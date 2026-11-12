import assert from "node:assert/strict";
import test from "node:test";
import { loadSourceModule } from "./helpers/sourceModule.mjs";

const userId = "11111111-1111-4111-8111-111111111111";
const setId = "22222222-2222-4222-8222-222222222222";
const input = {
  reviewId: crypto.randomUUID(),
  studyCardId: crypto.randomUUID(),
  sessionId: crypto.randomUUID(),
  exposureId: crypto.randomUUID(),
  replacementExposureId: crypto.randomUUID(),
  rating: 3,
  reviewedAt: "2026-11-10T12:00:00Z",
  durationMs: 1500,
};
function setup({
  authenticated = true,
  foreign = false,
  conflict = false,
} = {}) {
  const calls = [];
  class NotFound extends Error {}
  class Conflict extends Error {}
  const routes = loadSourceModule("src/lib/review/routes.ts", {
    "next/server": { NextResponse: Response },
    "@/auth": {
      auth: async () => (authenticated ? { user: { id: userId } } : null),
    },
    "@/db/studyScope": {
      StudyScopeNotFoundError: NotFound,
      getOwnedStudyCardSet: async (owner, card) => {
        assert.equal(owner, userId);
        assert.equal(card, input.studyCardId);
        if (foreign) throw new NotFound();
        return setId;
      },
    },
    "@/db/studyDay": { serializeStudyDay: (day) => day },
    "@/db/studyActivityRepo": {},
    "@/db/studyExposureRepo": {},
    "@/db/reviewRepo": {
      ReviewCardNotFoundError: NotFound,
      ReviewWriteConflictError: Conflict,
      undoReview: async (operation) => {
        calls.push(operation);
        if (conflict) throw new Conflict();
        return {
          card: {
            id: operation.studyCardId,
            templateKey: "recognition",
            state: { state: 0 },
          },
          exposure: { id: operation.replacementExposureId },
          studyDay: { timeZone: "UTC" },
        };
      },
      exposureAwareRatingPreviews: (_key, ratings) => ratings,
    },
    "@/lib/review/fsrs": {
      previewRatings: () => [{ rating: 3, intervalMs: 600000 }],
    },
  });
  const { POST } = loadSourceModule("src/app/api/study/reviews/undo/route.ts", {
    "@/lib/review/routes": routes,
  });
  return {
    calls,
    submit: (body = input) =>
      POST(
        new Request("https://gooseberry.test/api/study/reviews/undo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
  };
}

test("undo authenticates, validates ownership and forwards the exact session-bound action", async () => {
  const route = setup();
  const response = await route.submit();
  assert.equal(response.status, 200);
  assert.equal(route.calls.length, 1);
  assert.equal(route.calls[0].userId, userId);
  assert.equal(route.calls[0].wordSetId, setId);
  assert.equal(route.calls[0].reviewEventId, input.reviewId);
  assert.equal(route.calls[0].sessionId, input.sessionId);
  assert.equal(
    route.calls[0].replacementExposureId,
    input.replacementExposureId,
  );
  assert.equal(
    route.calls[0].reviewedAt.toISOString(),
    new Date(input.reviewedAt).toISOString(),
  );
  const body = await response.json();
  assert.equal(body.exposure.id, input.replacementExposureId);
  assert.equal(body.card.ratings[0].rating, 3);
});

test("undo rejects unauthenticated, foreign and malformed requests without a write", async () => {
  for (const [options, payload, status] of [
    [{ authenticated: false }, input, 401],
    [{ foreign: true }, input, 404],
    [{}, { ...input, sessionId: undefined }, 400],
    [{}, { ...input, replacementExposureId: "invalid" }, 400],
    [{}, { ...input, rating: 0 }, 400],
    [{}, null, 400],
  ]) {
    const route = setup(options);
    assert.equal((await route.submit(payload)).status, status);
    assert.equal(route.calls.length, 0);
  }
});

test("incompatible progress returns a reviewable conflict", async () => {
  const response = await setup({ conflict: true }).submit();
  assert.equal(response.status, 409);
  assert.equal(
    (await response.json()).errorCode,
    "errors.couldNotUndoChangedReview",
  );
});
