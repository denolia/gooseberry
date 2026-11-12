import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { createPostgresFixture } from "./helpers/postgres.mjs";
import { loadSourceModule } from "./helpers/sourceModule.mjs";

const fixture = await createPostgresFixture();
const { client, load } = fixture;
const repo = load("@/db/reviewRepo");
const activity = load("@/db/studyActivityRepo");
const days = load("@/db/studyDay");
const profiles = load("@/db/profileRepo");
const userId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-11-10T12:00:00Z");

beforeEach(async () => {
  await client.exec("TRUNCATE app_user CASCADE");
  await client.query(
    "INSERT INTO app_user (id,provider,provider_user_id) VALUES ($1,'test','one'),($2,'test','two')",
    [userId, otherId],
  );
});
after(() => fixture.close());

async function makeSet(count = 1) {
  const set = (
    await client.query(
      "INSERT INTO word_set (user_id,name,source_lang,target_lang) VALUES ($1,'Words','de','en') RETURNING id",
      [userId],
    )
  ).rows[0];
  await client.query(
    `INSERT INTO word_set_item (word_set_id,anki_note_guid,original,translation,position,created_at)
    SELECT $1, 'guid-'||p, 'word-'||p, 'translation',p,'2026-01-01' FROM generate_series(1,$2::integer) p`,
    [set.id, count],
  );
  await load("@/db/studyCardRepo").ensureStudyCards(userId, set.id);
  await client.query(
    "UPDATE study_card SET created_at='2026-01-01' WHERE word_set_item_id IN (SELECT id FROM word_set_item WHERE word_set_id=$1)",
    [set.id],
  );
  set.cards = (
    await client.query(
      "SELECT card.id,card.word_set_item_id FROM study_card card JOIN word_set_item item ON item.id=card.word_set_item_id WHERE item.word_set_id=$1 AND template_key='recognition' ORDER BY item.position",
      [set.id],
    )
  ).rows;
  return set;
}
async function save(set, index = 0, at = now, extra = {}) {
  const input = {
    userId,
    wordSetId: set.id,
    studyCardId: set.cards[index].id,
    exposureId: crypto.randomUUID(),
    reviewEventId: crypto.randomUUID(),
    rating: 3,
    reviewedAt: at,
    now: at,
    ...extra,
  };
  await repo.recordReview(input);
  return input;
}
async function receipts(count, date, owner = userId) {
  await client.query(
    `INSERT INTO study_activity (review_id,user_id,completed_at,credited_date,study_time_zone,template_key,study_card_id,word_set_item_id,word_set_id)
    SELECT gen_random_uuid(),$1,$2::date + time '12:00',$2::date,'UTC','recognition',gen_random_uuid(),gen_random_uuid(),gen_random_uuid() FROM generate_series(1,$3::integer)`,
    [owner, date, count],
  );
}
const snapshot = () => activity.getStudyActivity(userId, now);

test("19 → 20 → 21 and 39 → 40 are global durable totals across sets, sessions and ratings", async () => {
  const a = await makeSet(12);
  const b = await makeSet(28);
  await client.query(
    "INSERT INTO user_preference (user_id,new_words_per_day) VALUES ($1,100)",
    [userId],
  );
  for (let i = 0; i < 40; i++) {
    await save(i < 12 ? a : b, i < 12 ? i : i - 12, now, {
      rating: (i % 4) + 1,
    });
    if ([19, 20, 21, 39, 40].includes(i + 1)) {
      const result = await snapshot();
      assert.equal(result.today.completions, i + 1);
      assert.equal(result.today.leaves, Math.floor((i + 1) / 20));
      assert.equal(result.today.progress, (i + 1) % 20);
      assert.equal(result.currentStreak, 1);
    }
  }
  assert.equal((await snapshot()).totalLeaves, 2);
});

test("concurrent threshold saves and duplicate retries count exactly once", async () => {
  await receipts(19, "2026-11-10");
  const set = await makeSet(2);
  const inputs = await Promise.all([save(set, 0), save(set, 1)]);
  await Promise.all(
    inputs.flatMap((input) => [
      repo.recordReview(input),
      repo.recordReview(input),
    ]),
  );
  const result = await snapshot();
  assert.equal(result.today.completions, 21);
  assert.equal(result.totalLeaves, 1);
});

test("activity commits atomically; failures, displays, imports and projection rebuilds award nothing", async () => {
  const set = await makeSet();
  const opened = await repo.activateReviewCard({
    userId,
    wordSetId: set.id,
    studyCardId: set.cards[0].id,
    exposureId: crypto.randomUUID(),
    now,
  });
  assert.equal((await snapshot()).today.completions, 0);
  await client.exec(
    "ALTER TABLE study_activity ADD CONSTRAINT reject_activity CHECK (false)",
  );
  try {
    await assert.rejects(save(set, 0, now, { exposureId: opened.exposure.id }));
    assert.equal(
      (await client.query("SELECT count(*) FROM review_event")).rows[0].count,
      0,
    );
    assert.equal(
      (await client.query("SELECT count(*) FROM fsrs_card_state")).rows[0]
        .count,
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
  } finally {
    await client.exec(
      "ALTER TABLE study_activity DROP CONSTRAINT reject_activity",
    );
  }
  await client.query(
    "INSERT INTO review_event (user_id,study_card_id,rating,reviewed_at,source) VALUES ($1,$2,3,$3,'anki')",
    [userId, set.cards[0].id, now],
  );
  await load("@/db/reviewProjectionRepo").ensureReviewProjections(
    userId,
    set.id,
  );
  assert.equal((await snapshot()).totalLeaves, 0);
  assert.equal((await snapshot()).today.completions, 0);
});

test("deleting content preserves activity; account deletion removes it and other users stay isolated", async () => {
  const set = await makeSet();
  await save(set);
  await receipts(40, "2026-11-10", otherId);
  await client.query("DELETE FROM word_set WHERE id=$1", [set.id]);
  assert.equal((await snapshot()).today.completions, 1);
  assert.equal((await activity.getStudyActivity(otherId, now)).totalLeaves, 2);
  await client.query("DELETE FROM app_user WHERE id=$1", [userId]);
  assert.equal(
    (
      await client.query(
        "SELECT count(*) FROM study_activity WHERE user_id=$1",
        [userId],
      )
    ).rows[0].count,
    0,
  );
});

test("a retry after rollover retains its original server-credited day; timestamp skew cannot move rewards", async () => {
  const set = await makeSet();
  const at = new Date("2026-11-10T01:59:59Z");
  const input = await save(set, 0, at, {
    reviewedAt: new Date("2026-11-10T02:00:01Z"),
  });
  const credit = await activity.getStudyActivityCredit(
    userId,
    input.reviewEventId,
  );
  assert.equal(credit.creditedDate, "2026-11-09");
  await repo.recordReview({ ...input, now: new Date("2026-12-01T12:00:00Z") });
  assert.deepEqual(
    await activity.getStudyActivityCredit(userId, input.reviewEventId),
    credit,
  );
  const result = await snapshot();
  assert.equal(result.today.completions, 0);
  assert.equal(result.currentStreak, 1);
  assert.equal(result.days.at(-2).completions, 1);
  const another = await makeSet();
  for (const reviewedAt of [
    new Date(now.getTime() + 300_001),
    new Date(now.getTime() - 86_400_001),
  ]) {
    await assert.rejects(
      save(another, 0, now, { reviewedAt }),
      repo.ReviewCardNotDueError,
    );
  }
});

test("zero-filled bounded calendars, partial days, lifetime leaves and streaks include old history", async () => {
  let result = await snapshot();
  assert.equal(result.days.length, 365);
  assert.equal(result.currentStreak, 0);
  await receipts(40, "2024-01-01");
  for (const date of ["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-09"])
    await receipts(1, date);
  result = await activity.getStudyActivity(userId, now, 7);
  assert.equal(result.days.length, 7);
  assert.equal(result.currentStreak, 1);
  assert.equal(result.longestStreak, 3);
  assert.equal(result.totalLeaves, 2);
  assert.equal(result.days.at(-1).completions, 0);
  await receipts(1, "2026-11-10");
  result = await snapshot();
  assert.equal(result.currentStreak, 2);
  assert.equal(result.longestStreak, 3);
  assert.equal(result.today.progress, 1);
  const westward = await activity.getStudyActivity(
    userId,
    new Date("2026-11-09T12:00:00Z"),
  );
  assert.equal(westward.longestStreak, 3);
  assert.equal(westward.currentStreak, 1);
  assert.equal(
    (await activity.getStudyActivity(userId, new Date("2026-11-12T02:00:00Z")))
      .currentStreak,
    0,
  );
});

test("time-zone changes wait for the old boundary and preserve past attribution", async () => {
  const set = await makeSet();
  const at = new Date("2026-11-10T20:00:00Z");
  const input = await save(set, 0, at);
  await profiles.updateUserPreferences({
    userId,
    studyTimeZone: "Asia/Tokyo",
    now: at,
  });
  const before = await days.getStudyDay(
    userId,
    new Date("2026-11-11T01:59:59Z"),
  );
  assert.equal(before.timeZone, "UTC");
  assert.equal(before.creditedDate, "2026-11-10");
  const after = await days.getStudyDay(
    userId,
    new Date("2026-11-11T02:00:00Z"),
  );
  assert.equal(after.timeZone, "Asia/Tokyo");
  assert.equal(after.startAt.toISOString(), "2026-11-11T02:00:00.000Z");
  assert.equal(after.nextStartAt.toISOString(), "2026-11-11T17:00:00.000Z");
  assert.equal(after.creditedDate, "2026-11-11");
  assert.equal(
    (await activity.getStudyActivityCredit(userId, input.reviewEventId))
      .timeZone,
    "UTC",
  );
  // Saving unrelated settings or the same pending zone must not postpone it.
  await profiles.updateUserPreferences({
    userId,
    studyTimeZone: "Asia/Tokyo",
    newWordsPerDay: 5,
    now: new Date("2026-11-11T01:00:00Z"),
  });
  assert.equal(
    (await days.getStudyDay(userId, new Date("2026-11-11T02:00:00Z"))).timeZone,
    "Asia/Tokyo",
  );
});

test("travel west can repeat a credited date without splitting credit or inventing streak days", async () => {
  const at = new Date("2026-11-10T20:00:00Z");
  await receipts(19, "2026-11-10");
  await profiles.updateUserPreferences({
    userId,
    studyTimeZone: "America/Los_Angeles",
    now: at,
  });
  const day = await days.getStudyDay(userId, new Date("2026-11-11T02:00:00Z"));
  assert.equal(day.creditedDate, "2026-11-10");
  assert.equal(day.startAt.toISOString(), "2026-11-11T02:00:00.000Z");
  assert.equal(day.nextStartAt.toISOString(), "2026-11-11T10:00:00.000Z");
  const set = await makeSet();
  await save(set, 0, new Date("2026-11-11T03:00:00Z"));
  const result = await activity.getStudyActivity(
    userId,
    new Date("2026-11-11T03:00:00Z"),
  );
  assert.equal(result.today.completions, 20);
  assert.equal(result.totalLeaves, 1);
  assert.equal(result.currentStreak, 1);
});

test("spring gaps and later fall 2 am share the same credited date boundaries", async () => {
  await client.query(
    "INSERT INTO user_preference (user_id,study_time_zone) VALUES ($1,'Europe/Berlin')",
    [userId],
  );
  const cases = [
    ["2026-03-29T00:59:59Z", "2026-03-28"],
    ["2026-03-29T01:00:00Z", "2026-03-29"],
    ["2026-10-25T00:59:59Z", "2026-10-24"],
    ["2026-10-25T01:00:00Z", "2026-10-25"],
  ];
  for (const [instant, date] of cases) {
    const set = await makeSet();
    const input = await save(set, 0, new Date(instant));
    assert.equal(
      (await activity.getStudyActivityCredit(userId, input.reviewEventId))
        .creditedDate,
      date,
    );
  }
});

test("native backfill is idempotent and excludes foreign ownership and imported logs", async () => {
  const set = await makeSet();
  await client.query(
    "INSERT INTO user_preference (user_id,study_time_zone) VALUES ($1,'Europe/Berlin')",
    [userId],
  );
  await client.query(
    `INSERT INTO review_event (user_id,study_card_id,rating,reviewed_at,source) VALUES
    ($1,$3,3,'2026-10-25T00:30:00Z','gooseberry'),($1,$3,3,'2026-10-25T01:30:00Z','gooseberry'),
    ($2,$3,3,'2026-11-10T12:00:00Z','gooseberry'),($1,$3,3,'2026-11-10T12:00:00Z','anki')`,
    [userId, otherId, set.cards[0].id],
  );
  const backfill = readFileSync(
    new URL("../migrations/0016_study_activity.sql", import.meta.url),
    "utf8",
  )
    .split("--> statement-breakpoint")
    .at(-1);
  await client.exec(backfill);
  await client.exec(backfill);
  const rows = (
    await client.query(
      "SELECT credited_date::text AS date FROM study_activity ORDER BY credited_date",
    )
  ).rows;
  assert.deepEqual(rows, [{ date: "2026-10-24" }, { date: "2026-10-25" }]);
});

test("activity API authenticates, bounds ranges, isolates users and returns private uncached data", async () => {
  await receipts(1, "2026-11-10", otherId);
  const route = (session) =>
    loadSourceModule("src/app/api/study/activity/route.ts", {
      "next/server": { NextResponse: Response },
      "@/auth": { auth: async () => session },
      "@/db/studyActivityRepo": activity,
    });
  assert.equal(
    (await route(null).GET(new Request("http://localhost/api/study/activity")))
      .status,
    401,
  );
  const api = route({ user: { id: userId } });
  for (const query of [
    "days=0",
    "days=366",
    "days=1.5",
    "days=abc",
    "days=",
    "days=1&days=2",
  ])
    assert.equal(
      (
        await api.GET(
          new Request(`http://localhost/api/study/activity?${query}`),
        )
      ).status,
      400,
    );
  const response = await api.GET(
    new Request("http://localhost/api/study/activity?days=7"),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const body = await response.json();
  assert.equal(body.days.length, 7);
  assert.equal(body.totalLeaves, 0);
  assert(body.days.every((day) => day.completions === 0));
});

test("successive travel changes preserve the clipped active day until its next boundary", async () => {
  await profiles.updateUserPreferences({
    userId,
    studyTimeZone: "Asia/Tokyo",
    now: new Date("2026-11-10T20:00:00Z"),
  });
  const instant = new Date("2026-11-11T03:00:00Z");
  const before = await days.getStudyDay(userId, instant);
  await profiles.updateUserPreferences({
    userId,
    studyTimeZone: "America/Los_Angeles",
    now: instant,
  });
  const pending = await days.getStudyDay(userId, instant);
  assert.deepEqual(pending, before);
  const active = await days.getStudyDay(userId, before.nextStartAt);
  assert.equal(active.timeZone, "America/Los_Angeles");
  assert.equal(active.startAt.toISOString(), before.nextStartAt.toISOString());
});

test("reusing a review UUID for a different grade or presentation never awards more activity", async () => {
  const set = await makeSet(2);
  const input = await save(set);
  await assert.rejects(
    repo.recordReview({ ...input, rating: 1 }),
    repo.ReviewWriteConflictError,
  );
  await assert.rejects(
    repo.recordReview({ ...input, studyCardId: set.cards[1].id }),
    repo.ReviewWriteConflictError,
  );
  assert.equal((await snapshot()).today.completions, 1);
});
