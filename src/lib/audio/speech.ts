import OpenAI from "openai";

export const MAX_SPEECH_CHARACTERS = 500;

const speechModel = process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";
const speechVoice = process.env.OPENAI_TTS_VOICE ?? "marin";

export async function generateSpeechMp3(
  text: string,
  language: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const trimmedText = text.trim();
  if (!trimmedText || trimmedText.length > MAX_SPEECH_CHARACTERS) {
    throw new Error("Speech text is empty or too long");
  }

  const client = new OpenAI({ maxRetries: 2 });
  const speech = await client.audio.speech.create(
    {
      model: speechModel,
      voice: speechVoice,
      input: trimmedText,
      instructions: `Speak naturally and clearly in ${language}. Pronounce only the provided text.`,
      response_format: "mp3",
    },
    { signal },
  );

  return new Uint8Array(await speech.arrayBuffer());
}
