import {NextResponse} from 'next/server';

export async function POST(request: Request) {
  try {
    const { text } = await request.json();

    const apiKey = process.env.OPENAI_API_KEY;
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        store: true,
        messages: [
          {
            role: 'system',
            content: `You are a translator. Translate the following German text to Russian. If it is a one word or a phrase, then provide all possible translations for it, provide IPA transcription of a source word, and show how to use it in a sentence in German with translations in Russian. If the input is a sentence, provide only the translation without any additional comments.`
          },
          {
            role: 'user',
            content: text
          }
        ],
      }),
    });

    if (!response.ok) {
        const error = await response.json();
        console.error('OpenAI API error:', error);
        throw new Error('Translation request failed');
      }
      
    const data = await response.json();

    const translation = data.choices[0].message.content;

    return NextResponse.json({ translation });
  } catch (error) {
    console.error('Translation error:', error);
    return NextResponse.json(
      { error: 'Translation failed' },
      { status: 500 }
    );
  }
} 