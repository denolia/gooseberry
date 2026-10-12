import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "@typescript/typescript6";
const exports = {};
const code = ts.transpileModule(
  readFileSync(new URL("../src/lib/review/queue.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText;
new Function("require", "exports", code)(
  () => ({ FsrsCardState: { New: 0 } }),
  exports,
);
const { mergeReviewQueue, shouldRefillReviewQueue } = exports;
const fresh = (id) => ({ id, state: { state: 0 } });
const due = (id, dueAt = "2026-10-11T12:00:00Z") => ({
  id,
  state: { state: 2, dueAt },
});

test("newly due reviews move ahead of queued new material after the displayed card", () => {
  const current = [fresh("active"), fresh("word-2"), fresh("word-3")];
  const result = mergeReviewQueue(current, [
    due("later"),
    due("earlier", "2026-10-11T11:00:00Z"),
    fresh("word-4"),
  ]);
  assert.deepEqual(
    result.map(({ id }) => id),
    ["active", "earlier", "later", "word-2", "word-3", "word-4"],
  );
  assert.deepEqual(
    current.map(({ id }) => id),
    ["active", "word-2", "word-3"],
  );
});
test("merging preserves new exercise rounds and deduplicates prefetched cards", () => {
  assert.deepEqual(
    mergeReviewQueue(
      [fresh("one"), fresh("two")],
      [fresh("two"), fresh("three")],
    ).map(({ id }) => id),
    ["one", "two", "three"],
  );
  assert.deepEqual(
    mergeReviewQueue([], [due("review"), fresh("one")]).map(({ id }) => id),
    ["review", "one"],
  );
});

test("buffered new material cannot delay fetching the remaining due-review backlog", () => {
  const newCards = Array.from({ length: 20 }, (_, i) => fresh(`new-${i}`));
  const remainingReviews = Array.from({ length: 5 }, (_, i) => due(`due-${i}`));
  assert.equal(
    shouldRefillReviewQueue([...remainingReviews, ...newCards]),
    true,
  );
  assert.equal(shouldRefillReviewQueue(newCards, true), true);
  assert.equal(shouldRefillReviewQueue(newCards), false);
});
