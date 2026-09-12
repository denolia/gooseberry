import { eq } from "drizzle-orm";
import { getDb } from "@/db/drizzle";
import { appUser } from "@/db/schema";
import { isAdminEmail } from "@/lib/admin/access";

export async function hasPremiumAccess(userId: string): Promise<boolean> {
  const [user] = await getDb()
    .select({ tier: appUser.tier, email: appUser.email })
    .from(appUser)
    .where(eq(appUser.id, userId))
    .limit(1);
  return Boolean(
    user && (user.tier === "premium" || isAdminEmail(user.email)),
  );
}
