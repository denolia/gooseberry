import { db } from "@/db/drizzle";
import { appUser, translationHistory } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

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
