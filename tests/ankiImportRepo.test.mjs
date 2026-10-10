import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createPostgresFixture } from "./helpers/postgres.mjs";

const fixture = await createPostgresFixture();
const { client, load } = fixture;
const repo = load("@/db/ankiImportRepo");
const schemas = load("@/lib/anki/import/schemas");
const userId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const field = (ordinal) => ({ fields: [ordinal], separator: "\n" });
const model = {
  id: "123",
  name: "Finnish",
  type: 0,
  css: "",
  raw: { original: true },
  fields: [
    "Nominatiivi",
    "Back",
    "Sound",
    "Hint",
    "example_1_fin",
    "example_1_rus",
    "example_2_fin",
    "example_2_rus",
  ].map((name, ord) => ({ name, ord, raw: {} })),
  templates: [
    {
      name: "Basic",
      ord: 0,
      questionFormat: "{{Nominatiivi}}",
      answerFormat: "{{Back}}",
      raw: {},
    },
  ],
};
function begin(extra = {}) {
  return {
    requestKey: crypto.randomUUID(),
    file: { name: "Finnish.apkg", size: 18000000, sha256: "a".repeat(64) },
    name: "Finnish import",
    sourceLang: "fi",
    targetLang: "ru",
    mapping: [
      {
        modelId: "123",
        original: field(0),
        translation: field(1),
        examples: [
          { sample: field(4), translation: field(5) },
          { sample: field(6), translation: field(7) },
        ],
      },
    ],
    packageMetadata: {
      packageVersion: 1,
      databaseFormat: "legacy",
      schemaVersion: 11,
      models: [model],
      decks: [
        { id: "456", name: "Deck", configId: "1", raw: { desc: "Source" } },
      ],
      configs: [
        { id: "1", name: "Original preset", raw: { new: { delays: [1, 10] } } },
      ],
      collection: {
        creationTime: 123,
        config: { schedulerVersion: 2 },
        raw: { arbitrary: "preserved" },
      },
      diagnostics: {
        sourceBytes: 18000000,
        databaseBytes: 1000000,
        omittedMediaCount: 77,
        warnings: [],
      },
    },
    ...extra,
  };
}
function note(extra = {}) {
  return {
    id: "9007199254740999",
    guid: "source-guid",
    modelId: "123",
    fields: [
      "<b>monikko</b>",
      "множественное число",
      "[sound:source.mp3]",
      "m...",
      "",
      "",
      "Toinen; lause",
      "Второй; пример",
    ],
    tags: ["Suomen::Mestari"],
    raw: { mod: 123, original: "full private source" },
    ...extra,
  };
}
function card(extra = {}) {
  return {
    id: "9007199254741000",
    nid: "9007199254740999",
    did: "456",
    ord: 0,
    mod: 1,
    usn: -1,
    type: 2,
    queue: -1,
    due: 999,
    ivl: 77,
    factor: 2500,
    reps: 123,
    lapses: 4,
    left: 0,
    odue: 0,
    odid: "0",
    flags: 3,
    data: "source",
    ...extra,
  };
}
function review(extra = {}) {
  return {
    id: "9007199254741001",
    cid: "9007199254741000",
    usn: -1,
    ease: 3,
    ivl: 77,
    lastIvl: 33,
    factor: 2500,
    time: 1200,
    type: 1,
    ...extra,
  };
}
async function imported(extra = {}, notes = [note()]) {
  const job = await repo.beginAnkiImport(
    userId,
    schemas.BeginImportSchema.parse(begin(extra)),
  );
  await repo.stageAnkiImport(
    job.jobId,
    userId,
    schemas.ImportBatchSchema.parse({
      batchIndex: 0,
      notes,
      cards: [card()],
      revlogs: [review()],
    }),
  );
  return repo.commitAnkiImport(job.jobId, userId, {
    expectedBatchCount: 1,
    expectedNoteCount: notes.length,
  });
}
beforeEach(async () => {
  await client.exec("TRUNCATE app_user CASCADE");
  await client.query(
    "INSERT INTO app_user (id, provider, provider_user_id) VALUES ($1,'test','one'),($2,'test','two')",
    [userId, otherId],
  );
});
after(() => fixture.close());

test("explicit fresh imports retain source schedules privately without applying them", async () => {
  const job = await imported({ importProgress: false });
  assert.equal(job.status, "completed");
  assert.equal(job.addedCount, 1);
  assert.equal(job.skippedCount, 0);
  const [item] = (await client.query("SELECT * FROM word_set_item")).rows;
  assert.equal(item.original, "monikko");
  assert.equal(item.translation, "множественное число");
  assert.equal(item.sample, "Toinen; lause");
  assert.equal(item.sample_translation, "Второй; пример");
  assert.equal(item.example_pairs.length, 2);
  assert.notEqual(item.anki_note_guid, "source-guid");
  assert.equal(item.source_note_key, "anki:source-guid");
  assert.equal((await client.query("SELECT * FROM study_card")).rows.length, 5);
  assert.equal(
    (await client.query("SELECT * FROM fsrs_card_state")).rows.length,
    0,
  );
  assert.equal(
    (await client.query("SELECT * FROM review_event")).rows.length,
    0,
  );
  const [sourceCard] = (
    await client.query("SELECT raw_card FROM import_source_card")
  ).rows;
  assert.equal(sourceCard.raw_card.id, "9007199254741000");
  assert.equal(sourceCard.raw_card.queue, -1);
  assert.equal(sourceCard.raw_card.ivl, 77);
  assert.equal(
    (await client.query("SELECT * FROM import_source_review")).rows.length,
    1,
  );
  assert.match(
    (await repo.getImportNoteContext(item.id, userId)).Hint,
    /m\.\.\./,
  );
  assert.deepEqual(await repo.getImportNoteContext(item.id, otherId), {});
});

test("default imports carry matched source progress into durable baselines without duplicating native reviews", async () => {
  const job = await imported();
  assert.equal(job.importedProgressCount, 1);
  const [state] = (await client.query("SELECT * FROM fsrs_card_state")).rows;
  assert.equal(state.state, 2);
  assert.equal(state.scheduled_days, 77);
  assert.equal(state.reps, 123);
  assert.equal(state.lapses, 4);
  assert.equal(state.stability, 77);
  const [baseline] = (
    await client.query("SELECT * FROM study_card_import_baseline")
  ).rows;
  assert.equal(baseline.import_job_id, job.jobId);
  assert.equal(baseline.source_card_id, "9007199254741000");
  assert.equal(baseline.baseline_state.reps, 123);
  assert.equal(
    baseline.baseline_state.conversionVersion,
    "anki-to-gooseberry-v1",
  );
  const [linked] = (
    await client.query("SELECT * FROM study_card WHERE external_source='anki'")
  ).rows;
  assert.equal(linked.template_key, "recognition");
  assert.equal(linked.external_id, baseline.source_card_id);
  assert.equal(linked.is_suspended, true);
  assert.equal((await client.query("SELECT * FROM study_card")).rows.length, 5);
  assert.equal(
    (await client.query("SELECT * FROM review_event")).rows.length,
    0,
  );
  assert.equal(
    (await client.query("SELECT * FROM import_source_review")).rows.length,
    1,
  );
  const again = await repo.commitAnkiImport(job.jobId, userId, {
    expectedBatchCount: 1,
    expectedNoteCount: 1,
  });
  assert.equal(again.importedProgressCount, 1);
  assert.equal(
    (await client.query("SELECT * FROM study_card_import_baseline")).rows
      .length,
    1,
  );
});

test("reimport recovers progress in an existing fresh set but preserves locally reviewed cards", async () => {
  const fresh = await imported({ importProgress: false });
  const recognition = (
    await client.query(
      "SELECT * FROM study_card WHERE template_key='recognition'",
    )
  ).rows[0];
  const recovered = await imported({ targetSetId: fresh.wordSetId });
  assert.equal(recovered.addedCount, 0);
  assert.equal(recovered.importedProgressCount, 1);
  assert.equal(
    (await client.query("SELECT * FROM study_card_import_baseline")).rows[0]
      .study_card_id,
    recognition.id,
  );
  await client.query("UPDATE study_card SET is_suspended=false WHERE id=$1", [
    recognition.id,
  ]);
  const reviews = load("@/db/reviewRepo");
  await reviews.recordReview({
    userId,
    wordSetId: fresh.wordSetId,
    studyCardId: recognition.id,
    reviewEventId: crypto.randomUUID(),
    rating: 3,
    reviewedAt: new Date(),
  });
  const before = (await client.query("SELECT * FROM fsrs_card_state")).rows;
  const third = await imported({ targetSetId: fresh.wordSetId });
  assert.equal(third.importedProgressCount, 0);
  assert.deepEqual(
    (await client.query("SELECT * FROM fsrs_card_state")).rows,
    before,
  );
  assert.equal(
    (await client.query("SELECT * FROM review_event")).rows.length,
    1,
  );
});

test("reimport recovers an untouched exercise when Anki regenerated its source card ID", async () => {
  const fresh = await imported({ importProgress: false });
  await client.query(
    "UPDATE study_card SET external_source='anki', external_id='old-source-card-id' WHERE template_key='recognition'",
  );
  const recovered = await imported({ targetSetId: fresh.wordSetId });
  assert.equal(recovered.addedCount, 0);
  assert.equal(recovered.importedProgressCount, 1);
  const [card] = (
    await client.query(
      "SELECT * FROM study_card WHERE template_key='recognition'",
    )
  ).rows;
  assert.equal(card.external_id, "9007199254741000");
  assert.equal(
    (await client.query("SELECT * FROM fsrs_card_state")).rows[0].reps,
    123,
  );
});

test("reimport leaves conflicting source card mappings untouched without failing publication", async () => {
  const fresh = await imported({ importProgress: false });
  await client.query(
    "UPDATE study_card SET external_source='anki', external_id='9007199254741000' WHERE template_key='production'",
  );
  const recovered = await imported({ targetSetId: fresh.wordSetId });
  assert.equal(recovered.status, "completed");
  assert.equal(recovered.importedProgressCount, 0);
  assert.equal(
    (await client.query("SELECT * FROM fsrs_card_state")).rows.length,
    0,
  );
  const [card] = (
    await client.query("SELECT * FROM study_card WHERE external_source='anki'")
  ).rows;
  assert.equal(card.template_key, "production");
  assert.equal(card.external_id, "9007199254741000");
});

test("source ordinal mapping keeps recognition and typed answers independent and other directions new", async () => {
  const metadata = begin().packageMetadata;
  metadata.models = [
    {
      ...model,
      templates: [
        ...model.templates,
        {
          ord: 1,
          name: "Typed Finnish",
          questionFormat: "{{Back}}{{type:Nominatiivi}}",
          answerFormat: "{{type:Nominatiivi}}",
          raw: {},
        },
      ],
    },
  ];
  metadata.collection = {
    creationTime: 1738638000,
    config: { schedVer: 2, creationOffset: -120 },
    raw: {},
  };
  const job = await repo.beginAnkiImport(
    userId,
    schemas.BeginImportSchema.parse(
      begin({ packageMetadata: metadata, schedulingTimeZone: "Europe/Berlin" }),
    ),
  );
  await repo.stageAnkiImport(
    job.jobId,
    userId,
    schemas.ImportBatchSchema.parse({
      batchIndex: 0,
      notes: [note()],
      cards: [
        card({ queue: 2, due: 610 }),
        card({
          id: "9007199254741002",
          ord: 1,
          queue: 2,
          due: 640,
          ivl: 10,
          reps: 8,
        }),
      ],
    }),
  );
  const committed = await repo.commitAnkiImport(job.jobId, userId, {
    expectedBatchCount: 1,
    expectedNoteCount: 1,
  });
  assert.equal(committed.importedProgressCount, 2);
  const states = (
    await client.query(
      "SELECT card.template_key, state.due_at, state.reps FROM study_card card JOIN fsrs_card_state state ON state.study_card_id=card.id ORDER BY template_key",
    )
  ).rows;
  assert.deepEqual(
    states.map((row) => row.template_key),
    ["recognition", "type_answer"],
  );
  assert.equal(
    new Date(states[0].due_at).toISOString(),
    "2026-10-07T02:00:00.000Z",
  );
  assert.equal(
    new Date(states[1].due_at).toISOString(),
    "2026-11-06T03:00:00.000Z",
  );
  assert.deepEqual(
    states.map((row) => row.reps),
    [123, 8],
  );
});

test("duplicate sibling ordinals reject publication without leaving cards or progress behind", async () => {
  const job = await repo.beginAnkiImport(
    userId,
    schemas.BeginImportSchema.parse(begin()),
  );
  await repo.stageAnkiImport(
    job.jobId,
    userId,
    schemas.ImportBatchSchema.parse({
      batchIndex: 0,
      notes: [note()],
      cards: [card(), card({ id: "9007199254741002" })],
    }),
  );
  await assert.rejects(
    repo.commitAnkiImport(job.jobId, userId, {
      expectedBatchCount: 1,
      expectedNoteCount: 1,
    }),
    { status: 409 },
  );
  assert.equal((await client.query("SELECT * FROM word_set")).rows.length, 0);
  assert.equal(
    (await client.query("SELECT * FROM study_card_import_baseline")).rows
      .length,
    0,
  );
});

test("a failure saving imported progress rolls back the entire publication", async () => {
  await client.exec(
    "ALTER TABLE study_card_import_baseline ADD CONSTRAINT test_progress_failure CHECK (false)",
  );
  try {
    await assert.rejects(imported());
    assert.equal((await client.query("SELECT * FROM word_set")).rows.length, 0);
    assert.equal(
      (await client.query("SELECT * FROM study_card")).rows.length,
      0,
    );
    assert.equal(
      (await client.query("SELECT * FROM fsrs_card_state")).rows.length,
      0,
    );
    assert.equal(
      (await client.query("SELECT status FROM anki_import_job")).rows[0].status,
      "receiving",
    );
  } finally {
    await client.exec(
      "ALTER TABLE study_card_import_baseline DROP CONSTRAINT test_progress_failure",
    );
  }
});

test("reimport cannot replace a native schedule that has no imported baseline", async () => {
  const first = await imported({ importProgress: false });
  const recognition = (
    await client.query(
      "SELECT id FROM study_card WHERE template_key='recognition'",
    )
  ).rows[0];
  const reviews = load("@/db/reviewRepo");
  await reviews.recordReview({
    userId,
    wordSetId: first.wordSetId,
    studyCardId: recognition.id,
    reviewEventId: crypto.randomUUID(),
    rating: 3,
    reviewedAt: new Date(),
  });
  const before = (await client.query("SELECT * FROM fsrs_card_state")).rows;
  const importedAgain = await imported({ targetSetId: first.wordSetId });
  assert.equal(importedAgain.importedProgressCount, 0);
  assert.deepEqual(
    (await client.query("SELECT * FROM fsrs_card_state")).rows,
    before,
  );
  assert.equal(
    (await client.query("SELECT * FROM study_card_import_baseline")).rows
      .length,
    0,
  );
  assert.equal(
    (
      await client.query("SELECT is_suspended FROM study_card WHERE id=$1", [
        recognition.id,
      ])
    ).rows[0].is_suspended,
    false,
  );
});

test("begin, batches, and commits are idempotent and reject conflicting replay", async () => {
  const input = schemas.BeginImportSchema.parse(begin());
  const first = await repo.beginAnkiImport(userId, input);
  assert.equal((await repo.beginAnkiImport(userId, input)).jobId, first.jobId);
  await assert.rejects(
    repo.beginAnkiImport(userId, { ...input, name: "Changed" }),
    { status: 409 },
  );
  const batch = schemas.ImportBatchSchema.parse({
    batchIndex: 0,
    notes: [note()],
  });
  await repo.stageAnkiImport(first.jobId, userId, batch);
  await repo.stageAnkiImport(first.jobId, userId, batch);
  await assert.rejects(
    repo.stageAnkiImport(first.jobId, userId, {
      ...batch,
      notes: [note({ tags: ["different"] })],
    }),
    { status: 409 },
  );
  assert.equal(
    (await repo.getAnkiImport(first.jobId, userId)).stagedNoteCount,
    1,
  );
  const result = await repo.commitAnkiImport(first.jobId, userId, {
    expectedBatchCount: 1,
    expectedNoteCount: 1,
  });
  assert.deepEqual(
    await repo.commitAnkiImport(first.jobId, userId, {
      expectedBatchCount: 1,
      expectedNoteCount: 1,
    }),
    result,
  );
  assert.equal((await client.query("SELECT * FROM word_set")).rows.length, 1);
});

test("staged data is invisible and incomplete references never create a partial set", async () => {
  const job = await repo.beginAnkiImport(
    userId,
    schemas.BeginImportSchema.parse(begin()),
  );
  await repo.stageAnkiImport(
    job.jobId,
    userId,
    schemas.ImportBatchSchema.parse({
      batchIndex: 0,
      notes: [note()],
      cards: [card({ nid: "999" })],
    }),
  );
  assert.equal((await client.query("SELECT * FROM word_set")).rows.length, 0);
  await assert.rejects(
    repo.commitAnkiImport(job.jobId, userId, {
      expectedBatchCount: 1,
      expectedNoteCount: 1,
    }),
    { status: 409 },
  );
  assert.equal((await client.query("SELECT * FROM word_set")).rows.length, 0);
  assert.equal(
    (await client.query("SELECT * FROM word_set_item")).rows.length,
    0,
  );
  assert.equal(
    (await repo.getAnkiImport(job.jobId, userId)).status,
    "receiving",
  );
});

test("reimport skips existing source GUIDs and preserves edits, card IDs and review projections", async () => {
  const first = await imported();
  const [item] = (await client.query("SELECT * FROM word_set_item")).rows;
  const ids = (await client.query("SELECT id FROM study_card ORDER BY id"))
    .rows;
  await client.query(
    "UPDATE word_set_item SET original='user edit', content_revision=1 WHERE id=$1",
    [item.id],
  );
  const second = await imported({ targetSetId: first.wordSetId });
  assert.equal(second.addedCount, 0);
  assert.equal(second.skippedCount, 1);
  assert.equal(
    (await client.query("SELECT original FROM word_set_item")).rows[0].original,
    "user edit",
  );
  assert.deepEqual(
    (await client.query("SELECT id FROM study_card ORDER BY id")).rows,
    ids,
  );
  await repo.removeAnkiImport(second.jobId, userId);
  assert.equal(
    (await client.query("SELECT * FROM word_set_item")).rows.length,
    1,
  );
  await repo.removeAnkiImport(first.jobId, userId);
  assert.equal(
    (await client.query("SELECT * FROM word_set_item")).rows.length,
    0,
  );
  assert.equal((await client.query("SELECT * FROM word_set")).rows.length, 0);
});

test("missing required fields remain attention-marked and do not fabricate content", async () => {
  const missing = note({
    fields: ["", "множественное число", "", "m...", "one", "", "", ""],
  });
  const job = await imported({}, [missing]);
  assert.equal(job.needsAttentionCount, 1);
  const [item] = (await client.query("SELECT * FROM word_set_item")).rows;
  assert.equal(item.original, "");
  assert.equal(item.sample, "");
  assert.deepEqual(item.example_pairs[0], { sample: "one", translation: "" });
});

test("ownership, target language checks and cancellation prevent unauthorized writes", async () => {
  const first = await imported();
  await assert.rejects(repo.getAnkiImport(first.jobId, otherId), {
    status: 404,
  });
  await assert.rejects(repo.removeAnkiImport(first.jobId, otherId), {
    status: 404,
  });
  await assert.rejects(
    repo.beginAnkiImport(
      otherId,
      schemas.BeginImportSchema.parse(begin({ targetSetId: first.wordSetId })),
    ),
    { status: 404 },
  );
  await assert.rejects(
    repo.beginAnkiImport(
      userId,
      schemas.BeginImportSchema.parse(
        begin({ targetSetId: first.wordSetId, sourceLang: "de" }),
      ),
    ),
    { status: 400 },
  );
  const pending = await repo.beginAnkiImport(
    userId,
    schemas.BeginImportSchema.parse(begin()),
  );
  await repo.stageAnkiImport(
    pending.jobId,
    userId,
    schemas.ImportBatchSchema.parse({ batchIndex: 0, notes: [note()] }),
  );
  assert.equal(
    (await repo.removeAnkiImport(pending.jobId, userId)).status,
    "cancelled",
  );
  assert.equal(
    (
      await client.query("SELECT * FROM import_source_note WHERE job_id=$1", [
        pending.jobId,
      ])
    ).rows.length,
    0,
  );
  await assert.rejects(
    repo.commitAnkiImport(pending.jobId, userId, {
      expectedBatchCount: 1,
      expectedNoteCount: 1,
    }),
    { status: 409 },
  );
});

test("concurrent retries stage exactly once and conflicting same-index batches are rejected", async () => {
  const job = await repo.beginAnkiImport(
    userId,
    schemas.BeginImportSchema.parse(begin()),
  );
  const batch = schemas.ImportBatchSchema.parse({
    batchIndex: 0,
    notes: [note()],
  });
  const results = await Promise.all([
    repo.stageAnkiImport(job.jobId, userId, batch),
    repo.stageAnkiImport(job.jobId, userId, batch),
  ]);
  assert(results.every((result) => result.nextBatchIndex === 1));
  assert.equal(
    (await client.query("SELECT * FROM import_source_note")).rows.length,
    1,
  );
  const another = await repo.beginAnkiImport(
    userId,
    schemas.BeginImportSchema.parse(begin()),
  );
  const conflicting = await Promise.allSettled([
    repo.stageAnkiImport(another.jobId, userId, batch),
    repo.stageAnkiImport(another.jobId, userId, {
      ...batch,
      notes: [note({ guid: "conflicting" })],
    }),
  ]);
  assert.equal(
    conflicting.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    conflicting.find((result) => result.status === "rejected").reason.status,
    409,
  );
  assert.equal(
    (await repo.getAnkiImport(another.jobId, userId)).stagedNoteCount,
    1,
  );
});

test("duplicate source rows roll back their whole batch and respect cumulative limits", async () => {
  const job = await repo.beginAnkiImport(
    userId,
    schemas.BeginImportSchema.parse(begin()),
  );
  await repo.stageAnkiImport(
    job.jobId,
    userId,
    schemas.ImportBatchSchema.parse({ batchIndex: 0, notes: [note()] }),
  );
  await assert.rejects(
    repo.stageAnkiImport(
      job.jobId,
      userId,
      schemas.ImportBatchSchema.parse({ batchIndex: 1, notes: [note()] }),
    ),
    { status: 409 },
  );
  const status = await repo.getAnkiImport(job.jobId, userId);
  assert.equal(status.nextBatchIndex, 1);
  assert.equal(status.stagedNoteCount, 1);
  await client.query(
    "UPDATE anki_import_job SET staged_note_count=20000 WHERE id=$1",
    [job.jobId],
  );
  await assert.rejects(
    repo.stageAnkiImport(
      job.jobId,
      userId,
      schemas.ImportBatchSchema.parse({
        batchIndex: 1,
        notes: [note({ id: "999", guid: "other" })],
      }),
    ),
    { status: 413 },
  );
  assert.equal(
    (await client.query("SELECT * FROM import_source_note")).rows.length,
    1,
  );
});

test("removing an imported deck retains later manual vocabulary in its set", async () => {
  const job = await imported();
  await client.query(
    "INSERT INTO word_set_item (word_set_id,anki_note_guid,original,translation,position) VALUES ($1,'manual-guid','kissa','кот',99)",
    [job.wordSetId],
  );
  await repo.removeAnkiImport(job.jobId, userId);
  assert.equal((await client.query("SELECT * FROM word_set")).rows.length, 1);
  assert.equal(
    (await client.query("SELECT original FROM word_set_item")).rows[0].original,
    "kissa",
  );
  assert.equal(
    (await client.query("SELECT * FROM import_source_note")).rows.length,
    0,
  );
  assert.equal(
    (await client.query("SELECT * FROM import_source_card")).rows.length,
    0,
  );
  assert.equal(
    (await client.query("SELECT * FROM import_source_review")).rows.length,
    0,
  );
});

test("oversized visible vocabulary is rejected before publishing any set or cards", async () => {
  const job = await repo.beginAnkiImport(
    userId,
    schemas.BeginImportSchema.parse(begin()),
  );
  for (let batchIndex = 0; batchIndex < 3; batchIndex++) {
    const notes = Array.from({ length: 100 }, (_, index) => {
      const ordinal = batchIndex * 100 + index;
      return note({
        id: String(1000 + ordinal),
        guid: `large-${ordinal}`,
        fields: ["a".repeat(5000), "б".repeat(5000), "", "", "", "", "", ""],
      });
    });
    const batch = schemas.ImportBatchSchema.parse({ batchIndex, notes });
    assert(
      Buffer.byteLength(JSON.stringify(batch)) < schemas.IMPORT_BODY_LIMIT,
    );
    await repo.stageAnkiImport(job.jobId, userId, batch);
  }
  await assert.rejects(
    repo.commitAnkiImport(job.jobId, userId, {
      expectedBatchCount: 3,
      expectedNoteCount: 300,
    }),
    (error) =>
      error.status === 413 && /fewer fields|smaller deck/.test(error.message),
  );
  assert.equal(
    (await repo.getAnkiImport(job.jobId, userId)).status,
    "receiving",
  );
  assert.equal(
    (await client.query("SELECT count(*) FROM word_set")).rows[0].count,
    0,
  );
  assert.equal(
    (await client.query("SELECT count(*) FROM word_set_item")).rows[0].count,
    0,
  );
  assert.equal(
    (await client.query("SELECT count(*) FROM study_card")).rows[0].count,
    0,
  );
  assert.equal(
    (await client.query("SELECT count(*) FROM import_source_note")).rows[0]
      .count,
    300,
  );
});

test("visible-size admission includes existing destination text and metadata", async () => {
  const [target] = (
    await client.query(
      "INSERT INTO word_set (user_id,name,source_lang,target_lang) VALUES ($1,'Existing','fi','ru') RETURNING id",
      [userId],
    )
  ).rows;
  await client.query(
    `INSERT INTO word_set_item (word_set_id,anki_note_guid,original,translation,comments,position)
     SELECT $1,'existing-' || ordinal,'sana','слово',repeat('x',50000),ordinal FROM generate_series(1,60) ordinal`,
    [target.id],
  );
  const job = await repo.beginAnkiImport(
    userId,
    schemas.BeginImportSchema.parse(begin({ targetSetId: target.id })),
  );
  await repo.stageAnkiImport(
    job.jobId,
    userId,
    schemas.ImportBatchSchema.parse({
      batchIndex: 0,
      notes: Array.from({ length: 100 }, (_, index) =>
        note({ id: String(1000 + index), guid: `new-${index}` }),
      ),
    }),
  );
  await assert.rejects(
    repo.commitAnkiImport(job.jobId, userId, {
      expectedBatchCount: 1,
      expectedNoteCount: 100,
    }),
    { status: 413 },
  );
  assert.equal(
    (await client.query("SELECT count(*) FROM word_set")).rows[0].count,
    1,
  );
  assert.equal(
    (await client.query("SELECT count(*) FROM word_set_item")).rows[0].count,
    60,
  );
  assert.equal(
    (await client.query("SELECT count(*) FROM study_card")).rows[0].count,
    0,
  );
});

test("concurrent publication cannot jointly exceed the existing target's visible-size allowance", async () => {
  const [target] = (
    await client.query(
      "INSERT INTO word_set (user_id,name,source_lang,target_lang) VALUES ($1,'Concurrent target','fi','ru') RETURNING id",
      [userId],
    )
  ).rows;
  const jobs = [];
  for (let jobIndex = 0; jobIndex < 2; jobIndex++) {
    const job = await repo.beginAnkiImport(
      userId,
      schemas.BeginImportSchema.parse(begin({ targetSetId: target.id })),
    );
    for (let batchIndex = 0; batchIndex < 2; batchIndex++) {
      await repo.stageAnkiImport(
        job.jobId,
        userId,
        schemas.ImportBatchSchema.parse({
          batchIndex,
          notes: Array.from(
            { length: batchIndex === 0 ? 100 : 50 },
            (_, index) => {
              const ordinal = batchIndex * 100 + index;
              return note({
                id: String(1000 + ordinal),
                guid: `concurrent-${jobIndex}-${ordinal}`,
                fields: [
                  "a".repeat(5000),
                  "б".repeat(5000),
                  "",
                  "",
                  "",
                  "",
                  "",
                  "",
                ],
              });
            },
          ),
        }),
      );
    }
    jobs.push(job);
  }
  const outcomes = await Promise.allSettled(
    jobs.map((job) =>
      repo.commitAnkiImport(job.jobId, userId, {
        expectedBatchCount: 2,
        expectedNoteCount: 150,
      }),
    ),
  );
  assert.equal(
    outcomes.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    outcomes.find((result) => result.status === "rejected").reason.status,
    413,
  );
  assert.equal(
    (await client.query("SELECT count(*) FROM word_set_item")).rows[0].count,
    150,
  );
  assert.equal(
    (await client.query("SELECT count(*) FROM study_card")).rows[0].count,
    750,
  );
});
