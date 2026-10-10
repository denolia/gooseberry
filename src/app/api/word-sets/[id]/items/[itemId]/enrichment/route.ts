import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { countInputWords } from "@/lib/admin/wordCount";
import { finishUsage } from "@/db/usageRepo";
import {
  applyEnrichment,
  EnrichmentError,
  enrichmentResponse,
  finishEnrichment,
  getEnrichmentItem,
  getEnrichmentRequest,
  reserveEnrichment,
} from "@/db/enrichmentRepo";
import {
  buildEnrichmentPrompt,
  ENRICHMENT_FIELDS,
  ENRICHMENT_SYSTEM_PROMPT,
  EnrichmentInputSchema,
  EnrichmentProposalSchema,
  missingEnrichmentFields,
} from "@/lib/anki/enrichment";
import { BodyReadError, readBoundedJson } from "@/lib/http/readJson";

export const maxDuration = 60;
const maxCompletionTokens = 2000;
const model =
  process.env.OPENAI_ENRICHMENT_MODEL ??
  process.env.OPENAI_TRANSLATION_MODEL ??
  "gpt-5-mini";
const configuredLimit = Number(
  process.env.ENRICHMENT_DAILY_TOKEN_LIMIT ?? 100000,
);
const dailyTokenLimit =
  Number.isSafeInteger(configuredLimit) && configuredLimit >= 0
    ? configuredLimit
    : 100000;
const ContextSchema = z.object({ id: z.uuid(), itemId: z.uuid() });
type RouteContext = { params: Promise<{ id: string; itemId: string }> };

function failure(error: unknown) {
  if (error instanceof z.ZodError)
    return NextResponse.json(
      { error: "Choose valid missing fields and refresh this word." },
      { status: 400 },
    );
  if (error instanceof EnrichmentError || error instanceof BodyReadError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  console.error("Enrichment request failed", {
    error: error instanceof Error ? error.message : "Unknown error",
  });
  return NextResponse.json(
    { error: "Could not generate missing content. Please try again." },
    { status: 502 },
  );
}

export async function GET(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id, itemId } = ContextSchema.parse(await context.params);
    await getEnrichmentItem(session.user.id, id, itemId);
    const requestKey = z
      .uuid()
      .parse(new URL(request.url).searchParams.get("requestKey"));
    const result = await getEnrichmentRequest(
      session.user.id,
      itemId,
      requestKey,
    );
    if (!result)
      throw new EnrichmentError("Generation request not found.", 404);
    return NextResponse.json(enrichmentResponse(result), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let usageId: string | undefined;
  let completion: OpenAI.Chat.Completions.ChatCompletion | undefined;
  let finalized = false;
  try {
    const { id, itemId } = ContextSchema.parse(await context.params);
    const input = EnrichmentInputSchema.parse(
      await readBoundedJson(request, 16 * 1024),
    );
    const row = await getEnrichmentItem(session.user.id, id, itemId);
    // Recover completed or pending requests before inspecting the now-edited
    // content. Retries never silently cause a second paid provider request.
    const repeated = await getEnrichmentRequest(
      session.user.id,
      itemId,
      input.requestKey,
    );
    if (repeated) {
      if (
        repeated.contentRevision !== input.contentRevision ||
        JSON.stringify([...repeated.fields].sort()) !==
          JSON.stringify([...input.fields].sort())
      )
        throw new EnrichmentError(
          "This request was already used for different content.",
          409,
        );
      return NextResponse.json(enrichmentResponse(repeated), {
        status: repeated.status === "pending" ? 202 : 200,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    if (row.item.contentRevision !== input.contentRevision)
      throw new EnrichmentError(
        "This word changed. Refresh before generating.",
        409,
      );
    const missing = missingEnrichmentFields(row.item);
    if (input.fields.some((field) => !missing.includes(field)))
      throw new EnrichmentError("Only missing fields can be generated.", 400);
    if (
      ![
        ...ENRICHMENT_FIELDS.map((field) => row.item[field]),
        ...Object.values(row.sourceFields),
      ].some((value) => value.trim())
    )
      throw new EnrichmentError(
        "Add a word, meaning or example first so we know what to generate.",
        400,
      );
    const prompt = buildEnrichmentPrompt({
      sourceLang: row.sourceLang,
      targetLang: row.targetLang,
      fields: input.fields,
      content: row.item,
      sourceFields: row.sourceFields,
    });
    const promptBytes = new TextEncoder().encode(
      prompt + ENRICHMENT_SYSTEM_PROMPT,
    ).byteLength;
    if (promptBytes > 30000)
      throw new EnrichmentError(
        "This word has too much source context for one generation request. Shorten its notes first.",
        413,
      );
    const reservation = await reserveEnrichment({
      ...input,
      userId: session.user.id,
      itemId,
      // UTF-8 bytes conservatively bound text tokens; reserve output and framing
      // overhead too. Failed/unknown calls retain their reservation for the day.
      reservedTokens: promptBytes + maxCompletionTokens + 2048,
      dailyTokenLimit,
      model,
      inputWords: countInputWords(prompt),
    });
    if (!reservation.isNew)
      return NextResponse.json(enrichmentResponse(reservation.request), {
        status: reservation.request.status === "pending" ? 202 : 200,
      });
    usageId = reservation.request.id;
    const client = new OpenAI({ maxRetries: 0, timeout: 45000 });
    completion = await client.chat.completions.create(
      {
        model,
        max_completion_tokens: maxCompletionTokens,
        reasoning_effort: "minimal",
        response_format: zodResponseFormat(
          EnrichmentProposalSchema,
          "missing_vocabulary_fields",
        ),
        messages: [
          { role: "system", content: ENRICHMENT_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
      },
      { signal: request.signal },
    );
    const message = completion.choices[0]?.message;
    if (message?.refusal || completion.choices[0]?.finish_reason !== "stop")
      throw new Error("No complete generation result.");
    const proposal = EnrichmentProposalSchema.parse(
      JSON.parse(message?.content ?? ""),
    );
    for (const field of ENRICHMENT_FIELDS)
      if (!input.fields.includes(field)) proposal.values[field] = null;
    await finishEnrichment(usageId, proposal);
    await finishUsage(usageId, "succeeded", completion);
    finalized = true;
    return NextResponse.json(
      {
        requestKey: input.requestKey,
        contentRevision: input.contentRevision,
        fields: input.fields,
        status: "completed",
        proposal,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (usageId) await finishEnrichment(usageId, null).catch(() => undefined);
    return failure(error);
  } finally {
    if (usageId && !finalized) await finishUsage(usageId, "failed", completion);
  }
}

const ApplySchema = z.object({
  requestKey: z.uuid(),
  contentRevision: z.number().int().min(0),
  values: z
    .object({
      original: z.string().max(10000).optional(),
      translation: z.string().max(10000).optional(),
      wordForms: z.string().max(20000).optional(),
      sample: z.string().max(50000).optional(),
      sampleTranslation: z.string().max(50000).optional(),
      comments: z.string().max(50000).optional(),
    })
    .strict(),
});
export async function PATCH(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id, itemId } = ContextSchema.parse(await context.params);
    const input = ApplySchema.parse(await readBoundedJson(request, 256 * 1024));
    await applyEnrichment({
      ...input,
      userId: session.user.id,
      wordSetId: id,
      itemId,
    });
    return NextResponse.json(
      { success: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
