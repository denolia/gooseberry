import { messageErrors } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "@typescript/typescript6";
import { loadSourceModule } from "./helpers/sourceModule.mjs";
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
    if (name === "@/i18n/errors") return messageErrors;
    const mocks = {
      "next/server": { NextResponse: Response },
      "@/auth": { auth: async () => session },
      "@/db/reviewRepo": {
        ...errors,
        getReviewQueueTiming: async () => ({
          nextDueAt: null,
          exposureDeferredCount: 0,
        }),
        exposureAwareRatingPreviews: (_key, ratings) => ratings,
        getRecordedCardAvailableAt: async ({ state }) => state.dueAt,
        getNextScheduledReviewAt: async () => null,
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
      "@/db/studyDay": {
        getStudyDay: async (_userId, instant) => ({
          startAt: instant,
          nextStartAt: new Date(instant.getTime() + 86400000),
          timeZone: "UTC",
        }),
        serializeStudyDay: (day) => ({
          startAt: day.startAt.toISOString(),
          nextStartAt: day.nextStartAt.toISOString(),
          timeZone: day.timeZone,
        }),
      },
      zod: { z },
    };
    if (name === "@/lib/review/routes")
      return loadSourceModule("src/lib/review/routes.ts", {
        ...mocks,
        "@/db/studyScope": {
          assertOwnedStudyScope: async () => {},
          getOwnedStudyCardSet: async () =>
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          StudyScopeNotFoundError: class extends Error {},
        },
      });
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
    new Request(
      "http://localhost/api/word-sets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/review",
    ),
    { params: Promise.resolve({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }) },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.card.original, "Hallo");
  assert.equal(body.cards.length, 1);
  assert.deepEqual(body.card.ratings, [{ rating: 3, intervalMs: 600_000 }]);
  assert.equal(calls.get[0].userId, "user-1");
  assert.deepEqual(calls.get[0].scope, {
    kind: "sets",
    setIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
  });
});

test("review POST validates and records a four-button rating", async () => {
  const { route, calls } = loadRoute();
  const response = await route.POST(
    new Request(
      "http://localhost/api/word-sets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/review",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewId: "22222222-2222-4222-8222-222222222222",
          studyCardId: "11111111-1111-4111-8111-111111111111",
          exposureId: "33333333-3333-4333-8333-333333333333",
          rating: 3,
          reviewedAt: "2026-01-01T12:00:00.000Z",
          durationMs: 1200,
        }),
      },
    ),
    { params: Promise.resolve({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }) },
  );

  assert.equal(response.status, 200);
  assert.equal(calls.record.length, 1);
  assert.equal(calls.record[0].rating, 3);
  assert.equal(
    calls.record[0].exposureId,
    "33333333-3333-4333-8333-333333333333",
  );
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
    new Request(
      "http://localhost/api/word-sets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/review",
    ),
    { params: Promise.resolve({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }) },
  );
  assert.equal(unauthenticatedResponse.status, 401);

  const invalid = loadRoute();
  const invalidResponse = await invalid.route.POST(
    new Request(
      "http://localhost/api/word-sets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/review",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studyCardId: "11111111-1111-4111-8111-111111111111",
          rating: 5,
        }),
      },
    ),
    { params: Promise.resolve({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }) },
  );
  assert.equal(invalidResponse.status, 400);
  assert.equal(invalid.calls.record.length, 0);
});
