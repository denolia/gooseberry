import { and, isNotNull, ne, or, sql } from "drizzle-orm";
import { fsrsCardState, wordSetItem } from "@/db/schema";
import { studyCardContentCondition } from "@/db/studyCardRepo";
import { FsrsCardState } from "@/lib/review/model";
import { DEFAULT_NEW_WORDS_PER_DAY } from "@/lib/review/settings";
import { studySetCondition, studySetSelection } from "@/db/studyScope";
import type { StudyScope } from "@/lib/review/scope";
import { studyDayQuery } from "@/db/studyDay";

// Select a stable word cohort before applying card exclusions or fetch limits.
// Prefetching never consumes an allowance or opens a second cohort. A word's
// first saved native review consumes one slot; unlocked siblings stay available.
// Canonical history/import baselines keep this correct after projection rebuilds.
export function studyWordAvailabilityCondition(input: {
  userId: string;
  now: Date;
  wordSetId?: string;
  scope?: StudyScope;
}) {
  return or(
    // No daily cap ever hides an already-scheduled learning/review exercise.
    and(
      isNotNull(fsrsCardState.studyCardId),
      ne(fsrsCardState.state, FsrsCardState.New),
    ),
    sql`${wordSetItem.id} IN (
      WITH study_day AS (${studyDayQuery(input.userId, input.now)}), settings AS (
        SELECT coalesce(preference.new_words_per_day, ${DEFAULT_NEW_WORDS_PER_DAY}) AS daily_limit,
          study_day.start_at, study_day.next_start_at
        FROM (SELECT 1) singleton
        CROSS JOIN study_day
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
          SELECT sibling.word_set_item_id, min(coalesce(activity.completed_at, history.reviewed_at)) AS first_review_at
          FROM review_event history
          INNER JOIN study_card sibling ON sibling.id = history.study_card_id
          LEFT JOIN study_activity activity ON activity.review_id = history.id AND activity.user_id = history.user_id
          WHERE history.user_id = ${input.userId} AND history.source = 'gooseberry'
            AND NOT EXISTS (SELECT 1 FROM study_review_undo undo WHERE undo.review_id = history.id)
          GROUP BY sibling.word_set_item_id
        ) native ON native.word_set_item_id = candidate.id
        WHERE owned_set.user_id = ${input.userId}
          AND ${studySetCondition(studySetSelection(input), "owned_set")}
      ), used_today AS (
        SELECT word_set_id, count(*) AS used
        FROM progress CROSS JOIN settings
        WHERE NOT imported_studied
          AND first_review_at >= start_at AND first_review_at < next_start_at
        GROUP BY word_set_id
      ), unseen AS (
        SELECT progress.id, progress.word_set_id,
          row_number() OVER (PARTITION BY progress.word_set_id ORDER BY progress.position, progress.id) AS word_number
        FROM progress
        INNER JOIN word_set_item candidate ON candidate.id = progress.id
        WHERE first_review_at IS NULL AND NOT imported_studied AND NOT projected_studied
          -- Only recognition can introduce an unseen word. Optional content
          -- must not reserve an allowance slot when recognition is unavailable.
          AND EXISTS (
            SELECT 1 FROM study_card candidate_card
            WHERE candidate_card.word_set_item_id = candidate.id
              AND candidate_card.template_key = 'recognition'
              AND NOT candidate_card.is_suspended
              AND (candidate_card.buried_until IS NULL OR candidate_card.buried_until <= ${input.now})
              AND ${studyCardContentCondition("recognition", "candidate")}
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
