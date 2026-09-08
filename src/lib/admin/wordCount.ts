export function countInputWords(text: string): number {
  return Array.from(
    new Intl.Segmenter(undefined, { granularity: "word" }).segment(text),
  ).filter((segment) => segment.isWordLike).length;
}
