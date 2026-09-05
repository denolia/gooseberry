import OpenAI from "openai";
import { NextResponse } from "next/server";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  BaseTranslationResponseSchema,
  FinnishTranslationResponseSchema,
} from "@/app/utils/translationSchema";
import { auth } from "@/auth";
import { getTranslationPrompt } from "@/app/api/translate/getTranslationPrompt";
import { insertTranslation } from "@/db/translationRepo";
import {
  getLanguageCode,
  isSourceLanguage,
  isTargetLanguage,
  SourceLanguage,
  SourceLanguages,
  TargetLanguage,
  TargetLanguages,
} from "@/components/ui/Languages";

export const maxDuration = 60; // This function can run for a maximum of 60 seconds
const timeoutMs = 60000; // timeout for the request in milliseconds
const translationModel = process.env.OPENAI_TRANSLATION_MODEL ?? "gpt-5-mini";
const maxCompletionTokens = 1800;

type TimingName =
  | "auth"
  | "request"
  | "openai"
  | "openaiJson"
  | "validation"
  | "db"
  | "total";

type Timings = Partial<Record<TimingName, number>>;

function durationMs(start: number) {
  return Math.round((performance.now() - start) * 100) / 100;
}

async function timeAsync<T>(
  timings: Timings,
  name: TimingName,
  callback: () => Promise<T>,
) {
  const start = performance.now();
  try {
    return await callback();
  } finally {
    timings[name] = durationMs(start);
  }
}

function timeSync<T>(timings: Timings, name: TimingName, callback: () => T) {
  const start = performance.now();
  try {
    return callback();
  } finally {
    timings[name] = durationMs(start);
  }
}

function getServerTimingHeader(timings: Timings) {
  return Object.entries(timings)
    .map(([name, duration]) => `${name};dur=${duration}`)
    .join(", ");
}

function jsonWithTimings(body: unknown, timings: Timings, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Server-Timing", getServerTimingHeader(timings));

  return NextResponse.json(body, {
    ...init,
    headers,
  });
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getSourceLanguage(value: unknown): SourceLanguage {
  return isSourceLanguage(value) ? value : SourceLanguages.German;
}

function getTargetLanguage(value: unknown): TargetLanguage {
  return isTargetLanguage(value) ? value : TargetLanguages.English;
}

export async function POST(request: Request) {
  const totalStart = performance.now();
  const timings: Timings = {};
  let phase = "auth";
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    // Check if the user is authenticated
    const session = await timeAsync(timings, "auth", () => auth());
    if (!session?.user?.id) {
      timings.total = durationMs(totalStart);
      return jsonWithTimings({ error: "Unauthorized" }, timings, {
        status: 401,
      });
    }

    phase = "request";
    const { text, sourceLanguage, targetLanguage } = await timeAsync(
      timings,
      "request",
      () => request.json(),
    );
    const currentSourceLanguage = getSourceLanguage(sourceLanguage);
    const currentTargetLanguage = getTargetLanguage(targetLanguage);
    const responseSchema =
      currentSourceLanguage === SourceLanguages.Finnish
        ? FinnishTranslationResponseSchema
        : BaseTranslationResponseSchema;
    const inputLength = typeof text === "string" ? text.length : 0;

    if (typeof text !== "string" || !text.trim()) {
      return jsonWithTimings({ error: "Enter text to translate." }, timings, {
        status: 400,
      });
    }

    const abortController = new AbortController();
    const abort = () => abortController.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) abort();
    const encoder = new TextEncoder();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      async start(output) {
        const send = (event: unknown) => {
          if (!cancelled)
            output.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        };
        timeoutId = setTimeout(abort, timeoutMs);
        try {
          phase = "openai";
          const openaiStart = performance.now();
          const client = new OpenAI({ maxRetries: 0 });
          const stream = client.chat.completions.stream(
            {
              model: translationModel,
              max_completion_tokens: maxCompletionTokens,
              messages: [
                {
                  role: "system",
                  content: getTranslationPrompt(
                    currentSourceLanguage,
                    currentTargetLanguage,
                  ),
                },
                { role: "user", content: text },
              ],
              response_format: zodResponseFormat(
                responseSchema,
                "translation_response",
              ),
              reasoning_effort: "minimal",
              stream_options: { include_usage: true },
            },
            { signal: abortController.signal },
          );
          let lastPreview = "";
          stream.on("content.delta", ({ parsed }) => {
            if (!parsed || typeof parsed !== "object") return;
            const partial = parsed as {
              original?: unknown;
              translation?: unknown;
            };
            const preview = {
              type: "preview",
              original:
                typeof partial.original === "string" ? partial.original : "",
              translation:
                typeof partial.translation === "string"
                  ? partial.translation
                  : "",
            };
            const serialized = JSON.stringify(preview);
            if (serialized !== lastPreview) {
              lastPreview = serialized;
              send(preview);
            }
          });
          const data = await stream.finalChatCompletion();
          timings.openai = durationMs(openaiStart);
          clearTimeout(timeoutId);
          phase = "validation";
          const validatedData = timeSync(timings, "validation", () =>
            responseSchema.parse(
              JSON.parse(data.choices[0]?.message.content ?? ""),
            ),
          );
          // Display the validated card before waiting for persistence.
          send({ type: "result", response: validatedData });
          try {
            phase = "db";
            await timeAsync(timings, "db", () =>
              insertTranslation({
                userId: session.user.id,
                sourceLang: currentSourceLanguage,
                targetLang: getLanguageCode(currentTargetLanguage),
                inputText: text,
                responseJson: validatedData,
                model: translationModel,
                promptVersion: "v1",
              }),
            );
          } catch (error) {
            console.error("Failed to save translation to DB:", {
              error: getErrorMessage(error),
              timings,
            });
          }
          timings.total = durationMs(totalStart);
          console.info("Translation request completed", {
            model: translationModel,
            inputLength,
            timings,
            finishReason: data.choices[0]?.finish_reason,
            usage: {
              completionTokens: data.usage?.completion_tokens,
              promptTokens: data.usage?.prompt_tokens,
              reasoningTokens:
                data.usage?.completion_tokens_details?.reasoning_tokens,
            },
          });
          send({ type: "done", timings });
        } catch (error) {
          console.error("Translation stream failed", {
            phase,
            error: getErrorMessage(error),
            timings,
          });
          send({
            type: "error",
            error: abortController.signal.aborted
              ? "Translation timed out. Please try again."
              : "Could not finish the translation. Please try again.",
          });
        } finally {
          clearTimeout(timeoutId);
          request.signal.removeEventListener("abort", abort);
          if (!cancelled) output.close();
        }
      },
      cancel() {
        cancelled = true;
        abort();
      },
    });
    return new Response(body, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    timings.total = durationMs(totalStart);
    console.error("Translation error:", {
      error: getErrorMessage(error),
      phase,
      timings,
    });
    return jsonWithTimings({ error: "Translation failed" }, timings, {
      status: 500,
    });
  }
}
