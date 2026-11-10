import { sql } from "drizzle-orm";
import { fsrsCardState, studyCard, wordSetItem } from "@/db/schema";
import { FsrsCardState } from "@/lib/review/model";
import { EXPOSURE_SENSITIVE_TEMPLATES } from "@/lib/review/policy";
import type { StudyDayContext } from "@/db/studyDay";

export function exposureSensitiveCardCondition() {
  return sql<boolean>`(${fsrsCardState.state} IN (${FsrsCardState.Review}, ${FsrsCardState.Relearning})
    AND ${studyCard.templateKey} IN (${sql.join(
      EXPOSURE_SENSITIVE_TEMPLATES.map((key) => sql`${key}`),
      sql`, `,
    )}))`;
}

export function studyExposureAllowedCondition(day: StudyDayContext) {
  return sql<boolean>`(NOT coalesce(${exposureSensitiveCardCondition()}, false)
    OR ${wordSetItem.lastExposedAt} IS NULL OR ${wordSetItem.lastExposedAt} < ${day.startAt})`;
}

// Choose one due sensitive sibling before buffered-card exclusions, without
// deduplicating New/Learning or the independently available forms/examples.
export function firstSensitiveStudyCardCondition(userId: string, now: Date) {
  const keys = sql.join(
    EXPOSURE_SENSITIVE_TEMPLATES.map((key) => sql`${key}`),
    sql`, `,
  );
  return sql<boolean>`(NOT coalesce(${exposureSensitiveCardCondition()}, false) OR ${studyCard.id} = (
    SELECT sibling.id FROM study_card sibling
    INNER JOIN fsrs_card_state sibling_state ON sibling_state.study_card_id = sibling.id AND sibling_state.user_id = ${userId}
    WHERE sibling.word_set_item_id = ${wordSetItem.id}
      AND sibling.template_key IN (${keys}) AND sibling_state.state IN (${FsrsCardState.Review}, ${FsrsCardState.Relearning})
      AND sibling_state.due_at <= ${now} AND NOT sibling.is_suspended
      AND (sibling.buried_until IS NULL OR sibling.buried_until <= ${now})
    ORDER BY sibling_state.due_at, CASE sibling.template_key
      ${sql.join(
        EXPOSURE_SENSITIVE_TEMPLATES.map(
          (key, index) => sql`WHEN ${key} THEN ${index}::integer`,
        ),
        sql` `,
      )}
      END, sibling.id LIMIT 1
  ))`;
}

export function effectiveReviewDueAt(day: StudyDayContext) {
  return sql<Date>`greatest(${fsrsCardState.dueAt}, coalesce(${studyCard.buriedUntil}, ${fsrsCardState.dueAt}),
    CASE WHEN ${exposureSensitiveCardCondition()} AND ${wordSetItem.lastExposedAt} >= ${day.startAt}
      THEN ${day.nextStartAt}::timestamptz ELSE ${fsrsCardState.dueAt} END)`;
}
