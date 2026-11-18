/**
 * Firestore Event-Driven Triggers
 * 
 * 1. onBillWritten: Increments daily & monthly summaries, triggers low-stock alerts.
 * 2. onOutflowWritten: Increments expense summaries, updates Weighted-Average Cost on purchases.
 * 3. onPaymentWritten: Fires payment received notification to bill creator.
 * 4. onDeliveryWritten: Fires delivery assigned notification to rider.
 */

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { db } from "../services/firebase.js";
import { recordBillSummary, recordOutflowSummary } from "../services/summaryService.js";
import { createAndDispatchNotification } from "../services/notificationService.js";
import { reserveIdempotency } from "../services/idempotency.js";
import { BillDoc, OutflowDoc, PaymentDoc, DeliveryDoc, ProductDoc, RequestDoc, RequestActivityDoc } from "../types/models.js";
import { withTriggerContext, organizationOfDocumentEvent } from "../services/systemContext.js";
import { BillStatus, OutflowKind, OutflowStatus, DocumentType } from "../constants/enums.js";

/**
 * 1. onBillWritten
 */
export const onBillWritten = onDocumentWritten(
  { document: "bills/{billId}", region: "asia-south1" },
  withTriggerContext("onBillWritten", organizationOfDocumentEvent, async (event) => {
    const after = event.data?.after;
    if (!after || !after.exists) return; // Deleted

    const before = event.data?.before;
    const bill = after.data() as BillDoc;

    const isNew = !before || !before.exists;
    const wasDraft = before && before.exists && (before.data()?.status === "draft" || before.data()?.documentType === DocumentType.QUOTATION || before.data()?.documentType === DocumentType.PROFORMA);
    const isNowActive = bill.status === BillStatus.ACTIVE;
    const justFinalized = wasDraft && isNowActive;

    if ((isNew && isNowActive) || justFinalized) {
      await recordBillSummary(bill);

      // Check low-stock threshold for items
      if (Array.isArray(bill.items)) {
        for (const item of bill.items) {
          try {
            const prodRef = db.collection("products").doc(item.productId);
            const prodSnap = await prodRef.get();
            if (prodSnap.exists) {
              const prod = prodSnap.data() as ProductDoc;
              const threshold = prod.lowStockThreshold ?? 10;
              if (prod.currentStock <= threshold) {
                const orgAdminsSnap = await db
                  .collection("memberships")
                  .where("organizationId", "==", bill.organizationId)
                  .where("isPrimary", "==", true)
                  .limit(1)
                  .get();

                if (!orgAdminsSnap.empty) {
                  const adminData = orgAdminsSnap.docs[0].data();
                  await createAndDispatchNotification({
                    organizationId: bill.organizationId,
                    userId: adminData.userId,
                    membershipId: orgAdminsSnap.docs[0].id,
                    type: "low_stock",
                    title: "Low Stock Alert",
                    body: `Product "${prod.name}" has reached low stock level (${prod.currentStock} remaining).`,
                    relatedEntityType: "product",
                    relatedEntityId: item.productId,
                  });
                }
              }
            }
          } catch {
            // Non-blocking
          }
        }
      }

      // Dispatch bill_created notification to org admin
      try {
        const orgAdminsSnap = await db
          .collection("memberships")
          .where("organizationId", "==", bill.organizationId)
          .where("isPrimary", "==", true)
          .limit(1)
          .get();

        if (!orgAdminsSnap.empty) {
          const adminData = orgAdminsSnap.docs[0].data();
          await createAndDispatchNotification({
            organizationId: bill.organizationId,
            userId: adminData.userId,
            membershipId: orgAdminsSnap.docs[0].id,
            type: "bill_created",
            title: "New Bill Created",
            body: `Invoice ${bill.billNumber || event.params.billId} for Rs ${bill.totalAmount} was generated.`,
            relatedEntityType: "bill",
            relatedEntityId: event.params.billId,
          });
        }
      } catch {
        // Non-blocking
      }
    }
  })
);

/**
 * 2. onOutflowWritten
 */
export const onOutflowWritten = onDocumentWritten(
  { document: "outflows/{outflowId}", region: "asia-south1" },
  withTriggerContext("onOutflowWritten", organizationOfDocumentEvent, async (event) => {
    const after = event.data?.after;
    if (!after || !after.exists) return;

    const before = event.data?.before;
    if (before && before.exists) return; // Only process on create

    const outflow = after.data() as OutflowDoc;
    if (outflow.status === OutflowStatus.CONFIRMED) {
      await recordOutflowSummary(outflow);

      // Dispatch outflow_recorded notification to org admin
      try {
        const orgAdminsSnap = await db
          .collection("memberships")
          .where("organizationId", "==", outflow.organizationId)
          .where("isPrimary", "==", true)
          .limit(1)
          .get();

        if (!orgAdminsSnap.empty) {
          const adminData = orgAdminsSnap.docs[0].data();
          const kindLabel = outflow.kind === OutflowKind.PURCHASE ? "Purchase" : "Expense";
          await createAndDispatchNotification({
            organizationId: outflow.organizationId,
            userId: adminData.userId,
            membershipId: orgAdminsSnap.docs[0].id,
            type: "outflow_recorded",
            title: `${kindLabel} Recorded`,
            body: `${kindLabel} ${outflow.outflowNumber || event.params.outflowId} of Rs ${outflow.totalAmount || 0} recorded.`,
            relatedEntityType: "outflow",
            relatedEntityId: event.params.outflowId,
          });
        }
      } catch {
        // Non-blocking
      }
      // Note: Authoritative WAC is computed strictly synchronously in the outflowsCreate/outflowsApprove
      // transaction (single writer). No background trigger updates WAC to guarantee zero concurrency race.
    }
  })
);

/**
 * 3. onPaymentWritten
 */
export const onPaymentWritten = onDocumentWritten(
  { document: "payments/{paymentId}", region: "asia-south1" },
  withTriggerContext("onPaymentWritten", organizationOfDocumentEvent, async (event) => {
    const after = event.data?.after;
    if (!after || !after.exists) return;
    const before = event.data?.before;
    if (before && before.exists) return;

    const payment = after.data() as PaymentDoc;
    if (payment.direction === "in" && payment.referenceId && payment.referenceModel === "bill") {
      try {
        const billSnap = await db.collection("bills").doc(payment.referenceId).get();
        if (billSnap.exists) {
          const bill = billSnap.data() as BillDoc;
          let targetMembershipId = bill.salespersonMembershipId || null;
          const targetUserId = bill.createdBy;

          if (targetUserId) {
            if (!targetMembershipId) {
              const memSnap = await db
                .collection("memberships")
                .where("organizationId", "==", payment.organizationId)
                .where("userId", "==", targetUserId)
                .limit(1)
                .get();
              if (!memSnap.empty) {
                targetMembershipId = memSnap.docs[0].id;
              }
            }
            await createAndDispatchNotification({
              organizationId: payment.organizationId,
              userId: targetUserId,
              membershipId: targetMembershipId,
              type: "payment_received",
              title: "Payment Received",
              body: `Payment of Rs ${payment.amount} received for invoice ${bill.billNumber}.`,
              relatedEntityType: "payment",
              relatedEntityId: event.params.paymentId,
            });
          }
        }
      } catch {
        // Non-blocking
      }
    }
  })
);

/**
 * 4. onDeliveryWritten
 */
export const onDeliveryWritten = onDocumentWritten(
  { document: "deliveries/{deliveryId}", region: "asia-south1" },
  withTriggerContext("onDeliveryWritten", organizationOfDocumentEvent, async (event) => {
    const after = event.data?.after;
    if (!after || !after.exists) return;

    const before = event.data?.before;
    const delivery = after.data() as DeliveryDoc;

    const riderChanged = !before || !before.exists || before.data()?.riderMembershipId !== delivery.riderMembershipId;

    if (delivery.riderMembershipId && riderChanged) {
      try {
        const memberSnap = await db.collection("memberships").doc(delivery.riderMembershipId).get();
        if (memberSnap.exists) {
          const member = memberSnap.data()!;
          await createAndDispatchNotification({
            organizationId: delivery.organizationId,
            userId: member.userId,
            membershipId: delivery.riderMembershipId,
            type: "delivery_assigned",
            title: "New Delivery Assigned",
            body: `You have been assigned delivery ${event.params.deliveryId} to ${delivery.address?.city || "the customer"}.`,
            relatedEntityType: "delivery",
            relatedEntityId: event.params.deliveryId,
          });
        }
      } catch {
        // Non-blocking
      }
    }
  })
);

/**
 * 5. onRequestActivityWritten
 * Dispatches notifications on public activity (comments, status changes).
 * Idempotent delivery marker keyed by event.id (D-45).
 */
export const onRequestActivityWritten = onDocumentWritten(
  { document: "requests/{requestId}/activity/{activityId}", region: "asia-south1" },
  withTriggerContext("onRequestActivityWritten", () => null, async (event) => {
    const after = event.data?.after;
    if (!after || !after.exists) return; // Deleted
    const before = event.data?.before;
    if (before && before.exists) return; // Only process new activity records

    const activity = after.data() as RequestActivityDoc;
    // D-38: internal notes never notify tenants
    if (activity.visibility === "internal") return;

    const requestId = event.params.requestId;
    const reqSnap = await db.collection("requests").doc(requestId).get();
    if (!reqSnap.exists) return;
    const requestDoc = reqSnap.data() as RequestDoc;

    const reservation = await reserveIdempotency({
      scope: requestDoc.organizationId || "platform",
      actorUid: "system",
      operation: "trigger.requestActivity",
      clientKey: event.id,
      payload: { requestId, activityId: event.params.activityId },
    });
    if (reservation.isDuplicate) return;

    // Determine recipient: if author is requester, notify assignee;
    // if author is platform/manager, notify requester.
    const isAuthorRequester = activity.author.uid === requestDoc.requester.uid;
    const recipientUid = isAuthorRequester ? (requestDoc.assignee?.uid || null) : requestDoc.requester.uid;

    if (recipientUid) {
      try {
        let recipientMembershipId: string | null = null;
        if (requestDoc.organizationId && requestDoc.organizationId !== "platform") {
          const memSnap = await db
            .collection("memberships")
            .where("organizationId", "==", requestDoc.organizationId)
            .where("userId", "==", recipientUid)
            .limit(1)
            .get();
          if (!memSnap.empty) {
            recipientMembershipId = memSnap.docs[0].id;
          }
        }

        await createAndDispatchNotification({
          organizationId: requestDoc.organizationId,
          userId: recipientUid,
          membershipId: recipientMembershipId,
          type: "request_updated",
          title: `Update on ${requestDoc.requestNumber}`,
          body: activity.content || `Request ${requestDoc.requestNumber} status changed to ${requestDoc.status}.`,
          relatedEntityType: "request",
          relatedEntityId: requestId,
        });
      } catch {
        // Non-blocking notification dispatch
      }
    }

    if (reservation.recordId) {
      await db.collection("idempotencyRecords").doc(reservation.recordId).update({
        status: "succeeded",
        result: { dispatched: !!recipientUid },
        updatedAt: new Date().toISOString(),
      });
    }
  })
);

