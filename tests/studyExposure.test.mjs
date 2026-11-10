import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { createPostgresFixture } from "./helpers/postgres.mjs";

const fixture = await createPostgresFixture();
const { client, load } = fixture;
const repo = load("@/db/reviewRepo");
const stats = load("@/db/reviewStatsRepo");
const days = load("@/db/studyDay");
const policy = load("@/lib/review/policy");
const profiles = load("@/db/profileRepo");
const userId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-11-10T12:00:00Z");
const templates = [
  "recognition",
  "production",
  "type_answer",
  "word_forms",
  "example",
];

beforeEach(async () => {
  await client.exec("TRUNCATE app_user CASCADE");
  await client.query(
    "INSERT INTO app_user (id,provider,provider_user_id) VALUES ($1,'test','one'),($2,'test','two')",
    [userId, otherId],
  );
});
after(() => fixture.close());

async function makeSet({ fresh = false } = {}) {
  const [set] = (
    await client.query(
      "INSERT INTO word_set (user_id,name,source_lang,target_lang) VALUES ($1,'Test','de','en') RETURNING id",
      [userId],
    )
  ).rows;
  const [item] = (
    await client.query(
      `INSERT INTO word_set_item
    (word_set_id,anki_note_guid,original,translation,word_forms,sample,sample_translation,position,created_at)
    VALUES ($1,'guid','Wort','word','forms','example','translated example',0,'2026-01-01') RETURNING id`,
      [set.id],
    )
  ).rows;
  const { rows: cards } = await client.query(
    `INSERT INTO study_card (word_set_item_id,template_key,created_at)
    SELECT $1,key,'2026-01-01' FROM (VALUES ('recognition'),('production'),('type_answer'),('word_forms'),('example')) template(key) RETURNING id,template_key`,
    [item.id],
  );
  const result = {
    id: set.id,
    itemId: item.id,
    cards: Object.fromEntries(
      cards.map((card) => [card.template_key, card.id]),
    ),
  };
  if (!fresh) for (const key of templates) await seedState(result, key, 2);
  return result;
}
async function seedState(set, key, state, dueAt = new Date("2026-01-01")) {
  await client.query(
    `INSERT INTO fsrs_card_state (user_id,study_card_id,due_at,state,reps,stability,difficulty,scheduler_version,last_review_at)
    VALUES ($1,$2,$3,$4,$5,10,5,'ts-fsrs@5.4.2:gooseberry-v1','2026-01-01')
    ON CONFLICT (user_id,study_card_id) DO UPDATE SET state=excluded.state,reps=excluded.reps,due_at=excluded.due_at`,
    [userId, set.cards[key], dueAt, state, state === 0 ? 0 : 5],
  );
}
const activate = (set, key, extra = {}) =>
  repo.activateReviewCard({
    userId,
    wordSetId: set.id,
    studyCardId: set.cards[key],
    exposureId: crypto.randomUUID(),
    now,
    ...extra,
  });
const queue = (set, at = now) =>
  repo.getDueReviewCards({ userId, wordSetId: set.id, now: at, limit: 50 });
const grade = (set, opened, extra = {}) =>
  repo.recordReview({
    userId,
    wordSetId: set.id,
    studyCardId: opened.card.id,
    exposureId: opened.exposure.id,
    reviewEventId: crypto.randomUUID(),
    rating: 3,
    reviewedAt: now,
    ...extra,
  });
const marker = async (set) =>
  (
    await client.query(
      "SELECT last_exposed_at FROM word_set_item WHERE id=$1",
      [set.itemId],
    )
  ).rows[0].last_exposed_at;

test("only Review/Relearning vocabulary cards are exposure-sensitive", () => {
  for (const key of templates)
    for (const state of [0, 1, 2, 3]) {
      assert.equal(
        policy.isExposureSensitive(key, state),
        [2, 3].includes(state) && templates.slice(0, 3).includes(key),
        `${key}/${state}`,
      );
    }
});

test("migration backfill uses only the owner's native reviews, across all card types", async () => {
  const native = await makeSet();
  const importedOnly = await makeSet();
  await client.query(
    `INSERT INTO review_event (user_id,study_card_id,rating,reviewed_at,source) VALUES
    ($1,$3,3,'2026-11-09T10:00:00Z','gooseberry'),
    ($1,$4,3,'2026-11-10T09:00:00Z','gooseberry'),
    ($2,$3,3,'2026-11-10T11:00:00Z','gooseberry'),
    ($1,$3,3,'2026-11-10T11:00:00Z','anki'),
    ($1,$5,3,'2026-11-10T11:00:00Z','anki')`,
    [
      userId,
      otherId,
      native.cards.recognition,
      native.cards.example,
      importedOnly.cards.recognition,
    ],
  );
  const migration = readFileSync(
    new URL("../migrations/0013_study_exposure.sql", import.meta.url),
    "utf8",
  );
  await client.exec(migration.split("--> statement-breakpoint").at(-1));
  assert.equal(
    (await marker(native)).toISOString(),
    "2026-11-10T09:00:00.000Z",
  );
  assert.equal(await marker(importedOnly), null);
});

test("direct activation respects the unseen cohort without capping unlocked siblings", async () => {
  await profiles.updateUserPreferences({
    userId,
    reviewMode: "simple",
    newWordsPerDay: 1,
  });
  const set = await makeSet({ fresh: true });
  const [item] = (
    await client.query(
      `INSERT INTO word_set_item
    (word_set_id,anki_note_guid,original,translation,position) VALUES ($1,'second','Haus','house',1) RETURNING id`,
      [set.id],
    )
  ).rows;
  await load("@/db/studyCardRepo").ensureStudyCards(userId, set.id);
  const [hidden] = (
    await client.query(
      "SELECT id FROM study_card WHERE word_set_item_id=$1 AND template_key='recognition'",
      [item.id],
    )
  ).rows;
  await assert.rejects(
    repo.activateReviewCard({
      userId,
      wordSetId: set.id,
      studyCardId: hidden.id,
      exposureId: crypto.randomUUID(),
      now,
    }),
    repo.ReviewCardNotDueError,
  );
  assert.equal(
    (
      await client.query(
        "SELECT last_exposed_at FROM word_set_item WHERE id=$1",
        [item.id],
      )
    ).rows[0].last_exposed_at,
    null,
  );
  const first = await activate(set, "recognition");
  await grade(set, first);
  await activate(set, "production");
  assert.equal(
    (await queue(set)).some((card) => card.id === hidden.id),
    false,
  );
});

test("prefetch and statistics do not record exposure or scheduling events", async () => {
  const set = await makeSet();
  assert.equal((await queue(set)).length, 3);
  await stats.getWordSetReviewStats({ userId, now });
  await repo.getReviewQueueTiming({ userId, wordSetId: set.id, now });
  assert.equal(await marker(set), null);
  assert.equal(
    (await client.query("SELECT count(*) FROM study_exposure")).rows[0].count,
    0,
  );
  assert.equal(
    (await client.query("SELECT count(*) FROM review_event")).rows[0].count,
    0,
  );
});

test("queue selects one sensitive sibling before exclusions and retains exempt cards", async () => {
  const set = await makeSet();
  const cards = await queue(set);
  assert.deepEqual(
    cards.map((card) => card.templateKey),
    ["recognition", "word_forms", "example"],
  );
  const refill = await repo.getDueReviewCards({
    userId,
    wordSetId: set.id,
    now,
    limit: 20,
    excludedStudyCardIds: [set.cards.recognition],
  });
  assert.deepEqual(
    refill.map((card) => card.templateKey),
    ["word_forms", "example"],
  );
  assert.equal(await marker(set), null);
});

test("every card type and phase marks the word and blocks later mature vocabulary repetitions", async (t) => {
  for (const key of templates)
    for (const state of [0, 1, 2, 3])
      await t.test(`${key}/${state}`, async () => {
        const set = await makeSet();
        await seedState(set, key, state);
        await activate(set, key);
        assert.equal((await marker(set)).toISOString(), now.toISOString());
        const target = key === "recognition" ? "production" : "recognition";
        await assert.rejects(
          activate(set, target),
          repo.ReviewWordSeenTodayError,
        );
        assert(
          (await queue(set)).every(
            (card) =>
              !policy.isExposureSensitive(card.templateKey, card.state.state),
          ),
        );
        assert.equal(
          (await client.query("SELECT count(*) FROM review_event")).rows[0]
            .count,
          0,
        );
      });
});

test("New and Learning displays remain allowed after exposure, including the 10-minute return", async () => {
  const set = await makeSet({ fresh: true });
  const introduction = await activate(set, "recognition");
  const state = await grade(set, introduction);
  assert.equal(state.state, 1);
  assert.equal(state.dueAt.toISOString(), "2026-11-10T12:10:00.000Z");
  const production = await activate(set, "production");
  await grade(set, production);
  await activate(set, "type_answer");
  const learning = await activate(set, "recognition", { now: state.dueAt });
  assert.equal(learning.card.state.state, 1);
  assert.equal(learning.card.state.reps, 1);
  assert.notEqual(learning.exposure.id, introduction.exposure.id);
  assert.equal((await marker(set)).toISOString(), state.dueAt.toISOString());
});

test("forms/examples ignore exposure while Review to Relearning remains gated", async () => {
  const set = await makeSet();
  const opened = await activate(set, "recognition");
  const state = await grade(set, opened, { rating: 1 });
  assert.equal(state.state, 3);
  await assert.rejects(
    activate(set, "recognition", { now: state.dueAt }),
    repo.ReviewWordSeenTodayError,
  );
  await activate(set, "word_forms");
  await activate(set, "example");
  const day = await days.getStudyDay(userId, now);
  assert.equal(
    (
      await repo.getRecordedCardAvailableAt({
        userId,
        wordSetId: set.id,
        studyCardId: opened.card.id,
        state,
        studyDay: day,
      })
    ).toISOString(),
    day.nextStartAt.toISOString(),
  );
  const previews = repo.exposureAwareRatingPreviews(
    "recognition",
    [{ rating: 1, dueAt: state.dueAt, intervalMs: 600000, state: 3 }],
    now,
    day,
  );
  assert.equal(previews[0].dueAt.toISOString(), day.nextStartAt.toISOString());
  assert.equal(
    repo
      .exposureAwareRatingPreviews(
        "word_forms",
        previews.map((preview) => ({ ...preview, dueAt: state.dueAt })),
        now,
        day,
      )[0]
      .dueAt.toISOString(),
    state.dueAt.toISOString(),
  );
});

test("authorization retries and grade retries are idempotent and do not block themselves", async () => {
  const set = await makeSet();
  const exposureId = crypto.randomUUID();
  const opened = await activate(set, "recognition", { exposureId });
  const retried = await activate(set, "recognition", { exposureId });
  assert.equal(retried.exposure.id, opened.exposure.id);
  assert.equal(
    (await client.query("SELECT count(*) FROM study_exposure")).rows[0].count,
    1,
  );
  const reviewEventId = crypto.randomUUID();
  const state = await grade(set, opened, { reviewEventId });
  assert.deepEqual(await grade(set, opened, { reviewEventId }), state);
  assert.equal(
    (await client.query("SELECT count(*) FROM review_event")).rows[0].count,
    1,
  );
  await assert.rejects(grade(set, opened), repo.ReviewWriteConflictError);
  await assert.rejects(
    activate(set, "recognition", { exposureId }),
    repo.ReviewWriteConflictError,
  );
});

test("failed grades retain exposure but roll back scheduling and receipt consumption", async () => {
  const set = await makeSet();
  const opened = await activate(set, "recognition");
  await assert.rejects(grade(set, opened, { durationMs: -1 }));
  assert.equal(
    (await client.query("SELECT count(*) FROM review_event")).rows[0].count,
    0,
  );
  assert.equal(
    (
      await client.query(
        "SELECT review_event_id FROM study_exposure WHERE id=$1",
        [opened.exposure.id],
      )
    ).rows[0].review_event_id,
    null,
  );
  assert.equal((await marker(set)).toISOString(), now.toISOString());
  await assert.rejects(
    activate(set, "production"),
    repo.ReviewWordSeenTodayError,
  );
  await grade(set, opened);
});

test("missing or mismatched authorization cannot save a review", async () => {
  const set = await makeSet();
  await assert.rejects(
    repo.recordReview({
      userId,
      wordSetId: set.id,
      studyCardId: set.cards.recognition,
      reviewEventId: crypto.randomUUID(),
      rating: 3,
      reviewedAt: now,
    }),
    repo.ReviewCardNotDueError,
  );
  const opened = await activate(set, "word_forms");
  await assert.rejects(
    grade(set, opened, { studyCardId: set.cards.recognition }),
    repo.ReviewCardNotDueError,
  );
  await assert.rejects(
    activate(set, "recognition", { exposureId: opened.exposure.id }),
    repo.ReviewWriteConflictError,
  );
  await assert.rejects(
    activate(set, "recognition", { userId: otherId }),
    repo.ReviewCardNotFoundError,
  );
});

test("competing tabs cannot both activate sensitive siblings; unrelated notes remain independent", async () => {
  const set = await makeSet();
  const results = await Promise.allSettled([
    activate(set, "recognition"),
    activate(set, "production"),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    1,
  );
  const other = await makeSet();
  await activate(other, "recognition");
  assert.equal(
    (await client.query("SELECT count(*) FROM study_exposure")).rows[0].count,
    2,
  );
});

test("concurrent retries of the same presentation create one authorization", async () => {
  const set = await makeSet();
  const exposureId = crypto.randomUUID();
  const [first, second] = await Promise.all([
    activate(set, "recognition", { exposureId }),
    activate(set, "recognition", { exposureId }),
  ]);
  assert.equal(first.exposure.id, second.exposure.id);
  assert.equal(
    (await client.query("SELECT count(*) FROM study_exposure")).rows[0].count,
    1,
  );
});

test("concurrent retries of one grade commit one event and return the same schedule", async () => {
  const set = await makeSet();
  const opened = await activate(set, "recognition");
  const reviewEventId = crypto.randomUUID();
  const [first, second] = await Promise.all([
    grade(set, opened, { reviewEventId }),
    grade(set, opened, { reviewEventId }),
  ]);
  assert.deepEqual(first, second);
  assert.equal(
    (await client.query("SELECT count(*) FROM review_event")).rows[0].count,
    1,
  );
  assert.equal(
    (
      await client.query(
        "SELECT reps FROM fsrs_card_state WHERE study_card_id=$1",
        [opened.card.id],
      )
    ).rows[0].reps,
    6,
  );
});

test("a grade committed just after the retry's first lookup still returns success", async () => {
  const set = await makeSet();
  const opened = await activate(set, "recognition");
  const reviewEventId = crypto.randomUUID();
  const originalQuery = client.query.bind(client);
  let committed;
  client.query = async (query, ...args) => {
    const result = await originalQuery(query, ...args);
    if (
      !committed &&
      query.includes('from "review_event" inner join "study_card"')
    ) {
      committed = true;
      await grade(set, opened, { reviewEventId });
    }
    return result;
  };
  try {
    const state = await grade(set, opened, { reviewEventId });
    assert.equal(committed, true);
    assert.equal(state.reps, 6);
    assert.equal(
      (await originalQuery("SELECT count(*) FROM review_event")).rows[0].count,
      1,
    );
  } finally {
    client.query = originalQuery;
  }
});

test("a card suspended during authorization is unavailable without falsely marking exposure", async () => {
  const set = await makeSet();
  const originalBatch = fixture.database.batch;
  fixture.database.batch = async (queries) => {
    await client.query("UPDATE study_card SET is_suspended=true WHERE id=$1", [
      set.cards.recognition,
    ]);
    return originalBatch(queries);
  };
  try {
    await assert.rejects(
      activate(set, "recognition"),
      (error) =>
        error instanceof repo.ReviewCardNotDueError &&
        !(error instanceof repo.ReviewWordSeenTodayError),
    );
    assert.equal(await marker(set), null);
    assert.equal(
      (await client.query("SELECT count(*) FROM study_exposure")).rows[0].count,
      0,
    );
  } finally {
    fixture.database.batch = originalBatch;
  }
});

test("queue counts and next availability reflect exposure without changing FSRS state", async () => {
  const set = await makeSet();
  const before = (
    await client.query("SELECT * FROM fsrs_card_state ORDER BY study_card_id")
  ).rows;
  await activate(set, "example");
  assert.deepEqual(
    (await queue(set)).map((card) => card.templateKey),
    ["word_forms", "example"],
  );
  const [summary] = await stats.getWordSetReviewStats({ userId, now });
  assert.equal(summary.cardCount, 5);
  assert.equal(summary.dueCount, 2);
  const timing = await repo.getReviewQueueTiming({
    userId,
    wordSetId: set.id,
    now,
  });
  assert.equal(timing.exposureDeferredCount, 3);
  assert.equal(timing.nextDueAt.toISOString(), "2026-11-11T02:00:00.000Z");
  assert.deepEqual(
    (await client.query("SELECT * FROM fsrs_card_state ORDER BY study_card_id"))
      .rows,
    before,
  );
});

test("the gate releases at local 2 am rather than after 24 hours", async () => {
  await profiles.updateUserPreferences({
    userId,
    reviewMode: "simple",
    studyTimeZone: "Europe/Berlin",
  });
  const set = await makeSet();
  await activate(set, "example", { now: new Date("2026-11-10T00:59:00Z") });
  await assert.rejects(
    activate(set, "recognition", { now: new Date("2026-11-10T00:59:59Z") }),
    repo.ReviewWordSeenTodayError,
  );
  const opened = await activate(set, "recognition", {
    now: new Date("2026-11-10T01:00:00Z"),
  });
  assert.equal(
    opened.studyDay.startAt.toISOString(),
    "2026-11-10T01:00:00.000Z",
  );
  await assert.rejects(
    activate(set, "production", { now: new Date("2026-11-10T01:00:01Z") }),
    repo.ReviewWordSeenTodayError,
  );
});

test("2 am boundaries resolve spring gaps and fall overlaps exactly once", async () => {
  await profiles.updateUserPreferences({
    userId,
    reviewMode: "simple",
    studyTimeZone: "Europe/Berlin",
  });
  const cases = [
    [
      "2026-03-29T00:59:00Z",
      "2026-03-28T01:00:00.000Z",
      "2026-03-29T01:00:00.000Z",
    ],
    [
      "2026-03-29T01:00:00Z",
      "2026-03-29T01:00:00.000Z",
      "2026-03-30T00:00:00.000Z",
    ],
    [
      "2026-10-25T00:30:00Z",
      "2026-10-24T00:00:00.000Z",
      "2026-10-25T01:00:00.000Z",
    ],
    [
      "2026-10-25T01:00:00Z",
      "2026-10-25T01:00:00.000Z",
      "2026-10-26T01:00:00.000Z",
    ],
  ];
  for (const [instant, start, next] of cases) {
    const day = await days.getStudyDay(userId, new Date(instant));
    assert.equal(day.startAt.toISOString(), start);
    assert.equal(day.nextStartAt.toISOString(), next);
  }
});

test("resuming an ungraded prompt after rollover tracks the new day's visibility", async () => {
  const set = await makeSet();
  const exposureId = crypto.randomUUID();
  const first = await activate(set, "recognition", {
    exposureId,
    now: new Date("2026-11-10T01:59:00Z"),
  });
  const resumed = await activate(set, "recognition", {
    exposureId,
    now: new Date("2026-11-10T02:01:00Z"),
  });
  assert.equal(
    resumed.exposure.activatedAt.toISOString(),
    first.exposure.activatedAt.toISOString(),
  );
  assert.equal((await marker(set)).toISOString(), "2026-11-10T02:01:00.000Z");
  await assert.rejects(
    activate(set, "production", { now: new Date("2026-11-10T02:02:00Z") }),
    repo.ReviewWordSeenTodayError,
  );
  await grade(set, resumed, { reviewedAt: new Date("2026-11-10T02:03:00Z") });
});
