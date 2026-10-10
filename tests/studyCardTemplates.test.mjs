import assert from "node:assert/strict";
import test from "node:test";
import {
  STUDY_CARD_TEMPLATE_KEYS,
  getApplicableStudyCardTemplateKeys,
  getStudyCardTemplate,
} from "../src/lib/review/templates.ts";
import {
  GOOSEBERRY_TEMPLATE_KEYS_BY_ORD,
  buildAnkiPackage,
} from "./helpers/apkgExporter.mjs";

const note = {
  original: "kiinteistövälittäjä",
  translation: "риэлтор",
  wordForms: "kiinteistövälittäjät",
  sample: "Hän on kiinteistövälittäjä.",
  sampleTranslation: "Он риэлтор.",
  comments: "",
  tags: "noun",
  sourceId: "note-1",
  guid: "template-test-note",
};

test("each exercise recalls the intended field rather than a sibling's answer", () => {
  const expected = {
    recognition: ["original", "translation", false],
    production: ["translation", "original", false],
    word_forms: ["original", "wordForms", false],
    type_answer: ["translation", "original", true],
    example: ["sampleTranslation", "sample", false],
  };
  for (const key of STUDY_CARD_TEMPLATE_KEYS) {
    const template = getStudyCardTemplate(key);
    assert.deepEqual(
      [template.promptField, template.answerField, template.requiresTyping],
      expected[key],
    );
  }
});

test("missing optional details only pause their own exercises", () => {
  assert.deepEqual(getApplicableStudyCardTemplateKeys(note), [
    "recognition",
    "production",
    "word_forms",
    "type_answer",
    "example",
  ]);
  assert.deepEqual(
    getApplicableStudyCardTemplateKeys({
      ...note,
      wordForms: "\t\n ",
      sampleTranslation: "",
    }),
    ["recognition", "production", "type_answer"],
  );
  assert.deepEqual(
    getApplicableStudyCardTemplateKeys({
      ...note,
      original: "",
      sample: "",
      sampleTranslation: "",
    }),
    [],
  );
});

test("Gooseberry exercise availability matches exported Anki siblings", async () => {
  const cases = [
    note,
    { ...note, wordForms: "", sample: "", sampleTranslation: "" },
    { ...note, wordForms: "\t \n", sampleTranslation: "\u00a0" },
    { ...note, original: "" },
    { ...note, translation: "" },
    { ...note, sample: "", sampleTranslation: "An unpaired translation." },
  ];
  for (const content of cases) {
    const data = await buildAnkiPackage(
      "Template parity",
      [content],
      "FI",
      "RU",
    ).toCollection();
    const exported = data.cards.map(
      ({ ord }) => GOOSEBERRY_TEMPLATE_KEYS_BY_ORD[ord],
    );
    assert.deepEqual(
      exported.toSorted(),
      getApplicableStudyCardTemplateKeys(content).toSorted(),
    );
  }
});

test("export refuses unstudyable notes instead of generating a blank fallback card", () => {
  const missingContent = {
    ...note,
    original: "",
    wordForms: "",
    sample: "",
    sampleTranslation: "",
  };
  assert.deepEqual(getApplicableStudyCardTemplateKeys(missingContent), []);
  assert.throws(
    () => buildAnkiPackage("Incomplete notes", [missingContent], "FI", "RU"),
    /without a usable prompt and answer/,
  );
});
