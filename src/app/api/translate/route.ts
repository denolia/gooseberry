import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { text } = await request.json();

    const apiKey = process.env.OPENAI_API_KEY;

    // AbortController is needed for a custom timeout. But it will most probably not work due to Vercel's limit of 10 sec
    const controller = new AbortController();
    const timeout = 30000; // Set timeout to 30 seconds (adjust as needed)

    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        store: true,
        messages: [
          {
            role: "system",
            content: `
You are a professional translator and language assistant specializing in German-to-Russian translation. Your task is to provide accurate, concise and detailed translations optimized for language learners.

1. **For sentences**: Provide only the natural translation. Then add more details about: stylistic kind of the text (informal, formal, rude, etc). Estimate how close is the translation to the source meaning.

2. **For single words or phrases**, provide detailed linguistic information:
   - All possible translations with nuances of meaning.
   - IPA transcription for correct pronunciation.

   **If the word is not in its infinitive or initial form**, provide its **infinitive/initial form** before giving further details.

   **If it is a noun**:
   - Definite article (der/die/das).
   - Singular, plural, and Genitive case forms.

   **If it is a verb**:
   - Present tense 3rd person singular, Präteritum, and Perfect forms (with correct auxiliary verb haben or sein).
   - Any fixed Verb-Noun or Verb-Preposition-Case combinations (e.g., sich erinnern an + Akk.).

   **Additional details**:
   - Idiomatic uses and common collocations (e.g., "ins Auge fallen" – бросаться в глаза).
   - Frequency indicator: Mark the word/phrase as **common (✅), less common (⚠️), or rare (❌)**.
   Format for Noun case: 
   "
   [der/die/das] [Noun] [endings for plural and Genitiv]
   [translation]
   ---
   [then all the rest of the details]
   "
   Format for Verb case: 
   "
   [infinitive] * [3rd person singular] * [Präteritum] * [Perfect]
   [translation]
   ---
   [then all the rest of the details]
   "
   Format for other parts of speech: 
   [initial form when applicable]
   [translation]
   ---
   [then all the rest of the details]


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

    const translation = data.choices[0].message.content;

    return NextResponse.json({ translation });
  } catch (error) {
    console.error("Translation error:", error);
    return NextResponse.json({ error: "Translation failed" }, { status: 500 });
  }
}
