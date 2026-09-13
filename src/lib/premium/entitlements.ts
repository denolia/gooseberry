import { eq } from "drizzle-orm";
import { getDb } from "@/db/drizzle";
import { appUser } from "@/db/schema";

export async function hasPremiumAccess(userId: string): Promise<boolean> {
  const [user] = await getDb()
    .select({ tier: appUser.tier })
    .from(appUser)
    .where(eq(appUser.id, userId))
    .limit(1);
  return user?.tier === "premium";
}
