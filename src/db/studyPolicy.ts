import { sql, type SQL } from "drizzle-orm";
import { studyCard, wordSetItem } from "@/db/schema";

// Use canonical history/import baselines as well as the replaceable projection.
// A New projection with zero reps, card creation, and prefetch are not progress.
function introducedCardCondition(userId: string, identity: SQL) {
  return sql<boolean>`EXISTS (
    SELECT 1 FROM study_card introduction_card
    LEFT JOIN fsrs_card_state introduction_state
      ON introduction_state.study_card_id = introduction_card.id
      AND introduction_state.user_id = ${userId}
    LEFT JOIN study_card_import_baseline introduction_baseline
      ON introduction_baseline.study_card_id = introduction_card.id
      AND introduction_baseline.user_id = ${userId}
    WHERE ${identity} AND (
      coalesce(introduction_state.reps, 0) > 0
      OR coalesce(introduction_state.state, 0) <> 0
      OR coalesce((introduction_baseline.baseline_state->>'reps')::integer, 0) > 0
      OR coalesce((introduction_baseline.baseline_state->>'state')::integer, 0) <> 0
      OR EXISTS (
        SELECT 1 FROM review_event introduction_event
        WHERE introduction_event.study_card_id = introduction_card.id
          AND introduction_event.user_id = ${userId}
          AND introduction_event.source = 'gooseberry'
      )
    )
  )`;
}

export function studyCardIntroductionCondition(userId: string) {
  const recognitionIntroduced = introducedCardCondition(
    userId,
    sql`introduction_card.word_set_item_id = ${wordSetItem.id}
      AND introduction_card.template_key = 'recognition'`,
  );
  const productionIntroduced = introducedCardCondition(
    userId,
    sql`introduction_card.word_set_item_id = ${wordSetItem.id}
      AND introduction_card.template_key = 'production'`,
  );

  return sql<boolean>`(
    ${studyCard.templateKey} = 'recognition'
    OR ${introducedCardCondition(userId, sql`introduction_card.id = ${studyCard.id}`)}
    OR (${recognitionIntroduced} AND (
      ${studyCard.templateKey} = 'production' OR ${productionIntroduced}
    ))
  )`;
}
