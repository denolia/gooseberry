export const READER_TEXT_LIMIT = 20_000;
export const READER_TITLE_LIMIT = 200;

export type ReaderTextSummary = {
  id: string;
  title: string;
  preview: string;
  sourceLang: string;
  targetLang: string;
  createdAt: string;
  updatedAt: string;
};

export type ReaderDocument = Omit<ReaderTextSummary, "preview"> & {
  text: string;
};

export type ReaderHistoryPage = {
  texts: ReaderTextSummary[];
  nextCursor: string | null;
};

export function defaultReaderTitle(text: string, language: string): string {
  const normalized = text.replace(/\s+/gu, " ").trim();
  const words = Array.from(
    new Intl.Segmenter(language, { granularity: "word" }).segment(normalized),
  ).filter((segment) => segment.isWordLike);
  const last = words[4];
  const title = last
    ? normalized.slice(0, last.index + last.segment.length)
    : normalized;
  const characters = Array.from(title);
  const truncated = characters.length > 80 || words.length > 5;
  return truncated ? `${characters.slice(0, 79).join("").trimEnd()}…` : title;
}
