import assert from "node:assert/strict";
import test from "node:test";
import {
  applyReview,
  createInitialFsrsState,
  FSRS_SCHEDULER_VERSION,
  previewRatings,
  replayReviewHistory,
} from "../src/lib/review/fsrs.ts";
import { FsrsCardState, ReviewRating } from "../src/lib/review/model.ts";

const introducedAt = new Date("2026-01-01T12:00:00.000Z");

test("new cards are due immediately with a versioned empty FSRS state", () => {
  const state = createInitialFsrsState(introducedAt);

  assert.equal(state.dueAt.toISOString(), introducedAt.toISOString());
  assert.equal(state.state, FsrsCardState.New);
  assert.equal(state.reps, 0);
  assert.equal(state.schedulerVersion, FSRS_SCHEDULER_VERSION);
});

test("rating previews expose all four choices without mutating the card", () => {
  const state = createInitialFsrsState(introducedAt);
  const previews = previewRatings(state, introducedAt);

  assert.deepEqual(
    previews.map(({ rating }) => rating),
    [
      ReviewRating.Again,
      ReviewRating.Hard,
      ReviewRating.Good,
      ReviewRating.Easy,
    ],
  );
  assert.deepEqual(
    previews.map(({ intervalMs }) => intervalMs),
    [60_000, 360_000, 600_000, 8 * 24 * 60 * 60_000],
  );
  assert.equal(state.reps, 0);
});

test("history replay is deterministic and uses timestamp then sequence order", () => {
  const firstReviewAt = new Date("2026-01-01T12:00:00.000Z");
  const secondReviewAt = new Date("2026-01-01T12:10:00.000Z");
  const events = [
    {
      rating: ReviewRating.Good,
      reviewedAt: secondReviewAt,
      sequence: 2,
    },
    {
      rating: ReviewRating.Good,
      reviewedAt: firstReviewAt,
      sequence: 1,
    },
  ];

  const replayed = replayReviewHistory(introducedAt, events);
  const stepped = applyReview(
    applyReview(
      createInitialFsrsState(introducedAt),
      ReviewRating.Good,
      firstReviewAt,
    ),
    ReviewRating.Good,
    secondReviewAt,
  );

  assert.deepEqual(replayed, stepped);
  assert.equal(replayed.reps, 2);
  assert.equal(replayed.state, FsrsCardState.Review);
});
