import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import {
  FsrsCardState,
  ReviewMode,
  ReviewRating,
} from "../src/lib/review/model.ts";

const code = ts.transpileModule(
  readFileSync(
    new URL("../src/lib/review/controls.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const controls = {};
new Function("require", "exports", code)((name) => {
  if (name === "@/lib/review/model") {
    return { FsrsCardState, ReviewMode, ReviewRating };
  }
  throw new Error(`Unexpected dependency ${name}`);
}, controls);
const { isLearningState, isNewState, reviewControls, reviewPrompt } = controls;

test("only new cards ask the user to continue without grading", () => {
  assert.equal(isNewState(FsrsCardState.New), true);
  assert.equal(reviewPrompt(FsrsCardState.New), "Try to remember this:");
  assert.deepEqual(reviewControls(FsrsCardState.New, ReviewMode.Full), [
    { label: "Ok", rating: ReviewRating.Good, shortcut: null },
  ]);
});

test("learning cards retain the learning prompt but use grading controls", () => {
  for (const state of [FsrsCardState.Learning, FsrsCardState.Relearning]) {
    assert.equal(isLearningState(state), true);
    assert.equal(isNewState(state), false);
    assert.equal(reviewPrompt(state), "Try to remember this:");
    assert.deepEqual(reviewControls(state, ReviewMode.Simple), [
      { label: "No", rating: ReviewRating.Again, shortcut: "1" },
      { label: "Yes", rating: ReviewRating.Good, shortcut: "2" },
    ]);
    assert.deepEqual(
      reviewControls(state, ReviewMode.Full).map(({ rating }) => rating),
      [
        ReviewRating.Hard,
        ReviewRating.Good,
        ReviewRating.Easy,
        ReviewRating.Again,
      ],
    );
  }
});

test("simple review maps No and Yes to Again and Good", () => {
  assert.equal(reviewPrompt(FsrsCardState.Review), "Do you remember this?");
  assert.deepEqual(reviewControls(FsrsCardState.Review, ReviewMode.Simple), [
    { label: "No", rating: ReviewRating.Again, shortcut: "1" },
    { label: "Yes", rating: ReviewRating.Good, shortcut: "2" },
  ]);
});

test("full review puts the three passing grades before Again", () => {
  assert.deepEqual(reviewControls(FsrsCardState.Review, ReviewMode.Full), [
    { label: "Hard", rating: ReviewRating.Hard, shortcut: "2" },
    { label: "Good", rating: ReviewRating.Good, shortcut: "3" },
    { label: "Easy", rating: ReviewRating.Easy, shortcut: "4" },
    { label: "Again", rating: ReviewRating.Again, shortcut: "1" },
  ]);
});
