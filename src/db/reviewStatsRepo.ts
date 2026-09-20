import { getDb } from "@/db/drizzle";
import { fsrsCardState, studyCard, wordSet, wordSetItem } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  FsrsCardState,
  NATIVE_STUDY_CARD_TEMPLATE,
  type FsrsCardStateValue,
} from "@/lib/review/model";

export type WordSetItemReviewStats = {
  wordSetItemId: string;
  state: FsrsCardStateValue;
  dueAt: Date | null;
  reps: number;
  lapses: number;
  lastReviewAt: Date | null;
};

export type WordSetReviewStats = {
  wordSetId: string;
  itemCount: number;
  enabledItemCount: number;
  dueCount: number;
};

export async function getWordSetItemReviewStats(input: {
  userId: string;
  wordSetId: string;
}): Promise<WordSetItemReviewStats[]> {
  const rows = await getDb()
    .select({
      wordSetItemId: wordSetItem.id,
      state: fsrsCardState.state,
      dueAt: fsrsCardState.dueAt,
      reps: fsrsCardState.reps,
      lapses: fsrsCardState.lapses,
      lastReviewAt: fsrsCardState.lastReviewAt,
    })
    .from(wordSetItem)
    .innerJoin(wordSet, eq(wordSet.id, wordSetItem.wordSetId))
    .leftJoin(
      studyCard,
      and(
        eq(studyCard.wordSetItemId, wordSetItem.id),
        eq(studyCard.templateKey, NATIVE_STUDY_CARD_TEMPLATE),
      ),
    )
    .leftJoin(
      fsrsCardState,
      and(
        eq(fsrsCardState.studyCardId, studyCard.id),
        eq(fsrsCardState.userId, input.userId),
      ),
    )
    .where(
      and(eq(wordSet.id, input.wordSetId), eq(wordSet.userId, input.userId)),
    );

  return rows.map((row) => ({
    wordSetItemId: row.wordSetItemId,
    state: (row.state ?? FsrsCardState.New) as FsrsCardStateValue,
    dueAt: row.dueAt,
    reps: row.reps ?? 0,
    lapses: row.lapses ?? 0,
    lastReviewAt: row.lastReviewAt,
  }));
}

export async function getWordSetReviewStats(input: {
  userId: string;
  now: Date;
}): Promise<WordSetReviewStats[]> {
  const rows = await getDb()
    .select({
      wordSetId: wordSet.id,
      itemCount: sql<number>`count(DISTINCT ${wordSetItem.id})`,
      enabledItemCount: sql<number>`count(DISTINCT ${wordSetItem.id}) FILTER (WHERE ${wordSetItem.isEnabled} = true)`,
      dueCount: sql<number>`count(DISTINCT ${wordSetItem.id}) FILTER (
        WHERE ${wordSetItem.isEnabled} = true
          AND (${fsrsCardState.studyCardId} IS NULL OR ${fsrsCardState.dueAt} <= ${input.now})
      )`,
    })
    .from(wordSet)
    .leftJoin(wordSetItem, eq(wordSetItem.wordSetId, wordSet.id))
    .leftJoin(
      studyCard,
      and(
        eq(studyCard.wordSetItemId, wordSetItem.id),
        eq(studyCard.templateKey, NATIVE_STUDY_CARD_TEMPLATE),
      ),
    )
    .leftJoin(
      fsrsCardState,
      and(
        eq(fsrsCardState.studyCardId, studyCard.id),
        eq(fsrsCardState.userId, input.userId),
      ),
    )
    .where(eq(wordSet.userId, input.userId))
    .groupBy(wordSet.id);

  return rows.map((row) => ({
    wordSetId: row.wordSetId,
    itemCount: Number(row.itemCount),
    enabledItemCount: Number(row.enabledItemCount),
    dueCount: Number(row.dueCount),
  }));
}
