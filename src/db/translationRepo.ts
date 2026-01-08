import { db } from "@/db/drizzle";
import { appUser, translationHistory } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";

export async function upsertUser(input: {
  provider: "google";
  providerUserId: string; // session.user.id (sub)
  email?: string | null;
  name?: string | null;
  imageUrl?: string | null;
}) {
  const [row] = await db
    .insert(appUser)
    .values({
      provider: input.provider,
      providerUserId: input.providerUserId,
      email: input.email ?? null,
      name: input.name ?? null,
      imageUrl: input.imageUrl ?? null,
      lastLoginAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [appUser.provider, appUser.providerUserId],
      set: {
        email: input.email ?? null,
        name: input.name ?? null,
        imageUrl: input.imageUrl ?? null,
        lastLoginAt: new Date(),
      },
    })
    .returning({ id: appUser.id });

  return row.id;
}

export async function insertTranslation(input: {
  userId: string;
  sourceLang: string;
  targetLang: string;
  inputText: string;
  responseJson: unknown;
  model?: string;
  promptVersion?: string;
}) {
  await db.insert(translationHistory).values({
    userId: input.userId,
    sourceLang: input.sourceLang,
    targetLang: input.targetLang,
    inputText: input.inputText,
    responseJson: input.responseJson,
    model: input.model,
    promptVersion: input.promptVersion,
  });
}

export async function listLast50(userId: string) {
  return db
    .select()
    .from(translationHistory)
    .where(eq(translationHistory.userId, userId))
    .orderBy(desc(translationHistory.createdAt))
    .limit(50);
}

export async function getUserIdByProviderUserId(
  provider: "google",
  providerUserId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: appUser.id })
    .from(appUser)
    .where(
      and(
        eq(appUser.provider, provider),
        eq(appUser.providerUserId, providerUserId),
      ),
    )
    .limit(1);

  return row?.id ?? null;
}

export async function translationExists(
  userId: string,
  inputText: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: translationHistory.id })
    .from(translationHistory)
    .where(
      and(
        eq(translationHistory.userId, userId),
        eq(translationHistory.inputText, inputText),
      ),
    )
    .limit(1);

  return !!row;
}
