import assert from "node:assert/strict";
import test from "node:test";
import {
  typedAnswerDiff,
  typedAnswerMatches,
} from "../src/components/review/exercises.ts";

const unchanged = (value) => ({ value, changed: false });
const changed = (value) => ({ value, changed: true });

test("Finnish typos highlight only the incorrect and replacement fragments", () => {
  assert.deepEqual(typedAnswerDiff("opettaiä", "opettaja", "fi"), {
    matches: false,
    entered: [unchanged("opetta"), changed("iä")],
    expected: [unchanged("opetta"), changed("ja")],
  });
});

test("extra and missing letters keep the unchanged word around them", () => {
  assert.deepEqual(typedAnswerDiff("taloa", "talo", "fi"), {
    matches: false,
    entered: [unchanged("talo"), changed("a")],
    expected: [unchanged("talo")],
  });
  assert.deepEqual(typedAnswerDiff("tlo", "talo", "fi"), {
    matches: false,
    entered: [unchanged("tlo")],
    expected: [unchanged("t"), changed("a"), unchanged("lo")],
  });
});

test("matching answers retain their spelling while normalizing whitespace and NFC", () => {
  assert.deepEqual(
    typedAnswerDiff("  CAFÉ\t  AU\nLAIT  ", "cafe\u0301 au lait", "fr"),
    {
      matches: true,
      entered: [unchanged("CAFÉ AU LAIT")],
      expected: [unchanged("café au lait")],
    },
  );
});

test("partial matches retain the learner's case instead of copying the target", () => {
  assert.deepEqual(typedAnswerDiff("TALO!", "talo?", "fi"), {
    matches: false,
    entered: [unchanged("TALO"), changed("!")],
    expected: [unchanged("talo"), changed("?")],
  });
});

test("diacritics, punctuation, and missing word spaces remain meaningful", () => {
  assert.deepEqual(typedAnswerDiff("saa", "sää", "fi"), {
    matches: false,
    entered: [unchanged("s"), changed("aa")],
    expected: [unchanged("s"), changed("ää")],
  });
  assert.deepEqual(typedAnswerDiff("Hei", "Hei!", "fi").expected, [
    unchanged("Hei"),
    changed("!"),
  ]);
  const missingSpace = typedAnswerDiff("hyväähuomenta", "hyvää huomenta", "fi");
  assert.equal(missingSpace.matches, false);
  assert.deepEqual(missingSpace.expected, [
    unchanged("hyvää"),
    changed(" "),
    unchanged("huomenta"),
  ]);
});

test("joined emoji and combining graphemes are never split into partial changes", () => {
  assert.deepEqual(typedAnswerDiff("Hei 👩🏽‍💻!", "Hei 👨🏽‍💻!", "fi"), {
    matches: false,
    entered: [unchanged("Hei "), changed("👩🏽‍💻"), unchanged("!")],
    expected: [unchanged("Hei "), changed("👨🏽‍💻"), unchanged("!")],
  });
  assert.deepEqual(typedAnswerDiff("a\u0308\u0301", "a\u0301\u0308", "fi"), {
    matches: false,
    entered: [changed("ä\u0301")],
    expected: [changed("á\u0308")],
  });
});

test("an empty answer shows the entire target as missing and never matches", () => {
  assert.deepEqual(typedAnswerDiff(" \n ", "opettaja", "fi"), {
    matches: false,
    entered: [],
    expected: [changed("opettaja")],
  });
  assert.deepEqual(typedAnswerDiff("", "", "fi"), {
    matches: false,
    entered: [],
    expected: [],
  });
});

test("locale casing agrees with matching, including contextual Greek sigma", () => {
  for (const [entered, expected, language] of [
    ["IŞIK", "ışık", "tr"],
    ["ΟΣ", "ος", "el"],
    ["TALO", "talo", "not_a_locale"],
  ]) {
    assert.equal(typedAnswerMatches(entered, expected, language), true);
    assert.deepEqual(typedAnswerDiff(entered, expected, language), {
      matches: true,
      entered: [unchanged(entered)],
      expected: [unchanged(expected)],
    });
  }
  assert.deepEqual(typedAnswerDiff("ΟΣ!", "ος?", "el"), {
    matches: false,
    entered: [unchanged("ΟΣ"), changed("!")],
    expected: [unchanged("ος"), changed("?")],
  });
});

test("very long or very different answers use a bounded whole-fragment comparison", () => {
  for (const [entered, expected] of [
    ["a".repeat(5000), "a".repeat(4999) + "b"],
    ["a".repeat(300), "b".repeat(300)],
  ])
    assert.deepEqual(typedAnswerDiff(entered, expected, "fi"), {
      matches: false,
      entered: [changed(entered)],
      expected: [changed(expected)],
    });
  assert.deepEqual(typedAnswerDiff("A".repeat(5000), "a".repeat(5000), "fi"), {
    matches: true,
    entered: [unchanged("A".repeat(5000))],
    expected: [unchanged("a".repeat(5000))],
  });
});
