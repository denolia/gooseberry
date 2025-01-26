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
             If the input is a sentence, provide only translation without any additional comments. If the input is a one word or a phrase, then provide all possible translations for it, show where to put stress in a word, show how to use the word in 5 sentences in German with translations in Russian. When possible make the sentences illustrate different ways of using a word. If it is a noun, then add a definite article (der/die/das), show singular, plural forms and Genitiv case form. If the input is a verb, then write 3rd person form, Präteritum and Perfect forms with haben or sein. If the verb has a stable connection with prepositions and cases, writ it as well.`,
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
