import { startUsage, finishUsage } from "@/db/usageRepo";
import { countInputWords } from "@/lib/admin/wordCount";
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
  SourceLanguages,
} from "@/components/ui/Languages";

export const maxDuration = 60; // This function can run for a maximum of 60 seconds
const timeoutMs = 60000; // timeout for the request in milliseconds
const translationModel = process.env.OPENAI_TRANSLATION_MODEL ?? "gpt-5-mini";
const maxCompletionTokens = 1800;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: Request) {
  let phase = "auth";
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    // Check if the user is authenticated
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        {
          status: 401,
        },
      );
    }

    phase = "request";
    const requestBody = await request.json();
    const input =
      requestBody && typeof requestBody === "object"
        ? (requestBody as Record<string, unknown>)
        : {};
    const { text, sourceLanguage, targetLanguage } = input;
    if (
      typeof text !== "string" ||
      !isSourceLanguage(sourceLanguage) ||
      !isTargetLanguage(targetLanguage)
    ) {
      return NextResponse.json(
        { error: "Choose valid source and target languages." },
        { status: 400 },
      );
    }
    const currentSourceLanguage = sourceLanguage;
    const currentTargetLanguage = targetLanguage;
    const responseSchema =
      currentSourceLanguage === SourceLanguages.Finnish
        ? FinnishTranslationResponseSchema
        : BaseTranslationResponseSchema;

    if (typeof text !== "string" || !text.trim()) {
      return NextResponse.json(
        { error: "Enter text to translate." },
        {
          status: 400,
        },
      );
    }

    const usageId = await startUsage({
      userId: session.user.id,
      operation: "translate",
      model: translationModel,
      inputWords: countInputWords(text),
    });
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
        let completion:
          | {
              id: string;
              model: string;
              usage?: OpenAI.Completions.CompletionUsage | null;
            }
          | undefined;
        let usageStatus: "succeeded" | "failed" = "failed";
        let usageFinalized = false;
        try {
          phase = "openai";
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
          stream.on("chunk", (chunk) => {
            if (chunk.usage) completion = chunk;
          });
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
          completion = data;
          clearTimeout(timeoutId);
          phase = "validation";
          const validatedData = responseSchema.parse(
            JSON.parse(data.choices[0]?.message.content ?? ""),
          );
          usageStatus = "succeeded";
          // Display the validated card before waiting for persistence.
          send({ type: "result", response: validatedData });
          try {
            phase = "db";
            await insertTranslation({
              userId: session.user.id,
              sourceLang: currentSourceLanguage,
              targetLang: getLanguageCode(currentTargetLanguage),
              inputText: text,
              responseJson: validatedData,
              model: translationModel,
              promptVersion: "v2",
            });
          } catch (error) {
            console.error("Failed to save translation to DB:", {
              error: getErrorMessage(error),
            });
          }
          await finishUsage(usageId, usageStatus, completion);
          usageFinalized = true;
          send({ type: "done" });
        } catch (error) {
          console.error("Translation stream failed", {
            phase,
            error: getErrorMessage(error),
          });
          send({
            type: "error",
            error: abortController.signal.aborted
              ? "Translation timed out. Please try again."
              : "Could not finish the translation. Please try again.",
          });
        } finally {
          if (!usageFinalized)
            await finishUsage(usageId, usageStatus, completion);
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
    console.error("Translation error:", {
      error: getErrorMessage(error),
      phase,
    });
    return NextResponse.json(
      { error: "Translation failed" },
      {
        status: 500,
      },
    );
  }
}
