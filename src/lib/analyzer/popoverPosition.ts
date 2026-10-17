export type PopoverAnchorRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type PopoverViewport = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type AnalyzerPopoverPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  placement: "above" | "below";
  anchorIndex: number;
};

const VIEWPORT_INSET = 12;
const ANCHOR_GAP = 8;
const MIN_READABLE_HEIGHT = 220;

export function getAnalyzerPopoverPosition(
  anchorRects: readonly PopoverAnchorRect[],
  viewport: PopoverViewport,
  popover: { width: number; height: number },
): AnalyzerPopoverPosition | null {
  if (
    !Object.values(viewport).every(Number.isFinite) ||
    !Number.isFinite(popover.width) ||
    !Number.isFinite(popover.height) ||
    viewport.width <= VIEWPORT_INSET * 2 ||
    viewport.height <= VIEWPORT_INSET * 2 ||
    popover.width <= 0 ||
    popover.height <= 0
  ) {
    return null;
  }

  const viewportRight = viewport.left + viewport.width;
  const viewportBottom = viewport.top + viewport.height;
  // Client rects arrive in text order, including each line of a wrapped word.
  const anchorIndex = anchorRects.findIndex(
    (rect) =>
      Object.values(rect).every(Number.isFinite) &&
      rect.right > rect.left &&
      rect.bottom > rect.top &&
      rect.right > viewport.left &&
      rect.left < viewportRight &&
      rect.bottom > viewport.top &&
      rect.top < viewportBottom,
  );
  if (anchorIndex < 0) return null;

  const anchor = anchorRects[anchorIndex];
  const innerLeft = viewport.left + VIEWPORT_INSET;
  const innerTop = viewport.top + VIEWPORT_INSET;
  const innerRight = viewportRight - VIEWPORT_INSET;
  const innerBottom = viewportBottom - VIEWPORT_INSET;
  const width = Math.min(popover.width, innerRight - innerLeft);
  const aboveBottom = Math.min(anchor.top - ANCHOR_GAP, innerBottom);
  const belowTop = Math.max(anchor.bottom + ANCHOR_GAP, innerTop);
  const above = Math.max(0, aboveBottom - innerTop);
  const below = Math.max(0, innerBottom - belowTop);
  const placement =
    above >= Math.min(popover.height, MIN_READABLE_HEIGHT) ||
    (below < popover.height && above >= below)
      ? "above"
      : "below";
  const maxHeight = placement === "above" ? above : below;
  if (maxHeight <= 0) return null;

  const height = Math.min(popover.height, maxHeight);
  const anchorCenter = (anchor.left + anchor.right) / 2;
  const left = Math.min(
    Math.max(anchorCenter - width / 2, innerLeft),
    innerRight - width,
  );
  const top = placement === "above" ? aboveBottom - height : belowTop;

  return { left, top, width, maxHeight, placement, anchorIndex };
}
