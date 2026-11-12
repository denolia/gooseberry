import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createPostgresFixture } from "./helpers/postgres.mjs";

const fixture = await createPostgresFixture();
const { client, load } = fixture;
const repo = load("@/db/reviewRepo");
const activity = load("@/db/studyActivityRepo");
const userId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-11-10T12:00:00Z");
const sessionId = crypto.randomUUID();

beforeEach(async () => {
  await client.exec("TRUNCATE app_user CASCADE");
  await client.query(
    "INSERT INTO app_user (id,provider,provider_user_id) VALUES ($1,'test','one'),($2,'test','two')",
    [userId, otherId],
  );
});
after(() => fixture.close());

async function makeSet() {
  const [set] = (
    await client.query(
      "INSERT INTO word_set (user_id,name,source_lang,target_lang) VALUES ($1,'Words','de','en') RETURNING id",
      [userId],
    )
  ).rows;
  const [item] = (
    await client.query(
      "INSERT INTO word_set_item (word_set_id,anki_note_guid,original,translation,word_forms,position,created_at) VALUES ($1,'guid','Wort','word','Wörter',0,'2026-01-01T00:00:00Z') RETURNING id",
      [set.id],
    )
  ).rows;
  await load("@/db/studyCardRepo").ensureStudyCards(userId, set.id);
  await client.query(
    "UPDATE study_card SET created_at='2026-01-01T00:00:00Z' WHERE word_set_item_id=$1",
    [item.id],
  );
  set.itemId = item.id;
  set.cards = Object.fromEntries(
    (
      await client.query(
        "SELECT id,template_key FROM study_card WHERE word_set_item_id=$1",
        [item.id],
      )
    ).rows.map((card) => [card.template_key, card.id]),
  );
  return set;
}
function submission(set, template = "recognition", at = now) {
  return {
    userId,
    wordSetId: set.id,
    studyCardId: set.cards[template],
    reviewEventId: crypto.randomUUID(),
    exposureId: crypto.randomUUID(),
    sessionId,
    rating: 3,
    reviewedAt: at,
    now: at,
  };
}
const undo = (input, extra = {}) =>
  repo.undoReview({
    ...input,
    replacementExposureId: crypto.randomUUID(),
    ...extra,
  });
const snapshot = (at = now) => activity.getStudyActivity(userId, at);
const queue = (set) =>
  repo.getDueReviewCards({ userId, wordSetId: set.id, now, limit: 50 });

test("undo restores New state, removes credit and prerequisites, and survives projection loss and content deletion", async () => {
  const set = await makeSet();
  const input = submission(set);
  await repo.recordReview(input);
  assert((await queue(set)).some((card) => card.templateKey === "production"));
  const exposedAt = (
    await client.query(
      "SELECT last_exposed_at FROM word_set_item WHERE id=$1",
      [set.itemId],
    )
  ).rows[0].last_exposed_at;
  const restored = await undo(input);
  assert.equal(restored.card.state.reps, 0);
  assert.equal(restored.card.state.state, 0);
  assert.equal(
    restored.card.state.dueAt.toISOString(),
    "2026-01-01T00:00:00.000Z",
  );
  assert.equal(restored.exposure.repsBefore, 0);
  assert.equal((await snapshot()).today.completions, 0);
  assert.equal((await snapshot()).currentStreak, 0);
  assert.equal((await snapshot()).longestStreak, 0);
  assert.equal(
    await activity.getStudyActivityCredit(userId, input.reviewEventId),
    null,
  );
  assert(!(await queue(set)).some((card) => card.templateKey === "production"));
  assert.equal(
    (await client.query("SELECT count(*) FROM review_event")).rows[0].count,
    1,
  );
  assert.equal(
    (await client.query("SELECT count(*) FROM study_activity")).rows[0].count,
    1,
  );
  assert.deepEqual(
    (
      await client.query(
        "SELECT last_exposed_at FROM word_set_item WHERE id=$1",
        [set.itemId],
      )
    ).rows[0].last_exposed_at,
    exposedAt,
  );
  await client.query("DELETE FROM fsrs_card_state WHERE study_card_id=$1", [
    input.studyCardId,
  ]);
  assert.equal(
    (await queue(set)).find((card) => card.id === input.studyCardId).state.reps,
    0,
  );
  await client.query("DELETE FROM word_set WHERE id=$1", [set.id]);
  assert.equal((await snapshot()).today.completions, 0);
});

test("correction uses a fresh presentation; the old UUID and presentation cannot recreate the answer", async () => {
  const set = await makeSet();
  const input = submission(set);
  await repo.recordReview(input);
  const restored = await undo(input);
  await assert.rejects(repo.recordReview(input), repo.ReviewUndoneError);
  await assert.rejects(
    repo.recordReview({ ...input, reviewEventId: crypto.randomUUID() }),
    repo.ReviewUndoneError,
  );
  await repo.recordReview({
    ...input,
    reviewEventId: crypto.randomUUID(),
    exposureId: restored.exposure.id,
    rating: 1,
  });
  assert.equal((await snapshot()).today.completions, 1);
  assert.equal(
    (
      await client.query(
        "SELECT reps FROM fsrs_card_state WHERE study_card_id=$1",
        [input.studyCardId],
      )
    ).rows[0].reps,
    1,
  );
});

test("undo arriving before both display and grade prevents delayed writes from restoring credit", async () => {
  const set = await makeSet();
  const input = submission(set);
  const restored = await undo(input);
  assert.equal(restored.card.state.reps, 0);
  await assert.rejects(repo.recordReview(input), repo.ReviewUndoneError);
  await assert.rejects(
    repo.activateReviewCard(input),
    repo.ReviewCardNotDueError,
  );
  assert.equal((await snapshot()).today.completions, 0);
  assert.equal(
    (await client.query("SELECT count(*) FROM review_event")).rows[0].count,
    0,
  );
});

test("undo cancels an activated, pending grade and repeated undo requests return the same receipt", async () => {
  const set = await makeSet();
  const input = submission(set);
  await repo.activateReviewCard(input);
  const restored = await undo(input);
  const retry = await undo(input);
  assert.equal(retry.exposure.id, restored.exposure.id);
  assert.deepEqual(retry.card.state, restored.card.state);
  assert.equal(
    (await client.query("SELECT count(*) FROM study_review_undo")).rows[0]
      .count,
    1,
  );
  await assert.rejects(repo.recordReview(input), repo.ReviewUndoneError);
});

test("a later sibling must be undone before its prerequisite; conflicts leave every table unchanged", async () => {
  const set = await makeSet();
  const recognition = submission(set);
  await repo.recordReview(recognition);
  const production = submission(set, "production");
  await repo.recordReview(production);
  await assert.rejects(undo(recognition), repo.ReviewWriteConflictError);
  assert.equal((await snapshot()).today.completions, 2);
  assert.equal(
    (await client.query("SELECT count(*) FROM study_review_undo")).rows[0]
      .count,
    0,
  );
  await undo(production);
  await undo(recognition);
  assert.equal((await snapshot()).today.completions, 0);
  assert.deepEqual(
    (await queue(set)).map((card) => card.templateKey),
    ["recognition"],
  );
});

test("multiple answers of the same exercise unwind one by one without undoing earlier sessions", async () => {
  const set = await makeSet();
  const first = submission(set);
  const initial = await repo.recordReview(first);
  const second = submission(
    set,
    "recognition",
    new Date(initial.dueAt.getTime() + 1000),
  );
  await repo.recordReview(second);
  const restored = await undo(second);
  assert.deepEqual(restored.card.state, initial);
  await undo(first);
  assert.equal((await snapshot()).today.completions, 0);
});

test("undo validates ownership, session and the exact original submission", async () => {
  const set = await makeSet();
  const input = submission(set);
  await repo.recordReview(input);
  for (const extra of [
    { userId: otherId },
    { sessionId: crypto.randomUUID() },
    { rating: 4 },
    { exposureId: crypto.randomUUID() },
  ])
    await assert.rejects(
      undo(input, extra),
      (error) =>
        error instanceof repo.ReviewWriteConflictError ||
        error instanceof repo.ReviewCardNotFoundError,
    );
  assert.equal((await snapshot()).today.completions, 1);
  assert.equal(
    (await client.query("SELECT count(*) FROM study_review_undo")).rows[0]
      .count,
    0,
  );
});

test("undo removes credit from its original day across 2 am; correction earns credit on its new day", async () => {
  const set = await makeSet();
  const input = submission(
    set,
    "recognition",
    new Date("2026-11-10T01:59:00Z"),
  );
  await repo.recordReview(input);
  const at = new Date("2026-11-10T02:01:00Z");
  const restored = await undo(input, { now: at });
  assert.equal(
    (await snapshot(at)).days.find((day) => day.date === "2026-11-09")
      .completions,
    0,
  );
  await repo.recordReview({
    ...input,
    reviewEventId: crypto.randomUUID(),
    exposureId: restored.exposure.id,
    reviewedAt: at,
    now: at,
  });
  assert.equal((await snapshot(at)).today.completions, 1);
  assert.equal(
    (await snapshot(at)).days.find((day) => day.date === "2026-11-09")
      .completions,
    0,
  );
});

test("undo reverses a leaf threshold and retains other completion receipts", async () => {
  const set = await makeSet();
  await client.query(
    `INSERT INTO study_activity (review_id,user_id,completed_at,credited_date,study_time_zone,template_key,study_card_id,word_set_item_id,word_set_id)
    SELECT gen_random_uuid(),$1,$2,'2026-11-10','UTC','recognition',gen_random_uuid(),gen_random_uuid(),gen_random_uuid() FROM generate_series(1,19)`,
    [userId, now],
  );
  const input = submission(set);
  await repo.recordReview(input);
  assert.equal((await snapshot()).totalLeaves, 1);
  await undo(input);
  assert.equal((await snapshot()).totalLeaves, 0);
  assert.equal((await snapshot()).today.progress, 19);
});

test("a grade racing undo cannot survive cancellation", async () => {
  const set = await makeSet();
  const input = submission(set);
  const results = await Promise.allSettled([
    repo.recordReview(input),
    undo(input),
  ]);
  assert.equal(results[1].status, "fulfilled");
  assert.equal((await snapshot()).today.completions, 0);
  assert.equal(
    (
      await client.query(
        "SELECT reps FROM fsrs_card_state WHERE study_card_id=$1",
        [input.studyCardId],
      )
    ).rows[0].reps,
    0,
  );
  await assert.rejects(repo.recordReview(input), repo.ReviewUndoneError);
});

test("undo preserves a native schedule earned in an earlier session", async () => {
  const set = await makeSet();
  const earlier = { ...submission(set), sessionId: crypto.randomUUID() };
  const baseline = await repo.recordReview(earlier);
  const current = submission(
    set,
    "recognition",
    new Date(baseline.dueAt.getTime() + 1000),
  );
  await repo.recordReview(current);
  const restored = await undo(current);
  assert.deepEqual(restored.card.state, baseline);
  assert.equal((await snapshot()).today.completions, 1);
  assert.equal(
    (await client.query("SELECT review_id FROM study_review_undo")).rows[0]
      .review_id,
    current.reviewEventId,
  );
});

test("undo of an unavailable unsaved prompt cannot grant an introduction or allowance bypass", async () => {
  const set = await makeSet();
  await assert.rejects(
    undo(submission(set, "production")),
    repo.ReviewWriteConflictError,
  );
  await client.query(
    "INSERT INTO user_preference (user_id,new_words_per_day) VALUES ($1,0)",
    [userId],
  );
  await assert.rejects(undo(submission(set)), repo.ReviewWriteConflictError);
  assert.equal(
    (await client.query("SELECT count(*) FROM study_review_undo")).rows[0]
      .count,
    0,
  );
});

test("retrying an already completed undo acknowledges cancellation without restoring newer progress", async () => {
  const set = await makeSet();
  const input = submission(set);
  await repo.recordReview(input);
  const restored = await undo(input);
  assert.equal(restored.resumable, true);
  const corrected = await repo.recordReview({
    ...input,
    reviewEventId: crypto.randomUUID(),
    exposureId: restored.exposure.id,
  });
  const retry = await undo(input);
  assert.equal(retry.resumable, false);
  assert.deepEqual(retry.card.state, corrected);
  assert.equal((await snapshot()).today.completions, 1);
});

test("an old undo receipt cannot resume a sibling after its prerequisite has also been undone", async () => {
  const set = await makeSet();
  const recognition = submission(set);
  await repo.recordReview(recognition);
  const production = submission(set, "production");
  await repo.recordReview(production);
  await undo(production);
  await undo(recognition);
  assert.equal((await undo(production)).resumable, false);
});
