import { FsrsCardState } from "@/lib/review/model";

type QueueCard = {
  id: string;
  state: { state: number; dueAt?: string };
};

export function shouldRefillReviewQueue(
  cards: QueueCard[],
  answeredScheduledCard = false,
): boolean {
  if (cards.length <= 5) return true;
  const scheduledCount = cards.filter(
    (card) => card.state.state !== FsrsCardState.New,
  ).length;
  return scheduledCount <= 5 && (scheduledCount > 0 || answeredScheduledCard);
}

// Keep the displayed prompt stable, then put scheduled repetitions ahead of
// new exercises. Stable sorting preserves server round order for new material.
export function mergeReviewQueue<T extends QueueCard>(
  current: T[],
  incoming: T[],
): T[] {
  const existingIds = new Set(current.map(({ id }) => id));
  const cards = [
    ...current,
    ...incoming.filter(({ id }) => !existingIds.has(id)),
  ];
  const displayed = current[0];
  const waiting = displayed ? cards.slice(1) : cards;
  waiting.sort((left, right) => {
    const leftNew = left.state.state === FsrsCardState.New;
    const rightNew = right.state.state === FsrsCardState.New;
    if (leftNew !== rightNew) return leftNew ? 1 : -1;
    if (leftNew) return 0;
    return (
      new Date(left.state.dueAt ?? 0).getTime() -
      new Date(right.state.dueAt ?? 0).getTime()
    );
  });
  return displayed ? [displayed, ...waiting] : waiting;
}
