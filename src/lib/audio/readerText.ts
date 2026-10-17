import {
  MAX_READER_CHARACTERS,
  READER_CHUNK_CHARACTERS,
  type ReaderSpeed,
} from "./readerConfig";

export type ReaderTextRange = { start: number; end: number };

export type ReaderSpeechChunk = ReaderTextRange & {
  text: string;
  sentenceStart: number;
  sentenceEnd: number;
  sentenceIndex: number;
};

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

export function getReaderSpeechChunks(
  text: string,
  language: string,
): ReaderSpeechChunk[] {
  const value = text.trim();
  if (value.length > MAX_READER_CHARACTERS) {
    throw new Error(
      `Text must be ${MAX_READER_CHARACTERS.toLocaleString("en-US")} characters or fewer`,
    );
  }
  if (!value) return [];
  const leadingOffset = text.length - text.trimStart().length;

  let segmenter: Intl.Segmenter;
  try {
    segmenter = new Intl.Segmenter(language, { granularity: "sentence" });
  } catch {
    segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
  }
  const sentences: ReaderTextRange[] = [];
  for (const { segment, index } of segmenter.segment(value)) {
    const start = leadingOffset + index;
    const end = start + segment.length;
    if (!segment.trim() && sentences.length) {
      sentences[sentences.length - 1].end = end;
    } else if (segment.trim()) {
      sentences.push({ start, end });
    }
  }
  const chunks: ReaderSpeechChunk[] = [];
  for (const [sentenceIndex, range] of sentences.entries()) {
    const sentence = text.slice(range.start, range.end);
    const sentenceStart =
      range.start + sentence.length - sentence.trimStart().length;
    const sentenceEnd = range.start + sentence.trimEnd().length;
    let cursor = range.start;
    for (const piece of splitLongSentence(sentence)) {
      const start = cursor;
      cursor += piece.length;
      // Keep offsets advancing through large whitespace runs without spending
      // an audio request on a chunk that has nothing to pronounce.
      if (piece.trim()) {
        chunks.push({
          text: piece,
          start,
          end: cursor,
          sentenceStart,
          sentenceEnd,
          sentenceIndex,
        });
      }
    }
  }
  return chunks;
}

export function splitReaderText(
  text: string,
  language: string,
  _speed?: ReaderSpeed,
): string[] {
  return getReaderSpeechChunks(text, language).map((chunk) => chunk.text);
}
