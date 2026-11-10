import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import {
  createActivatedReviewer,
  createPostgresFixture,
} from "./helpers/postgres.mjs";

const fixture = await createPostgresFixture();
const { client, load } = fixture;
const repo = load("@/db/reviewRepo");
const review = createActivatedReviewer(repo);
const stats = load("@/db/reviewStatsRepo");
const profiles = load("@/db/profileRepo");
const userId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-10-11T12:00:00.000Z");

beforeEach(async () => {
  await client.exec("TRUNCATE app_user CASCADE");
  await client.query(
    "INSERT INTO app_user (id,provider,provider_user_id) VALUES ($1,'test','one'),($2,'test','two')",
    [userId, otherId],
  );
});
after(() => fixture.close());

async function makeSet(count = 1) {
  const [set] = (
    await client.query(
      "INSERT INTO word_set (user_id,name,source_lang,target_lang) VALUES ($1,'Test','fi','en') RETURNING id",
      [userId],
    )
  ).rows;
  const { rows: items } = await client.query(
    `INSERT INTO word_set_item (word_set_id,anki_note_guid,original,translation,word_forms,sample,sample_translation,position,created_at)
     SELECT $1,'guid-' || p,'word-' || p,'translation','forms','example','translated example',p*3+1,'2026-01-01'
     FROM generate_series(0,$2::integer-1) p RETURNING id,position`,
    [set.id, count],
  );
  await client.query(
    `INSERT INTO study_card (word_set_item_id,template_key,created_at)
     SELECT item.id,template.key,'2026-01-01' FROM word_set_item item
     CROSS JOIN (VALUES ('recognition'),('production'),('word_forms'),('type_answer'),('example')) template(key)
     WHERE item.word_set_id=$1`,
    [set.id],
  );
  return { ...set, items: items.sort((a, b) => a.position - b.position) };
}

const queue = (set, extra = {}) =>
  repo.getDueReviewCards({
    userId,
    wordSetId: set.id,
    now,
    limit: 50,
    ...extra,
  });
const keys = (cards) => cards.map(({ templateKey }) => templateKey);
const answer = (set, card, extra = {}) =>
  review({
    userId,
    wordSetId: set.id,
    studyCardId: card.id,
    reviewEventId: crypto.randomUUID(),
    rating: 3,
    reviewedAt: now,
    ...extra,
  });
async function cardFor(set, key, itemId = set.items[0].id) {
  const [card] = (
    await client.query(
      "SELECT id FROM study_card WHERE word_set_item_id=$1 AND template_key=$2",
      [itemId, key],
    )
  ).rows;
  return card;
}
async function readyCount(set) {
  const [summary] = await stats.getWordSetReviewStats({ userId, now });
  const [item] = await stats.getWordSetItemReviewStats({
    userId,
    wordSetId: set.id,
    now,
  });
  assert.equal(summary.cardCount, 5);
  assert.equal(item.cardCount, 5);
  assert.equal(summary.dueCount, item.dueCount);
  return item.dueCount;
}

test("fresh notes always start with recognition, regardless of position, limit, or exclusions", async () => {
  const set = await makeSet(8);
  const first = await queue(set, { limit: 3 });
  assert.deepEqual(keys(first), Array(3).fill("recognition"));
  assert.deepEqual(
    first.map((card) => card.wordSetItemId),
    set.items.slice(0, 3).map((item) => item.id),
  );
  const remaining = await queue(set, {
    excludedStudyCardIds: first.map((card) => card.id),
  });
  assert.deepEqual(keys(remaining), Array(5).fill("recognition"));
  assert.deepEqual(
    await queue(set, {
      excludedStudyCardIds: [...first, ...remaining].map((card) => card.id),
    }),
    [],
  );
  assert.equal(
    (await client.query("SELECT count(*) FROM review_event")).rows[0].count,
    0,
  );
});

test("saved recognition unlocks production, then production unlocks the remaining types the same day", async () => {
  const set = await makeSet();
  assert.equal(await readyCount(set), 1);
  const [recognition] = await queue(set);
  const reviewId = crypto.randomUUID();
  const state = await answer(set, recognition, { reviewEventId: reviewId });
  assert.equal(state.dueAt.toISOString(), "2026-10-11T12:10:00.000Z");
  assert.deepEqual(
    await answer(set, recognition, { reviewEventId: reviewId }),
    state,
  );
  assert.deepEqual(keys(await queue(set)), ["production"]);
  assert.equal(await readyCount(set), 1);
  await answer(set, (await queue(set))[0]);
  assert.deepEqual(keys(await queue(set)), [
    "type_answer",
    "word_forms",
    "example",
  ]);
  assert.equal(await readyCount(set), 3);
  assert.equal(
    (await client.query("SELECT count(*) FROM review_event")).rows[0].count,
    2,
  );
  const returning = await queue(set, { now: state.dueAt });
  assert.equal(returning[0].id, recognition.id);
  assert.equal(returning[0].state.state, 1);
});

test("submission cannot bypass introduction prerequisites even with a known card UUID", async () => {
  const set = await makeSet();
  for (const key of ["production", "type_answer", "word_forms", "example"]) {
    await assert.rejects(
      answer(set, await cardFor(set, key)),
      repo.ReviewCardNotDueError,
    );
  }
  assert.equal(
    (await client.query("SELECT count(*) FROM review_event")).rows[0].count,
    0,
  );
  await answer(set, (await queue(set))[0]);
  for (const key of ["type_answer", "word_forms", "example"]) {
    await assert.rejects(
      answer(set, await cardFor(set, key)),
      repo.ReviewCardNotDueError,
    );
  }
  assert.equal(
    (await client.query("SELECT count(*) FROM review_event")).rows[0].count,
    1,
  );
});

test("the prerequisite history survives projection loss without resetting cards or schedules", async () => {
  const set = await makeSet();
  const recognition = (await queue(set))[0];
  await answer(set, recognition);
  await client.exec("DELETE FROM fsrs_card_state");
  assert.deepEqual(keys(await queue(set)), ["production"]);
  const production = (await queue(set))[0];
  await answer(set, production);
  await client.exec("DELETE FROM fsrs_card_state");
  assert.deepEqual(keys(await queue(set)), [
    "type_answer",
    "word_forms",
    "example",
  ]);
  const { rows } = await client.query(
    "SELECT study_card_id,reps,due_at FROM fsrs_card_state ORDER BY study_card_id",
  );
  assert.equal(rows.length, 2);
  assert(
    rows.every(
      (row) =>
        row.reps === 1 &&
        row.due_at.toISOString() === "2026-10-11T12:10:00.000Z",
    ),
  );
  assert.deepEqual(
    new Set(rows.map((row) => row.study_card_id)),
    new Set([recognition.id, production.id]),
  );
});

test("notes missing recognition content do not occupy the daily cohort through optional exercises", async () => {
  const set = await makeSet(3);
  await profiles.updateUserPreferences({
    userId,
    reviewMode: "simple",
    newWordsPerDay: 1,
  });
  await client.query("UPDATE word_set_item SET translation='' WHERE id=$1", [
    set.items[0].id,
  ]);
  await client.query("UPDATE word_set_item SET original='' WHERE id=$1", [
    set.items[1].id,
  ]);
  const cards = await queue(set);
  assert.deepEqual(keys(cards), ["recognition"]);
  assert.equal(cards[0].wordSetItemId, set.items[2].id);
  const summaries = await stats.getWordSetItemReviewStats({
    userId,
    wordSetId: set.id,
    now,
  });
  assert(
    summaries
      .filter((item) => item.wordSetItemId !== set.items[2].id)
      .every((item) => item.dueCount === 0),
  );
});

test("suspending or burying recognition does not let optional siblings consume an unseen slot", async () => {
  const set = await makeSet(3);
  await profiles.updateUserPreferences({
    userId,
    reviewMode: "simple",
    newWordsPerDay: 1,
  });
  const first = await cardFor(set, "recognition", set.items[0].id);
  const second = await cardFor(set, "recognition", set.items[1].id);
  await client.query("UPDATE study_card SET is_suspended=true WHERE id=$1", [
    first.id,
  ]);
  await client.query("UPDATE study_card SET buried_until=$1 WHERE id=$2", [
    new Date("2026-10-12"),
    second.id,
  ]);
  const cards = await queue(set);
  assert.deepEqual(keys(cards), ["recognition"]);
  assert.equal(cards[0].wordSetItemId, set.items[2].id);
});

test("a paused production prerequisite does not unlock later types, and restoring it retains IDs", async () => {
  const set = await makeSet();
  await answer(set, (await queue(set))[0]);
  const production = (await queue(set))[0];
  await client.query("UPDATE study_card SET is_suspended=true WHERE id=$1", [
    production.id,
  ]);
  assert.deepEqual(await queue(set), []);
  assert.equal(await readyCount(set), 0);
  await client.query("UPDATE study_card SET is_suspended=false WHERE id=$1", [
    production.id,
  ]);
  assert.equal((await queue(set))[0].id, production.id);
  await answer(set, production);
  await client.query(
    "UPDATE word_set_item SET word_forms='',sample='' WHERE id=$1",
    [set.items[0].id],
  );
  assert.deepEqual(keys(await queue(set)), ["type_answer"]);
});

test("previously studied directions retain due priority even without recognition history", async () => {
  const set = await makeSet();
  await client.query(
    `INSERT INTO fsrs_card_state (user_id,study_card_id,due_at,state,reps,scheduler_version)
     SELECT $1,id,'2026-10-10',2,7,'ts-fsrs@5.4.2:gooseberry-v1'
     FROM study_card WHERE word_set_item_id=$2 AND template_key <> 'recognition'`,
    [userId, set.items[0].id],
  );
  const cards = await queue(set);
  assert.equal(cards.length, 4);
  assert(
    cards
      .slice(0, 3)
      .every((card) => card.state.reps === 7 && card.state.state === 2),
  );
  assert.equal(cards[3].templateKey, "recognition");
  assert.equal(
    (await client.query("SELECT count(*) FROM fsrs_card_state WHERE reps=7"))
      .rows[0].count,
    4,
  );
  assert.equal(
    (await client.query("SELECT count(*) FROM review_event")).rows[0].count,
    0,
  );
});

test("progress belonging to another user cannot unlock a note's introductions", async () => {
  const set = await makeSet();
  await client.query(
    `INSERT INTO fsrs_card_state (user_id,study_card_id,due_at,state,reps,scheduler_version)
     SELECT $1,id,'2026-10-10',2,7,'ts-fsrs@5.4.2:gooseberry-v1'
     FROM study_card WHERE word_set_item_id=$2`,
    [otherId, set.items[0].id],
  );
  assert.deepEqual(keys(await queue(set)), ["recognition"]);
});

test("imported progress unlocks prerequisites, but untouched imported New baselines do not", async () => {
  const set = await makeSet();
  const [job] = (
    await client.query(
      `INSERT INTO anki_import_job (user_id,request_key,request_hash,file_name,file_size,file_sha256,name,source_lang,target_lang,mapping,package_metadata)
       VALUES ($1,gen_random_uuid(),'hash','test.apkg',100,'sha','Imported','fi','en','[]','{}') RETURNING id`,
      [userId],
    )
  ).rows;
  const fsrs = load("@/lib/review/fsrs");
  for (const [key, studied] of [
    ["recognition", true],
    ["production", false],
  ]) {
    const card = await cardFor(set, key);
    const state = {
      ...fsrs.createInitialFsrsState(new Date("2026-01-01")),
      ...(studied
        ? {
            reps: 8,
            state: 2,
            dueAt: new Date("2026-10-12"),
            stability: 10,
            difficulty: 5,
          }
        : {}),
    };
    await client.query(
      "INSERT INTO study_card_import_baseline (user_id,study_card_id,import_job_id,source_card_id,baseline_state) VALUES ($1,$2,$3,$4,$5)",
      [userId, card.id, job.id, key, fsrs.serializeFsrsState(state)],
    );
  }
  assert.deepEqual(keys(await queue(set)), ["production"]);
  await answer(set, (await queue(set))[0]);
  await client.exec("DELETE FROM fsrs_card_state");
  assert.deepEqual(keys(await queue(set)), [
    "type_answer",
    "word_forms",
    "example",
  ]);
  const recognition = await cardFor(set, "recognition");
  const [projection] = (
    await client.query(
      "SELECT reps,due_at FROM fsrs_card_state WHERE study_card_id=$1",
      [recognition.id],
    )
  ).rows;
  assert.equal(projection.reps, 8);
  assert.equal(projection.due_at.toISOString(), "2026-10-12T00:00:00.000Z");
});
