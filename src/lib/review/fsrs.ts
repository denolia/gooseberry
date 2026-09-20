import { createEmptyCard, fsrs, type Card, type Grade } from "ts-fsrs";
import type { FsrsCardStateValue, ReviewRatingValue } from "@/lib/review/model";

export const FSRS_SCHEDULER_VERSION = "ts-fsrs@5.4.2:gooseberry-v1";

const scheduler = fsrs({
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: false,
  enable_short_term: true,
  learning_steps: ["1m", "10m"],
  relearning_steps: ["10m"],
});

export type FsrsStateProjection = {
  dueAt: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: FsrsCardStateValue;
  lastReviewAt: Date | null;
  schedulerVersion: string;
};

export type ReviewHistoryEvent = {
  rating: ReviewRatingValue;
  reviewedAt: Date;
  sequence: number;
};

export type RatingPreview = {
  rating: ReviewRatingValue;
  dueAt: Date;
  intervalMs: number;
  state: FsrsCardStateValue;
};

const REVIEW_RATINGS: ReviewRatingValue[] = [1, 2, 3, 4];

export function createInitialFsrsState(
  introducedAt: Date,
): FsrsStateProjection {
  return fromFsrsCard(createEmptyCard(introducedAt));
}

export function applyReview(
  state: FsrsStateProjection,
  rating: ReviewRatingValue,
  reviewedAt: Date,
): FsrsStateProjection {
  const result = scheduler.next(toFsrsCard(state), reviewedAt, rating as Grade);
  return fromFsrsCard(result.card);
}

export function previewRatings(
  state: FsrsStateProjection,
  reviewedAt: Date,
): RatingPreview[] {
  const previews = scheduler.repeat(toFsrsCard(state), reviewedAt);

  return REVIEW_RATINGS.map((rating) => {
    const next = previews[rating as Grade].card;
    return {
      rating,
      dueAt: next.due,
      intervalMs: Math.max(0, next.due.getTime() - reviewedAt.getTime()),
      state: next.state as FsrsCardStateValue,
    };
  });
}

export function replayReviewHistory(
  introducedAt: Date,
  history: ReviewHistoryEvent[],
): FsrsStateProjection {
  return [...history]
    .sort(
      (left, right) =>
        left.reviewedAt.getTime() - right.reviewedAt.getTime() ||
        left.sequence - right.sequence,
    )
    .reduce(
      (state, event) => applyReview(state, event.rating, event.reviewedAt),
      createInitialFsrsState(introducedAt),
    );
}

function toFsrsCard(state: FsrsStateProjection): Card {
  return {
    due: state.dueAt,
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: state.elapsedDays,
    scheduled_days: state.scheduledDays,
    learning_steps: state.learningSteps,
    reps: state.reps,
    lapses: state.lapses,
    state: state.state,
    last_review: state.lastReviewAt ?? undefined,
  };
}

function fromFsrsCard(card: Card): FsrsStateProjection {
  return {
    dueAt: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as FsrsCardStateValue,
    lastReviewAt: card.last_review ?? null,
    schedulerVersion: FSRS_SCHEDULER_VERSION,
  };
}
