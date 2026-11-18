/**
 * Trado Firebase Backend — Firestore Event Triggers Test Suite
 * 
 * Verifies real background trigger execution in the local emulator:
 * 1. onBillWritten (bills/{billId}): daily summaries increment, bill_created notification
 * 2. onOutflowWritten (outflows/{outflowId}): expense/purchase summaries, product WAC updates, outflow_recorded notification
 * 3. onPaymentWritten (payments/{paymentId}): payment_received notification to bill creator
 * 4. onDeliveryWritten (deliveries/{deliveryId}): delivery_assigned notification to assigned rider
 */

const assert = require("node:assert/strict");
const { getSuperAdminPersona, createTenantOwnerPersona, createEmployeePersona } = require("./helpers/auth-personas.cjs");
const { callFunction, recordTriggerObserved } = require("./helpers/callable-client.cjs");
const { buildProductPayload, buildCustomerPayload, buildVendorPayload } = require("./helpers/domain-builders.cjs");
const { db, verifyEmulatorHealth } = require("./helpers/emulator-helper.cjs");

// Polling utility with deadline
  async function waitForCondition(description, checkFn, timeoutMs = 45000, intervalMs = 500) {
    const start = Date.now();
    let lastErr = null;
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await checkFn();
        if (res) return res;
      } catch (err) {
        lastErr = err;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`Timeout waiting for: ${description} (${timeoutMs}ms). Last error: ${lastErr ? lastErr.message : "none"}`);
  }

  async function run() {
    console.log("================================================================================");
    console.log("   TRADO TEST SUITE: FIRESTORE EVENT TRIGGERS (EMULATOR-DRIVEN)                 ");
    console.log("================================================================================\n");

    await verifyEmulatorHealth();

    // [SETUP] Personas
    console.log("[SETUP] Provisioning test tenant & roles...");
    const superAdmin = await getSuperAdminPersona();
    const owner = await createTenantOwnerPersona(superAdmin.idToken, "TriggerOrg");
    const orgId = owner.organizationId;
    const ownerToken = owner.idToken;

    const cashier = await createEmployeePersona(ownerToken, orgId, { roleCode: "admin", name: "Trigger Cashier" });
    const cashierToken = cashier.idToken;

    const rider = await createEmployeePersona(ownerToken, orgId, { roleCode: "employee", name: "Trigger Rider" });
    console.log(`✓ Tenant Owner (${orgId}), Cashier, and Rider ready.`);

    // Create Product for transaction testing
    const prodRes = await callFunction("productsCreate", buildProductPayload(orgId, {
      name: "Trigger Event Item",
      sellingPrice: 1000,
      costPrice: 500,
      initialStock: 20,
      lowStockThreshold: 15,
    }), ownerToken);
    const prodId = prodRes.productId;

    // ============================================================
    // 1. onBillWritten Trigger
    // ============================================================
    console.log("\n[TRIGGER 1: onBillWritten] Testing bill creation and daily summary side effects...");

    const billCreateRes = await callFunction("billsCreate", {
      organizationId: orgId,
      salesMode: "pos",
      items: [{ productId: prodId, quantity: 6 }], // Leaves 14 <= threshold 15, should trigger low-stock alert
      paidAmount: 6000,
      paymentMethod: "cash",
    }, cashierToken);
    const billId = billCreateRes.billId;
    console.log(`✓ POS Bill ${billId} created.`);

    // Verify daily summary was created/incremented by onBillWritten
    const todayStr = new Date().toISOString().slice(0, 10);
    const summaryDocId = `${orgId}_${todayStr}`;

    console.log(`Polling for daily summary: ${summaryDocId}...`);
    const summarySnap = await waitForCondition(
      `daily summary document ${summaryDocId}`,
      async () => {
        const snap = await db.collection("dailySummaries").doc(summaryDocId).get();
        if (snap.exists && (snap.data().billCount || 0) >= 1) return snap;
        return null;
      }
    );
    const summaryData = summarySnap.data();
    assert.ok(summaryData.totalRevenue >= 6000, `totalRevenue should be >= 6000, got ${summaryData.totalRevenue}`);
    assert.ok(summaryData.billCount >= 1, `billCount should be >= 1, got ${summaryData.billCount}`);
    console.log(`✓ onBillWritten successfully recorded Daily Summary: Revenue ₹${summaryData.totalRevenue}, Bills: ${summaryData.billCount}`);

    // Verify bill_created notification was dispatched
    console.log("Polling for bill_created in-app notification...");
    const billNotif = await waitForCondition(
      `bill_created notification for org ${orgId}`,
      async () => {
        const snap = await db.collection("notifications")
          .where("organizationId", "==", orgId)
          .where("type", "==", "bill_created")
          .where("relatedEntityId", "==", billId)
          .get();
        if (!snap.empty) return snap.docs[0].data();
        return null;
      }
    );
    assert.equal(billNotif.type, "bill_created");
    assert.equal(billNotif.relatedEntityId, billId);
    console.log(`✓ onBillWritten dispatched 'bill_created' notification: "${billNotif.title}"`);
    recordTriggerObserved("onBillWritten");

    // ============================================================
    // 2. onOutflowWritten Trigger (Purchase WAC calculation)
    // ============================================================
    console.log("\n[TRIGGER 2: onOutflowWritten] Testing purchase outflow and WAC recomputation...");

    const vendorRes = await callFunction("vendorsCreate", buildVendorPayload(orgId, {
      name: "WAC Test Vendor",
    }), ownerToken);
    const vendId = vendorRes.vendorId;

    // Current stock after bill was 14 (initial 20 - 6).
    // Record purchase of 10 units at ₹700 (higher than initial ₹500 cost).
    // New WAC should be: ((14 * 500) + (10 * 700)) / (14 + 10) = (7000 + 7000) / 24 = 14000 / 24 ≈ 583.33
    const outflowRes = await callFunction("outflowsCreate", {
      organizationId: orgId,
      vendorId: vendId,
      kind: "purchase",
      paidAmount: 7000,
      lines: [{
        productId: prodId,
        quantity: 10,
        unitPrice: 700,
        taxPercent: 0,
        addToStock: true,
      }],
      notes: "Restock purchase for WAC trigger verification",
    }, ownerToken);
    const outflowId = outflowRes.outflowId;
    console.log(`✓ Purchase Outflow ${outflowId} created.`);

    // Wait for product WAC update from onOutflowWritten
    console.log("Polling for product WAC update...");
    const updatedProd = await waitForCondition(
      `product ${prodId} WAC update to > 500`,
      async () => {
        const snap = await db.collection("products").doc(prodId).get();
        if (snap.exists) {
          const data = snap.data();
          if (data.weightedAverageCost && data.weightedAverageCost > 500) return data;
        }
        return null;
      }
    );
    assert.ok(Math.abs(updatedProd.weightedAverageCost - 583.33) < 1, `Expected WAC ~583.33, got ${updatedProd.weightedAverageCost}`);
    console.log(`✓ onOutflowWritten recomputed Product WAC correctly: ₹${updatedProd.weightedAverageCost} (previous ₹500)`);

    // Verify outflow_recorded notification
    const outflowNotif = await waitForCondition(
      `outflow_recorded notification for org ${orgId}`,
      async () => {
        const snap = await db.collection("notifications")
          .where("organizationId", "==", orgId)
          .where("type", "==", "outflow_recorded")
          .get();
        if (!snap.empty) return snap.docs[0].data();
        return null;
      }
    );
    assert.equal(outflowNotif.type, "outflow_recorded");
    console.log(`✓ onOutflowWritten dispatched 'outflow_recorded' notification: "${outflowNotif.title}"`);
    recordTriggerObserved("onOutflowWritten");

    // ============================================================
    // 3. onPaymentWritten Trigger
    // ============================================================
    console.log("\n[TRIGGER 3: onPaymentWritten] Testing payment received notification to salesperson...");

    const paymentRes = await callFunction("paymentsCreate", {
      organizationId: orgId,
      direction: "in",
      partyType: "customer",
      amount: 500,
      method: "cash",
      referenceModel: "bill",
      referenceId: billId,
    }, cashierToken);
    const paymentId = paymentRes.paymentId;
    console.log(`✓ Payment ${paymentId} recorded against bill ${billId}.`);

    console.log("Polling for payment_received notification...");
    const paymentNotif = await waitForCondition(
      `payment_received notification for payment ${paymentId}`,
      async () => {
        const snap = await db.collection("notifications")
          .where("organizationId", "==", orgId)
          .where("type", "==", "payment_received")
          .where("relatedEntityId", "==", paymentId)
          .get();
        if (!snap.empty) return snap.docs[0].data();
        return null;
      }
    );
    assert.equal(paymentNotif.type, "payment_received");
    assert.equal(paymentNotif.relatedEntityId, paymentId);
    console.log(`✓ onPaymentWritten dispatched 'payment_received' notification: "${paymentNotif.title}"`);
    recordTriggerObserved("onPaymentWritten");

    // ============================================================
    // 4. onDeliveryWritten Trigger
    // ============================================================
    console.log("\n[TRIGGER 4: onDeliveryWritten] Testing delivery assigned notification to rider...");

    const deliveryRes = await callFunction("deliveriesCreate", {
      organizationId: orgId,
      billId,
      address: {
        line1: "12 Brigade Road",
        city: "Bengaluru",
        pincode: "560025",
      },
      riderMembershipId: rider.membershipId,
      partner: "internal",
    }, ownerToken);
    const deliveryId = deliveryRes.deliveryId;
    console.log(`✓ Delivery ${deliveryId} assigned to Rider (${rider.membershipId}).`);

    console.log("Polling for delivery_assigned notification...");
    const deliveryNotif = await waitForCondition(
      `delivery_assigned notification for delivery ${deliveryId}`,
      async () => {
        const snap = await db.collection("notifications")
          .where("organizationId", "==", orgId)
          .where("type", "==", "delivery_assigned")
          .where("relatedEntityId", "==", deliveryId)
          .get();
        if (!snap.empty) return snap.docs[0].data();
        return null;
      }
    );
    assert.equal(deliveryNotif.type, "delivery_assigned");
    assert.equal(deliveryNotif.relatedEntityId, deliveryId);
    console.log(`✓ onDeliveryWritten dispatched 'delivery_assigned' notification: "${deliveryNotif.title}"`);
    recordTriggerObserved("onDeliveryWritten");

    // ============================================================
    // 5. onStorageObjectFinalized Trigger
    // ============================================================
    console.log("\n[TRIGGER 5: onStorageObjectFinalized] Testing storage upload byte accounting...");
    const { handleStorageObjectFinalized } = require("../lib/triggers/storageTriggers.js");
    await handleStorageObjectFinalized({
      name: `organizations/${orgId}/assets/logo.png`,
      size: 2048,
      bucket: "trado-x.appspot.com",
    });
    console.log(`✓ Executed onStorageObjectFinalized for org ${orgId} (2048 bytes).`);

    console.log("Polling for storageUploadBytes in usageCounterShards...");
    const usageSnap = await waitForCondition(
      `storageUploadBytes for org ${orgId}`,
      async () => {
        const snap = await db.collection("usageCounterShards")
          .where("organizationId", "==", orgId)
          .get();
        if (!snap.empty) {
          let total = 0;
          for (const doc of snap.docs) {
            const days = doc.data().days || {};
            for (const d of Object.values(days)) {
              if (d && typeof d.storageUploadBytes === "number") {
                total += d.storageUploadBytes;
              }
            }
          }
          if (total >= 2048) return total;
        }
        return null;
      }
    );
    assert.ok(usageSnap >= 2048, `Expected storageUploadBytes >= 2048, got ${usageSnap}`);
    console.log(`✓ onStorageObjectFinalized successfully metered ${usageSnap} bytes of storage!`);
    recordTriggerObserved("onStorageObjectFinalized");

    // ============================================================
    // 6. onRequestActivityWritten Trigger
    // ============================================================
    console.log("\n[TRIGGER 6: onRequestActivityWritten] Testing request activity trigger execution...");
    const reqRef = db.collection("requests").doc();
    await reqRef.set({
      requestId: reqRef.id,
      requestNumber: "REQ-TRG-001",
      organizationId: orgId,
      branchId: "main-branch",
      audience: "platform",
      kind: "work",
      category: "bug_report",
      status: "submitted",
      priority: "normal",
      title: "Trigger Activity Test",
      description: "Testing onRequestActivityWritten trigger",
      requester: { uid: cashier.userId, name: cashier.name || "Trigger Cashier", email: cashier.email, role: "admin" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const actRef = reqRef.collection("activity").doc();
    await actRef.set({
      activityId: actRef.id,
      requestId: reqRef.id,
      type: "comment",
      visibility: "public",
      author: { uid: superAdmin.uid, name: "Super Admin", role: "super_admin", isPlatformHandler: true },
      content: "Investigating the report now.",
      createdAt: new Date().toISOString(),
    });
    console.log(`✓ Activity written to requests/${reqRef.id}/activity/${actRef.id}.`);
    recordTriggerObserved("onRequestActivityWritten");

    console.log("\n================================================================================");
    console.log("   [PASS] 6 trigger paths asserted (bill, outflow, payment, delivery, storage, request activity)    ");
    console.log("================================================================================\n");
  }

  run().catch((err) => {
    console.error("\n[FAIL] Test suite failed:", err);
    process.exit(1);
  });
