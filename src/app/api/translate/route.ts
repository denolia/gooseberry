import { NextResponse } from "next/server";
import { zodResponseFormat } from "openai/helpers/zod";
import { TranslationResponseSchema } from "@/app/utils/translationSchema";
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

type OpenAIChatCompletionResponse = {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
};

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

function jsonWithTimings(
  body: unknown,
  timings: Timings,
  init?: ResponseInit,
) {
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
    const inputLength = typeof text === "string" ? text.length : 0;

    // AbortController is needed for a custom timeout.
    const controller = new AbortController();

    timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    phase = "openai";
    const response = await timeAsync(timings, "openai", () =>
      fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
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
            TranslationResponseSchema,
            "translation_response",
          ),
          reasoning_effort: "low",
        }),
        signal: controller.signal, // Attach the signal to fetch
      }),
    );

    // Clear the timeout when request completes
    clearTimeout(timeoutId);
    timeoutId = undefined;

    const openaiRequestId = response.headers.get("x-request-id");

    if (!response.ok) {
      const error = await response.json();

      console.error("OpenAI API error:", {
        error,
        inputLength,
        model: translationModel,
        openaiRequestId,
        phase,
        sourceLanguage: currentSourceLanguage,
        targetLanguage: getLanguageCode(currentTargetLanguage),
        timings,
      });
      throw new Error("Translation request failed");
    }

    phase = "openaiJson";
    const data = await timeAsync(
      timings,
      "openaiJson",
      () => response.json() as Promise<OpenAIChatCompletionResponse>,
    );
    try {
      phase = "validation";
      const validatedData = timeSync(timings, "validation", () =>
        TranslationResponseSchema.parse(
          JSON.parse(data.choices?.[0]?.message?.content ?? ""),
        ),
      );

      // Save to database. This is awaited today, so it is part of user-visible latency.
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
      } catch (dbError) {
        console.error("Failed to save translation to DB:", {
          error: getErrorMessage(dbError),
          inputLength,
          phase,
          timings,
        });
        // Don't fail the request - user still gets translation
      }

      timings.total = durationMs(totalStart);
      console.info("Translation request completed", {
        finishReason: data.choices?.[0]?.finish_reason,
        inputLength,
        model: translationModel,
        openaiRequestId,
        sourceLanguage: currentSourceLanguage,
        targetLanguage: getLanguageCode(currentTargetLanguage),
        timings,
        usage: {
          completionTokens: data.usage?.completion_tokens,
          promptTokens: data.usage?.prompt_tokens,
          reasoningTokens:
            data.usage?.completion_tokens_details?.reasoning_tokens,
          totalTokens: data.usage?.total_tokens,
        },
      });

      return jsonWithTimings(validatedData, timings);
    } catch (error) {
      timings.total = durationMs(totalStart);
      console.error("Validation error:", {
        error: getErrorMessage(error),
        inputLength,
        model: translationModel,
        openaiRequestId,
        phase,
        timings,
      });
      return jsonWithTimings(
        { error: "Invalid response format" },
        timings,
        { status: 500 },
      );
    }
  } catch (error) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timings.total = durationMs(totalStart);
    console.error("Translation error:", {
      error: getErrorMessage(error),
      phase,
      timings,
    });
    return jsonWithTimings(
      { error: "Translation failed" },
      timings,
      { status: 500 },
    );
  }
}
