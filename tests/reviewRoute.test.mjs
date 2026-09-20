import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";

function loadRoute({ session = { user: { id: "user-1" } }, card = null } = {}) {
  const calls = { get: [], record: [] };
  const errors = {
    ReviewCardNotFoundError: class ReviewCardNotFoundError extends Error {},
    ReviewCardNotDueError: class ReviewCardNotDueError extends Error {},
    ReviewWriteConflictError: class ReviewWriteConflictError extends Error {},
  };
  const code = ts.transpileModule(
    readFileSync(
      new URL("../src/app/api/word-sets/[id]/review/route.ts", import.meta.url),
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
      "@/db/reviewRepo": {
        ...errors,
        getDueReviewCards: async (input) => {
          calls.get.push(input);
          return card ? [card] : [];
        },
        getNextDueReviewCard: async (input) => {
          calls.get.push(input);
          return card;
        },
        recordReview: async (input) => {
          calls.record.push(input);
          return { dueAt: new Date("2026-01-02T00:00:00.000Z") };
        },
      },
      "@/lib/review/fsrs": {
        previewRatings: () => [{ rating: 3, intervalMs: 600_000 }],
      },
      "@/lib/review/model": {
        ReviewRatingSchema: z.union([
          z.literal(1),
          z.literal(2),
          z.literal(3),
          z.literal(4),
        ]),
      },
      zod: { z },
    };
    if (!(name in mocks)) throw new Error(`Unexpected dependency ${name}`);
    return mocks[name];
  }, exports);

  return { route: exports, calls };
}

test("review GET returns a due card with rating previews", async () => {
  const card = {
    id: "11111111-1111-4111-8111-111111111111",
    original: "Hallo",
    translation: "Hello",
    state: { dueAt: new Date("2026-01-01T00:00:00.000Z") },
  };
  const { route, calls } = loadRoute({ card });
  const response = await route.GET(
    new Request("http://localhost/api/word-sets/set-1/review"),
    { params: Promise.resolve({ id: "set-1" }) },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.card.original, "Hallo");
  assert.equal(body.cards.length, 1);
  assert.deepEqual(body.card.ratings, [{ rating: 3, intervalMs: 600_000 }]);
  assert.equal(calls.get[0].userId, "user-1");
  assert.equal(calls.get[0].wordSetId, "set-1");
});

test("review POST validates and records a four-button rating", async () => {
  const { route, calls } = loadRoute();
  const response = await route.POST(
    new Request("http://localhost/api/word-sets/set-1/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reviewId: "22222222-2222-4222-8222-222222222222",
        studyCardId: "11111111-1111-4111-8111-111111111111",
        rating: 3,
        reviewedAt: "2026-01-01T12:00:00.000Z",
        durationMs: 1200,
      }),
    }),
    { params: Promise.resolve({ id: "set-1" }) },
  );

  assert.equal(response.status, 200);
  assert.equal(calls.record.length, 1);
  assert.equal(calls.record[0].rating, 3);
  assert.equal(
    calls.record[0].reviewEventId,
    "22222222-2222-4222-8222-222222222222",
  );
  assert.equal(
    calls.record[0].reviewedAt.toISOString(),
    "2026-01-01T12:00:00.000Z",
  );
  assert.equal(calls.record[0].durationMs, 1200);
});

test("review routes require authentication and reject invalid ratings", async () => {
  const unauthenticated = loadRoute({ session: null });
  const unauthenticatedResponse = await unauthenticated.route.GET(
    new Request("http://localhost/api/word-sets/set-1/review"),
    { params: Promise.resolve({ id: "set-1" }) },
  );
  assert.equal(unauthenticatedResponse.status, 401);

  const invalid = loadRoute();
  const invalidResponse = await invalid.route.POST(
    new Request("http://localhost/api/word-sets/set-1/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studyCardId: "11111111-1111-4111-8111-111111111111",
        rating: 5,
      }),
    }),
    { params: Promise.resolve({ id: "set-1" }) },
  );
  assert.equal(invalidResponse.status, 400);
  assert.equal(invalid.calls.record.length, 0);
});
