import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createPostgresFixture } from "./helpers/postgres.mjs";
import { loadSourceModule } from "./helpers/sourceModule.mjs";

const fixture = await createPostgresFixture();
const { client, load } = fixture;
const repo = load("@/db/reviewRepo");
const stats = load("@/db/reviewStatsRepo");
const scopes = load("@/db/studyScope");
const query = load("@/lib/review/scope");
const userId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-11-11T12:00:00Z");
const all = { kind: "all" };
const selected = (...sets) => ({
  kind: "sets",
  setIds: sets.map((set) => set.id).sort(),
});

beforeEach(async () => {
  await client.exec("TRUNCATE app_user CASCADE");
  await client.query(
    "INSERT INTO app_user (id,provider,provider_user_id) VALUES ($1,'test','one'),($2,'test','two')",
    [userId, otherId],
  );
});
after(() => fixture.close());

async function makeSet({
  count = 1,
  owner = userId,
  source = "de",
  target = "en",
  offset = 0,
} = {}) {
  const [set] = (
    await client.query(
      "INSERT INTO word_set (user_id,name,source_lang,target_lang) VALUES ($1,$2,$3,$4) RETURNING id",
      [owner, `${source} vocabulary`, source, target],
    )
  ).rows;
  const items = (
    await client.query(
      `INSERT INTO word_set_item (word_set_id,anki_note_guid,original,translation,word_forms,sample,sample_translation,position,created_at)
    SELECT $1, 'guid-'||p, 'word-'||p, 'translation', 'forms', 'example', 'translated example', $3::integer + p*10, '2026-01-01'
    FROM generate_series(0,$2::integer-1) p RETURNING id,position`,
      [set.id, count, offset],
    )
  ).rows.sort((a, b) => a.position - b.position);
  await load("@/db/studyCardRepo").ensureStudyCards(owner, set.id);
  await client.query(
    "UPDATE study_card SET created_at='2026-01-01' WHERE word_set_item_id IN (SELECT id FROM word_set_item WHERE word_set_id=$1)",
    [set.id],
  );
  const cards = (
    await client.query(
      "SELECT id,word_set_item_id,template_key FROM study_card WHERE word_set_item_id IN (SELECT id FROM word_set_item WHERE word_set_id=$1)",
      [set.id],
    )
  ).rows;
  return { ...set, items, cards, owner };
}
const cardFor = (set, key, index = 0) =>
  set.cards.find(
    (card) =>
      card.word_set_item_id === set.items[index].id &&
      card.template_key === key,
  );
async function seed(
  set,
  key,
  state,
  dueAt = new Date("2026-01-01"),
  index = 0,
) {
  const card = cardFor(set, key, index);
  await client.query(
    `INSERT INTO fsrs_card_state (user_id,study_card_id,due_at,state,reps,stability,difficulty,scheduler_version,last_review_at)
    VALUES ($1,$2,$3,$4,$5,10,5,'ts-fsrs@5.4.2:gooseberry-v1','2026-01-01')`,
    [set.owner, card.id, dueAt, state, state === 0 ? 0 : 5],
  );
  return card;
}
const queue = (scope = all, extra = {}) =>
  repo.getDueReviewCards({ userId, scope, now, limit: 50, ...extra });
const route = (path, session = { user: { id: userId } }) =>
  loadSourceModule(`src/app/api/study/${path}/route.ts`, {
    "next/server": { NextResponse: Response },
    "@/auth": { auth: async () => session },
    "@/db/reviewRepo": repo,
    "@/db/studyScope": scopes,
    "@/db/studyDay": load("@/db/studyDay"),
    "@/db/studyExposureRepo": load("@/db/studyExposureRepo"),
    "@/db/studyActivityRepo": load("@/db/studyActivityRepo"),
  });
const getQueue = (search = "") =>
  route("queue").GET(new Request(`http://localhost/api/study/queue${search}`));
const post = (path, body) =>
  route(path).POST(
    new Request(`http://localhost/api/study/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

test("scope parsing normalizes duplicate UUIDs, preserves filter and rejects empty, malformed or oversized selections", () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  assert.deepEqual(
    query.parseStudyQuery(
      new URLSearchParams(
        `scope=sets&set=${id}&set=${id.toUpperCase()}&filter=due_only`,
      ),
    ),
    { scope: { kind: "sets", setIds: [id] }, filter: "due_only" },
  );
  for (const search of [
    "scope=sets",
    "scope=sets&set=",
    "scope=sets&set=bad",
    "scope=bogus",
    `scope=all&set=${id}`,
    "filter=bogus",
  ]) {
    assert.throws(() => query.parseStudyQuery(new URLSearchParams(search)));
  }
  assert.throws(() =>
    query.StudyScopeSchema.parse({ kind: "sets", setIds: Array(101).fill(id) }),
  );
  assert.equal(
    query.studyHref(all, "due_only"),
    "/study?scope=all&filter=due_only",
  );
});

test("all and selected scopes globally prioritize scheduled work across mixed language sets", async () => {
  const fresh = await makeSet();
  const later = await makeSet({ source: "fi", target: "ru" });
  const earlier = await makeSet({ source: "es", target: "de" });
  await makeSet({ owner: otherId });
  const learning = await seed(
    later,
    "recognition",
    1,
    new Date("2026-11-10T10:00Z"),
  );
  const review = await seed(
    earlier,
    "recognition",
    2,
    new Date("2026-11-09T10:00Z"),
  );
  const cards = await queue();
  assert.deepEqual(
    cards.slice(0, 2).map((card) => card.id),
    [review.id, learning.id],
  );
  assert(cards.slice(2).every((card) => card.state.state === 0));
  assert.equal(cards[0].sourceLang, "es");
  assert.equal(cards[1].targetLang, "ru");
  assert.equal(cards[1].wordSetName, "fi vocabulary");
  assert(
    cards.every((card) =>
      [fresh.id, later.id, earlier.id].includes(card.wordSetId),
    ),
  );
  assert(
    (await queue(selected(fresh, later))).every((card) =>
      [fresh.id, later.id].includes(card.wordSetId),
    ),
  );
  assert.deepEqual(
    (await queue(selected(fresh))).map((c) => c.id),
    (
      await repo.getDueReviewCards({
        userId,
        wordSetId: fresh.id,
        now,
        limit: 50,
      })
    ).map((c) => c.id),
  );
});

test("new-card rounds are fair with sparse positions and different unlocked types, and stay stable across refills", async () => {
  const a = await makeSet({ count: 3, offset: 1000 });
  const b = await makeSet({ count: 3 });
  await seed(a, "recognition", 1, new Date("2027-01-01"));
  const cards = await queue(selected(a, b));
  const order = [a.id, b.id].sort();
  assert.deepEqual(
    cards.slice(0, 4).map((c) => c.wordSetId),
    [...order, ...order],
  );
  assert.equal(
    cards.find((c) => c.wordSetId === a.id && c.wordSetItemId === a.items[0].id)
      .templateKey,
    "production",
  );
  const first = await queue(selected(a, b), { limit: 3 });
  const rest = await queue(selected(a, b), {
    excludedStudyCardIds: first.map((c) => c.id),
  });
  assert.deepEqual(
    [...first, ...rest].map((c) => c.id),
    cards.map((c) => c.id),
  );
});

test("due-only excludes missing and persisted New projections while retaining due Learning, Review and Relearning", async () => {
  const set = await makeSet({ count: 6 });
  await seed(set, "recognition", 0, new Date("2026-01-01"), 1);
  const dueIds = [];
  for (const [index, state] of [
    [2, 1],
    [3, 2],
    [4, 3],
  ])
    dueIds.push(
      (await seed(set, "recognition", state, new Date("2026-01-01"), index)).id,
    );
  await seed(set, "recognition", 2, new Date("2027-01-01"), 5);
  const cards = await queue(all, { filter: "due_only" });
  assert.deepEqual(cards.map((c) => c.id).sort(), dueIds.sort());
  const [summary] = await stats.getWordSetReviewStats({
    userId,
    now,
    scope: selected(set),
    filter: "due_only",
  });
  assert.equal(summary.dueCount, 3);
  assert.equal(
    (
      await stats.getWordSetReviewStats({
        userId,
        now,
        scope: { kind: "sets", setIds: [] },
      })
    ).length,
    0,
  );
  assert.equal(
    (
      await repo.getNextScheduledReviewAt({ userId, scope: all, now })
    ).toISOString(),
    "2027-01-01T00:00:00.000Z",
  );
});

test("each selected set retains its own fixed daily allowance and exclusions cannot open a new cohort", async () => {
  await load("@/db/profileRepo").updateUserPreferences({
    userId,
    reviewMode: "simple",
    newWordsPerDay: 1,
  });
  const a = await makeSet({ count: 3 });
  const b = await makeSet({ count: 3 });
  const first = await queue(selected(a, b));
  assert.equal(first.length, 2);
  assert.equal(
    (
      await queue(selected(a, b), {
        excludedStudyCardIds: first.map((c) => c.id),
      })
    ).length,
    0,
  );
  const card = first.find((c) => c.wordSetId === a.id);
  const opened = await repo.activateReviewCard({
    userId,
    wordSetId: a.id,
    studyCardId: card.id,
    exposureId: crypto.randomUUID(),
    now,
  });
  await repo.recordReview({
    userId,
    wordSetId: a.id,
    studyCardId: card.id,
    exposureId: opened.exposure.id,
    reviewEventId: crypto.randomUUID(),
    rating: 3,
    reviewedAt: now,
    now,
  });
  const cards = await queue();
  assert.deepEqual(
    cards.filter((c) => c.wordSetId === a.id).map((c) => c.templateKey),
    ["production"],
  );
  assert.deepEqual(
    cards.filter((c) => c.wordSetId === b.id).map((c) => c.wordSetItemId),
    [b.items[0].id],
  );
});

test("exposure and effective next availability follow a note through every scope", async () => {
  const a = await makeSet();
  const b = await makeSet();
  await seed(a, "recognition", 2);
  await seed(a, "production", 2);
  await seed(b, "recognition", 1);
  const card = (await queue(all, { filter: "due_only" })).find(
    (c) => c.wordSetId === a.id,
  );
  await repo.activateReviewCard({
    userId,
    wordSetId: a.id,
    studyCardId: card.id,
    exposureId: crypto.randomUUID(),
    now,
  });
  for (const scope of [all, selected(a), selected(a, b)]) {
    assert(
      !(await queue(scope, { filter: "due_only" })).some(
        (c) => c.wordSetId === a.id,
      ),
    );
    const timing = await repo.getReviewQueueTiming({ userId, scope, now });
    assert.equal(timing.exposureDeferredCount, 2);
    assert.equal(timing.nextDueAt.toISOString(), "2026-11-12T02:00:00.000Z");
  }
  const next = await queue(all, {
    now: new Date("2026-11-12T02:00Z"),
    filter: "due_only",
  });
  assert(next.some((c) => c.wordSetId === a.id));
});

test("queue API rejects foreign, missing, empty and invalid scopes without falling back to all", async () => {
  const owned = await makeSet();
  const foreign = await makeSet({ owner: otherId });
  for (const search of [
    "?scope=sets",
    "?scope=sets&set=bad",
    `?scope=sets&set=${owned.id}&filter=bad`,
    `?${new URLSearchParams(Array(101).fill(["set", owned.id]))}`,
  ]) {
    assert.equal((await getQueue(search)).status, 400);
  }
  for (const id of [foreign.id, crypto.randomUUID()]) {
    const response = await getQueue(`?scope=sets&set=${owned.id}&set=${id}`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.errorCode, "errors.studySetsUnavailable");
    assert.equal(body.error, undefined);
  }
  const empty = await makeSet({ count: 0 });
  assert.deepEqual(
    (await (await getQueue(`?scope=sets&set=${empty.id}`)).json()).cards,
    [],
  );
  const duplicate = await getQueue(
    `?scope=sets&set=${owned.id}&set=${owned.id}`,
  );
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).scope.setIds.length, 1);
  const cards = (await (await getQueue()).json()).cards;
  assert.equal(cards.length, 1);
  assert.equal(cards[0].wordSetId, owned.id);
  await client.query("DELETE FROM word_set WHERE id=$1", [owned.id]);
  assert.equal((await getQueue(`?scope=sets&set=${owned.id}`)).status, 404);
});

test("shared mutation APIs derive ownership from cards, preserve retries and reject malformed or foreign submissions", async () => {
  const owned = await makeSet();
  const foreign = await makeSet({ owner: otherId });
  const card = cardFor(owned, "recognition");
  const exposureId = crypto.randomUUID();
  const display = {
    studyCardId: card.id,
    exposureId,
    displayed: true,
    wordSetId: foreign.id,
  };
  assert.equal((await post("activate", display)).status, 200);
  assert.equal((await post("activate", display)).status, 200);
  const body = {
    studyCardId: card.id,
    exposureId,
    reviewId: crypto.randomUUID(),
    rating: 3,
    reviewedAt: new Date().toISOString(),
    wordSetId: foreign.id,
  };
  assert.equal((await post("reviews", body)).status, 200);
  assert.equal((await post("reviews", body)).status, 200);
  assert.equal(
    (await client.query("SELECT count(*) FROM review_event")).rows[0].count,
    1,
  );
  assert.equal(await scopes.getOwnedStudyCardSet(userId, card.id), owned.id);
  for (const path of ["activate", "reviews"]) {
    assert.equal((await post(path, "invalid json")).status, 400);
    assert.equal(
      (
        await post(path, {
          ...body,
          studyCardId: cardFor(foreign, "recognition").id,
        })
      ).status,
      404,
    );
    assert.equal(
      (await post(path, { ...body, studyCardId: crypto.randomUUID() })).status,
      404,
    );
    const anonymous = route(path, null);
    assert.equal(
      (
        await anonymous.POST(
          new Request(`http://localhost/api/study/${path}`, {
            method: "POST",
            body: JSON.stringify(body),
          }),
        )
      ).status,
      401,
    );
  }
  assert.equal(
    (
      await route("queue", null).GET(
        new Request("http://localhost/api/study/queue"),
      )
    ).status,
    401,
  );
});

test("subset reconciliation repairs only selected sets and an empty selection reconciles none", async () => {
  const a = await makeSet();
  const b = await makeSet();
  await client.query("DELETE FROM study_card");
  assert.deepEqual(await queue({ kind: "sets", setIds: [] }), []);
  assert.equal(
    (await client.query("SELECT count(*) FROM study_card")).rows[0].count,
    0,
  );
  await queue(selected(a));
  assert.equal(
    (await client.query("SELECT count(*) FROM study_card")).rows[0].count,
    5,
  );
  await queue(all);
  assert.equal(
    (await client.query("SELECT count(*) FROM study_card")).rows[0].count,
    10,
  );
  assert.equal((await queue(selected(b))).length, 1);
});
