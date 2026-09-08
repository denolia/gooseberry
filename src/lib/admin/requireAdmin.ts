import { auth } from "@/auth";
import { getDb } from "@/db/drizzle";
import { appUser } from "@/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { isAdminEmail } from "@/lib/admin/access";

export async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id || !isAdminEmail(session.user.email)) notFound();
  const [user] = await getDb()
    .select()
    .from(appUser)
    .where(eq(appUser.id, session.user.id))
    .limit(1);
  if (!user || user.provider !== "google" || !isAdminEmail(user.email))
    notFound();
  return user;
}
