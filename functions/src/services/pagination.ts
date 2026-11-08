/**
 * Cursor pagination shared by every list callable (one implementation).
 *
 * Input: `startAfterId` (the last document id of the previous page) and `limit`.
 * Output: the page snapshot and `nextCursor` (null on the last page). A cursor that no longer
 * exists restarts from the beginning rather than failing. Data-scope filtering after the query
 * may return fewer rows than `limit`; `nextCursor` still advances over the raw page.
 */

import { db } from "./firebase.js";

export interface Page {
  snapshot: FirebaseFirestore.QuerySnapshot;
  nextCursor: string | null;
}

export async function fetchPage(
  query: FirebaseFirestore.Query,
  collection: string,
  startAfterId: string | undefined,
  limit: number
): Promise<Page> {
  let q = query;
  if (startAfterId) {
    const cursor = await db.collection(collection).doc(startAfterId).get();
    if (cursor.exists) q = q.startAfter(cursor);
  }
  const snapshot = await q.limit(limit).get();
  return { snapshot, nextCursor: snapshot.size === limit ? snapshot.docs[snapshot.size - 1].id : null };
}
