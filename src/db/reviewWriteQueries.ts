import { sql } from "drizzle-orm";
import type { StudyDayContext } from "@/db/studyDay";
import type { FsrsStateProjection } from "@/lib/review/fsrs";
import type { ReviewRatingValue } from "@/lib/review/model";

export function lockStudyNote(wordSetItemId: string) {
  return sql`SELECT id FROM word_set_item WHERE id = ${wordSetItemId} FOR UPDATE`;
}

export function cancelReviewIfUnchanged(input: {
  userId: string;
  wordSetId: string;
  wordSetItemId: string;
  studyCardId: string;
  reviewEventId: string;
  sessionId: string;
  exposureId: string;
  replacementExposureId: string;
  rating: ReviewRatingValue;
  reviewedAt: Date;
  now: Date;
  targetReview: { sequence: number | null } | undefined;
  currentState: Pick<FsrsStateProjection, "state" | "reps">;
}) {
  // Validate again under the note lock: the grade may have arrived, another
  // exercise may have progressed, or ownership/availability may have changed.
  return sql`WITH cancelled AS (
    INSERT INTO study_review_undo
      (review_id,user_id,study_card_id,session_id,exposure_id,replacement_exposure_id,rating,reviewed_at,undone_at)
    SELECT ${input.reviewEventId},${input.userId},${input.studyCardId},${input.sessionId},
      ${input.exposureId},${input.replacementExposureId},${input.rating},${input.reviewedAt},${input.now}
    WHERE ${
      input.targetReview
        ? sql`EXISTS (SELECT 1 FROM review_event WHERE id = ${input.reviewEventId})`
        : sql`NOT EXISTS (SELECT 1 FROM review_event WHERE id = ${input.reviewEventId})`
    }
      AND EXISTS (SELECT 1 FROM study_card WHERE id = ${input.studyCardId} AND NOT is_suspended
        AND (buried_until IS NULL OR buried_until <= ${input.now}))
      AND NOT EXISTS (SELECT 1 FROM study_review_undo WHERE review_id = ${input.reviewEventId})
      AND NOT EXISTS (SELECT 1 FROM study_exposure WHERE id = ${input.exposureId}
        AND (user_id <> ${input.userId} OR study_card_id <> ${input.studyCardId}))
      AND EXISTS (SELECT 1 FROM word_set_item item INNER JOIN word_set owned_set ON owned_set.id = item.word_set_id
        WHERE item.id = ${input.wordSetItemId} AND owned_set.id = ${input.wordSetId} AND owned_set.user_id = ${input.userId})
      AND NOT EXISTS (
        SELECT 1 FROM review_event later INNER JOIN study_card sibling ON sibling.id = later.study_card_id
        WHERE sibling.word_set_item_id = ${input.wordSetItemId} AND later.user_id = ${input.userId}
          AND later.source = 'gooseberry' AND later.id <> ${input.reviewEventId}
          AND NOT EXISTS (SELECT 1 FROM study_review_undo undo WHERE undo.review_id = later.id)
          AND ${
            input.targetReview
              ? sql`later.sequence > ${input.targetReview.sequence}`
              : sql`later.created_at > coalesce(
                (SELECT activated_at FROM study_exposure WHERE id = ${input.exposureId}), ${input.reviewedAt})`
          }
      )
      AND ${
        input.targetReview
          ? sql`true`
          : sql`NOT EXISTS (SELECT 1 FROM study_exposure WHERE id = ${input.exposureId}
            AND (review_event_id IS NOT NULL OR state_before <> ${input.currentState.state} OR reps_before <> ${input.currentState.reps}))`
      }
    RETURNING 1
  ) SELECT 1 / count(*)::integer AS committed FROM cancelled`;
}

export function writeCardStateIfUnchanged(input: {
  userId: string;
  studyCardId: string;
  state: FsrsStateProjection;
  expectedRevision: number | null;
  lastReviewEventId: string | null;
  rebuildMissingProjection?: boolean;
}) {
  const { state, expectedRevision } = input;
  const updates = sql`
    due_at = ${state.dueAt}, stability = ${state.stability}, difficulty = ${state.difficulty},
    elapsed_days = ${state.elapsedDays}, scheduled_days = ${state.scheduledDays},
    learning_steps = ${state.learningSteps}, reps = ${state.reps}, lapses = ${state.lapses},
    state = ${state.state}, revision = fsrs_card_state.revision + 1,
    last_review_at = ${state.lastReviewAt}, last_review_event_id = ${input.lastReviewEventId},
    scheduler_version = ${state.schedulerVersion}, updated_at = now()
  `;
  // Grading must fail if a previously read projection disappeared. Undo has
  // always allowed rebuilding it, while still guarding any existing revision.
  const write =
    expectedRevision === null || input.rebuildMissingProjection
      ? sql`
          INSERT INTO fsrs_card_state (
            user_id,study_card_id,due_at,stability,difficulty,elapsed_days,scheduled_days,
            learning_steps,reps,lapses,state,revision,last_review_at,last_review_event_id,scheduler_version,updated_at
          ) VALUES (
            ${input.userId},${input.studyCardId},${state.dueAt},${state.stability},${state.difficulty},
            ${state.elapsedDays},${state.scheduledDays},${state.learningSteps},${state.reps},${state.lapses},
            ${state.state},1,${state.lastReviewAt},${input.lastReviewEventId},${state.schedulerVersion},now()
          )
          ${
            expectedRevision === null
              ? sql`ON CONFLICT (user_id,study_card_id) DO NOTHING`
              : sql`ON CONFLICT (user_id,study_card_id) DO UPDATE SET ${updates}
                  WHERE fsrs_card_state.revision = ${expectedRevision}`
          }
          RETURNING 1
        `
      : sql`
          UPDATE fsrs_card_state SET ${updates}
          WHERE user_id = ${input.userId} AND study_card_id = ${input.studyCardId}
            AND revision = ${expectedRevision}
          RETURNING 1
        `;

  // A skipped conditional write must abort the entire HTTP batch transaction.
  return sql`WITH written AS (${write})
    SELECT 1 / count(*)::integer AS committed FROM written`;
}

export function createReplacementPresentation(input: {
  replacementExposureId: string;
  userId: string;
  studyCardId: string;
  wordSetItemId: string;
  state: Pick<FsrsStateProjection, "state" | "reps">;
  now: Date;
  day: StudyDayContext;
}) {
  return sql`INSERT INTO study_exposure
    (id,user_id,study_card_id,word_set_item_id,state_before,reps_before,activated_at,study_day_start,study_time_zone)
    VALUES (${input.replacementExposureId},${input.userId},${input.studyCardId},${input.wordSetItemId},
      ${input.state.state},${input.state.reps},${input.now},${input.day.startAt},${input.day.timeZone})`;
}
