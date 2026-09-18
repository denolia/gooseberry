import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const cursorId = "11111111-1111-4111-8111-111111111111";
const cursorTimestamp = "2026-09-18 12:34:56.123456+00";

function loadRoute({
  session = { user: { id: "user-1" } },
  page = { items: [], nextCursor: null },
} = {}) {
  const calls = [];
  const code = ts.transpileModule(
    readFileSync(
      new URL("../src/app/api/history/list/route.ts", import.meta.url),
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
    const mocks = {
      "next/server": { NextResponse: Response },
      "@/auth": { auth: async () => session },
      "@/db/translationRepo": {
        listTranslationHistoryPage: async (...args) => {
          calls.push(args);
          return page;
        },
      },
    };
    if (!(name in mocks)) throw new Error(`Unexpected dependency ${name}`);
    return mocks[name];
  }, exports);

  return { route: exports, calls };
}

function loadTranslationRepo(rows) {
  const query = {};
  const code = ts.transpileModule(
    readFileSync(
      new URL("../src/db/translationRepo.ts", import.meta.url),
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
    const expression =
      (op) =>
      (...args) => ({ op, args });
    const mocks = {
      "@/db/drizzle": {
        getDb: () => ({
          select: () => ({
            from: () => ({
              where: (where) => {
                query.where = where;
                return {
                  orderBy: (...orderBy) => {
                    query.orderBy = orderBy;
                    return {
                      limit: async (limit) => {
                        query.limit = limit;
                        return rows;
                      },
                    };
                  },
                };
              },
            }),
          }),
        }),
      },
      "@/db/schema": {
        appUser: {},
        translationHistory: {
          userId: "history.userId",
          createdAt: "history.createdAt",
          id: "history.id",
        },
      },
      "drizzle-orm": {
        and: expression("and"),
        desc: expression("desc"),
        eq: expression("eq"),
        inArray: expression("inArray"),
        lt: expression("lt"),
        or: expression("or"),
      },
    };
    if (!(name in mocks)) throw new Error(`Unexpected dependency ${name}`);
    return mocks[name];
  }, exports);

  return { repo: exports, query };
}

test("history endpoint requests 50 rows and returns an opaque next cursor", async () => {
  const row = {
    id: "22222222-2222-4222-8222-222222222222",
    sourceLang: "German",
    targetLang: "en",
    inputText: "Hallo",
    responseJson: { original: "Hallo", translation: "Hello" },
    model: "test",
    createdAt: new Date("2026-09-18T12:35:00.000Z"),
  };
  const { route, calls } = loadRoute({
    page: {
      items: [row],
      nextCursor: { createdAt: cursorTimestamp, id: cursorId },
    },
  });

  const response = await route.GET(
    new Request("http://localhost/api/history/list"),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [["user-1", { limit: 50, cursor: undefined }]]);
  assert.equal(body.history[0].id, row.id);
  assert.deepEqual(route.decodeHistoryCursor(body.nextCursor), {
    createdAt: cursorTimestamp,
    id: cursorId,
  });
});

test("history endpoint decodes the cursor for the next page", async () => {
  const instance = loadRoute();
  const cursor = instance.route.encodeHistoryCursor({
    createdAt: cursorTimestamp,
    id: cursorId,
  });

  const response = await instance.route.GET(
    new Request(
      `http://localhost/api/history/list?cursor=${encodeURIComponent(cursor)}`,
    ),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(instance.calls, [
    [
      "user-1",
      { limit: 50, cursor: { createdAt: cursorTimestamp, id: cursorId } },
    ],
  ]);
});

test("history endpoint rejects invalid cursors before querying the database", async () => {
  const { route, calls } = loadRoute();
  const response = await route.GET(
    new Request("http://localhost/api/history/list?cursor=not-a-cursor"),
  );

  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test("history endpoint requires authentication", async () => {
  const { route, calls } = loadRoute({ session: null });
  const response = await route.GET(
    new Request("http://localhost/api/history/list"),
  );

  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test("history repository fetches one extra row and derives the next cursor", async () => {
  const rows = Array.from({ length: 51 }, (_, index) => ({
    id: `${index}`.padStart(36, "0"),
    createdAt: `2026-09-18 12:00:${`${51 - index}`.padStart(2, "0")}.000000+00`,
  }));
  const { repo, query } = loadTranslationRepo(rows);
  const page = await repo.listTranslationHistoryPage("user-1", { limit: 50 });

  assert.equal(query.limit, 51);
  assert.equal(query.orderBy.length, 2);
  assert.equal(page.items.length, 50);
  assert.deepEqual(page.nextCursor, {
    createdAt: rows[49].createdAt,
    id: rows[49].id,
  });
});

test("history repository applies the timestamp and id cursor tie-breaker", async () => {
  const { repo, query } = loadTranslationRepo([]);
  await repo.listTranslationHistoryPage("user-1", {
    limit: 50,
    cursor: { createdAt: cursorTimestamp, id: cursorId },
  });

  const serializedFilter = JSON.stringify(query.where);
  assert.match(serializedFilter, /history\.createdAt/);
  assert.match(serializedFilter, /history\.id/);
  assert.match(serializedFilter, new RegExp(cursorId));
});

test("history repository ends pagination on a partial page", async () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    id: `${index}`.padStart(36, "0"),
    createdAt: cursorTimestamp,
  }));
  const { repo } = loadTranslationRepo(rows);
  const page = await repo.listTranslationHistoryPage("user-1", { limit: 50 });

  assert.equal(page.items.length, 12);
  assert.equal(page.nextCursor, null);
});
