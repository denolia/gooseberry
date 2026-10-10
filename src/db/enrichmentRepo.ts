import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/drizzle";
import { enrichmentRequest, wordSet, wordSetItem } from "@/db/schema";
import { getImportNoteContext } from "@/db/ankiImportRepo";
import {
  type EnrichmentField,
  type EnrichmentProposal,
  ENRICHMENT_FIELDS,
} from "@/lib/anki/enrichment";

export class EnrichmentError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function getEnrichmentItem(
  userId: string,
  wordSetId: string,
  itemId: string,
) {
  const [row] = await getDb()
    .select({
      item: wordSetItem,
      sourceLang: wordSet.sourceLang,
      targetLang: wordSet.targetLang,
    })
    .from(wordSetItem)
    .innerJoin(wordSet, eq(wordSet.id, wordSetItem.wordSetId))
    .where(
      and(
        eq(wordSet.userId, userId),
        eq(wordSet.id, wordSetId),
        eq(wordSetItem.id, itemId),
      ),
    )
    .limit(1);
  if (!row) throw new EnrichmentError("Word not found.", 404);
  return { ...row, sourceFields: await getImportNoteContext(itemId, userId) };
}

export async function getEnrichmentRequest(
  userId: string,
  itemId: string,
  requestKey: string,
) {
  // Recovery must also work when the original server call disappeared and no
  // later reservation runs the broader cleanup. Keep its reserved AI budget;
  // the same request key returns this failure rather than starting paid work.
  await getDb()
    .execute(sql`UPDATE enrichment_request SET status='failed', completed_at=now()
    WHERE user_id=${userId} AND item_id=${itemId} AND request_key=${requestKey}
      AND status='pending' AND created_at < now()-interval '10 minutes'`);
  const [row] = await getDb()
    .select()
    .from(enrichmentRequest)
    .where(
      and(
        eq(enrichmentRequest.userId, userId),
        eq(enrichmentRequest.itemId, itemId),
        eq(enrichmentRequest.requestKey, requestKey),
      ),
    )
    .limit(1);
  return row ?? null;
}

function matchesRequest(
  row: typeof enrichmentRequest.$inferSelect,
  input: { itemId: string; fields: EnrichmentField[]; contentRevision: number },
) {
  return (
    row.itemId === input.itemId &&
    row.contentRevision === input.contentRevision &&
    JSON.stringify([...row.fields].sort()) ===
      JSON.stringify([...input.fields].sort())
  );
}

export async function reserveEnrichment(input: {
  userId: string;
  itemId: string;
  requestKey: string;
  contentRevision: number;
  fields: EnrichmentField[];
  reservedTokens: number;
  dailyTokenLimit: number;
  model: string;
  inputWords: number;
}) {
  const existing = await getEnrichmentRequest(
    input.userId,
    input.itemId,
    input.requestKey,
  );
  if (existing) {
    if (!matchesRequest(existing, input))
      throw new EnrichmentError(
        "This request was already used for different content.",
        409,
      );
    return { request: existing, isNew: false };
  }
  const id = crypto.randomUUID();
  const db = getDb();
  // Neon batches run in one transaction. The user row serializes reservations,
  // so concurrent requests cannot both spend the remaining daily allowance.
  const results = await db.batch([
    db.execute(
      sql`SELECT id FROM app_user WHERE id = ${input.userId} FOR UPDATE`,
    ),
    db.execute(sql`UPDATE enrichment_request SET status = 'failed', completed_at = now()
      WHERE user_id = ${input.userId} AND status = 'pending' AND created_at < now() - interval '10 minutes'`),
    db.execute(sql`INSERT INTO enrichment_request (id,user_id,item_id,request_key,content_revision,fields)
      SELECT ${id}::uuid, ${input.userId}::uuid, ${input.itemId}::uuid, ${input.requestKey}::uuid,
        ${input.contentRevision}, ${JSON.stringify(input.fields)}::jsonb
      WHERE EXISTS (SELECT 1 FROM word_set_item i JOIN word_set s ON s.id=i.word_set_id
        WHERE i.id=${input.itemId} AND s.user_id=${input.userId} AND i.content_revision=${input.contentRevision})
      AND NOT EXISTS (SELECT 1 FROM enrichment_request WHERE item_id=${input.itemId} AND status='pending')
      AND (SELECT coalesce(sum(reserved_tokens),0) FROM ai_usage
        WHERE user_id=${input.userId} AND operation='enrich'
          AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') + ${input.reservedTokens} <= ${input.dailyTokenLimit}
      AND (SELECT count(*) FROM ai_usage WHERE user_id=${input.userId} AND operation='enrich' AND created_at > now()-interval '1 hour') < 20
      AND (SELECT count(*) FROM ai_usage WHERE user_id=${input.userId} AND operation='enrich' AND created_at > now()-interval '1 minute') < 5
      ON CONFLICT DO NOTHING RETURNING id`),
    db.execute(sql`INSERT INTO ai_usage (id,user_id,operation,model,status,input_words,reserved_tokens)
      SELECT id,user_id,'enrich',${input.model},'pending',${input.inputWords},${input.reservedTokens}
      FROM enrichment_request WHERE id=${id} ON CONFLICT DO NOTHING`),
  ]);
  if (results[2].rows.length === 0) {
    const repeated = await getEnrichmentRequest(
      input.userId,
      input.itemId,
      input.requestKey,
    );
    if (repeated) {
      if (!matchesRequest(repeated, input))
        throw new EnrichmentError(
          "This request was already used for different content.",
          409,
        );
      return { request: repeated, isNew: false };
    }
    const [pending] = await db
      .select({ id: enrichmentRequest.id })
      .from(enrichmentRequest)
      .where(
        and(
          eq(enrichmentRequest.itemId, input.itemId),
          eq(enrichmentRequest.status, "pending"),
        ),
      )
      .limit(1);
    if (pending)
      throw new EnrichmentError(
        "Generation is already running for this word. Try checking it again shortly.",
        409,
      );
    throw new EnrichmentError(
      "The generation allowance or request limit has been reached, or this word changed. Refresh and try again later.",
      429,
    );
  }
  const request = await getEnrichmentRequest(
    input.userId,
    input.itemId,
    input.requestKey,
  );
  if (!request) throw new Error("Could not load the generation request.");
  return { request, isNew: true };
}

export async function finishEnrichment(
  id: string,
  proposal: EnrichmentProposal | null,
) {
  await getDb()
    .update(enrichmentRequest)
    .set({
      status: proposal ? "completed" : "failed",
      proposal,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(enrichmentRequest.id, id),
        eq(enrichmentRequest.status, "pending"),
      ),
    );
}

export async function applyEnrichment(input: {
  userId: string;
  wordSetId: string;
  itemId: string;
  requestKey: string;
  contentRevision: number;
  values: Partial<Record<EnrichmentField, string>>;
}) {
  const current = await getEnrichmentItem(
    input.userId,
    input.wordSetId,
    input.itemId,
  );
  const request = await getEnrichmentRequest(
    input.userId,
    input.itemId,
    input.requestKey,
  );
  if (!request) throw new EnrichmentError("Generation request not found.", 404);
  if (request.status === "applied") return;
  if (request.status !== "completed")
    throw new EnrichmentError("This proposal is not ready to save.", 409);
  if (
    request.contentRevision !== input.contentRevision ||
    current.item.contentRevision !== input.contentRevision
  )
    throw new EnrichmentError(
      "This word changed since generation. Review the latest content before generating again.",
      409,
    );
  const entries = Object.entries(input.values) as [EnrichmentField, string][];
  if (
    !entries.length ||
    entries.some(
      ([field, value]) =>
        !request.fields.includes(field) ||
        current.item[field].trim() ||
        !value.trim(),
    )
  )
    throw new EnrichmentError(
      "Only the requested missing fields can be saved.",
      400,
    );
  const values = Object.fromEntries(
    entries.map(([field, value]) => [field, value.trim()]),
  );
  const proposal = request.proposal as EnrichmentProposal | null;
  const origins = Object.fromEntries(
    entries.map(([field, value]) => [
      field,
      {
        origin:
          value.trim() === proposal?.values[field]?.trim() ? "ai" : "edited",
        requestId: request.id,
      },
    ]),
  );
  const pairs = [...current.item.examplePairs];
  if (values.sample !== undefined || values.sampleTranslation !== undefined) {
    const sample = values.sample ?? current.item.sample;
    const translation =
      values.sampleTranslation ?? current.item.sampleTranslation;
    const first = pairs.findIndex(
      (pair) =>
        pair.sample === current.item.sample &&
        pair.translation === current.item.sampleTranslation,
    );
    if (first >= 0) pairs[first] = { sample, translation };
    else pairs.unshift({ sample, translation });
  }
  const db = getDb();
  // The revision comparison and the request transition are atomic. A concurrent
  // edit or apply leaves the user's values and all scheduling history intact.
  const assignments = sql.join(
    entries.map(
      ([field, value]) =>
        sql`${sql.identifier(wordSetItem[field].name)} = ${value.trim()}`,
    ),
    sql`, `,
  );
  const result = await db.execute(sql`WITH updated AS (
    UPDATE word_set_item SET ${assignments}, example_pairs=${JSON.stringify(pairs)}::jsonb,
      content_revision=content_revision+1,
      field_origins=field_origins || ${JSON.stringify(origins)}::jsonb, updated_at=now()
    WHERE id=${input.itemId} AND word_set_id=${input.wordSetId} AND content_revision=${input.contentRevision}
      AND EXISTS (SELECT 1 FROM enrichment_request WHERE id=${request.id} AND status='completed')
      AND EXISTS (SELECT 1 FROM word_set WHERE id=${input.wordSetId} AND user_id=${input.userId})
    RETURNING id
  ) UPDATE enrichment_request SET status='applied', completed_at=now()
    FROM updated WHERE enrichment_request.id=${request.id} AND enrichment_request.status='completed'
    RETURNING enrichment_request.id`);
  if (!result.rows.length) {
    const latest = await getEnrichmentRequest(
      input.userId,
      input.itemId,
      input.requestKey,
    );
    if (latest?.status !== "applied")
      throw new EnrichmentError(
        "This word changed. Your generated proposal was not saved.",
        409,
      );
  }
}

export function enrichmentResponse(
  request: typeof enrichmentRequest.$inferSelect,
) {
  return {
    requestKey: request.requestKey,
    contentRevision: request.contentRevision,
    fields: request.fields.filter((field): field is EnrichmentField =>
      ENRICHMENT_FIELDS.includes(field as EnrichmentField),
    ),
    status: request.status,
    proposal: request.proposal,
  };
}
