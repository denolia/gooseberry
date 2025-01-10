import { log } from 'console';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { text } = await request.json();

    const apiKey = process.env.OPENAI_API_KEY;
    console.log("apiKey", apiKey);
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
            content: 'You are a translator. Translate the following German text to Russian. Provide only the translation without any additional comments.'
          },
          {
            role: 'user',
            content: text
          }
        ],
      }),
    });
    console.log("response", response);

    if (!response.ok) {
        const error = await response.json();
        console.error('OpenAI API error:', error);
        throw new Error('Translation request failed');
      }
      
    const data = await response.json();
    console.log(data);

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