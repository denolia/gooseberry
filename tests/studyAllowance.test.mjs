import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createPostgresFixture } from "./helpers/postgres.mjs";

const fixture = await createPostgresFixture();
const { client, load } = fixture;
const repo = load("@/db/reviewRepo");
const stats = load("@/db/reviewStatsRepo");
const profiles = load("@/db/profileRepo");
const userId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-10-11T12:00:00.000Z");
beforeEach(async () => {
  await client.exec("TRUNCATE app_user CASCADE");
  await client.query(
    "INSERT INTO app_user (id,provider,provider_user_id) VALUES ($1,'test','one')",
    [userId],
  );
});
after(() => fixture.close());

async function makeSet(count = 3) {
  const [set] = (
    await client.query(
      "INSERT INTO word_set (user_id,name,source_lang,target_lang) VALUES ($1,'Test','fi','en') RETURNING id",
      [userId],
    )
  ).rows;
  const items = (
    await client.query(
      `INSERT INTO word_set_item (word_set_id,anki_note_guid,original,translation,position,created_at)
    SELECT $1,'guid-' || position,'word-' || position,'translation',position,'2026-01-01' FROM generate_series(0,$2::integer-1) position RETURNING id,position`,
      [set.id, count],
    )
  ).rows;
  await client.query(
    `INSERT INTO study_card (word_set_item_id,template_key,created_at)
    SELECT item.id,template.key,'2026-01-01' FROM word_set_item item
    CROSS JOIN (VALUES ('recognition'),('production'),('word_forms'),('type_answer'),('example')) template(key)
    WHERE item.word_set_id=$1`,
    [set.id],
  );
  return { id: set.id, items: items.sort((a, b) => a.position - b.position) };
}
const queue = (set, extra = {}) =>
  repo.getDueReviewCards({
    userId,
    wordSetId: set.id,
    now,
    limit: 50,
    ...extra,
  });
const wordIds = (cards) => [
  ...new Set(cards.map((card) => card.wordSetItemId)),
];
const settings = (limit, studyTimeZone = "UTC") =>
  profiles.updateUserPreferences({
    userId,
    reviewMode: "simple",
    newWordsPerDay: limit,
    studyTimeZone,
  });
const answer = (set, card, reviewedAt = now) =>
  repo.recordReview({
    userId,
    wordSetId: set.id,
    studyCardId: card.id,
    reviewEventId: crypto.randomUUID(),
    rating: 3,
    reviewedAt,
  });

test("defaults to 20 words, with stable cohorts across fetches and exclusions", async () => {
  const set = await makeSet(25);
  const first = await queue(set);
  assert.equal(first.length, 50);
  assert.deepEqual(
    new Set(wordIds(first)),
    new Set(set.items.slice(0, 20).map((item) => item.id)),
  );
  const next = await queue(set, {
    excludedStudyCardIds: first.map((card) => card.id),
  });
  assert.equal(next.length, 10);
  assert(
    next.every((card) =>
      set.items.slice(0, 20).some((item) => item.id === card.wordSetItemId),
    ),
  );
  assert.equal(
    (await profiles.getUserProfile(userId)).preferences.newWordsPerDay,
    20,
  );
});

test("saved introductions count words once, survive reopening and reset the next day", async () => {
  await settings(2);
  const set = await makeSet(4);
  let cards = await queue(set);
  const firstWord = cards.filter(
    (card) => card.wordSetItemId === set.items[0].id,
  );
  for (const card of firstWord) await answer(set, card);
  cards = await queue(set);
  assert.deepEqual(wordIds(cards), [set.items[1].id]);
  await answer(set, cards[0]);
  cards = await queue(set);
  assert(cards.every((card) => card.wordSetItemId === set.items[1].id));
  assert.equal((await queue(set)).length, cards.length);
  await client.exec("DELETE FROM fsrs_card_state");
  assert(
    (await queue(set)).every((card) => card.wordSetItemId === set.items[1].id),
  );
  const tomorrow = await queue(set, { now: new Date("2026-10-12T12:00:00Z") });
  assert(tomorrow.some((card) => card.wordSetItemId === set.items[2].id));
  assert(tomorrow.some((card) => card.wordSetItemId === set.items[3].id));
});

test("daily allowances are independent for each set and reflected in ready counts", async () => {
  await settings(1);
  const first = await makeSet();
  const second = await makeSet();
  await answer(first, (await queue(first))[0]);
  assert.deepEqual(wordIds(await queue(second)), [second.items[0].id]);
  const summaries = await stats.getWordSetReviewStats({ userId, now });
  assert.equal(summaries.find((set) => set.wordSetId === first.id).dueCount, 2);
  assert.equal(
    summaries.find((set) => set.wordSetId === second.id).dueCount,
    3,
  );
  const items = await stats.getWordSetItemReviewStats({
    userId,
    wordSetId: second.id,
    now,
  });
  assert.equal(
    items.find((item) => item.wordSetItemId === second.items[0].id).dueCount,
    3,
  );
  assert(
    items
      .filter((item) => item.wordSetItemId !== second.items[0].id)
      .every((item) => item.dueCount === 0),
  );
});

test("zero pauses unseen words while due reviews and started-word siblings stay available", async () => {
  const set = await makeSet(25);
  await queue(set);
  await client.query(
    `INSERT INTO fsrs_card_state (user_id,study_card_id,due_at,state,reps,scheduler_version)
    SELECT $1,card.id,$2,2,5,'ts-fsrs@5.4.2:gooseberry-v1' FROM study_card card
    INNER JOIN word_set_item item ON item.id=card.word_set_item_id WHERE item.word_set_id=$3 AND card.template_key='recognition'`,
    [userId, now, set.id],
  );
  await settings(0);
  const cards = await queue(set);
  assert.equal(cards.filter((card) => card.state.state === 2).length, 25);
  assert(cards.slice(0, 25).every((card) => card.state.state === 2));
  assert(cards.some((card) => card.templateKey === "production"));
  const unseenSet = await makeSet();
  assert.deepEqual(await queue(unseenSet), []);
});

test("empty, suspended and buried words do not occupy the new-word cohort", async () => {
  const set = await makeSet(4);
  await queue(set);
  await settings(1);
  await client.query(
    "UPDATE word_set_item SET original='',translation='' WHERE id=$1",
    [set.items[0].id],
  );
  await client.query(
    "UPDATE study_card SET is_suspended=true WHERE word_set_item_id=$1",
    [set.items[1].id],
  );
  await client.query(
    "UPDATE study_card SET buried_until=$1 WHERE word_set_item_id=$2",
    [new Date("2026-10-12"), set.items[2].id],
  );
  assert.deepEqual(wordIds(await queue(set)), [set.items[3].id]);
});

test("the saved study timezone resets at local midnight, including DST boundaries", async () => {
  for (const midnight of ["2026-10-10T22:00:00Z", "2026-10-25T23:00:00Z"]) {
    await settings(1, "Europe/Berlin");
    const set = await makeSet(2);
    const beforeMidnight = new Date(new Date(midnight).getTime() - 60_000);
    const first = await queue(set, { now: beforeMidnight });
    await answer(set, first[0], beforeMidnight);
    assert(
      !(await queue(set, { now: beforeMidnight })).some(
        (card) => card.wordSetItemId === set.items[1].id,
      ),
    );
    assert(
      (await queue(set, { now: new Date(midnight) })).some(
        (card) => card.wordSetItemId === set.items[1].id,
      ),
    );
  }
});

test("reports the next scheduled repetition without treating new exercises as scheduled reviews", async () => {
  const set = await makeSet(1);
  const first = (await queue(set))[0];
  assert.equal(
    await repo.getNextScheduledReviewAt({ userId, wordSetId: set.id, now }),
    null,
  );
  const state = await answer(set, first);
  assert.equal(state.dueAt.toISOString(), "2026-10-11T12:10:00.000Z");
  assert.equal(
    (
      await repo.getNextScheduledReviewAt({ userId, wordSetId: set.id, now })
    ).toISOString(),
    state.dueAt.toISOString(),
  );
});

test("an imported New projection stays in its word's exercise round", async () => {
  const set = await makeSet(2);
  await client.query(
    `INSERT INTO fsrs_card_state (user_id,study_card_id,due_at,state,reps,scheduler_version)
    SELECT $1,card.id,'2026-01-01',0,0,'ts-fsrs@5.4.2:gooseberry-v1' FROM study_card card
    WHERE word_set_item_id=$2 AND template_key='recognition'`,
    [userId, set.items[1].id],
  );
  const cards = await queue(set);
  assert.deepEqual(
    cards.map((card) => [card.wordSetItemId, card.templateKey]),
    [
      [set.items[0].id, "recognition"],
      [set.items[1].id, "production"],
      [set.items[0].id, "production"],
      [set.items[1].id, "type_answer"],
      [set.items[0].id, "type_answer"],
      [set.items[1].id, "recognition"],
    ],
  );
});

test("saving review-button preferences alone preserves daily settings", async () => {
  await settings(7, "Europe/Berlin");
  await profiles.updateUserPreferences({ userId, reviewMode: "full" });
  const profile = await profiles.getUserProfile(userId);
  assert.deepEqual(profile.preferences, {
    reviewMode: "full",
    newWordsPerDay: 7,
    studyTimeZone: "Europe/Berlin",
  });
});

test("imported studied words keep their siblings without consuming today's new-word allowance", async () => {
  const set = await makeSet(3);
  await settings(1);
  const [job] = (
    await client.query(
      `INSERT INTO anki_import_job (user_id,request_key,request_hash,file_name,file_size,file_sha256,name,source_lang,target_lang,mapping,package_metadata)
    VALUES ($1,gen_random_uuid(),'hash','test.apkg',100,'sha','Imported','fi','en','[]','{}') RETURNING id`,
      [userId],
    )
  ).rows;
  const [card] = (
    await client.query(
      "SELECT id FROM study_card WHERE word_set_item_id=$1 AND template_key='recognition'",
      [set.items[0].id],
    )
  ).rows;
  const fsrs = load("@/lib/review/fsrs");
  const baseline = {
    ...fsrs.createInitialFsrsState(now),
    dueAt: new Date("2026-10-12T12:00:00Z"),
    state: 2,
    reps: 10,
    stability: 10,
    difficulty: 5,
  };
  await client.query(
    `INSERT INTO study_card_import_baseline (user_id,study_card_id,import_job_id,source_card_id,baseline_state)
    VALUES ($1,$2,$3,'source-card',$4)`,
    [userId, card.id, job.id, fsrs.serializeFsrsState(baseline)],
  );
  const cards = await queue(set);
  assert.deepEqual(
    new Set(wordIds(cards)),
    new Set(set.items.slice(0, 2).map((item) => item.id)),
  );
  await answer(
    set,
    cards.find((entry) => entry.wordSetItemId === set.items[0].id),
  );
  assert(
    (await queue(set)).some((entry) => entry.wordSetItemId === set.items[1].id),
  );
  assert(
    !(await queue(set)).some(
      (entry) => entry.wordSetItemId === set.items[2].id,
    ),
  );
});
