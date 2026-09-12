import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/drizzle";
import { appUser, premiumRequest } from "@/db/schema";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export async function getPendingPremiumRequests() {
  await requireAdmin();
  return getDb()
    .select({
      id: premiumRequest.id,
      userId: premiumRequest.userId,
      name: appUser.name,
      email: appUser.email,
      message: premiumRequest.message,
      createdAt: premiumRequest.createdAt,
    })
    .from(premiumRequest)
    .innerJoin(appUser, eq(appUser.id, premiumRequest.userId))
    .where(eq(premiumRequest.status, "pending"))
    .orderBy(asc(premiumRequest.createdAt));
}

export async function resolvePremiumRequest(
  requestId: string,
  decision: "approved" | "declined",
) {
  const admin = await requireAdmin();
  const db = getDb();

  if (decision === "approved") {
    const result = await db.execute(sql`
      WITH resolved AS (
        UPDATE premium_request
        SET status = 'approved', resolved_at = now(), resolved_by = ${admin.id}
        WHERE id = ${requestId} AND status = 'pending'
        RETURNING user_id
      )
      UPDATE app_user
      SET tier = 'premium', premium_granted_at = now(), premium_granted_by = ${admin.id}
      WHERE id IN (SELECT user_id FROM resolved)
      RETURNING id
    `);
    return result.rows.length > 0;
  }

  const [resolved] = await db
    .update(premiumRequest)
    .set({
      status: decision,
      resolvedAt: new Date(),
      resolvedBy: admin.id,
    })
    .where(
      and(
        eq(premiumRequest.id, requestId),
        eq(premiumRequest.status, "pending"),
      ),
    )
    .returning({ id: premiumRequest.id });
  return Boolean(resolved);
}
