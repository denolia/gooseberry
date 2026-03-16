import { db } from "@/db/drizzle";
import { wordSet, wordSetItem } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";

export async function createWordSet(input: {
  userId: string;
  name: string;
  sourceLang: string;
  targetLang: string;
}) {
  const [set] = await db
    .insert(wordSet)
    .values({
      userId: input.userId,
      name: input.name,
      sourceLang: input.sourceLang,
      targetLang: input.targetLang,
    })
    .returning();

  return set;
}

export async function listWordSets(userId: string) {
  return db
    .select()
    .from(wordSet)
    .where(eq(wordSet.userId, userId))
    .orderBy(desc(wordSet.updatedAt));
}

export async function getWordSet(id: string, userId: string) {
  const [set] = await db
    .select()
    .from(wordSet)
    .where(and(eq(wordSet.id, id), eq(wordSet.userId, userId)))
    .limit(1);

  return set ?? null;
}

export async function updateWordSet(
  id: string,
  userId: string,
  updates: {
    name?: string;
    sourceLang?: string;
    targetLang?: string;
  },
) {
  const [set] = await db
    .update(wordSet)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(wordSet.id, id), eq(wordSet.userId, userId)))
    .returning();

  return set ?? null;
}

export async function deleteWordSet(id: string, userId: string) {
  await db
    .delete(wordSet)
    .where(and(eq(wordSet.id, id), eq(wordSet.userId, userId)));
}

export async function addItemsToWordSet(
  wordSetId: string,
  items: Array<{
    ankiNoteGuid: string;
    original: string;
    translation: string;
    wordForms?: string;
    sample?: string;
    sampleTranslation?: string;
    comments?: string;
    tags?: string;
    sourceTranslationId?: string;
    position: number;
  }>,
) {
  if (items.length === 0) return;

  await db.insert(wordSetItem).values(
    items.map((item) => ({
      wordSetId,
      ankiNoteGuid: item.ankiNoteGuid,
      original: item.original,
      translation: item.translation,
      wordForms: item.wordForms ?? "",
      sample: item.sample ?? "",
      sampleTranslation: item.sampleTranslation ?? "",
      comments: item.comments ?? "",
      tags: item.tags ?? "",
      sourceTranslationId: item.sourceTranslationId ?? null,
      position: item.position,
    })),
  );
}

export async function getWordSetItems(wordSetId: string) {
  return db
    .select()
    .from(wordSetItem)
    .where(eq(wordSetItem.wordSetId, wordSetId))
    .orderBy(wordSetItem.position);
}

export async function getWordSetItem(itemId: string) {
  const [item] = await db
    .select()
    .from(wordSetItem)
    .where(eq(wordSetItem.id, itemId))
    .limit(1);

  return item ?? null;
}

export async function updateWordSetItem(
  wordSetId: string,
  itemId: string,
  updates: {
    original?: string;
    translation?: string;
    wordForms?: string;
    sample?: string;
    sampleTranslation?: string;
    comments?: string;
    tags?: string;
    isEnabled?: boolean;
    position?: number;
  },
) {
  const [item] = await db
    .update(wordSetItem)
    .set({ ...updates, updatedAt: new Date() })
    .where(
      and(eq(wordSetItem.id, itemId), eq(wordSetItem.wordSetId, wordSetId)),
    )
    .returning({ id: wordSetItem.id });

  return item ?? null;
}

export async function deleteWordSetItem(wordSetId: string, itemId: string) {
  const [item] = await db
    .delete(wordSetItem)
    .where(
      and(eq(wordSetItem.id, itemId), eq(wordSetItem.wordSetId, wordSetId)),
    )
    .returning({ id: wordSetItem.id });

  return item ?? null;
}

export async function updateLastExportedAt(wordSetId: string) {
  await db
    .update(wordSet)
    .set({ lastExportedAt: new Date(), updatedAt: new Date() })
    .where(eq(wordSet.id, wordSetId));
}

export async function getWordSetItemCount(wordSetId: string): Promise<number> {
  const items = await db
    .select({ id: wordSetItem.id })
    .from(wordSetItem)
    .where(eq(wordSetItem.wordSetId, wordSetId));

  return items.length;
}
