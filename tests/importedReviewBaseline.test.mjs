import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createPostgresFixture } from "./helpers/postgres.mjs";

const fixture = await createPostgresFixture();
const { client, load } = fixture;
const repo = load("@/db/reviewRepo");
const stats = load("@/db/reviewStatsRepo");
const fsrs = load("@/lib/review/fsrs");
const userId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-06-01T12:00:00.000Z");
const baseline = {
  dueAt: now,
  stability: 12,
  difficulty: 5,
  elapsedDays: 30,
  scheduledDays: 30,
  learningSteps: 0,
  reps: 30,
  lapses: 2,
  state: 2,
  lastReviewAt: new Date("2026-05-01T12:00:00.000Z"),
  schedulerVersion: "imported-source-v1",
};
beforeEach(async () => {
  await client.exec("TRUNCATE app_user CASCADE");
  await client.query(
    "INSERT INTO app_user (id,provider,provider_user_id) VALUES ($1,'test','one'),($2,'test','two')",
    [userId, otherId],
  );
});
after(() => fixture.close());

async function importedCard(state = baseline) {
  const [job] = (
    await client.query(
      `INSERT INTO anki_import_job (user_id,request_key,request_hash,file_name,file_size,file_sha256,
       name,source_lang,target_lang,mapping,package_metadata)
     VALUES ($1,gen_random_uuid(),'hash','test.apkg',100,'sha','Imported','fi','ru','[]','{}') RETURNING id`,
      [userId],
    )
  ).rows;
  const [set] = (
    await client.query(
      "INSERT INTO word_set (user_id,name,source_lang,target_lang) VALUES ($1,'Imported','fi','ru') RETURNING id",
      [userId],
    )
  ).rows;
  const [item] = (
    await client.query(
      `INSERT INTO word_set_item (word_set_id,anki_note_guid,original,translation,position,created_at)
     VALUES ($1,'new-export-guid','kissa','кот',0,$2) RETURNING id`,
      [set.id, now],
    )
  ).rows;
  await client.query(
    `INSERT INTO study_card (word_set_item_id,template_key,created_at)
     SELECT $1,key,$2 FROM (VALUES ('recognition'),('production'),('word_forms'),('type_answer'),('example')) template(key)`,
    [item.id, now],
  );
  const [card] = (
    await client.query(
      "SELECT id FROM study_card WHERE word_set_item_id=$1 AND template_key='recognition'",
      [item.id],
    )
  ).rows;
  await client.query(
    `INSERT INTO study_card_import_baseline (user_id,study_card_id,import_job_id,source_card_id,baseline_state)
     VALUES ($1,$2,$3,'9007199254740999',$4)`,
    [userId, card.id, job.id, fsrs.serializeFsrsState(state)],
  );
  return { cardId: card.id, setId: set.id, itemId: item.id, jobId: job.id };
}
const due = (setId, at = now) =>
  repo.getDueReviewCards({ userId, wordSetId: setId, now: at, limit: 50 });

test("a missing imported projection retains future due date and counters in queue and stats", async () => {
  const state = { ...baseline, dueAt: new Date("2026-06-10T12:00:00.000Z") };
  const card = await importedCard(state);
  await assert.rejects(
    repo.recordReview({
      userId,
      wordSetId: card.setId,
      studyCardId: card.cardId,
      reviewEventId: crypto.randomUUID(),
      rating: 3,
      reviewedAt: now,
    }),
    repo.ReviewCardNotDueError,
  );
  const cards = await due(card.setId);
  assert(!cards.some((entry) => entry.id === card.cardId));
  assert.deepEqual(cards.map((entry) => entry.templateKey).sort(), [
    "production",
    "type_answer",
  ]);
  const [summary] = await stats.getWordSetItemReviewStats({
    userId,
    wordSetId: card.setId,
    now,
  });
  assert.equal(summary.cardCount, 3);
  assert.equal(summary.dueCount, 2);
  assert.equal(summary.reps, 30);
  assert.equal(summary.lapses, 2);
  assert.equal(
    (await stats.getWordSetReviewStats({ userId, now }))[0].dueCount,
    2,
  );
  assert.equal(
    (await client.query("SELECT count(*) FROM review_event")).rows[0].count,
    0,
  );
  const available = (await due(card.setId, state.dueAt)).find(
    (entry) => entry.id === card.cardId,
  );
  assert.equal(available.state.reps, 30);
  assert.equal(available.state.dueAt.toISOString(), state.dueAt.toISOString());
});

test("the first actual review seeds from imported progress without inventing source events", async () => {
  const card = await importedCard();
  const reviewEventId = crypto.randomUUID();
  const state = await repo.recordReview({
    userId,
    wordSetId: card.setId,
    studyCardId: card.cardId,
    reviewEventId,
    rating: 3,
    reviewedAt: now,
  });
  assert.deepEqual(state, fsrs.applyReview(baseline, 3, now));
  assert.equal(state.reps, 31);
  assert.equal(state.lapses, 2);
  const events = (await client.query("SELECT source FROM review_event")).rows;
  assert.deepEqual(events, [{ source: "gooseberry" }]);
  assert.deepEqual(
    (
      await client.query(
        "SELECT baseline_state FROM study_card_import_baseline",
      )
    ).rows[0].baseline_state,
    fsrs.serializeFsrsState(baseline),
  );
  await client.query("DELETE FROM fsrs_card_state WHERE study_card_id=$1", [
    card.cardId,
  ]);
  const repeated = await repo.recordReview({
    userId,
    wordSetId: card.setId,
    studyCardId: card.cardId,
    reviewEventId,
    rating: 3,
    reviewedAt: now,
  });
  assert.deepEqual(repeated, state);
  assert.equal(
    (await client.query("SELECT count(*) FROM review_event")).rows[0].count,
    1,
  );
  const sibling = (await due(card.setId)).find(
    (entry) => entry.templateKey === "production",
  );
  assert.equal(sibling.state.reps, 0);
});

test("scheduler rebuild and projection loss replay only owned Gooseberry events after baseline", async () => {
  const card = await importedCard();
  const expected = fsrs.applyReview(baseline, 3, now);
  await client.query(
    `INSERT INTO review_event (user_id,study_card_id,rating,reviewed_at,source)
     VALUES ($1,$2,3,$3,'gooseberry'),($1,$2,1,$3,'anki'),($4,$2,4,$3,'gooseberry')`,
    [userId, card.cardId, now, otherId],
  );
  await client.query(
    `INSERT INTO fsrs_card_state (user_id,study_card_id,due_at,scheduler_version,revision)
     VALUES ($1,$2,$3,'outdated-scheduler',7)`,
    [userId, card.cardId, now],
  );
  const tomorrow = new Date("2026-06-02T12:00:00.000Z");
  assert(
    !(await due(card.setId, tomorrow)).some(
      (entry) => entry.id === card.cardId,
    ),
  );
  let projection = (
    await client.query("SELECT * FROM fsrs_card_state WHERE study_card_id=$1", [
      card.cardId,
    ])
  ).rows[0];
  assert.equal(projection.reps, 31);
  assert.equal(projection.revision, 8);
  assert.equal(projection.scheduler_version, fsrs.FSRS_SCHEDULER_VERSION);
  assert.equal(projection.due_at.toISOString(), expected.dueAt.toISOString());
  await client.query("DELETE FROM fsrs_card_state WHERE study_card_id=$1", [
    card.cardId,
  ]);
  const [summary] = await stats.getWordSetItemReviewStats({
    userId,
    wordSetId: card.setId,
    now: tomorrow,
  });
  assert.equal(summary.reps, 31);
  assert.equal(summary.dueCount, 2);
  projection = (
    await client.query("SELECT * FROM fsrs_card_state WHERE study_card_id=$1", [
      card.cardId,
    ])
  ).rows[0];
  assert.equal(projection.due_at.toISOString(), expected.dueAt.toISOString());
  assert.equal(
    (await client.query("SELECT count(*) FROM review_event")).rows[0].count,
    3,
  );
  assert.equal(
    (await client.query("SELECT count(*) FROM study_card_import_baseline"))
      .rows[0].count,
    1,
  );
});

test("suspended and buried directions keep history but do not become due until available", async () => {
  const card = await importedCard();
  const tomorrow = new Date("2026-06-02T12:00:00.000Z");
  await client.query("UPDATE study_card SET is_suspended=true WHERE id=$1", [
    card.cardId,
  ]);
  await client.query(
    "UPDATE study_card SET buried_until=$1 WHERE word_set_item_id=$2 AND template_key='production'",
    [tomorrow, card.itemId],
  );
  assert.deepEqual(
    (await due(card.setId)).map((entry) => entry.templateKey),
    ["type_answer"],
  );
  const [summary] = await stats.getWordSetReviewStats({ userId, now });
  assert.equal(summary.cardCount, 3);
  assert.equal(summary.dueCount, 1);
  for (const entry of (
    await client.query(
      "SELECT id FROM study_card WHERE word_set_item_id=$1 AND template_key IN ('recognition','production')",
      [card.itemId],
    )
  ).rows) {
    await assert.rejects(
      repo.recordReview({
        userId,
        wordSetId: card.setId,
        studyCardId: entry.id,
        reviewEventId: crypto.randomUUID(),
        rating: 3,
        reviewedAt: now,
      }),
      repo.ReviewCardNotDueError,
    );
  }
  assert.deepEqual(
    (await due(card.setId, tomorrow)).map((entry) => entry.templateKey).sort(),
    ["production", "type_answer"],
  );
  await client.query("DELETE FROM word_set_item WHERE id=$1", [card.itemId]);
  assert.equal(
    (await client.query("SELECT count(*) FROM study_card_import_baseline"))
      .rows[0].count,
    0,
  );
});

test("projection repair cannot overwrite an actual review committed during recovery", async () => {
  const card = await importedCard();
  await client.query(
    "INSERT INTO fsrs_card_state (user_id,study_card_id,due_at,scheduler_version,revision) VALUES ($1,$2,$3,'outdated',0)",
    [userId, card.cardId, now],
  );
  const originalQuery = client.query.bind(client);
  let injected = false;
  client.query = async (query, ...args) => {
    if (
      !injected &&
      query.includes("WITH data AS") &&
      query.includes("INSERT INTO fsrs_card_state")
    ) {
      injected = true;
      await repo.recordReview({
        userId,
        wordSetId: card.setId,
        studyCardId: card.cardId,
        reviewEventId: crypto.randomUUID(),
        rating: 3,
        reviewedAt: now,
      });
    }
    return originalQuery(query, ...args);
  };
  try {
    const [summary] = await stats.getWordSetItemReviewStats({
      userId,
      wordSetId: card.setId,
      now,
    });
    assert(injected);
    assert.equal(summary.reps, 31);
    const projection = (
      await originalQuery(
        "SELECT * FROM fsrs_card_state WHERE study_card_id=$1",
        [card.cardId],
      )
    ).rows[0];
    assert.equal(projection.revision, 1);
    assert.equal(projection.reps, 31);
  } finally {
    client.query = originalQuery;
  }
});
