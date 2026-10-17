import {
  MAX_READER_CHARACTERS,
  READER_CHUNK_CHARACTERS,
  type ReaderSpeed,
} from "./readerConfig";

// Keep the original text and punctuation; split only at safe text boundaries.
function splitLongSentence(sentence: string): string[] {
  const chunks: string[] = [];
  let rest = sentence;
  while (rest.length > READER_CHUNK_CHARACTERS) {
    let boundary = READER_CHUNK_CHARACTERS;
    const prefix = rest.slice(0, boundary);
    const whitespace = Array.from(prefix.matchAll(/\s+/gu)).at(-1);
    if (whitespace && whitespace.index > 0) {
      boundary = whitespace.index + whitespace[0].length;
    } else {
      // UTF-16 length limits must not cut an emoji or another surrogate pair.
      const previous = rest.charCodeAt(boundary - 1);
      const next = rest.charCodeAt(boundary);
      if (
        previous >= 0xd800 &&
        previous <= 0xdbff &&
        next >= 0xdc00 &&
        next <= 0xdfff
      ) {
        boundary--;
      }
    }
    chunks.push(rest.slice(0, boundary));
    rest = rest.slice(boundary);
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export function splitReaderText(
  text: string,
  language: string,
  speed: ReaderSpeed,
): string[] {
  const value = text.trim();
  if (value.length > MAX_READER_CHARACTERS) {
    throw new Error(
      `Text must be ${MAX_READER_CHARACTERS.toLocaleString("en-US")} characters or fewer`,
    );
  }
  if (!value) return [];

  let segmenter: Intl.Segmenter;
  try {
    segmenter = new Intl.Segmenter(language, { granularity: "sentence" });
  } catch {
    segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
  }
  const sentences: string[] = [];
  for (const { segment } of segmenter.segment(value)) {
    if (!segment.trim() && sentences.length) {
      sentences[sentences.length - 1] += segment;
    } else {
      sentences.push(segment);
    }
  }
  const chunks: string[] = [];
  for (const sentence of sentences) {
    for (const piece of splitLongSentence(sentence)) {
      const lastIndex = chunks.length - 1;
      if (
        speed !== "normal-pauses" &&
        lastIndex >= 0 &&
        chunks[lastIndex].length + piece.length <= READER_CHUNK_CHARACTERS
      ) {
        chunks[lastIndex] += piece;
      } else {
        chunks.push(piece);
      }
    }
  }
  // Large runs of whitespace need no audio request.
  return chunks.filter((chunk) => chunk.trim());
}
