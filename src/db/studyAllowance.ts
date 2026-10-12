import { and, isNotNull, ne, or, sql } from "drizzle-orm";
import { fsrsCardState, wordSetItem } from "@/db/schema";
import { studyCardContentCondition } from "@/db/studyCardRepo";
import { FsrsCardState } from "@/lib/review/model";
import { DEFAULT_NEW_WORDS_PER_DAY } from "@/lib/review/settings";
import { STUDY_CARD_TEMPLATE_KEYS } from "@/lib/review/templates";

// Select a stable word cohort before applying card exclusions or fetch limits.
// Prefetching never consumes an allowance or opens a second cohort. A word's
// first saved native review consumes one slot; its siblings remain available.
// Canonical history/import baselines keep this correct after projection rebuilds.
export function studyWordAvailabilityCondition(input: {
  userId: string;
  now: Date;
  wordSetId?: string;
}) {
  const candidateContent = or(
    ...STUDY_CARD_TEMPLATE_KEYS.map((key) =>
      and(
        sql`candidate_card.template_key = ${key}`,
        studyCardContentCondition(key, "candidate"),
      ),
    ),
  );

  return or(
    // No daily cap ever hides an already-scheduled learning/review exercise.
    and(
      isNotNull(fsrsCardState.studyCardId),
      ne(fsrsCardState.state, FsrsCardState.New),
    ),
    sql`${wordSetItem.id} IN (
      WITH settings AS (
        SELECT coalesce(preference.new_words_per_day, ${DEFAULT_NEW_WORDS_PER_DAY}) AS daily_limit,
          coalesce(preference.study_time_zone, 'UTC') AS time_zone
        FROM (SELECT 1) singleton
        LEFT JOIN user_preference preference ON preference.user_id = ${input.userId}
      ), progress AS (
        SELECT candidate.id, candidate.word_set_id, candidate.position,
          native.first_review_at,
          EXISTS (
            SELECT 1 FROM study_card sibling
            INNER JOIN study_card_import_baseline baseline ON baseline.study_card_id = sibling.id
            WHERE sibling.word_set_item_id = candidate.id AND baseline.user_id = ${input.userId}
              AND ((baseline.baseline_state->>'reps')::integer > 0
                OR (baseline.baseline_state->>'state')::integer <> 0)
          ) AS imported_studied,
          EXISTS (
            SELECT 1 FROM study_card sibling
            INNER JOIN fsrs_card_state projection ON projection.study_card_id = sibling.id
            WHERE sibling.word_set_item_id = candidate.id AND projection.user_id = ${input.userId}
              AND (projection.reps > 0 OR projection.state <> 0)
          ) AS projected_studied
        FROM word_set_item candidate
        INNER JOIN word_set owned_set ON owned_set.id = candidate.word_set_id
        LEFT JOIN (
          SELECT sibling.word_set_item_id, min(history.reviewed_at) AS first_review_at
          FROM review_event history
          INNER JOIN study_card sibling ON sibling.id = history.study_card_id
          WHERE history.user_id = ${input.userId} AND history.source = 'gooseberry'
          GROUP BY sibling.word_set_item_id
        ) native ON native.word_set_item_id = candidate.id
        WHERE owned_set.user_id = ${input.userId}
          ${input.wordSetId ? sql`AND owned_set.id = ${input.wordSetId}` : sql``}
      ), used_today AS (
        SELECT word_set_id, count(*) AS used
        FROM progress CROSS JOIN settings
        WHERE NOT imported_studied
          AND (first_review_at AT TIME ZONE time_zone)::date = (${input.now}::timestamptz AT TIME ZONE time_zone)::date
        GROUP BY word_set_id
      ), unseen AS (
        SELECT progress.id, progress.word_set_id,
          row_number() OVER (PARTITION BY progress.word_set_id ORDER BY progress.position, progress.id) AS word_number
        FROM progress
        INNER JOIN word_set_item candidate ON candidate.id = progress.id
        WHERE first_review_at IS NULL AND NOT imported_studied AND NOT projected_studied
          AND EXISTS (
            SELECT 1 FROM study_card candidate_card
            WHERE candidate_card.word_set_item_id = candidate.id
              AND NOT candidate_card.is_suspended
              AND (candidate_card.buried_until IS NULL OR candidate_card.buried_until <= ${input.now})
              AND ${candidateContent}
          )
      )
      SELECT id FROM progress
      WHERE first_review_at IS NOT NULL OR imported_studied OR projected_studied
      UNION ALL
      SELECT unseen.id FROM unseen CROSS JOIN settings
      LEFT JOIN used_today ON used_today.word_set_id = unseen.word_set_id
      WHERE word_number <= greatest(0, daily_limit - coalesce(used, 0))
    )`,
  )!;
}
