import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createPostgresFixture } from "./helpers/postgres.mjs";

const fixture = await createPostgresFixture();
const { client, load } = fixture;
const repo = load("@/db/wordSetRepo");
const reviews = load("@/db/reviewRepo");
const userId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-11-11T12:00:00Z");

beforeEach(async () => {
  await client.exec("TRUNCATE app_user CASCADE");
  await client.query(
    "INSERT INTO app_user (id,provider,provider_user_id) VALUES ($1,'test','one'),($2,'test','two')",
    [userId, otherId],
  );
});
after(() => fixture.close());

const makeSet = (extra = {}) =>
  repo.createWordSet({
    userId,
    name: "Vocabulary",
    sourceLang: "de",
    targetLang: "ru",
    ...extra,
  });
async function makeItem(setId, extra = {}) {
  const guid = crypto.randomUUID();
  await repo.addItemsToWordSet(setId, [
    {
      ankiNoteGuid: guid,
      original: "Haus",
      translation: "дом",
      wordForms: "Häuser",
      sample: "Ein Haus.",
      sampleTranslation: "Дом.",
      comments: "Keep me",
      position: 0,
      ...extra,
    },
  ]);
  // Keep fresh-card due times inside this fixture's fixed clock, even when the
  // suite runs after 11 November. New cards otherwise inherit wall-clock now().
  await client.query(
    "UPDATE study_card SET created_at=$1 WHERE word_set_item_id IN (SELECT id FROM word_set_item WHERE anki_note_guid=$2)",
    [now, guid],
  );
  return (await repo.getWordSetItems(setId)).find(
    (item) => item.ankiNoteGuid === guid,
  );
}
async function setup() {
  const source = await makeSet();
  const destination = await makeSet();
  const item = await makeItem(source.id);
  const input = {
    userId,
    sourceWordSetId: source.id,
    destinationWordSetId: destination.id,
    itemId: item.id,
  };
  return { source, destination, item, input };
}
async function makeJob(setId) {
  return (
    await client.query(
      `INSERT INTO anki_import_job (user_id,request_key,request_hash,file_name,file_size,file_sha256,name,source_lang,target_lang,mapping,package_metadata,word_set_id)
    VALUES ($1,gen_random_uuid(),'hash','test.apkg',100,'sha','Imported','de','ru','[]','{}',$2) RETURNING id`,
      [userId, setId],
    )
  ).rows[0];
}
const rows = async (table) =>
  (await client.query(`SELECT * FROM ${table} ORDER BY 1`)).rows;
const hasStatus = (status) => (error) =>
  error instanceof repo.MoveWordSetItemError && error.status === status;

test("moving retains note, cards, review history, schedules and exposure, and appends after destination gaps", async () => {
  const { item, source, destination, input } = await setup();
  await makeItem(destination.id, { position: 9 });
  const opened = await reviews.activateReviewCard({
    userId,
    wordSetId: source.id,
    studyCardId: (
      await client.query(
        "SELECT id FROM study_card WHERE word_set_item_id=$1 AND template_key='recognition'",
        [item.id],
      )
    ).rows[0].id,
    exposureId: crypto.randomUUID(),
    now,
  });
  await reviews.recordReview({
    userId,
    wordSetId: source.id,
    studyCardId: opened.card.id,
    exposureId: opened.exposure.id,
    reviewEventId: crypto.randomUUID(),
    rating: 3,
    reviewedAt: now,
  });
  await client.query(
    "UPDATE fsrs_card_state SET state=2,due_at=$1 WHERE study_card_id=$2",
    [now, opened.card.id],
  );
  const beforeItem = await repo.getWordSetItem(item.id);
  const before = await Promise.all(
    ["study_card", "review_event", "fsrs_card_state", "study_exposure"].map(
      rows,
    ),
  );
  await repo.moveWordSetItem(input);
  const moved = await repo.getWordSetItem(item.id);
  assert.equal(moved.wordSetId, destination.id);
  assert.equal(moved.position, 10);
  for (const key of [
    "id",
    "ankiNoteGuid",
    "createdAt",
    "contentRevision",
    "lastExposedAt",
    "original",
    "translation",
    "wordForms",
    "sample",
    "comments",
    "fieldOrigins",
    "examplePairs",
  ])
    assert.deepEqual(moved[key], beforeItem[key]);
  assert.deepEqual(
    await Promise.all(
      ["study_card", "review_event", "fsrs_card_state", "study_exposure"].map(
        rows,
      ),
    ),
    before,
  );
  assert.equal((await repo.getWordSetItems(source.id)).length, 0);
  assert.equal((await repo.getWordSetItems(destination.id)).length, 2);
  const due = await reviews.getDueReviewCards({
    userId,
    wordSetId: destination.id,
    now,
    limit: 50,
  });
  assert(
    !due.some((card) => card.id === opened.card.id),
    "moving must not bypass today's exposure gate",
  );
  const position = moved.position;
  await repo.moveWordSetItem(input);
  assert.equal((await repo.getWordSetItem(item.id)).position, position);
});

test("ownership, language and same-set checks reject invalid moves without changing the word", async () => {
  const { item, input } = await setup();
  const foreign = await makeSet({ userId: otherId });
  const different = await makeSet({ sourceLang: "fi" });
  await assert.rejects(
    repo.moveWordSetItem({
      ...input,
      destinationWordSetId: input.sourceWordSetId,
    }),
    hasStatus(400),
  );
  await assert.rejects(
    repo.moveWordSetItem({ ...input, destinationWordSetId: different.id }),
    hasStatus(400),
  );
  await assert.rejects(
    repo.moveWordSetItem({ ...input, destinationWordSetId: foreign.id }),
    hasStatus(404),
  );
  await assert.rejects(
    repo.moveWordSetItem({ ...input, sourceWordSetId: foreign.id }),
    hasStatus(404),
  );
  await assert.rejects(
    repo.moveWordSetItem({ ...input, userId: otherId }),
    hasStatus(404),
  );
  await assert.rejects(
    repo.moveWordSetItem({ ...input, itemId: crypto.randomUUID() }),
    hasStatus(409),
  );
  assert.deepEqual(await repo.getWordSetItem(item.id), item);
});

test("an item from a third set cannot be pulled into the destination using a different source URL", async () => {
  const { input } = await setup();
  const third = await makeSet();
  const item = await makeItem(third.id);
  await assert.rejects(
    repo.moveWordSetItem({ ...input, itemId: item.id }),
    hasStatus(409),
  );
  assert.equal((await repo.getWordSetItem(item.id)).wordSetId, third.id);
});

test("an imported identity collision rolls the move back without merging or deleting either note", async () => {
  const { input, item, destination } = await setup();
  const other = await makeItem(destination.id);
  await client.query(
    "UPDATE word_set_item SET source_note_key='anki:same' WHERE id IN ($1,$2)",
    [item.id, other.id],
  );
  const before = await rows("word_set_item");
  await assert.rejects(repo.moveWordSetItem(input), hasStatus(409));
  assert.deepEqual(await rows("word_set_item"), before);
});

test("moving an imported note keeps its baseline and protects it from undoing the original import", async () => {
  const { input, item, source, destination } = await setup();
  const job = await makeJob(source.id);
  await client.query("UPDATE anki_import_job SET owns_set=true WHERE id=$1", [
    job.id,
  ]);
  await client.query(
    "UPDATE word_set_item SET source_note_key='anki:original', import_job_id=$1 WHERE id=$2",
    [job.id, item.id],
  );
  const [card] = (
    await client.query(
      "SELECT id FROM study_card WHERE word_set_item_id=$1 LIMIT 1",
      [item.id],
    )
  ).rows;
  await client.query(
    `INSERT INTO study_card_import_baseline (user_id,study_card_id,import_job_id,source_card_id,baseline_state)
    VALUES ($1,$2,$3,'source','{}')`,
    [userId, card.id, job.id],
  );
  const baseline = await rows("study_card_import_baseline");
  await repo.moveWordSetItem(input);
  const moved = await repo.getWordSetItem(item.id);
  assert.equal(moved.importJobId, null);
  assert.equal(moved.sourceNoteKey, "anki:original");
  assert.deepEqual(await rows("study_card_import_baseline"), baseline);
  await load("@/db/ankiImportRepo").removeAnkiImport(job.id, userId);
  assert.equal((await repo.getWordSetItem(item.id)).wordSetId, destination.id);
  assert.equal(await repo.getWordSet(source.id, userId), null);
  assert.deepEqual(await rows("study_card_import_baseline"), baseline);
});

test("concurrent moves append distinct positions and concurrent retries do not duplicate the note", async () => {
  const { input, source, destination } = await setup();
  const other = await makeItem(source.id);
  await Promise.all([
    repo.moveWordSetItem(input),
    repo.moveWordSetItem({ ...input, itemId: other.id }),
  ]);
  const items = await repo.getWordSetItems(destination.id);
  assert.equal(items.length, 2);
  assert.equal(new Set(items.map((item) => item.position)).size, 2);
  await Promise.all([repo.moveWordSetItem(input), repo.moveWordSetItem(input)]);
  assert.equal((await repo.getWordSetItems(destination.id)).length, 2);
});
