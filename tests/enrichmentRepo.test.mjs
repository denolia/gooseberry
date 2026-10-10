import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createPostgresFixture } from "./helpers/postgres.mjs";
import { PgDialect } from "drizzle-orm/pg-core";

const fixture = await createPostgresFixture();
const { client, load, database } = fixture;
const repo = load("@/db/enrichmentRepo");
const userId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const wordSetId = "33333333-3333-4333-8333-333333333333";
const itemId = "44444444-4444-4444-8444-444444444444";
const otherItemId = "55555555-5555-4555-8555-555555555555";
const originalExecute = database.execute.bind(database);
function reservation(extra = {}) {
  return {
    userId,
    itemId,
    requestKey: crypto.randomUUID(),
    contentRevision: 0,
    fields: ["wordForms"],
    reservedTokens: 600,
    dailyTokenLimit: 1000,
    model: "test-model",
    inputWords: 10,
    ...extra,
  };
}
function proposal(extra = {}) {
  return {
    values: {
      original: null,
      translation: null,
      wordForms: "monikot",
      sample: null,
      sampleTranslation: null,
      comments: null,
      ...extra,
    },
    message: "Review this proposal.",
  };
}
async function completed(extra = {}) {
  const input = reservation(extra);
  const { request } = await repo.reserveEnrichment(input);
  await repo.finishEnrichment(request.id, proposal());
  return { ...input, wordSetId };
}
beforeEach(async () => {
  database.execute = originalExecute;
  await client.exec("TRUNCATE app_user CASCADE");
  await client.query(
    "INSERT INTO app_user(id,provider,provider_user_id) VALUES ($1,'test','one'),($2,'test','two')",
    [userId, otherId],
  );
  await client.query(
    "INSERT INTO word_set(id,user_id,name,source_lang,target_lang) VALUES ($1,$2,'Words','fi','ru')",
    [wordSetId, userId],
  );
  await client.query(
    "INSERT INTO word_set_item(id,word_set_id,anki_note_guid,original,translation,position) VALUES ($1,$2,'one','monikko','множественное число',0),($3,$2,'two','kissa','кот',1)",
    [itemId, wordSetId, otherItemId],
  );
});
after(() => fixture.close());

test("concurrent paid reservations share one atomic per-user allowance", async () => {
  const results = await Promise.allSettled([
    repo.reserveEnrichment(reservation()),
    repo.reserveEnrichment(reservation({ itemId: otherItemId })),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.find((result) => result.status === "rejected").reason.status,
    429,
  );
  assert.equal(
    (
      await client.query(
        "SELECT sum(reserved_tokens)::int AS total FROM ai_usage",
      )
    ).rows[0].total,
    600,
  );
  assert.equal(
    (await client.query("SELECT * FROM enrichment_request")).rows.length,
    1,
  );
});

test("idempotent retries reuse reservations, singleflight blocks duplicate paid work, and failures retain the budget", async () => {
  const input = reservation();
  const first = await repo.reserveEnrichment(input);
  const repeated = await repo.reserveEnrichment(input);
  assert.equal(repeated.isNew, false);
  assert.equal(first.request.id, repeated.request.id);
  assert.equal((await client.query("SELECT * FROM ai_usage")).rows.length, 1);
  await assert.rejects(repo.reserveEnrichment(reservation()), { status: 409 });
  await assert.rejects(
    repo.reserveEnrichment({ ...input, fields: ["comments"] }),
    { status: 409 },
  );
  await repo.finishEnrichment(first.request.id, null);
  const failedRetry = await repo.reserveEnrichment(input);
  assert.equal(failedRetry.isNew, false);
  assert.equal(failedRetry.request.status, "failed");
  await assert.rejects(repo.reserveEnrichment(reservation()), { status: 429 });
  assert.equal(
    (
      await client.query(
        "SELECT sum(reserved_tokens)::int AS total FROM ai_usage",
      )
    ).rows[0].total,
    600,
  );
});

test("saving a reviewed proposal changes only missing requested fields and keeps review identities", async () => {
  await client.query(
    "INSERT INTO study_card(word_set_item_id,template_key) VALUES ($1,'recognition')",
    [itemId],
  );
  const ids = (await client.query("SELECT id FROM study_card")).rows;
  const input = await completed();
  await repo.applyEnrichment({ ...input, values: { wordForms: "monikot" } });
  const [item] = (
    await client.query("SELECT * FROM word_set_item WHERE id=$1", [itemId])
  ).rows;
  assert.equal(item.word_forms, "monikot");
  assert.equal(item.original, "monikko");
  assert.equal(item.content_revision, 1);
  assert.equal(item.field_origins.wordForms.origin, "ai");
  assert.equal(
    (await repo.getEnrichmentRequest(userId, itemId, input.requestKey)).status,
    "applied",
  );
  await repo.applyEnrichment({ ...input, values: { wordForms: "monikot" } });
  assert.equal(
    (
      await client.query(
        "SELECT content_revision FROM word_set_item WHERE id=$1",
        [itemId],
      )
    ).rows[0].content_revision,
    1,
  );
  assert.deepEqual((await client.query("SELECT id FROM study_card")).rows, ids);
});

test("an edit between proposal review and atomic save never marks the proposal applied", async () => {
  const input = await completed();
  let injected = false;
  database.execute = (statement) => {
    const query = new PgDialect().sqlToQuery(statement).sql;
    if (!injected && query.includes("WITH updated AS")) {
      injected = true;
      return (async () => {
        await client.query(
          "UPDATE word_set_item SET comments='concurrent user edit',content_revision=1 WHERE id=$1",
          [itemId],
        );
        return originalExecute(statement);
      })();
    }
    return originalExecute(statement);
  };
  await assert.rejects(
    repo.applyEnrichment({ ...input, values: { wordForms: "monikot" } }),
    { status: 409 },
  );
  assert.equal(injected, true);
  const [item] = (
    await client.query("SELECT * FROM word_set_item WHERE id=$1", [itemId])
  ).rows;
  assert.equal(item.word_forms, "");
  assert.equal(item.comments, "concurrent user edit");
  assert.equal(
    (await repo.getEnrichmentRequest(userId, itemId, input.requestKey)).status,
    "completed",
  );
});

test("concurrent apply retries increment the content revision exactly once", async () => {
  const input = await completed();
  await Promise.all([
    repo.applyEnrichment({ ...input, values: { wordForms: "monikot" } }),
    repo.applyEnrichment({ ...input, values: { wordForms: "monikot" } }),
  ]);
  assert.equal(
    (
      await client.query(
        "SELECT content_revision FROM word_set_item WHERE id=$1",
        [itemId],
      )
    ).rows[0].content_revision,
    1,
  );
});

test("owner checks prevent foreign proposal reads, writes, and paid reservations", async () => {
  const input = await completed();
  await assert.rejects(repo.getEnrichmentItem(otherId, wordSetId, itemId), {
    status: 404,
  });
  await assert.rejects(
    repo.applyEnrichment({
      ...input,
      userId: otherId,
      values: { wordForms: "steal" },
    }),
    { status: 404 },
  );
  await assert.rejects(
    repo.reserveEnrichment(reservation({ userId: otherId })),
    { status: 429 },
  );
  assert.equal(
    (await client.query("SELECT * FROM ai_usage WHERE user_id=$1", [otherId]))
      .rows.length,
    0,
  );
});

test("a generated example pair preserves existing unpaired source examples", async () => {
  await client.query(
    "UPDATE word_set_item SET example_pairs=$2::jsonb WHERE id=$1",
    [
      itemId,
      JSON.stringify([
        { sample: "source without translation", translation: "" },
      ]),
    ],
  );
  const input = reservation({ fields: ["sample", "sampleTranslation"] });
  const { request } = await repo.reserveEnrichment(input);
  await repo.finishEnrichment(
    request.id,
    proposal({
      wordForms: null,
      sample: "Sana on monikossa.",
      sampleTranslation: "Слово во множественном числе.",
    }),
  );
  await repo.applyEnrichment({
    ...input,
    wordSetId,
    values: {
      sample: "Sana on monikossa.",
      sampleTranslation: "Слово во множественном числе.",
    },
  });
  const [item] = (
    await client.query("SELECT * FROM word_set_item WHERE id=$1", [itemId])
  ).rows;
  assert.equal(item.example_pairs.length, 2);
  assert.deepEqual(item.example_pairs[0], {
    sample: "Sana on monikossa.",
    translation: "Слово во множественном числе.",
  });
  assert.equal(item.example_pairs[1].translation, "");
});

test("full content edits preserve unchanged field provenance and stale revisions cannot mutate content", async () => {
  const words = load("@/db/wordSetRepo");
  const input = await completed();
  await repo.applyEnrichment({ ...input, values: { wordForms: "monikot" } });
  await client.query(
    "UPDATE word_set_item SET field_origins=field_origins || $2::jsonb WHERE id=$1",
    [itemId, JSON.stringify({ original: { origin: "imported" } })],
  );
  const content = {
    original: "monikko",
    translation: "множественное число",
    wordForms: "monikot",
    sample: "",
    sampleTranslation: "",
    comments: "",
    tags: "learner-tag",
    contentRevision: 1,
  };
  assert.deepEqual(await words.updateWordSetItem(wordSetId, itemId, content), {
    id: itemId,
  });
  const [item] = (
    await client.query("SELECT * FROM word_set_item WHERE id=$1", [itemId])
  ).rows;
  assert.equal(item.content_revision, 2);
  assert.equal(item.field_origins.wordForms.origin, "ai");
  assert.equal(item.field_origins.original.origin, "imported");
  assert.equal(item.field_origins.tags.origin, "edited");
  assert.equal(
    await words.updateWordSetItem(wordSetId, itemId, {
      ...content,
      tags: "stale overwrite",
    }),
    null,
  );
  const [unchanged] = (
    await client.query("SELECT * FROM word_set_item WHERE id=$1", [itemId])
  ).rows;
  assert.equal(unchanged.content_revision, 2);
  assert.equal(unchanged.tags, "learner-tag");
  assert.equal(unchanged.field_origins.wordForms.origin, "ai");
});

test("expired pending recovery is owner-scoped and never refunds or repeats paid work", async () => {
  const input = reservation({ dailyTokenLimit: 2000 });
  const first = await repo.reserveEnrichment(input);
  await client.query(
    "UPDATE enrichment_request SET created_at=now()-interval '11 minutes' WHERE id=$1",
    [first.request.id],
  );
  assert.equal(
    await repo.getEnrichmentRequest(otherId, itemId, input.requestKey),
    null,
  );
  assert.equal(
    (
      await client.query("SELECT status FROM enrichment_request WHERE id=$1", [
        first.request.id,
      ])
    ).rows[0].status,
    "pending",
  );
  const recovered = await repo.getEnrichmentRequest(
    userId,
    itemId,
    input.requestKey,
  );
  assert.equal(recovered.status, "failed");
  assert(recovered.completedAt instanceof Date);
  const repeated = await repo.reserveEnrichment(input);
  assert.equal(repeated.isNew, false);
  assert.equal(repeated.request.id, first.request.id);
  assert.equal(repeated.request.status, "failed");
  assert.equal(
    (
      await client.query(
        "SELECT sum(reserved_tokens)::int AS total FROM ai_usage",
      )
    ).rows[0].total,
    600,
  );
  const retry = await repo.reserveEnrichment(
    reservation({ dailyTokenLimit: 2000 }),
  );
  assert.equal(retry.isNew, true);
  assert.notEqual(retry.request.id, first.request.id);
  assert.equal(
    (
      await client.query(
        "SELECT sum(reserved_tokens)::int AS total FROM ai_usage",
      )
    ).rows[0].total,
    1200,
  );
});
