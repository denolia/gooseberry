import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CardFieldsSchema,
  draftFromFields,
  fieldsFromDraft,
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
