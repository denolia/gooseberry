import { getDb } from "@/db/drizzle";
import { fsrsCardState, studyCard, wordSet, wordSetItem } from "@/db/schema";
import {
  eligibleStudyCardCondition,
  availableStudyCardCondition,
  ensureStudyCards,
} from "@/db/studyCardRepo";
import { and, eq, sql } from "drizzle-orm";
import { FsrsCardState, type FsrsCardStateValue } from "@/lib/review/model";
import { ensureReviewProjections } from "@/db/reviewProjectionRepo";

export type WordSetItemReviewStats = {
  wordSetItemId: string;
  cardCount: number;
  dueCount: number;
  state: FsrsCardStateValue;
  dueAt: Date | null;
  reps: number;
  lapses: number;
  lastReviewAt: Date | null;
};

export type WordSetReviewStats = {
  wordSetId: string;
  itemCount: number;
  cardCount: number;
  dueCount: number;
};

export async function getWordSetItemReviewStats(input: {
  userId: string;
  wordSetId: string;
  now?: Date;
}): Promise<WordSetItemReviewStats[]> {
  await ensureStudyCards(input.userId, input.wordSetId);
  await ensureReviewProjections(input.userId, input.wordSetId);
  const now = input.now ?? new Date();
  const rows = await getDb()
    .select({
      wordSetItemId: wordSetItem.id,
      cardCount: sql<number>`count(${studyCard.id})`,
      dueCount: sql<number>`count(${studyCard.id}) FILTER (
        WHERE ${availableStudyCardCondition(now)}
          AND (${fsrsCardState.studyCardId} IS NULL OR ${fsrsCardState.dueAt} <= ${now})
      )`,
      // A note summarizes eligible exercises: relearning/learning first, then
      // untouched exercises, then established review cards.
      state: sql<number>`CASE
        WHEN max(CASE WHEN ${fsrsCardState.state} = ${FsrsCardState.Relearning} THEN 1 ELSE 0 END) = 1 THEN ${FsrsCardState.Relearning}
        WHEN max(CASE WHEN ${fsrsCardState.state} = ${FsrsCardState.Learning} THEN 1 ELSE 0 END) = 1 THEN ${FsrsCardState.Learning}
        WHEN count(${studyCard.id}) = 0 OR count(${studyCard.id}) FILTER (WHERE ${fsrsCardState.studyCardId} IS NULL OR ${fsrsCardState.state} = ${FsrsCardState.New}) > 0 THEN ${FsrsCardState.New}
        ELSE ${FsrsCardState.Review}
      END`,
      // Null denotes an untouched exercise ready immediately. Otherwise take
      // the earliest of the note's eligible card due dates.
      dueAt: sql<Date | null>`CASE
        WHEN count(${studyCard.id}) FILTER (WHERE ${fsrsCardState.studyCardId} IS NULL) > 0 THEN NULL
        ELSE min(${fsrsCardState.dueAt})
      END`.mapWith(fsrsCardState.dueAt),
      reps: sql<number>`coalesce(sum(${fsrsCardState.reps}), 0)`,
      lapses: sql<number>`coalesce(sum(${fsrsCardState.lapses}), 0)`,
      lastReviewAt:
        sql<Date | null>`max(${fsrsCardState.lastReviewAt})`.mapWith(
          fsrsCardState.lastReviewAt,
        ),
    })
    .from(wordSetItem)
    .innerJoin(wordSet, eq(wordSet.id, wordSetItem.wordSetId))
    .leftJoin(
      studyCard,
      and(
        eq(studyCard.wordSetItemId, wordSetItem.id),
        eligibleStudyCardCondition(),
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
    )
    .groupBy(wordSetItem.id);

  return rows.map((row) => ({
    wordSetItemId: row.wordSetItemId,
    cardCount: Number(row.cardCount),
    dueCount: Number(row.dueCount),
    state: Number(row.state) as FsrsCardStateValue,
    dueAt: row.dueAt,
    reps: Number(row.reps),
    lapses: Number(row.lapses),
    lastReviewAt: row.lastReviewAt,
  }));
}

export async function getWordSetReviewStats(input: {
  userId: string;
  now: Date;
}): Promise<WordSetReviewStats[]> {
  await ensureStudyCards(input.userId);
  await ensureReviewProjections(input.userId);
  const rows = await getDb()
    .select({
      wordSetId: wordSet.id,
      itemCount: sql<number>`count(DISTINCT ${wordSetItem.id})`,
      cardCount: sql<number>`count(${studyCard.id})`,
      dueCount: sql<number>`count(${studyCard.id}) FILTER (
        WHERE ${availableStudyCardCondition(input.now)}
          AND (${fsrsCardState.studyCardId} IS NULL OR ${fsrsCardState.dueAt} <= ${input.now})
      )`,
    })
    .from(wordSet)
    .leftJoin(wordSetItem, eq(wordSetItem.wordSetId, wordSet.id))
    .leftJoin(
      studyCard,
      and(
        eq(studyCard.wordSetItemId, wordSetItem.id),
        eligibleStudyCardCondition(),
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
    cardCount: Number(row.cardCount),
    dueCount: Number(row.dueCount),
  }));
}
