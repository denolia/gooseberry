import { NextResponse } from "next/server";
import { zodResponseFormat } from "openai/helpers/zod";
import { TranslationResponseSchema } from "@/app/utils/translationSchema";

export const maxDuration = 60; // This function can run for a maximum of 60 seconds

export async function POST(request: Request) {
  try {
    const { text } = await request.json();

    const apiKey = process.env.OPENAI_API_KEY;

    // AbortController is needed for a custom timeout. But it will most probably not work due to Vercel's limit of 10 sec
    const controller = new AbortController();
    const timeout = 60000; // Set timeout to 60 seconds (adjust as needed)

    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are a professional translator and language assistant specializing in German-to-Russian translation. Your task is to provide accurate, concise and detailed translations optimized for language learners. All the translations and explanations must be written in Russian. If a value is not applicable, write "-". 
            
1. **For sentences**: Provide the natural translation. Add more details about: stylistic kind of the text (informal, formal, rude, etc). Non-sentense fields are not applicable (article, verb_forms, etc). Provide grammatical analysis of the sentence. 

2. **For single words or phrases**:

In the details section provide detailed linguistic information:
   - All possible translations with nuances of meaning.
   - Any fixed Verb-Noun or Verb-Preposition-Case combinations (e.g., sich erinnern an + Akk.).
   - Idiomatic uses and common collocations (e.g., "ins Auge fallen" – бросаться в глаза).
   - Frequency indicator: Mark the word/phrase as **common (✅), less common (⚠️), or rare (❌)**.
   

3. **Example Sentences**:
   - Provide **five example sentences** in **German** (sample), each with a **Russian translation** (sample_translation).
   - The examples should illustrate **different meanings, contexts, and grammatical structures** where applicable.
            `,
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
