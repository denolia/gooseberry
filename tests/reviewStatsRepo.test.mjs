import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadRepo(rows) {
  const query = {
    from() {
      return this;
    },
    innerJoin() {
      return this;
    },
    leftJoin() {
      return this;
    },
    where() {
      return this;
    },
    groupBy() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(rows).then(resolve, reject);
    },
  };
  const db = { select: () => query };
  const code = ts.transpileModule(
    readFileSync(
      new URL("../src/db/reviewStatsRepo.ts", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const exports = {};
  new Function("require", "exports", code)((name) => {
    const expression = () => ({});
    const tables = new Proxy(
      {},
      { get: (_target, property) => String(property) },
    );
    const mocks = {
      "@/db/drizzle": { getDb: () => db },
      "@/db/schema": {
        fsrsCardState: tables,
        studyCard: tables,
        wordSet: tables,
        wordSetItem: tables,
      },
      "drizzle-orm": {
        and: expression,
        eq: expression,
        sql: (strings, ...values) => ({ strings, values }),
      },
      "@/lib/review/model": {
        FsrsCardState: { New: 0 },
        NATIVE_STUDY_CARD_TEMPLATE: "recognition",
      },
    };
    if (!(name in mocks)) throw new Error(`Unexpected dependency ${name}`);
    return mocks[name];
  }, exports);

  return exports;
}

test("items without a projection are reported as fresh new cards", async () => {
  const repo = loadRepo([
    {
      wordSetItemId: "item-1",
      state: null,
      dueAt: null,
      reps: null,
      lapses: null,
      lastReviewAt: null,
    },
  ]);

  const [stats] = await repo.getWordSetItemReviewStats({
    userId: "user-1",
    wordSetId: "set-1",
  });

  assert.deepEqual(stats, {
    wordSetItemId: "item-1",
    state: 0,
    dueAt: null,
    reps: 0,
    lapses: 0,
    lastReviewAt: null,
  });
});

test("set-level review counts are normalized to numbers", async () => {
  const repo = loadRepo([
    {
      wordSetId: "set-1",
      itemCount: "18",
      enabledItemCount: "17",
      dueCount: "6",
    },
  ]);

  const [stats] = await repo.getWordSetReviewStats({
    userId: "user-1",
    now: new Date("2026-01-01T12:00:00.000Z"),
  });

  assert.deepEqual(stats, {
    wordSetId: "set-1",
    itemCount: 18,
    enabledItemCount: 17,
    dueCount: 6,
  });
});
