import { getDb } from "@/db/drizzle";
import { appUser, translationHistory } from "@/db/schema";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";

export type TranslationHistoryCursor = {
  createdAt: string;
  id: string;
};

export async function upsertUser(input: {
  provider: "google";
  providerUserId: string; // session.user.id (sub)
  email?: string | null;
  name?: string | null;
  imageUrl?: string | null;
}) {
  const db = getDb();
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
  const db = getDb();
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

export async function listTranslationHistoryPage(
  userId: string,
  options: {
    limit: number;
    cursor?: TranslationHistoryCursor;
  },
) {
  const db = getDb();
  const cursorFilter = options.cursor
    ? or(
        lt(translationHistory.createdAt, options.cursor.createdAt),
        and(
          eq(translationHistory.createdAt, options.cursor.createdAt),
          lt(translationHistory.id, options.cursor.id),
        ),
      )
    : undefined;
  const rows = await db
    .select()
    .from(translationHistory)
    .where(
      cursorFilter
        ? and(eq(translationHistory.userId, userId), cursorFilter)
        : eq(translationHistory.userId, userId),
    )
    .orderBy(desc(translationHistory.createdAt), desc(translationHistory.id))
    .limit(options.limit + 1);

  const hasMore = rows.length > options.limit;
  const items = hasMore ? rows.slice(0, options.limit) : rows;
  const lastItem = items.at(-1);

  return {
    items,
    nextCursor:
      hasMore && lastItem
        ? { createdAt: lastItem.createdAt, id: lastItem.id }
        : null,
  };
}

export async function getUserIdByProviderUserId(
  provider: "google",
  providerUserId: string,
): Promise<string | null> {
  const db = getDb();
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

export async function getUserSessionByProviderUserId(
  provider: "google",
  providerUserId: string,
) {
  const db = getDb();
  const [row] = await db
    .select({ id: appUser.id, tier: appUser.tier, email: appUser.email })
    .from(appUser)
    .where(
      and(
        eq(appUser.provider, provider),
        eq(appUser.providerUserId, providerUserId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function translationExists(
  userId: string,
  inputText: string,
): Promise<boolean> {
  const db = getDb();
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

export async function getTranslationById(id: string, userId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(translationHistory)
    .where(
      and(eq(translationHistory.id, id), eq(translationHistory.userId, userId)),
    )
    .limit(1);

  return row ?? null;
}

export async function getTranslationsByIds(ids: string[], userId: string) {
  if (ids.length === 0) return [];

  const db = getDb();
  return db
    .select()
    .from(translationHistory)
    .where(
      and(
        eq(translationHistory.userId, userId),
        inArray(translationHistory.id, ids),
      ),
    );
}
