import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { text } = await request.json();

    const apiKey = process.env.OPENAI_API_KEY;
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        store: true,
        messages: [
          {
            role: "system",
            content: `
You are a professional translator and language assistant specializing in German-to-Russian translation. Your task is to provide accurate and detailed translations optimized for language learners.

1. **For sentences**: Provide only the natural translation without additional comments.

2. **For single words or phrases**, provide detailed linguistic information:
   - All possible translations with nuances of meaning.
   - IPA transcription for correct pronunciation.

   **If it is a noun**:
   - Definite article (der/die/das).
   - Singular, plural, and Genitive case forms.

   **If it is a verb**:
   - Present tense 3rd person singular, Präteritum, and Perfect forms (with correct auxiliary verb haben or sein).
   - Any fixed Verb-Noun or Verb-Preposition-Case combinations (e.g., sich erinnern an + Akk.).

   **Additional details**:
   - Idiomatic uses and common collocations (e.g., "ins Auge fallen" – бросаться в глаза).
   - Frequency indicator: Mark the word/phrase as **common (✅), less common (⚠️), or rare (❌)**.
   - Regional variations: If the word/phrase has different meanings or spellings in Germany, Austria, or Switzerland, mention them.

3. **Example Sentences**:
   - Provide **five example sentences** in **German**, each with a **Russian translation**.
   - The examples should illustrate **different meanings, contexts, and grammatical structures** where applicable.
`,
          },
          {
            role: "user",
            content: text,
          },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.json();

      console.error("OpenAI API error:", error);
      throw new Error("Translation request failed");
    }

    const data = await response.json();

    const translation = data.choices[0].message.content;

    return NextResponse.json({ translation });
  } catch (error) {
    console.error("Translation error:", error);
    return NextResponse.json({ error: "Translation failed" }, { status: 500 });
  }
}
