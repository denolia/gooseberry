import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAnkiPackage,
  createApkgPackage,
  createGooseberryNotetype,
  GOOSEBERRY_FIELD_NAMES,
  GOOSEBERRY_NOTE_TYPE_ID,
  GOOSEBERRY_NOTE_TYPE_NAME,
} from "../src/lib/anki/apkgExporter.ts";

const completeNote = {
  original: "der Schwarm",
  translation: "рой, стая",
  wordForms: "die Schwärme * des Schwarms",
  sample: "Er ist schon seit Monaten ihr Schwarm.",
  sampleTranslation: "Он уже несколько месяцев её предмет обожания.",
  comments: "Common noun",
  tags: "noun common noun",
  sourceId: "item-1",
  guid: "gooseberry-set-item-1",
};

test("defines a stable structured note type with five sibling templates", () => {
  const notetype = createGooseberryNotetype();

  assert.equal(notetype.id, GOOSEBERRY_NOTE_TYPE_ID);
  assert.equal(notetype.name, GOOSEBERRY_NOTE_TYPE_NAME);
  assert.deepEqual(
    notetype.fields.map((field) => field.name),
    [...GOOSEBERRY_FIELD_NAMES],
  );
  assert.deepEqual(
    notetype.templates.map((template) => template.name),
    ["Recognition", "Production", "Word Forms", "Example", "Type Answer"],
  );
  assert.match(
    notetype.templates.at(-1).questionFormat,
    /\{\{type:Original\}\}/,
  );
});

test("packages one complete vocabulary item as one note with five cards", async () => {
  const data = await buildAnkiPackage(
    "Gooseberry::de-ru::Test",
    [completeNote],
    "DE",
    "RU",
  ).toCollection();

  assert.equal(data.notes.length, 1);
  assert.equal(data.cards.length, 5);
  assert.equal(data.notes[0].guid, completeNote.guid);
  assert.equal(data.notes[0].mid, GOOSEBERRY_NOTE_TYPE_ID);
  assert.match(data.notes[0].tags, / noun /);
  assert.deepEqual(
    data.cards.map((card) => card.ord),
    [0, 1, 2, 3, 4],
  );
});

test("does not generate optional word-form or example cards for empty fields", async () => {
  const data = await buildAnkiPackage(
    "Gooseberry::de-ru::Test",
    [
      {
        ...completeNote,
        wordForms: "",
        sample: "",
        sampleTranslation: "",
      },
    ],
    "DE",
    "RU",
  ).toCollection();

  assert.equal(data.notes.length, 1);
  assert.deepEqual(
    data.cards.map((card) => card.ord),
    [0, 1, 4],
  );
});

test("escapes field HTML and retains stable source identity and tags", async () => {
  const data = await buildAnkiPackage(
    "Gooseberry::de-ru::Test",
    [
      {
        ...completeNote,
        original: "<script>alert('x')</script>\nword",
        tags: "noun noun frequent",
      },
    ],
    "DE",
    "RU",
  ).toCollection();
  const fields = data.notes[0].flds.split("\u001f");

  assert.equal(fields[0], completeNote.sourceId);
  assert.equal(
    fields[1],
    "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;<br>word",
  );
  assert.equal(data.notes[0].tags, " noun frequent ");
});

test("serializes the structured deck as an APKG zip", async () => {
  const output = await createApkgPackage(
    "Gooseberry::de-ru::Test",
    [completeNote],
    "DE",
    "RU",
  );

  assert.ok(output.length > 1_000);
  assert.equal(output.subarray(0, 2).toString("ascii"), "PK");
});
