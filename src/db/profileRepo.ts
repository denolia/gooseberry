import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/drizzle";
import { appUser, premiumRequest, userPreference } from "@/db/schema";
import { isAdminEmail } from "@/lib/admin/access";
import type { SourceLanguage, TargetLanguage } from "@/components/ui/Languages";

export type AccountTier = "free" | "premium";
export type PremiumRequestStatus =
  | "pending"
  | "approved"
  | "declined"
  | "cancelled";

function accountTier(value: string): AccountTier {
  return value === "premium" ? "premium" : "free";
}

export async function getUserProfile(userId: string) {
  const db = getDb();
  const [user] = await db
    .select({
      id: appUser.id,
      email: appUser.email,
      name: appUser.name,
      imageUrl: appUser.imageUrl,
      tier: appUser.tier,
      createdAt: appUser.createdAt,
      premiumGrantedAt: appUser.premiumGrantedAt,
    })
    .from(appUser)
    .where(eq(appUser.id, userId))
    .limit(1);

  if (!user) return null;

  const [preferences, pendingRequest] = await Promise.all([
    db
      .select()
      .from(userPreference)
      .where(eq(userPreference.userId, userId))
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select({
        id: premiumRequest.id,
        status: premiumRequest.status,
        message: premiumRequest.message,
        createdAt: premiumRequest.createdAt,
      })
      .from(premiumRequest)
      .where(
        and(
          eq(premiumRequest.userId, userId),
          eq(premiumRequest.status, "pending"),
        ),
      )
      .orderBy(desc(premiumRequest.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  const tier =
    accountTier(user.tier) === "premium" || isAdminEmail(user.email)
      ? "premium"
      : "free";

  return {
    ...user,
    tier: tier satisfies AccountTier,
    isAdmin: isAdminEmail(user.email),
    preferences: {
      defaultSourceLang: (preferences?.defaultSourceLang ??
        "German") as SourceLanguage,
      defaultTargetLang: (preferences?.defaultTargetLang ??
        "English") as TargetLanguage,
    },
    pendingRequest,
  };
}

export async function updateUserPreferences(input: {
  userId: string;
  defaultSourceLang: SourceLanguage;
  defaultTargetLang: TargetLanguage;
}) {
  const [preferences] = await getDb()
    .insert(userPreference)
    .values({
      userId: input.userId,
      defaultSourceLang: input.defaultSourceLang,
      defaultTargetLang: input.defaultTargetLang,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userPreference.userId,
      set: {
        defaultSourceLang: input.defaultSourceLang,
        defaultTargetLang: input.defaultTargetLang,
        updatedAt: new Date(),
      },
    })
    .returning();
  return preferences;
}

export async function createPremiumRequest(input: {
  userId: string;
  message?: string | null;
}) {
  const db = getDb();
  const [user] = await db
    .select({ tier: appUser.tier, email: appUser.email, name: appUser.name })
    .from(appUser)
    .where(eq(appUser.id, input.userId))
    .limit(1);

  if (!user) return { kind: "missing-user" as const };
  if (accountTier(user.tier) === "premium" || isAdminEmail(user.email)) {
    return { kind: "already-premium" as const };
  }

  const [created] = await db
    .insert(premiumRequest)
    .values({ userId: input.userId, message: input.message || null })
    .onConflictDoNothing()
    .returning({
      id: premiumRequest.id,
      createdAt: premiumRequest.createdAt,
    });

  if (!created) {
    return { kind: "already-pending" as const };
  }

  return { kind: "created" as const, request: created, user };
}
