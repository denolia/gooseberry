import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { FsrsCardState } from "../src/lib/review/model.ts";

const code = ts.transpileModule(
  readFileSync(new URL("../src/lib/review/stats.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const stats = {};
new Function("require", "exports", code)((name) => {
  if (name === "@/lib/review/model") return { FsrsCardState };
  throw new Error(`Unexpected dependency ${name}`);
}, stats);

test("review state labels use learner-facing language", () => {
  assert.equal(stats.reviewStateLabel(FsrsCardState.New), "New");
  assert.equal(stats.reviewStateLabel(FsrsCardState.Learning), "Learning");
  assert.equal(stats.reviewStateLabel(FsrsCardState.Review), "Repeat");
  assert.equal(stats.reviewStateLabel(FsrsCardState.Relearning), "Relearning");
});

test("new and elapsed cards are ready for review", () => {
  const now = new Date("2026-09-20T12:00:00.000Z");
  assert.equal(stats.isReadyForReview(FsrsCardState.New, null, now), true);
  assert.equal(
    stats.isReadyForReview(
      FsrsCardState.Review,
      "2026-09-20T11:59:00.000Z",
      now,
    ),
    true,
  );
  assert.equal(
    stats.isReadyForReview(
      FsrsCardState.Review,
      "2026-09-21T12:00:00.000Z",
      now,
    ),
    false,
  );
});

test("readiness counts map to the four plant stages", () => {
  assert.equal(stats.plantReadinessStage(0), "seed");
  assert.equal(stats.plantReadinessStage(1), "sprout");
  assert.equal(stats.plantReadinessStage(5), "sprout");
  assert.equal(stats.plantReadinessStage(6), "growing");
  assert.equal(stats.plantReadinessStage(14), "growing");
  assert.equal(stats.plantReadinessStage(15), "ripe");
});

test("review counts call untouched cards fresh", () => {
  assert.equal(stats.reviewCountLabel(0), "Fresh");
  assert.equal(stats.reviewCountLabel(1), "1 review");
  assert.equal(stats.reviewCountLabel(4), "4 reviews");
});
