import { getDb } from "@/db/drizzle";
import { studyCard, wordSet, wordSetItem } from "@/db/schema";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { STUDY_CARD_TEMPLATE_KEYS } from "@/lib/review/templates";

export async function createWordSet(input: {
  userId: string;
  name: string;
  sourceLang: string;
  targetLang: string;
}) {
  const db = getDb();
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
  const db = getDb();
  return db
    .select()
    .from(wordSet)
    .where(eq(wordSet.userId, userId))
    .orderBy(desc(wordSet.updatedAt));
}

export async function getWordSet(id: string, userId: string) {
  const db = getDb();
  const [set] = await db
    .select()
    .from(wordSet)
    .where(and(eq(wordSet.id, id), eq(wordSet.userId, userId)))
    .limit(1);

  return set ?? null;
}

export async function getWordSetById(id: string) {
  const db = getDb();
  const [set] = await db
    .select()
    .from(wordSet)
    .where(eq(wordSet.id, id))
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
  const db = getDb();
  const [set] = await db
    .update(wordSet)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(wordSet.id, id), eq(wordSet.userId, userId)))
    .returning();

  return set ?? null;
}

export async function deleteWordSet(id: string, userId: string) {
  const db = getDb();
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

  const db = getDb();
  const itemRows = items.map((item) => ({
    id: crypto.randomUUID(),
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
  }));

  const [inserted] = await db.batch([
    db.insert(wordSetItem).values(itemRows).returning({ id: wordSetItem.id }),
    db.insert(studyCard).values(
      itemRows.flatMap(({ id }) =>
        STUDY_CARD_TEMPLATE_KEYS.map((templateKey) => ({
          wordSetItemId: id,
          templateKey,
        })),
      ),
    ),
  ]);

  return inserted;
}

export async function getExistingSourceTranslationIds(
  wordSetId: string,
  sourceTranslationIds: string[],
): Promise<string[]> {
  if (sourceTranslationIds.length === 0) return [];

  const db = getDb();
  const rows = await db
    .select({ sourceTranslationId: wordSetItem.sourceTranslationId })
    .from(wordSetItem)
    .where(
      and(
        eq(wordSetItem.wordSetId, wordSetId),
        inArray(wordSetItem.sourceTranslationId, sourceTranslationIds),
      ),
    );

  return rows
    .map((row) => row.sourceTranslationId)
    .filter((id): id is string => id !== null);
}

export async function getWordSetItems(wordSetId: string) {
  const db = getDb();
  return db
    .select()
    .from(wordSetItem)
    .where(eq(wordSetItem.wordSetId, wordSetId))
    .orderBy(wordSetItem.position);
}

export async function getWordSetItem(itemId: string) {
  const db = getDb();
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
    position?: number;
    examplePairs?: { sample: string; translation: string }[];
    contentRevision?: number;
  },
) {
  const db = getDb();
  const { contentRevision, ...content } = updates;
  const contentFields = Object.keys(content).filter(
    (field) => field !== "position" && field !== "examplePairs",
  ) as (
    | "original"
    | "translation"
    | "wordForms"
    | "sample"
    | "sampleTranslation"
    | "comments"
    | "tags"
  )[];
  const originChanges = contentFields.length
    ? sql.join(
        contentFields.map(
          (field) => sql`CASE
    WHEN ${wordSetItem[field]} IS DISTINCT FROM ${content[field]}
    THEN ${JSON.stringify({ [field]: { origin: "edited" } })}::jsonb ELSE '{}'::jsonb END`,
        ),
        sql` || `,
      )
    : sql`'{}'::jsonb`;
  const [item] = await db
    .update(wordSetItem)
    .set({
      ...content,
      contentRevision: sql`${wordSetItem.contentRevision} + 1`,
      fieldOrigins: sql`${wordSetItem.fieldOrigins} || ${originChanges}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(wordSetItem.id, itemId),
        eq(wordSetItem.wordSetId, wordSetId),
        contentRevision === undefined
          ? undefined
          : eq(wordSetItem.contentRevision, contentRevision),
      ),
    )
    .returning({ id: wordSetItem.id });

  return item ?? null;
}

export async function deleteWordSetItem(wordSetId: string, itemId: string) {
  const db = getDb();
  const [item] = await db
    .delete(wordSetItem)
    .where(
      and(eq(wordSetItem.id, itemId), eq(wordSetItem.wordSetId, wordSetId)),
    )
    .returning({ id: wordSetItem.id });

  return item ?? null;
}

export class MoveWordSetItemError extends Error {
  constructor(
    message: string,
    public status: 400 | 404 | 409,
  ) {
    super(message);
  }
}

export async function moveWordSetItem(input: {
  userId: string;
  sourceWordSetId: string;
  destinationWordSetId: string;
  itemId: string;
}) {
  const { userId, sourceWordSetId, destinationWordSetId, itemId } = input;
  if (sourceWordSetId === destinationWordSetId) {
    throw new MoveWordSetItemError("Choose another set.", 400);
  }
  const [source, destination] = await Promise.all([
    getWordSet(sourceWordSetId, userId),
    getWordSet(destinationWordSetId, userId),
  ]);
  if (!source || !destination)
    throw new MoveWordSetItemError("Word set not found.", 404);
  if (
    source.sourceLang !== destination.sourceLang ||
    source.targetLang !== destination.targetLang
  ) {
    throw new MoveWordSetItemError(
      "Choose a set with the same source and target languages.",
      400,
    );
  }

  const db = getDb();
  try {
    // The moved note keeps its import identity/baseline, but an undo of the
    // original import must no longer delete a word the user has relocated.
    await db.batch([
      // A stable lock order also serializes appends from concurrent moves.
      db.execute(sql`SELECT id FROM word_set WHERE user_id = ${userId}
        AND id IN (${sourceWordSetId}, ${destinationWordSetId}) ORDER BY id FOR UPDATE`),
      db.execute(sql`WITH moved AS (
        UPDATE word_set_item AS item SET
          word_set_id = ${destinationWordSetId},
          position = (SELECT coalesce(max(position), -1) + 1 FROM word_set_item WHERE word_set_id = ${destinationWordSetId}),
          import_job_id = NULL,
          updated_at = now()
        FROM word_set AS source, word_set AS destination
        WHERE item.id = ${itemId} AND item.word_set_id = ${sourceWordSetId}
          AND source.id = item.word_set_id AND source.user_id = ${userId}
          AND destination.id = ${destinationWordSetId} AND destination.user_id = ${userId}
          AND source.source_lang = destination.source_lang AND source.target_lang = destination.target_lang
        RETURNING item.id
      ) UPDATE word_set SET updated_at = now()
        WHERE id IN (${sourceWordSetId}, ${destinationWordSetId}) AND user_id = ${userId}
          AND EXISTS (SELECT 1 FROM moved)`),
    ]);
  } catch (error) {
    let cause: unknown = error;
    while (cause && typeof cause === "object") {
      if ("code" in cause && cause.code === "23505") {
        throw new MoveWordSetItemError(
          "This set already contains this imported word. Choose another set.",
          409,
        );
      }
      cause = "cause" in cause ? cause.cause : null;
    }
    throw error;
  }

  const item = await getWordSetItem(itemId);
  // A retry after a lost response succeeds without appending or copying again.
  if (item?.wordSetId === destinationWordSetId)
    return { id: item.id, wordSetId: destinationWordSetId };
  throw new MoveWordSetItemError(
    "This word is no longer in the source set. Refresh and try again.",
    409,
  );
}

export async function updateLastExportedAt(wordSetId: string) {
  const db = getDb();
  await db
    .update(wordSet)
    .set({ lastExportedAt: new Date(), updatedAt: new Date() })
    .where(eq(wordSet.id, wordSetId));
}

export async function getWordSetItemCount(wordSetId: string): Promise<number> {
  const db = getDb();
  const items = await db
    .select({ id: wordSetItem.id })
    .from(wordSetItem)
    .where(eq(wordSetItem.wordSetId, wordSetId));

  return items.length;
}
