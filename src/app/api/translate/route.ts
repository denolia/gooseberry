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
            content: `You are a translator. Translate German text to Russian.
             If the input is a sentence, provide only translation without any additional comments. If the input is a one word or a phrase, then provide all possible translations for it.  Write IPA  transcription. If it is a noun, then add a definitive article (der/die/das), show singular, plural and Genitiv case forms. If the input is a verb, then write Presens 3rd person, Präteritum and Perfect forms with haben or sein. If the verb has a fixed Verb-Noun or Verb-Preposition-Case, write it as well. Then show how to use the word in 5 sentences in German with translations in Russian. When possible make the sentences illustrate different ways of using the word. `,
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
