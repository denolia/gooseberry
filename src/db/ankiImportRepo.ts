import { createHash } from "node:crypto";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db/drizzle";
import {
  ankiImportBatch,
  ankiImportJob,
  importSourceNote,
  wordSet,
  wordSetItem,
} from "@/db/schema";
import {
  mapAnkiNote,
  sanitizeAnkiText,
  type NoteTypeMapping,
} from "@/lib/anki/import/mapping";
import {
  IMPORT_CARD_LIMIT,
  IMPORT_NOTE_LIMIT,
  IMPORT_REVIEW_LIMIT,
  IMPORT_TEXT_BYTE_LIMIT,
  IMPORT_VISIBLE_BYTE_LIMIT,
  validateImportMapping,
  type BeginImportInput,
  type ImportBatchInput,
} from "@/lib/anki/import/schemas";
import type { AnkiPackage, AnkiNote } from "@/lib/anki/import/readerTypes";
import { STUDY_CARD_TEMPLATE_KEYS } from "@/lib/review/templates";
import { ankiProgressWriteStatements } from "@/db/ankiProgressRepo";

type ImportJob = typeof ankiImportJob.$inferSelect;
export class AnkiImportError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function importJobView(job: ImportJob) {
  return {
    jobId: job.id,
    status: job.status,
    wordSetId: job.wordSetId,
    fileSha256: job.fileSha256,
    name: job.name,
    nextBatchIndex: job.nextBatchIndex,
    stagedNoteCount: job.stagedNoteCount,
    stagedCardCount: job.stagedCardCount,
    stagedReviewCount: job.stagedReviewCount,
    addedCount: job.addedCount,
    skippedCount: job.skippedCount,
    needsAttentionCount: job.needsAttentionCount,
    importedProgressCount: job.importedProgressCount,
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function digest(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
function isUniqueViolation(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 4) return false;
  const details = error as { code?: string; cause?: unknown };
  return (
    details.code === "23505" || isUniqueViolation(details.cause, depth + 1)
  );
}

function visibleImportBytes(
  jobId: string | SQL,
  targetSetId: string | null | SQL,
) {
  // Existing rows already include all editable metadata. New mapped JSON
  // includes examples and provenance; add source identity plus 900 bytes per
  // row for export UUIDs, timestamps, column names, and its review summary.
  // This is intentionally a conservative estimate, not a serializer contract.
  return sql`coalesce((SELECT sum(octet_length(to_jsonb(existing)::text) + 500)
      FROM word_set_item existing WHERE existing.word_set_id = ${targetSetId}), 0)
    + coalesce((SELECT sum(octet_length(note.mapped_content::text)
        + octet_length(note.source_note_key) + 900)
      FROM import_source_note note WHERE note.job_id = ${jobId} AND NOT note.skipped
        AND NOT EXISTS (SELECT 1 FROM word_set_item existing
          WHERE existing.word_set_id = ${targetSetId} AND existing.source_note_key = note.source_note_key)), 0)`;
}

async function assertVisibleImportBound(job: ImportJob) {
  const result = await getDb().execute(
    sql`SELECT ${visibleImportBytes(job.id, job.targetSetId)} AS estimated_bytes`,
  );
  if (Number(result.rows[0]?.estimated_bytes) > IMPORT_VISIBLE_BYTE_LIMIT) {
    throw new AnkiImportError(
      "This set would be too large to open in the current library. Select fewer fields or import a smaller deck; existing vocabulary has not been changed.",
      413,
    );
  }
}
async function ownedJob(jobId: string, userId: string): Promise<ImportJob> {
  const [job] = await getDb()
    .select()
    .from(ankiImportJob)
    .where(and(eq(ankiImportJob.id, jobId), eq(ankiImportJob.userId, userId)))
    .limit(1);
  if (!job) throw new AnkiImportError("Import not found", 404);
  return job;
}
export async function getAnkiImport(jobId: string, userId: string) {
  return importJobView(await ownedJob(jobId, userId));
}
export async function listAnkiImports(userId: string) {
  const jobs = await getDb()
    .select({
      jobId: ankiImportJob.id,
      status: ankiImportJob.status,
      wordSetId: ankiImportJob.wordSetId,
      fileSha256: ankiImportJob.fileSha256,
      name: ankiImportJob.name,
      nextBatchIndex: ankiImportJob.nextBatchIndex,
      stagedNoteCount: ankiImportJob.stagedNoteCount,
      stagedCardCount: ankiImportJob.stagedCardCount,
      stagedReviewCount: ankiImportJob.stagedReviewCount,
      addedCount: ankiImportJob.addedCount,
      skippedCount: ankiImportJob.skippedCount,
      needsAttentionCount: ankiImportJob.needsAttentionCount,
      importedProgressCount: ankiImportJob.importedProgressCount,
    })
    .from(ankiImportJob)
    .where(eq(ankiImportJob.userId, userId))
    .orderBy(desc(ankiImportJob.updatedAt))
    .limit(50);
  return jobs;
}
export async function beginAnkiImport(userId: string, input: BeginImportInput) {
  try {
    validateImportMapping(input);
  } catch (error) {
    throw new AnkiImportError(
      error instanceof Error ? error.message : "Invalid mapping",
    );
  }
  // Preserve hashes for jobs created before progress options existed when
  // the new options have their compatible defaults.
  const { importProgress, schedulingTimeZone, ...legacyInput } = input;
  const hash = digest({
    ...legacyInput,
    ...(importProgress === false ? { importProgress } : {}),
    ...(schedulingTimeZone && schedulingTimeZone !== "UTC"
      ? { schedulingTimeZone }
      : {}),
  });
  const [existing] = await getDb()
    .select()
    .from(ankiImportJob)
    .where(
      and(
        eq(ankiImportJob.userId, userId),
        eq(ankiImportJob.requestKey, input.requestKey),
      ),
    )
    .limit(1);
  if (existing) {
    if (existing.requestHash !== hash)
      throw new AnkiImportError(
        "This import request ID was already used with different settings",
        409,
      );
    return importJobView(existing);
  }
  if (input.targetSetId) {
    const [target] = await getDb()
      .select()
      .from(wordSet)
      .where(and(eq(wordSet.id, input.targetSetId), eq(wordSet.userId, userId)))
      .limit(1);
    if (!target) throw new AnkiImportError("Target word set not found", 404);
    if (
      target.sourceLang !== input.sourceLang ||
      target.targetLang !== input.targetLang
    ) {
      throw new AnkiImportError(
        "Target word set languages must match the import",
      );
    }
  }
  const [inserted] = await getDb()
    .insert(ankiImportJob)
    .values({
      userId,
      requestKey: input.requestKey,
      requestHash: hash,
      fileName: input.file.name,
      fileSize: input.file.size,
      fileSha256: input.file.sha256,
      name: input.name,
      sourceLang: input.sourceLang,
      targetLang: input.targetLang,
      targetSetId: input.targetSetId ?? null,
      mapping: input.mapping,
      packageMetadata: input.packageMetadata,
      importProgress: input.importProgress,
      schedulingTimeZone: input.schedulingTimeZone,
    })
    .onConflictDoNothing({
      target: [ankiImportJob.userId, ankiImportJob.requestKey],
    })
    .returning();
  const job =
    inserted ??
    (
      await getDb()
        .select()
        .from(ankiImportJob)
        .where(
          and(
            eq(ankiImportJob.userId, userId),
            eq(ankiImportJob.requestKey, input.requestKey),
          ),
        )
        .limit(1)
    )[0];
  if (!job || job.requestHash !== hash)
    throw new AnkiImportError("Import request conflict", 409);
  return importJobView(job);
}

export async function stageAnkiImport(
  jobId: string,
  userId: string,
  batch: ImportBatchInput,
) {
  const job = await ownedJob(jobId, userId);
  const hash = digest(batch);
  const byteCount = Buffer.byteLength(JSON.stringify(batch));
  const [existing] = await getDb()
    .select()
    .from(ankiImportBatch)
    .where(
      and(
        eq(ankiImportBatch.jobId, jobId),
        eq(ankiImportBatch.batchIndex, batch.batchIndex),
      ),
    )
    .limit(1);
  if (existing) {
    if (existing.payloadHash !== hash)
      throw new AnkiImportError(
        "Batch number was already used for different content",
        409,
      );
    return importJobView(await ownedJob(jobId, userId));
  }
  if (job.status !== "receiving")
    throw new AnkiImportError("This import no longer accepts content", 409);
  if (batch.batchIndex !== job.nextBatchIndex)
    throw new AnkiImportError(`Expected batch ${job.nextBatchIndex}`, 409);
  if (
    job.stagedNoteCount + batch.notes.length > IMPORT_NOTE_LIMIT ||
    job.stagedCardCount + batch.cards.length > IMPORT_CARD_LIMIT ||
    job.stagedReviewCount + batch.revlogs.length > IMPORT_REVIEW_LIMIT ||
    job.stagedByteCount + byteCount > IMPORT_TEXT_BYTE_LIMIT
  ) {
    throw new AnkiImportError(
      "This deck exceeds the supported text import limits",
      413,
    );
  }
  const metadata =
    job.packageMetadata as unknown as BeginImportInput["packageMetadata"];
  const models = new Map(metadata.models.map((model) => [model.id, model]));
  const mappings = new Map(
    (job.mapping as NoteTypeMapping[]).map((mapping) => [
      mapping.modelId,
      mapping,
    ]),
  );
  const notes = batch.notes.map((note, index) => {
    const model = models.get(note.modelId);
    if (!model)
      throw new AnkiImportError("A note references an unknown note type");
    const fieldCount =
      Math.max(-1, ...model.fields.map((field) => field.ord)) + 1;
    if (note.fields.length !== fieldCount)
      throw new AnkiImportError(
        "Source note fields do not match its note type",
      );
    const mapped = mapAnkiNote(note, mappings.get(note.modelId), model);
    if (
      mapped.original.length > 10000 ||
      mapped.translation.length > 10000 ||
      mapped.wordForms.length > 20000 ||
      mapped.sample.length > 50000 ||
      mapped.sampleTranslation.length > 50000 ||
      mapped.comments.length > 50000 ||
      mapped.tags.length > 2000
    ) {
      throw new AnkiImportError(
        "Mapped text exceeds the supported field length",
        413,
      );
    }
    return {
      source_note_id: note.id,
      source_note_key: `anki:${note.guid}`,
      source_guid: note.guid,
      model_id: note.modelId,
      raw_note: note,
      mapped_content: mapped,
      skipped: mapped.skipped,
      needs_attention: mapped.needsAttention.length > 0,
      position: job.stagedNoteCount + index,
    };
  });
  const cards = batch.cards.map((card) => ({
    source_card_id: card.id,
    source_note_id: card.nid,
    raw_card: card,
  }));
  const reviews = batch.revlogs.map((review) => ({
    source_review_id: review.id,
    source_card_id: review.cid,
    raw_review: review,
  }));
  try {
    await getDb().execute(sql`
      WITH ready AS (
        UPDATE anki_import_job SET next_batch_index = next_batch_index + 1,
          staged_note_count = staged_note_count + ${notes.length},
          staged_card_count = staged_card_count + ${cards.length},
          staged_review_count = staged_review_count + ${reviews.length},
          staged_byte_count = staged_byte_count + ${byteCount}, updated_at = now()
        WHERE id = ${jobId} AND user_id = ${userId} AND status = 'receiving'
          AND next_batch_index = ${batch.batchIndex}
          AND staged_note_count + ${notes.length} <= ${IMPORT_NOTE_LIMIT}
          AND staged_card_count + ${cards.length} <= ${IMPORT_CARD_LIMIT}
          AND staged_review_count + ${reviews.length} <= ${IMPORT_REVIEW_LIMIT}
          AND staged_byte_count + ${byteCount} <= ${IMPORT_TEXT_BYTE_LIMIT}
        RETURNING id
      ), saved_batch AS (
        INSERT INTO anki_import_batch (job_id, batch_index, payload_hash)
        SELECT id, ${batch.batchIndex}, ${hash} FROM ready RETURNING job_id
      ), saved_notes AS (
        INSERT INTO import_source_note (job_id, source_note_id, source_note_key, source_guid, model_id,
          raw_note, mapped_content, skipped, needs_attention, position)
        SELECT ready.id, data.* FROM ready CROSS JOIN jsonb_to_recordset(${JSON.stringify(notes)}::jsonb)
          AS data(source_note_id text, source_note_key text, source_guid text, model_id text,
            raw_note jsonb, mapped_content jsonb, skipped boolean, needs_attention boolean, position integer)
        RETURNING id
      ), saved_cards AS (
        INSERT INTO import_source_card (job_id, source_card_id, source_note_id, raw_card)
        SELECT ready.id, data.* FROM ready CROSS JOIN jsonb_to_recordset(${JSON.stringify(cards)}::jsonb)
          AS data(source_card_id text, source_note_id text, raw_card jsonb) RETURNING source_card_id
      ), saved_reviews AS (
        INSERT INTO import_source_review (job_id, source_review_id, source_card_id, raw_review)
        SELECT ready.id, data.* FROM ready CROSS JOIN jsonb_to_recordset(${JSON.stringify(reviews)}::jsonb)
          AS data(source_review_id text, source_card_id text, raw_review jsonb) RETURNING source_review_id
      ) SELECT count(*) FROM saved_batch
    `);
  } catch (error) {
    if (isUniqueViolation(error)) {
      const [retry] = await getDb()
        .select()
        .from(ankiImportBatch)
        .where(
          and(
            eq(ankiImportBatch.jobId, jobId),
            eq(ankiImportBatch.batchIndex, batch.batchIndex),
          ),
        )
        .limit(1);
      if (retry?.payloadHash === hash)
        return importJobView(await ownedJob(jobId, userId));
      throw new AnkiImportError(
        "Duplicate note, card, review, or conflicting batch in this deck",
        409,
      );
    }
    throw error;
  }
  const updated = await ownedJob(jobId, userId);
  const [retry] = await getDb()
    .select()
    .from(ankiImportBatch)
    .where(
      and(
        eq(ankiImportBatch.jobId, jobId),
        eq(ankiImportBatch.batchIndex, batch.batchIndex),
      ),
    )
    .limit(1);
  if (retry?.payloadHash !== hash)
    throw new AnkiImportError("Import changed while staging this batch", 409);
  return importJobView(updated);
}

export async function commitAnkiImport(
  jobId: string,
  userId: string,
  expected: { expectedBatchCount: number; expectedNoteCount: number },
) {
  const job = await ownedJob(jobId, userId);
  if (job.status === "completed") {
    const db = getDb();
    const progress = await ankiProgressWriteStatements(job, userId);
    if (progress.length)
      await db.batch([
        db.execute(
          sql`SELECT id FROM app_user WHERE id = ${userId} FOR UPDATE`,
        ),
        ...progress.map((statement) => db.execute(statement)),
      ]);
    return importJobView(await ownedJob(jobId, userId));
  }
  if (job.status !== "receiving")
    throw new AnkiImportError("This import cannot be committed", 409);
  if (
    job.nextBatchIndex !== expected.expectedBatchCount ||
    job.stagedNoteCount !== expected.expectedNoteCount
  ) {
    throw new AnkiImportError(
      "Import is incomplete; finish uploading all text batches",
      409,
    );
  }
  await assertVisibleImportBound(job);
  const templateRows = sql.join(
    STUDY_CARD_TEMPLATE_KEYS.map((key) => sql`(${key}::text)`),
    sql`, `,
  );
  const db = getDb();
  const progress = await ankiProgressWriteStatements(job, userId);
  // Serialize publication by owner, then take a fresh statement snapshot for
  // the destination size check. Different jobs can target the same word set.
  await db.batch([
    db.execute(sql`SELECT id FROM app_user WHERE id = ${userId} FOR UPDATE`),
    db.execute(sql`
    WITH locked AS (
      SELECT * FROM anki_import_job WHERE id = ${jobId} AND user_id = ${userId} FOR UPDATE
    ), ready AS (
      SELECT * FROM locked WHERE status = 'receiving'
        AND next_batch_index = ${expected.expectedBatchCount} AND staged_note_count = ${expected.expectedNoteCount}
        AND (${visibleImportBytes(sql`locked.id`, sql`locked.target_set_id`)}) <= ${IMPORT_VISIBLE_BYTE_LIMIT}
        AND EXISTS (SELECT 1 FROM import_source_note WHERE job_id = locked.id AND NOT skipped)
        AND (target_set_id IS NULL OR EXISTS (
          SELECT 1 FROM word_set WHERE id = locked.target_set_id AND user_id = locked.user_id
            AND source_lang = locked.source_lang AND target_lang = locked.target_lang
        ))
        AND NOT EXISTS (SELECT 1 FROM import_source_card card WHERE card.job_id = locked.id
          AND NOT EXISTS (SELECT 1 FROM import_source_note note WHERE note.job_id = card.job_id AND note.source_note_id = card.source_note_id))
        AND NOT EXISTS (SELECT 1 FROM import_source_review review WHERE review.job_id = locked.id
          AND NOT EXISTS (SELECT 1 FROM import_source_card card WHERE card.job_id = review.job_id AND card.source_card_id = review.source_card_id))
        AND NOT EXISTS (SELECT 1 FROM import_source_card card WHERE card.job_id = locked.id
          GROUP BY card.source_note_id, card.raw_card->>'ord' HAVING count(*) > 1)
    ), created_set AS (
      INSERT INTO word_set (user_id, name, source_lang, target_lang)
      SELECT user_id, name, source_lang, target_lang FROM ready WHERE target_set_id IS NULL RETURNING id
    ), destination AS (
      SELECT ready.*, coalesce(ready.target_set_id, created_set.id) AS destination_id
      FROM ready LEFT JOIN created_set ON true
    ), inserted AS (
      INSERT INTO word_set_item (id, word_set_id, anki_note_guid, original, translation, word_forms, sample,
        sample_translation, comments, tags, source_note_key, import_job_id, example_pairs, field_origins, position)
      SELECT note.proposed_item_id, destination.destination_id,
        'gooseberry-' || destination.destination_id::text || '-' || note.proposed_item_id::text,
        note.mapped_content->>'original', note.mapped_content->>'translation', note.mapped_content->>'wordForms',
        note.mapped_content->>'sample', note.mapped_content->>'sampleTranslation', note.mapped_content->>'comments',
        note.mapped_content->>'tags', note.source_note_key, destination.id,
        note.mapped_content->'examplePairs', note.mapped_content->'fieldOrigins',
        coalesce((SELECT max(position) + 1 FROM word_set_item WHERE word_set_id = destination.destination_id), 0) + note.position
      FROM import_source_note note INNER JOIN destination ON note.job_id = destination.id WHERE NOT note.skipped
      ON CONFLICT (word_set_id, source_note_key) WHERE source_note_key IS NOT NULL DO NOTHING
      RETURNING id, source_note_key
    ), linked_targets AS (
      SELECT id, source_note_key FROM inserted
      UNION ALL
      SELECT item.id, item.source_note_key FROM word_set_item item INNER JOIN destination
        ON item.word_set_id = destination.destination_id
      WHERE EXISTS (SELECT 1 FROM import_source_note note WHERE note.job_id = destination.id
        AND note.source_note_key = item.source_note_key AND NOT note.skipped)
    ), linked AS (
      UPDATE import_source_note SET item_id = linked_targets.id FROM linked_targets
      WHERE import_source_note.job_id = ${jobId} AND import_source_note.source_note_key = linked_targets.source_note_key RETURNING import_source_note.id
    ), cards_created AS (
      INSERT INTO study_card (word_set_item_id, template_key)
      SELECT inserted.id, template.key FROM inserted CROSS JOIN (VALUES ${templateRows}) AS template(key) RETURNING id
    )
    UPDATE anki_import_job SET status = 'completed', word_set_id = destination.destination_id,
      owns_set = destination.target_set_id IS NULL, added_count = (SELECT count(*) FROM inserted),
      skipped_count = anki_import_job.staged_note_count - (SELECT count(*) FROM inserted),
      needs_attention_count = (SELECT count(*) FROM import_source_note note INNER JOIN inserted ON note.proposed_item_id = inserted.id WHERE note.needs_attention),
      updated_at = now(), completed_at = now()
    FROM destination WHERE anki_import_job.id = destination.id
    `),
    ...progress.map((statement) => db.execute(statement)),
  ]);
  const updated = await ownedJob(jobId, userId);
  if (updated.status !== "completed") {
    await assertVisibleImportBound(updated);
    throw new AnkiImportError(
      "Import validation failed: unsupported notes, incomplete references, or changed target set",
      409,
    );
  }
  return importJobView(updated);
}

export async function removeAnkiImport(jobId: string, userId: string) {
  const job = await ownedJob(jobId, userId);
  if (job.status === "removed" || job.status === "cancelled")
    return importJobView(job);
  const db = getDb();
  // Clear source rows before deleting their items: their SET NULL foreign key
  // must not update a row also deleted by a sibling data-modifying CTE.
  await db.batch([
    db.execute(
      sql`SELECT id FROM anki_import_job WHERE id = ${jobId} AND user_id = ${userId} FOR UPDATE`,
    ),
    db.execute(
      sql`DELETE FROM import_source_note WHERE job_id = ${jobId} AND EXISTS (SELECT 1 FROM anki_import_job WHERE id = ${jobId} AND user_id = ${userId})`,
    ),
    db.execute(
      sql`DELETE FROM import_source_card WHERE job_id = ${jobId} AND EXISTS (SELECT 1 FROM anki_import_job WHERE id = ${jobId} AND user_id = ${userId})`,
    ),
    db.execute(
      sql`DELETE FROM import_source_review WHERE job_id = ${jobId} AND EXISTS (SELECT 1 FROM anki_import_job WHERE id = ${jobId} AND user_id = ${userId})`,
    ),
    db.execute(
      sql`DELETE FROM anki_import_batch WHERE job_id = ${jobId} AND EXISTS (SELECT 1 FROM anki_import_job WHERE id = ${jobId} AND user_id = ${userId})`,
    ),
    db.execute(sql`DELETE FROM word_set_item USING word_set
      WHERE import_job_id = ${jobId} AND word_set_item.word_set_id = word_set.id AND word_set.user_id = ${userId}`),
    db.execute(sql`DELETE FROM word_set USING anki_import_job job
      WHERE job.id = ${jobId} AND job.user_id = ${userId} AND job.owns_set AND word_set.id = job.word_set_id
        AND word_set.user_id = ${userId} AND NOT EXISTS (SELECT 1 FROM word_set_item WHERE word_set_id = word_set.id)`),
    db.execute(sql`UPDATE anki_import_job SET status = CASE WHEN status IN ('completed', 'removed') THEN 'removed' ELSE 'cancelled' END,
      mapping = '[]'::jsonb, package_metadata = '{}'::jsonb, updated_at = now()
      WHERE id = ${jobId} AND user_id = ${userId}`),
  ]);
  return importJobView(await ownedJob(jobId, userId));
}

export async function getImportNoteContext(
  itemId: string,
  userId: string,
): Promise<Record<string, string>> {
  const [source] = await getDb()
    .select({
      rawNote: importSourceNote.rawNote,
      metadata: ankiImportJob.packageMetadata,
    })
    .from(importSourceNote)
    .innerJoin(ankiImportJob, eq(ankiImportJob.id, importSourceNote.jobId))
    .innerJoin(wordSetItem, eq(wordSetItem.id, importSourceNote.itemId))
    .innerJoin(wordSet, eq(wordSet.id, wordSetItem.wordSetId))
    .where(
      and(
        eq(importSourceNote.itemId, itemId),
        eq(ankiImportJob.userId, userId),
        eq(wordSet.userId, userId),
      ),
    )
    .limit(1);
  if (!source) return {};
  const note = source.rawNote as unknown as AnkiNote;
  const models = (source.metadata as unknown as AnkiPackage).models ?? [];
  const model = models.find((entry) => entry.id === note.modelId);
  const result: Record<string, string> = Object.create(null);
  let remaining = 12000;
  for (const field of model?.fields ?? []) {
    const value = sanitizeAnkiText(note.fields[field.ord] ?? "").slice(
      0,
      Math.min(2000, remaining),
    );
    if (!value) continue;
    result[field.name.slice(0, 200)] = value;
    remaining -= value.length;
    if (!remaining) break;
  }
  return result;
}

export async function getAnkiImportSource(
  jobId: string,
  userId: string,
  offset = 0,
) {
  await ownedJob(jobId, userId);
  const notes = await getDb()
    .select({
      id: importSourceNote.sourceNoteId,
      itemId: importSourceNote.itemId,
      modelId: importSourceNote.modelId,
      note: importSourceNote.rawNote,
    })
    .from(importSourceNote)
    .where(eq(importSourceNote.jobId, jobId))
    .orderBy(asc(importSourceNote.position))
    .limit(1)
    .offset(offset);
  // One note may approach the upload limit; keep the private response bounded.
  const json = JSON.stringify(notes);
  if (Buffer.byteLength(json) > 3 * 1024 * 1024)
    throw new AnkiImportError("Source note too large to display", 413);
  return { notes, nextOffset: notes.length ? offset + 1 : null };
}
