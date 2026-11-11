import { messageErrors } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "@typescript/typescript6";
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
  if (name === "@/i18n/errors") return messageErrors;
  if (name === "@/lib/review/model") {
    return { FsrsCardState, ReviewMode, ReviewRating };
  }
  throw new Error(`Unexpected dependency ${name}`);
}, controls);
const { isNewState, reviewControls } = controls;

test("only new cards ask the user to continue without grading", () => {
  assert.equal(isNewState(FsrsCardState.New), true);
  for (const mode of [ReviewMode.Simple, ReviewMode.Full]) {
    assert.deepEqual(reviewControls(FsrsCardState.New, mode), [
      { labelKey: "common.ok", rating: ReviewRating.Good, shortcut: " " },
    ]);
  }
});

test("learning cards use grading controls", () => {
  for (const state of [FsrsCardState.Learning, FsrsCardState.Relearning]) {
    assert.equal(isNewState(state), false);
    assert.deepEqual(reviewControls(state, ReviewMode.Simple), [
      { labelKey: "common.no", rating: ReviewRating.Again, shortcut: "1" },
      { labelKey: "common.yes", rating: ReviewRating.Good, shortcut: "2" },
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
  assert.deepEqual(reviewControls(FsrsCardState.Review, ReviewMode.Simple), [
    { labelKey: "common.no", rating: ReviewRating.Again, shortcut: "1" },
    { labelKey: "common.yes", rating: ReviewRating.Good, shortcut: "2" },
  ]);
});

test("full review puts the three passing grades before Again", () => {
  assert.deepEqual(reviewControls(FsrsCardState.Review, ReviewMode.Full), [
    { labelKey: "common.hard", rating: ReviewRating.Hard, shortcut: "2" },
    { labelKey: "common.good", rating: ReviewRating.Good, shortcut: "3" },
    { labelKey: "common.easy", rating: ReviewRating.Easy, shortcut: "4" },
    { labelKey: "common.again", rating: ReviewRating.Again, shortcut: "1" },
  ]);
});
