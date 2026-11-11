import { and, desc, eq, ilike, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db/drizzle";
import { readerText } from "@/db/schema";
import { defaultReaderTitle } from "@/lib/reader/library";
import type { ReaderHistoryCursor } from "@/lib/reader/server";

export async function listReaderTexts(
  userId: string,
  {
    search = "",
    cursor,
    limit = 50,
  }: {
    search?: string;
    cursor?: ReaderHistoryCursor;
    limit?: number;
  } = {},
) {
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await getDb()
    .select({
      id: readerText.id,
      title: readerText.title,
      preview: sql<string>`left(${readerText.text}, 160)`,
      sourceLang: readerText.sourceLang,
      targetLang: readerText.targetLang,
      createdAt: readerText.createdAt,
      updatedAt: readerText.updatedAt,
    })
    .from(readerText)
    .where(
      and(
        eq(readerText.userId, userId),
        search
          ? or(
              ilike(readerText.title, pattern),
              ilike(readerText.text, pattern),
            )
          : undefined,
        cursor
          ? or(
              lt(readerText.createdAt, cursor.createdAt),
              and(
                eq(readerText.createdAt, cursor.createdAt),
                lt(readerText.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(readerText.createdAt), desc(readerText.id))
    .limit(limit + 1);
  const texts = rows.slice(0, limit);
  const last = texts.at(-1);
  return {
    texts,
    nextCursor:
      rows.length > limit && last
        ? { createdAt: last.createdAt, id: last.id }
        : null,
  };
}

export async function getReaderText(userId: string, id: string) {
  const [row] = await getDb()
    .select()
    .from(readerText)
    .where(and(eq(readerText.userId, userId), eq(readerText.id, id)))
    .limit(1);
  return row ?? null;
}

export async function saveNewReaderText(input: {
  id: string;
  userId: string;
  text: string;
  sourceLang: string;
  targetLang: string;
}) {
  // The draft's stable UUID makes a retry after a lost response idempotent.
  // A conflicting UUID owned by another account can never be updated.
  const [row] = await getDb()
    .insert(readerText)
    .values({
      ...input,
      title: defaultReaderTitle(input.text, input.sourceLang),
    })
    .onConflictDoUpdate({
      target: readerText.id,
      set: {
        text: input.text,
        sourceLang: input.sourceLang,
        targetLang: input.targetLang,
        updatedAt: new Date().toISOString(),
      },
      setWhere: eq(readerText.userId, input.userId),
    })
    .returning();
  return row ?? null;
}

export async function updateReaderText(
  userId: string,
  id: string,
  input: {
    title?: string;
    text?: string;
    sourceLang?: string;
    targetLang?: string;
  },
) {
  const [row] = await getDb()
    .update(readerText)
    .set({ ...input, updatedAt: new Date().toISOString() })
    .where(and(eq(readerText.userId, userId), eq(readerText.id, id)))
    .returning();
  return row ?? null;
}

export async function deleteReaderText(userId: string, id: string) {
  const [row] = await getDb()
    .delete(readerText)
    .where(and(eq(readerText.userId, userId), eq(readerText.id, id)))
    .returning({ id: readerText.id });
  return row ?? null;
}
