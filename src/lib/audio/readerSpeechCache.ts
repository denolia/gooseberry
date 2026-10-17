import { createHash } from "node:crypto";
import { cacheSpeech, getCachedSpeech } from "@/db/speechCacheRepo";

type ReaderSpeechCacheInput = {
  text: string;
  language: string;
  voice: string;
  model: string;
  instructions?: string;
};

const CACHE_REVISION = "reader-base1x-v1";

export function readerSpeechCacheKey(input: ReaderSpeechCacheInput): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        revision: CACHE_REVISION,
        text: input.text.trim(),
        language: input.language.trim().toLowerCase(),
        voice: input.voice,
        model: input.model,
        instructions: input.instructions ?? null,
        speed: 1,
        format: "mp3",
      }),
    )
    .digest("hex");
  return `${CACHE_REVISION}-${digest}.mp3`;
}

export async function getOrGenerateReaderSpeech(
  input: ReaderSpeechCacheInput,
  generate: () => Promise<Uint8Array>,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  signal?.throwIfAborted();
  const key = readerSpeechCacheKey(input);
  let cached: Uint8Array | null = null;
  try {
    cached = await getCachedSpeech(key);
  } catch (error) {
    signal?.throwIfAborted();
    console.warn("Could not read the reader speech cache:", error);
  }
  signal?.throwIfAborted();
  if (cached?.length) return cached;

  const audio = await generate();
  signal?.throwIfAborted();
  if (!audio.length)
    throw new Error("Reader speech generation returned empty audio");
  try {
    await cacheSpeech(key, audio);
  } catch (error) {
    signal?.throwIfAborted();
    // Saving is best-effort: never synthesize a second time after a write error.
    console.warn("Could not save the reader speech cache:", error);
  }
  signal?.throwIfAborted();
  return audio;
}
