import assert from "node:assert/strict";
import test from "node:test";
import {
  createImportBatches,
  importJsonByteLength,
  importRequest,
  MAX_IMPORT_REQUEST_BYTES,
} from "../src/lib/anki/import/clientTransport.ts";
import {
  deckWithDescendants,
  importDisplayName,
  MAX_IMPORT_EXAMPLE_PAIRS,
  selectImportContent,
  suggestedImportLanguages,
  suggestNoteTypeMappings,
} from "../src/lib/anki/import/clientHelpers.ts";
import { mapAnkiNote } from "../src/lib/anki/import/mapping.ts";

function modelWithFields(names) {
  return {
    id: "11",
    name: "Vocabulary",
    type: 0,
    css: "",
    raw: {},
    fields: names.map((name, ord) => ({ name, ord, raw: {} })),
    templates: [],
  };
}

test("Suomen Mestari aliases map words and both example pairs without sound fields", () => {
  const model = modelWithFields([
    "Nominatiivi",
    "Sound",
    "Back",
    "Hint",
    "example_1_fin",
    "sound_example_1",
    "example_1_rus",
    "example_2_fin",
    "sound_example_2",
    "example_2_rus",
  ]);
  const [mapping] = suggestNoteTypeMappings([model]);
  assert.deepEqual(mapping.original.fields, [0]);
  assert.deepEqual(mapping.translation.fields, [2]);
  assert.deepEqual(
    mapping.examples.map((pair) => [
      pair.sample.fields,
      pair.translation.fields,
    ]),
    [
      [[4], [6]],
      [[7], [9]],
    ],
  );
  const mapped = mapAnkiNote(
    {
      id: "1",
      guid: "word-1",
      modelId: "11",
      tags: ["lesson1"],
      raw: {},
      fields: [
        "<b>monikko</b>",
        "[sound:a.mp3]",
        "множественное число",
        "m...",
        "",
        "[sound:b.mp3]",
        "",
        "Sana on monikossa.",
        "[sound:c.mp3]",
        "Слово во множественном числе.",
      ],
    },
    mapping,
    model,
  );
  assert.equal(mapped.original, "monikko");
  assert.equal(mapped.translation, "множественное число");
  assert.equal(mapped.examplePairs.length, 2);
  assert.equal(mapped.sample, "Sana on monikossa.");
  assert.equal(mapped.sampleTranslation, "Слово во множественном числе.");
});

test("Gooseberry aliases preserve field direction and recognize language fields", () => {
  const model = modelWithFields([
    "Gooseberry ID",
    "Original",
    "Translation",
    "Word Forms",
    "Sample",
    "Sample Translation",
    "Comments",
    "Source Language",
    "Target Language",
    "Source Audio",
  ]);
  const [mapping] = suggestNoteTypeMappings([model]);
  assert.deepEqual(mapping.original.fields, [1]);
  assert.deepEqual(mapping.translation.fields, [2]);
  assert.deepEqual(mapping.wordForms.fields, [3]);
  assert.deepEqual(mapping.comments.fields, [6]);
  assert.deepEqual(mapping.examples[0], {
    sample: { fields: [4], separator: " " },
    translation: { fields: [5], separator: " " },
  });
  assert.deepEqual(
    suggestedImportLanguages({
      models: [model],
      notes: [
        {
          modelId: "11",
          fields: ["id", "word", "translation", "", "", "", "", "FI", "RU"],
        },
      ],
    }),
    { sourceLang: "fi", targetLang: "ru" },
  );
});

test("suggested example mappings respect the import limit while retaining source fields", () => {
  const model = modelWithFields([
    "Front",
    "Back",
    "Sample",
    "Sample Translation",
    ...Array.from({ length: 25 }, (_, index) => [
      `example_${index + 1}_fin`,
      `example_${index + 1}_rus`,
    ]).flat(),
  ]);
  const [mapping] = suggestNoteTypeMappings([model]);
  assert.equal(mapping.examples.length, MAX_IMPORT_EXAMPLE_PAIRS);
  assert.equal(model.fields.length, 54);
  assert.deepEqual(mapping.examples.at(-1).sample.fields, [40]);
});

test("subdeck selection deduplicates notes and retains only associated card history", () => {
  const pkg = {
    decks: [
      { id: "1", name: "Finnish" },
      { id: "2", name: "Finnish::Lesson 1" },
      { id: "3", name: "Other" },
    ],
    notes: [{ id: "10" }, { id: "20" }, { id: "30" }],
    cards: [
      { id: "101", nid: "10", did: "1" },
      { id: "102", nid: "10", did: "2" },
      { id: "201", nid: "20", did: "3" },
    ],
    revlogs: [
      { id: "1001", cid: "101" },
      { id: "1002", cid: "102" },
      { id: "2001", cid: "201" },
    ],
  };
  assert.deepEqual(deckWithDescendants(pkg, "1"), ["1", "2"]);
  const selected = selectImportContent(pkg, ["1", "2"]);
  assert.deepEqual(
    selected.notes.map((note) => note.id),
    ["10"],
  );
  assert.deepEqual(
    selected.cards.map((card) => card.id),
    ["101", "102"],
  );
  assert.deepEqual(
    selected.revlogs.map((revlog) => revlog.id),
    ["1001", "1002"],
  );
  assert.deepEqual(
    selectImportContent(pkg, ["1", "2", "3"]).notes.map((note) => note.id),
    ["10", "20", "30"],
  );
  assert.equal(
    importDisplayName("deck.apkg", { ...pkg, cards: pkg.cards.slice(0, 2) }),
    "Finnish",
  );
});

test("text batches use actual UTF-8 bytes and preserve raw source records", () => {
  const notes = Array.from({ length: 7 }, (_, index) => ({
    id: String(index),
    guid: `guid-${index}`,
    modelId: "11",
    tags: ["слово"],
    fields: ["ä".repeat(400), "слово"],
    raw: { html: "<b>ä</b>", checksum: index },
  }));
  const cards = [{ id: "100", nid: "0", did: "1", queue: -1, ivl: 28 }];
  const revlogs = [{ id: "1000", cid: "100", ease: 3, ivl: 28 }];
  const batches = createImportBatches({ notes, cards, revlogs }, 2200);
  assert.ok(batches.length > 1);
  for (const [index, batch] of batches.entries()) {
    assert.equal(batch.batchIndex, index);
    assert.ok(importJsonByteLength(batch) <= 2200);
  }
  assert.deepEqual(
    batches.flatMap((batch) => batch.notes),
    notes,
  );
  assert.deepEqual(
    batches.flatMap((batch) => batch.cards),
    cards,
  );
  assert.deepEqual(
    batches.flatMap((batch) => batch.revlogs),
    revlogs,
  );
});

test("batch row limits leave room for server validation and split large histories", () => {
  const notes = Array.from({ length: 205 }, (_, id) => ({ id: String(id) }));
  const cards = Array.from({ length: 2101 }, (_, id) => ({ id: String(id) }));
  const revlogs = Array.from({ length: 10001 }, (_, id) => ({
    id: String(id),
  }));
  const batches = createImportBatches({ notes, cards, revlogs });
  for (const batch of batches) {
    assert.ok(batch.notes.length <= 100);
    assert.ok(batch.cards.length <= 1000);
    assert.ok(batch.revlogs.length <= 5000);
    assert.ok(importJsonByteLength(batch) <= MAX_IMPORT_REQUEST_BYTES);
  }
  assert.equal(batches.flatMap((batch) => batch.notes).length, 205);
  assert.equal(batches.flatMap((batch) => batch.cards).length, 2101);
  assert.equal(batches.flatMap((batch) => batch.revlogs).length, 10001);
});

test("one oversized record fails before any upload can start", () => {
  assert.throws(
    () =>
      createImportBatches(
        {
          notes: [{ id: "1", fields: ["ä".repeat(1000)] }],
          cards: [],
          revlogs: [],
        },
        1000,
      ),
    /One item.*too large/,
  );
});

test("a retried stage request keeps exactly the same idempotent batch body", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (_path, options) => {
    calls.push(options);
    return calls.length === 1
      ? Response.json({ error: "Temporary problem" }, { status: 503 })
      : Response.json({ nextBatchIndex: 2 });
  });
  const result = await importRequest("/api/anki/imports/job", "PUT", {
    batchIndex: 1,
    notes: [],
    cards: [{ id: "12" }],
    revlogs: [],
  });
  assert.equal(result.nextBatchIndex, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body, calls[1].body);
  assert.equal(calls[0].method, "PUT");
});

test("permanent validation failures and pause requests are never retried", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ error: "Wrong field selection" }, { status: 400 });
  });
  await assert.rejects(
    importRequest("/api/anki/imports", "POST", {}),
    /Wrong field selection/,
  );
  assert.equal(calls, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    importRequest("/api/anki/imports", "POST", {}, controller.signal),
    { name: "AbortError" },
  );
  assert.equal(calls, 1);
});

test("oversized request bodies never reach a server function", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({});
  });
  await assert.rejects(
    importRequest("/api/anki/imports", "POST", {
      text: "ä".repeat(MAX_IMPORT_REQUEST_BYTES),
    }),
    /too much information/,
  );
  assert.equal(calls, 0);
});
