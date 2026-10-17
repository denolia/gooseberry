export type ReadingLineRect = { top: number; bottom: number };

export function getReadingFollowTarget({
  rects,
  viewport,
  lineHeight,
  scrollY,
  maxScroll,
  newSentence = false,
}: {
  rects: readonly ReadingLineRect[];
  viewport: { top: number; height: number };
  lineHeight: number;
  scrollY: number;
  maxScroll: number;
  newSentence?: boolean;
}): number | null {
  if (
    ![viewport.top, viewport.height, lineHeight, scrollY, maxScroll].every(
      Number.isFinite,
    ) ||
    viewport.height <= 0 ||
    lineHeight <= 0
  )
    return null;
  const lines = rects.filter(
    (rect) =>
      Number.isFinite(rect.top) &&
      Number.isFinite(rect.bottom) &&
      rect.bottom > rect.top,
  );
  if (!lines.length) return null;
  const dockSpace = Math.min(80, viewport.height / 2);
  const margin = Math.min(
    lineHeight * 2,
    Math.max(0, (viewport.height - dockSpace - lineHeight) / 3),
  );
  const top = viewport.top + margin;
  const bottom = viewport.top + viewport.height - margin - dockSpace;
  const sentenceTop = Math.min(...lines.map((line) => line.top));
  const sentenceBottom = Math.max(...lines.map((line) => line.bottom));
  let delta = 0;
  if (sentenceBottom - sentenceTop > bottom - top) {
    // A long sentence can span several screens. Keep its currently visible
    // lines after manual reading rather than alternating between both ends.
    if (
      !newSentence &&
      lines.some((line) => line.bottom > top && line.top < bottom)
    )
      return null;
    const first = lines[0];
    if (first.top < top - 2 || first.bottom > bottom + 2)
      delta = first.top - top;
  } else if (sentenceTop < top - 2) {
    delta = sentenceTop - top;
  } else if (sentenceBottom > bottom + 2) {
    delta = sentenceBottom - bottom;
  }
  const target = Math.max(0, Math.min(Math.max(0, maxScroll), scrollY + delta));
  return Math.abs(target - scrollY) >= 2 ? target : null;
}
