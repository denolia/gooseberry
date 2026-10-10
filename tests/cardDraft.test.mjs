import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CardFieldsSchema,
  draftFromFields,
  fieldsFromDraft,
  studyFieldsFromDraft,
} from "../src/app/utils/cardDraft.ts";
const fields = {
  original: "entdecken",
  translation: "discover",
  wordForms: "",
  sample: "First example; Second example",
  sampleTranslation: "First translation; Second translation",
  comments: "",
  tags: "verb",
};

test("removing an example removes the matching translation from exported fields", () => {
  const draft = draftFromFields(fields);
  draft.examples.splice(0, 1);
  const result = fieldsFromDraft(draft);
  assert.equal(result.sample, "Second example");
  assert.equal(result.sampleTranslation, "Second translation");
});

test("structured imported examples preserve semicolons and unmatched pairs", () => {
  const pairs = [{ sample: "A sentence; with punctuation.", translation: "Один пример; с пунктуацией." },
    { sample: "Unpaired source", translation: "" }];
  const draft = draftFromFields({ ...fields, examplePairs: pairs });
  assert.deepEqual(draft.examples, pairs);
  const saved = studyFieldsFromDraft(draft);
  assert.equal(saved.sample, pairs[0].sample);
  assert.equal(saved.sampleTranslation, pairs[0].translation);
  assert.deepEqual(saved.examplePairs, pairs);
  assert.equal(draft.examples.length, 2);
});
test("preserves unmatched legacy example translations when opening the editor", () => {
  const result = draftFromFields({ ...fields, sample: "First example" });
  assert.equal(result.examples.length, 2);
  assert.equal(result.examples[1].sample, "");
  assert.equal(result.examples[1].translation, "Second translation");
});
test("allows cards without examples and rejects blank required fields", () => {
  const draft = draftFromFields(fields);
  draft.examples = [];
  assert.equal(CardFieldsSchema.parse(fieldsFromDraft(draft)).sample, "");
  assert.equal(
    CardFieldsSchema.safeParse({ ...fields, translation: "  " }).success,
    false,
  );
});
