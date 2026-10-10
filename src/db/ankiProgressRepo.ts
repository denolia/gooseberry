import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db/drizzle";
import type { ankiImportJob } from "@/db/schema";
import type { AnkiCard, AnkiPackage } from "@/lib/anki/import/readerTypes";
import type { NoteTypeMapping } from "@/lib/anki/import/mapping";
import { resolveAnkiStudyTemplate } from "@/lib/anki/import/templateMapping";
import {
  ANKI_PROGRESS_CONVERSION_VERSION,
  convertAnkiProgress,
} from "@/lib/anki/import/progress";
import { serializeFsrsState } from "@/lib/review/fsrs";

// Prepare immutable source conversions before the publication transaction.
// Writes run after notes/cards are published, in the SAME atomic db.batch.
export async function ankiProgressWriteStatements(
  job: typeof ankiImportJob.$inferSelect,
  userId: string,
): Promise<SQL[]> {
  if (!job.importProgress) return [];
  const metadata = job.packageMetadata as unknown as Omit<
    AnkiPackage,
    "notes" | "cards" | "revlogs"
  >;
  const models = new Map(metadata.models.map((model) => [model.id, model]));
  const mappings = new Map(
    (job.mapping as NoteTypeMapping[]).map((mapping) => [
      mapping.modelId,
      mapping,
    ]),
  );
  const source = await getDb().execute(sql`
    SELECT card.raw_card, note.model_id, note.source_note_id,
      max(review.source_review_id::numeric) FILTER (
        WHERE review.raw_review->>'ease' IN ('1', '2', '3', '4')
          AND review.raw_review->>'type' IN ('0', '1', '2', '3')
          AND NOT (review.raw_review->>'type' = '3' AND review.raw_review->>'factor' = '0')
      )::text AS last_rated_review_ms
    FROM import_source_card card
    INNER JOIN import_source_note note ON note.job_id = card.job_id
      AND note.source_note_id = card.source_note_id AND NOT note.skipped
    LEFT JOIN import_source_review review ON review.job_id = card.job_id
      AND review.source_card_id = card.source_card_id
    WHERE card.job_id = ${job.id}
    GROUP BY card.source_card_id, card.job_id, note.model_id, note.source_note_id
    ORDER BY card.source_card_id
  `);
  const now = new Date();
  const rows = source.rows.flatMap((row) => {
    const model = models.get(row.model_id as string);
    const mapping = mappings.get(row.model_id as string);
    const card = row.raw_card as AnkiCard;
    if (!model || !mapping || mapping.skip) return [];
    const templateKey = resolveAnkiStudyTemplate(model, mapping, card.ord);
    if (!templateKey) return [];
    const converted = convertAnkiProgress(
      card,
      {
        collection: metadata.collection,
        timeZone: job.schedulingTimeZone,
        now,
      },
      row.last_rated_review_ms ? Number(row.last_rated_review_ms) : null,
    );
    if (!converted) return [];
    const needsBaseline =
      card.type > 0 || converted.isSuspended || converted.buriedUntil !== null;
    return [
      {
        source_note_id: row.source_note_id,
        source_card_id: card.id,
        template_key: templateKey,
        baseline_state: needsBaseline
          ? {
              ...serializeFsrsState(converted.state),
              conversionVersion: ANKI_PROGRESS_CONVERSION_VERSION,
              conversionMethod: converted.method,
            }
          : null,
        is_suspended: converted.isSuspended,
        buried_until: converted.buriedUntil?.toISOString() ?? null,
      },
    ];
  });
  const statements: SQL[] = [];
  for (let offset = 0; offset < rows.length; offset += 250) {
    statements.push(sql`
      WITH candidates AS MATERIALIZED (
        SELECT card.id AS study_card_id, data.*
        FROM jsonb_to_recordset(${JSON.stringify(rows.slice(offset, offset + 250))}::jsonb)
          AS data(source_note_id text, source_card_id text, template_key text,
            baseline_state jsonb, is_suspended boolean, buried_until timestamptz)
        INNER JOIN import_source_note note ON note.job_id = ${job.id}
          AND note.source_note_id = data.source_note_id AND NOT note.skipped
        INNER JOIN anki_import_job job ON job.id = note.job_id AND job.user_id = ${userId}
          AND job.status = 'completed' AND job.import_progress
        INNER JOIN word_set_item item ON item.id = note.item_id AND item.word_set_id = job.word_set_id
        INNER JOIN word_set destination ON destination.id = item.word_set_id AND destination.user_id = ${userId}
        INNER JOIN study_card card ON card.word_set_item_id = item.id AND card.template_key = data.template_key
        WHERE (card.external_source IS NULL OR card.external_source = 'anki')
          AND NOT EXISTS (
            SELECT 1 FROM study_card other WHERE other.word_set_item_id = card.word_set_item_id
              AND other.id <> card.id AND other.external_source = 'anki'
              AND other.external_id = data.source_card_id
          )
          AND NOT EXISTS (SELECT 1 FROM review_event event WHERE event.study_card_id = card.id)
          AND NOT EXISTS (SELECT 1 FROM fsrs_card_state state WHERE state.study_card_id = card.id AND state.user_id = ${userId})
          AND NOT EXISTS (SELECT 1 FROM study_card_import_baseline baseline WHERE baseline.study_card_id = card.id AND baseline.user_id = ${userId})
        FOR UPDATE OF card
      ), projected AS (
        INSERT INTO fsrs_card_state (user_id, study_card_id, due_at, stability, difficulty,
          elapsed_days, scheduled_days, learning_steps, reps, lapses, state, revision,
          last_review_at, scheduler_version)
        SELECT ${userId}, study_card_id, (baseline_state->>'dueAt')::timestamptz,
          (baseline_state->>'stability')::double precision, (baseline_state->>'difficulty')::double precision,
          (baseline_state->>'elapsedDays')::integer, (baseline_state->>'scheduledDays')::integer,
          (baseline_state->>'learningSteps')::integer, (baseline_state->>'reps')::integer,
          (baseline_state->>'lapses')::integer, (baseline_state->>'state')::integer, 0,
          (baseline_state->>'lastReviewAt')::timestamptz, baseline_state->>'schedulerVersion'
        FROM candidates WHERE baseline_state IS NOT NULL
        ON CONFLICT (user_id, study_card_id) DO NOTHING RETURNING study_card_id
      ), baselines AS (
        INSERT INTO study_card_import_baseline (user_id, study_card_id, import_job_id, source_card_id, baseline_state)
        SELECT ${userId}, candidates.study_card_id, ${job.id}, candidates.source_card_id, candidates.baseline_state
        FROM candidates INNER JOIN projected USING (study_card_id)
        RETURNING study_card_id
      )
      UPDATE study_card SET external_source = 'anki', external_id = candidates.source_card_id,
        is_suspended = candidates.is_suspended, buried_until = candidates.buried_until
      FROM candidates WHERE study_card.id = candidates.study_card_id
        AND (candidates.baseline_state IS NULL OR EXISTS (
          SELECT 1 FROM baselines WHERE baselines.study_card_id = candidates.study_card_id))
    `);
  }
  statements.push(sql`
    UPDATE anki_import_job SET imported_progress_count = (
      SELECT count(*) FROM study_card_import_baseline baseline
      WHERE baseline.import_job_id = ${job.id} AND baseline.user_id = ${userId}
        AND (baseline.baseline_state->>'state')::integer > 0
    ) WHERE id = ${job.id} AND user_id = ${userId} AND status = 'completed'
  `);
  return statements;
}
