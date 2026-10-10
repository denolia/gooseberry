import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test, { before } from "node:test";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/pg-proxy";
import ts from "@typescript/typescript6";

const externalRequire = createRequire(import.meta.url);
let SQL;
before(async () => {
  SQL = await initSqlJs();
});
const now = new Date("2026-10-10T12:00:00.000Z");
const tomorrow = "2026-10-11T12:00:00.000Z";

// Run the real Drizzle SELECTs against a local SQL engine. Only PostgreSQL's
// VALUES table alias syntax needs adapting; joins, aggregation,
// filtering, projection decoding and conflict handling execute as written.
function createFixture({ complete = true, empty = false } = {}) {
  const storage = new SQL.Database();
  storage.create_function("now", () => now.toISOString());
  storage.create_function("gen_random_uuid", () => crypto.randomUUID());
  storage.create_function("btrim", (value, characters) => {
    if (value === null) return null;
    const whitespace = new Set(characters);
    let start = 0;
    let end = value.length;
    while (start < end && whitespace.has(value[start])) start += 1;
    while (end > start && whitespace.has(value[end - 1])) end -= 1;
    return value.slice(start, end);
  });
  storage.run(`
    CREATE TABLE word_set (
      id TEXT PRIMARY KEY, user_id TEXT, name TEXT, source_lang TEXT, target_lang TEXT
    );
    CREATE TABLE word_set_item (
      id TEXT PRIMARY KEY, word_set_id TEXT, original TEXT, translation TEXT,
      word_forms TEXT, sample TEXT, sample_translation TEXT, comments TEXT,
      tags TEXT, position INTEGER, created_at TEXT
    );
    CREATE TABLE study_card (
      id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()), word_set_item_id TEXT,
      template_key TEXT, created_at TEXT, is_suspended INTEGER DEFAULT 0, buried_until TEXT,
      UNIQUE(word_set_item_id, template_key)
    );
    CREATE TABLE fsrs_card_state (
      user_id TEXT, study_card_id TEXT, due_at TEXT, stability REAL,
      difficulty REAL, elapsed_days INTEGER, scheduled_days INTEGER,
      learning_steps INTEGER, reps INTEGER, lapses INTEGER, state INTEGER,
      last_review_at TEXT, scheduler_version TEXT, revision INTEGER,
      PRIMARY KEY(user_id, study_card_id)
    );
    CREATE TABLE study_card_import_baseline (
      user_id TEXT, study_card_id TEXT, baseline_state TEXT,
      PRIMARY KEY(user_id, study_card_id)
    );
    CREATE TABLE review_event (
      id TEXT PRIMARY KEY, user_id TEXT, study_card_id TEXT,
      rating INTEGER, reviewed_at TEXT
    );
  `);
  storage.run("INSERT INTO word_set VALUES (?, ?, ?, ?, ?)", [
    "set-1",
    "user-1",
    "Finnish",
    "FI",
    "RU",
  ]);
  storage.run(
    "INSERT INTO word_set_item VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      "item-1",
      "set-1",
      empty ? "\n\t" : "monikko",
      empty ? "" : "множественное число",
      complete && !empty ? "monikot" : "\n\t",
      complete && !empty ? "Sana on monikossa." : "",
      complete && !empty ? "Слово во множественном числе." : "",
      "",
      "",
      0,
      "2026-01-01T12:00:00.000Z",
    ],
  );
  const database = drizzle(async (query, params) => {
    const adapted = query
      .replace(
        /CROSS JOIN \(VALUES ([\s\S]*?)\) AS template\(key\)/g,
        (_full, values) => {
          const rows = [...values.matchAll(/\((\$\d+)::text\)/g)];
          return `CROSS JOIN (${rows.map((row) => `SELECT ${row[1]} AS key`).join(" UNION ALL ")}) AS template`;
        },
      )
      .replace(/::(?:text|integer)/g, "")
      .replace(/ ~ /g, " REGEXP ")
      .replace(/\$(\d+)/g, "?$1");
    const statement = storage.prepare(adapted);
    try {
      statement.bind(
        params.map((value) =>
          value instanceof Date
            ? value.toISOString()
            : typeof value === "boolean"
              ? Number(value)
              : value,
        ),
      );
      const rows = [];
      while (statement.step()) rows.push(statement.get());
      return { rows };
    } finally {
      statement.free();
    }
  });
  const modules = new Map();
  function load(name) {
    if (name === "@/db/drizzle") return { getDb: () => database };
    // Imported baseline/cache recovery uses genuine PostgreSQL in
    // importedReviewBaseline.test.mjs; this fixture covers ordinary card SQL.
    if (name === "@/db/reviewProjectionRepo")
      return { ensureReviewProjections: async () => {} };
    if (!name.startsWith("@/")) return externalRequire(name);
    if (modules.has(name)) return modules.get(name);
    const exports = {};
    modules.set(name, exports);
    const source = readFileSync(
      new URL(`../src/${name.slice(2)}.ts`, import.meta.url),
      "utf8",
    );
    const code = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    new Function("require", "exports", code)(load, exports);
    return exports;
  }
  const repo = load("@/db/reviewRepo");
  const stats = load("@/db/reviewStatsRepo");
  function cards() {
    return (
      storage.exec("SELECT id, template_key FROM study_card")[0]?.values ?? []
    );
  }
  function setState(
    templateKey,
    { state = 2, dueAt = tomorrow, reps = 1 } = {},
  ) {
    const id = cards().find((row) => row[1] === templateKey)?.[0];
    assert(id, `missing ${templateKey}`);
    storage.run(
      "INSERT OR REPLACE INTO fsrs_card_state VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        "user-1",
        id,
        dueAt,
        2.1,
        3.2,
        0,
        1,
        0,
        reps,
        0,
        state,
        now.toISOString(),
        "ts-fsrs@5.4.2:gooseberry-v1",
        1,
      ],
    );
    return id;
  }
  return { repo, stats, storage, cards, setState };
}

const queue = (repo, extra = {}) =>
  repo.getDueReviewCards({
    userId: "user-1",
    wordSetId: "set-1",
    now,
    limit: 20,
    ...extra,
  });

test("basic notes expose three exercises but keep five stable identities", async () => {
  const { repo, cards } = createFixture({ complete: false });
  const first = await queue(repo);
  assert.deepEqual(
    first.map((card) => card.templateKey).sort(),
    ["recognition", "production", "type_answer"].sort(),
  );
  assert(first.every((card) => card.wordSetItemId === "item-1"));
  assert.equal(cards().length, 5);
  assert.deepEqual(
    (await queue(repo)).map((card) => card.id),
    first.map((card) => card.id),
  );
  assert.equal(
    (await queue(repo, { excludedStudyCardIds: [first[0].id] })).length,
    2,
  );
});

test("scheduling one direction leaves sibling exercises independently due", async () => {
  const { repo, stats, setState } = createFixture();
  assert.equal((await queue(repo)).length, 5);
  const recognitionId = setState("recognition", { reps: 7 });
  const remaining = await queue(repo);
  assert.equal(remaining.length, 4);
  assert(!remaining.some((card) => card.id === recognitionId));
  assert(remaining.some((card) => card.templateKey === "production"));
  assert(remaining.some((card) => card.templateKey === "type_answer"));
  const [setStats] = await stats.getWordSetReviewStats({
    userId: "user-1",
    now,
  });
  assert.deepEqual(setStats, {
    wordSetId: "set-1",
    itemCount: 1,
    cardCount: 5,
    dueCount: 4,
  });
});

test("blank optional content pauses an exercise and restores its ID and schedule", async () => {
  const { repo, stats, storage, cards, setState } = createFixture();
  await queue(repo);
  const wordFormsId = setState("word_forms", { reps: 9 });
  storage.run("UPDATE word_set_item SET word_forms = ? WHERE id = ?", [
    "\n\t",
    "item-1",
  ]);
  assert.equal((await queue(repo)).length, 4);
  const [paused] = await stats.getWordSetItemReviewStats({
    userId: "user-1",
    wordSetId: "set-1",
    now,
  });
  assert.equal(paused.cardCount, 4);
  assert.equal(paused.reps, 0);
  assert.equal(
    cards().find((card) => card[1] === "word_forms")[0],
    wordFormsId,
  );
  storage.run(
    "UPDATE word_set_item SET word_forms = 'monikot' WHERE id = 'item-1'",
  );
  const [restored] = await stats.getWordSetItemReviewStats({
    userId: "user-1",
    wordSetId: "set-1",
    now,
  });
  assert.equal(restored.cardCount, 5);
  assert.equal(restored.reps, 9);
  assert(!(await queue(repo)).some((card) => card.id === wordFormsId));
});

test("item summaries aggregate learning, untouched siblings and completed reviews", async () => {
  const { repo, stats, setState } = createFixture({ complete: false });
  await queue(repo);
  setState("recognition", { reps: 5 });
  setState("production", { state: 1, reps: 1 });
  const [item] = await stats.getWordSetItemReviewStats({
    userId: "user-1",
    wordSetId: "set-1",
    now,
  });
  assert.equal(item.cardCount, 3);
  assert.equal(item.dueCount, 1);
  assert.equal(item.state, 1);
  assert.equal(item.dueAt, null);
  assert.equal(item.reps, 6);
  assert.equal(item.lastReviewAt.toISOString(), now.toISOString());
  setState("type_answer", { dueAt: "2026-10-10T11:00:00.000Z" });
  const [scheduled] = await stats.getWordSetItemReviewStats({
    userId: "user-1",
    wordSetId: "set-1",
    now,
  });
  assert.equal(scheduled.dueAt.toISOString(), "2026-10-10T11:00:00.000Z");
});

test("empty fields and foreign users do not produce ready exercises", async () => {
  const { repo, stats, cards } = createFixture({ empty: true });
  assert.equal((await queue(repo)).length, 0);
  assert.equal(cards().length, 5);
  assert.deepEqual(
    await stats.getWordSetReviewStats({ userId: "user-1", now }),
    [{ wordSetId: "set-1", itemCount: 1, cardCount: 0, dueCount: 0 }],
  );
  assert.equal((await queue(repo, { userId: "other-user" })).length, 0);
  assert.deepEqual(
    await stats.getWordSetReviewStats({ userId: "other-user", now }),
    [],
  );
});

test("availability treats Unicode whitespace exactly like String.trim", async () => {
  const { repo, stats, storage } = createFixture();
  const whitespace = "\u00a0\ufeff\u1680\u2001\u202f\u3000\n\t";
  storage.run("UPDATE word_set_item SET word_forms = ?, sample = ?", [
    whitespace,
    whitespace,
  ]);
  assert.deepEqual(
    (await queue(repo)).map((card) => card.templateKey).sort(),
    ["recognition", "production", "type_answer"].sort(),
  );
  const [set] = await stats.getWordSetReviewStats({ userId: "user-1", now });
  assert.equal(set.cardCount, 3);
});

test("new cards rotate exercises across notes and scheduled reviews take priority", async () => {
  const { repo, storage, setState } = createFixture({ complete: false });
  storage.run(`INSERT INTO word_set_item
    SELECT 'item-2', word_set_id, 'kissa', 'кот', word_forms, sample,
      sample_translation, comments, tags, 1, created_at
    FROM word_set_item WHERE id = 'item-1'`);
  const cards = await queue(repo);
  assert.deepEqual(
    cards.map((card) => [card.templateKey, card.wordSetItemId]),
    [
      ["recognition", "item-1"],
      ["production", "item-2"],
      ["production", "item-1"],
      ["type_answer", "item-2"],
      ["type_answer", "item-1"],
      ["recognition", "item-2"],
    ],
  );
  const scheduledId = setState("type_answer", {
    dueAt: "2026-10-09T12:00:00.000Z",
  });
  assert.equal((await queue(repo))[0].id, scheduledId);
});

test("new-card rounds keep word order, diversify all modes and survive prefetch exclusions", async () => {
  const { repo, storage } = createFixture();
  for (let position = 1; position < 8; position += 1) {
    storage.run(
      `INSERT INTO word_set_item
      SELECT ?, word_set_id, original || ?, translation, word_forms, sample,
        sample_translation, comments, tags, ?, created_at
      FROM word_set_item WHERE id = 'item-1'`,
      [`item-${position + 1}`, String(position), position],
    );
  }
  const first = await queue(repo, { limit: 8 });
  assert.deepEqual(
    first.map((card) => card.wordSetItemId),
    Array.from({ length: 8 }, (_, i) => `item-${i + 1}`),
  );
  assert.equal(new Set(first.map((card) => card.templateKey)).size, 5);
  const remaining = await queue(repo, {
    limit: 8,
    excludedStudyCardIds: first.map((card) => card.id),
  });
  assert.deepEqual(
    remaining.map((card) => card.wordSetItemId),
    first.map((card) => card.wordSetItemId),
  );
  assert(
    remaining.every((card, i) => card.templateKey !== first[i].templateKey),
  );
  const complete = await queue(repo, { limit: 50 });
  assert.equal(complete.length, 40);
  assert(
    complete.every(
      (card, i) =>
        i === 0 || card.wordSetItemId !== complete[i - 1].wordSetItemId,
    ),
  );
});

test("review writes reject inactive, unsupported and unowned card identities", async () => {
  const { repo, storage, cards } = createFixture({ complete: false });
  await queue(repo);
  storage.run(
    "INSERT INTO study_card (id,word_set_item_id,template_key,created_at) VALUES ('custom-card', 'item-1', 'custom', ?)",
    [now.toISOString()],
  );
  const inactiveId = cards().find((card) => card[1] === "word_forms")[0];
  const recognitionId = cards().find((card) => card[1] === "recognition")[0];
  for (const extra of [
    { studyCardId: inactiveId },
    { studyCardId: "custom-card" },
    { studyCardId: recognitionId, userId: "other-user" },
    { studyCardId: recognitionId, wordSetId: "other-set" },
  ]) {
    await assert.rejects(
      repo.recordReview({
        userId: "user-1",
        wordSetId: "set-1",
        rating: 3,
        reviewedAt: now,
        reviewEventId: crypto.randomUUID(),
        ...extra,
      }),
      repo.ReviewCardNotFoundError,
    );
  }
  assert.equal(
    storage.exec("SELECT count(*) FROM review_event")[0].values[0][0],
    0,
  );
});

test("reconciliation preserves preexisting recognition identity and history", async () => {
  const { repo, storage, setState } = createFixture();
  const introducedAt = "2026-02-01T12:00:00.000Z";
  storage.run(
    "INSERT INTO study_card (id,word_set_item_id,template_key,created_at) VALUES ('legacy-recognition', 'item-1', 'recognition', ?)",
    [introducedAt],
  );
  setState("recognition", { reps: 12 });
  const due = await queue(repo);
  assert.equal(due.length, 4);
  assert(!due.some((card) => card.id === "legacy-recognition"));
  assert.deepEqual(
    storage.exec(
      "SELECT id, created_at FROM study_card WHERE template_key = 'recognition'",
    )[0].values,
    [["legacy-recognition", introducedAt]],
  );
  assert.equal(
    storage.exec(
      "SELECT reps FROM fsrs_card_state WHERE study_card_id = 'legacy-recognition'",
    )[0].values[0][0],
    12,
  );
});

test("an empty set has zero notes, zero cards and zero due exercises", async () => {
  const { stats, storage } = createFixture();
  storage.run("DELETE FROM word_set_item");
  assert.deepEqual(
    await stats.getWordSetReviewStats({ userId: "user-1", now }),
    [{ wordSetId: "set-1", itemCount: 0, cardCount: 0, dueCount: 0 }],
  );
});
