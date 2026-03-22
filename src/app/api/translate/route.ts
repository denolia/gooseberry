import { NextResponse } from "next/server";
import { zodResponseFormat } from "openai/helpers/zod";
import { TranslationResponseSchema } from "@/app/utils/translationSchema";
import { auth } from "@/auth";
import { getTranslationPrompt } from "@/app/api/translate/getTranslationPrompt";
import { insertTranslation } from "@/db/translationRepo";
import {
  Language,
  Languages,
  TargetLanguage,
  TargetLanguageCodes,
  TargetLanguages,
} from "@/components/ui/Languages";

export const maxDuration = 60; // This function can run for a maximum of 60 seconds
const timeoutMs = 60000; // timeout for the request in milliseconds

function getSourceLanguage(value: unknown): Language {
  return value === Languages.Norwegian || value === Languages.English
    ? value
    : Languages.German;
}

function getTargetLanguage(value: unknown): TargetLanguage {
  return value === TargetLanguages.Russian
    ? TargetLanguages.Russian
    : TargetLanguages.English;
}

export async function POST(request: Request) {
  // Check if the user is authenticated
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { text, language, targetLanguage } = await request.json();
    const currentSourceLanguage = getSourceLanguage(language);
    const currentTargetLanguage = getTargetLanguage(targetLanguage);

    // AbortController is needed for a custom timeout.
    const controller = new AbortController();

    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
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
      }),
      signal: controller.signal, // Attach the signal to fetch
    });

    // Clear the timeout when request completes
    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json();

      console.error("OpenAI API error:", error);
      throw new Error("Translation request failed");
    }

    const data = await response.json();
    try {
      const validatedData = TranslationResponseSchema.parse(
        JSON.parse(data.choices[0].message.content),
      );

      // Save to database (non-blocking)
      try {
        await insertTranslation({
          userId: session.user.id,
          sourceLang: currentSourceLanguage,
          targetLang: TargetLanguageCodes[currentTargetLanguage],
          inputText: text,
          responseJson: validatedData,
          model: "gpt-4o",
          promptVersion: "v1",
        });
      } catch (dbError) {
        console.error("Failed to save translation to DB:", dbError);
        // Don't fail the request - user still gets translation
      }

      return NextResponse.json(validatedData);
    } catch (error) {
      console.error("Validation error:", error);
      return NextResponse.json(
        { error: "Invalid response format" },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error("Translation error:", error);
    return NextResponse.json({ error: "Translation failed" }, { status: 500 });
  }
}
