import assert from "node:assert/strict";
import test from "node:test";
import { formatReviewInterval } from "../src/lib/review/formatInterval.ts";

test("formats short and long FSRS intervals compactly", () => {
  assert.equal(formatReviewInterval(60_000), "1m");
  assert.equal(formatReviewInterval(10 * 60_000), "10m");
  assert.equal(formatReviewInterval(2 * 60 * 60_000), "2h");
  assert.equal(formatReviewInterval(8 * 24 * 60 * 60_000), "8d");
  assert.equal(formatReviewInterval(60 * 24 * 60 * 60_000), "2mo");
  assert.equal(formatReviewInterval(800 * 24 * 60 * 60_000), "2y");
});
