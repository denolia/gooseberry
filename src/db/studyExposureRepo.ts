import { and, eq, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db/drizzle";
import { studyExposure, wordSet, wordSetItem } from "@/db/schema";
import type { StudyDayContext } from "@/db/studyDay";
import { studyExposureAllowedCondition } from "@/db/studyExposurePolicy";

export type StudyExposure = typeof studyExposure.$inferSelect;

export async function getStudyExposure(
  userId: string,
  id?: string,
): Promise<StudyExposure | null> {
  if (!id) return null;
  const [receipt] = await getDb()
    .select()
    .from(studyExposure)
    .where(and(eq(studyExposure.userId, userId), eq(studyExposure.id, id)))
    .limit(1);
  return receipt ?? null;
}

export async function persistStudyExposure(input: {
  userId: string;
  wordSetItemId: string;
  studyCardId: string;
  exposureId: string;
  stateBefore: number;
  repsBefore: number;
  now: Date;
  day: StudyDayContext;
  cardCondition: SQL;
  enforceExposureGate?: boolean;
}): Promise<StudyExposure | null> {
  const db = getDb();
  // The second statement gets a fresh snapshot after acquiring this note's lock.
  // This makes duplicate retries and competing tabs agree before marking it.
  await db.batch([
    db.execute(sql`SELECT ${wordSetItem.id} FROM ${wordSetItem}
      INNER JOIN ${wordSet} ON ${wordSet.id} = ${wordSetItem.wordSetId}
      WHERE ${wordSetItem.id} = ${input.wordSetItemId} AND ${wordSet.userId} = ${input.userId}
      FOR UPDATE OF ${wordSetItem}`),
    db.execute(sql`
      WITH marked AS (
        UPDATE word_set_item SET last_exposed_at = greatest(last_exposed_at, ${input.now}::timestamptz)
        WHERE id = ${input.wordSetItemId}
          AND NOT EXISTS (SELECT 1 FROM study_exposure WHERE id = ${input.exposureId})
          AND EXISTS (
            SELECT 1 FROM study_card
            INNER JOIN word_set ON word_set.id = word_set_item.word_set_id
            LEFT JOIN fsrs_card_state ON fsrs_card_state.study_card_id = study_card.id
              AND fsrs_card_state.user_id = ${input.userId}
            WHERE ${input.cardCondition} AND ${input.enforceExposureGate === false ? sql`true` : studyExposureAllowedCondition(input.day)}
          )
        RETURNING id
      ) INSERT INTO study_exposure
        (id,user_id,study_card_id,word_set_item_id,state_before,reps_before,activated_at,study_day_start,study_time_zone)
        SELECT ${input.exposureId},${input.userId},${input.studyCardId},id,${input.stateBefore},${input.repsBefore},
          ${input.now},${input.day.startAt},${input.day.timeZone} FROM marked
    `),
  ]);
  return getStudyExposure(input.userId, input.exposureId);
}

// Resuming the same ungraded presentation (including across 02:00) records
// current visibility without granting permission for a second review attempt.
export async function touchStudyExposure(receipt: StudyExposure, now: Date) {
  await getDb()
    .execute(sql`UPDATE word_set_item SET last_exposed_at = greatest(last_exposed_at, ${now}::timestamptz)
    WHERE id = ${receipt.wordSetItemId} AND EXISTS (
      SELECT 1 FROM study_exposure WHERE id = ${receipt.id} AND user_id = ${receipt.userId}
        AND review_event_id IS NULL
    )`);
}

// A prefetched prompt can become stale in another tab before it renders.
// Record its actual display even when it cannot receive a grading receipt.
export async function recordDisplayedStudyCardExposure(input: {
  userId: string;
  wordSetId: string;
  studyCardId: string;
  now: Date;
}) {
  await getDb().execute(sql`UPDATE word_set_item AS item
    SET last_exposed_at = greatest(item.last_exposed_at, ${input.now}::timestamptz)
    FROM study_card AS card, word_set AS owned_set
    WHERE item.id = card.word_set_item_id AND owned_set.id = item.word_set_id
      AND owned_set.user_id = ${input.userId} AND owned_set.id = ${input.wordSetId}
      AND card.id = ${input.studyCardId}`);
}

export function consumeStudyExposure(input: {
  userId: string;
  studyCardId: string;
  exposureId: string;
  reviewEventId: string;
}) {
  return sql`WITH consumed AS (
    UPDATE study_exposure SET review_event_id = ${input.reviewEventId}
    WHERE id = ${input.exposureId} AND user_id = ${input.userId}
      AND study_card_id = ${input.studyCardId} AND review_event_id IS NULL RETURNING 1
  ) SELECT 1 / count(*)::integer AS committed FROM consumed`;
}
