import { messageErrors } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "@typescript/typescript6";
import { z } from "zod";

function setup({ session = { user: { id: "user-1" } }, failure } = {}) {
  const calls = [];
  const displays = [];
  class ReviewCardNotDueError extends Error {}
  const errors = {
    ReviewCardNotDueError,
    ReviewCardNotFoundError: class extends Error {},
    ReviewWriteConflictError: class extends Error {},
    ReviewWordSeenTodayError: class extends ReviewCardNotDueError {},
  };
  const day = {
    startAt: new Date("2026-11-10T01:00:00Z"),
    nextStartAt: new Date("2026-11-11T01:00:00Z"),
    timeZone: "Europe/Berlin",
  };
  const code = ts.transpileModule(
    readFileSync(
      new URL(
        "../src/app/api/word-sets/[id]/review/exposure/route.ts",
        import.meta.url,
      ),
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
    const modules = {
      zod: { z },
      "next/server": { NextResponse: Response },
      "@/auth": { auth: async () => session },
      "@/db/studyDay": {
        getStudyDay: async () => day,
        serializeStudyDay: (value) => ({
          startAt: value.startAt.toISOString(),
          nextStartAt: value.nextStartAt.toISOString(),
          timeZone: value.timeZone,
        }),
      },
      "@/lib/review/fsrs": {
        previewRatings: () => [{ rating: 3, intervalMs: 600000 }],
      },
      "@/db/studyExposureRepo": {
        recordDisplayedStudyCardExposure: async (input) => {
          displays.push(input);
        },
      },
      "@/db/reviewRepo": {
        ...errors,
        exposureAwareRatingPreviews: (_key, ratings) => ratings,
        activateReviewCard: async (input) => {
          calls.push(input);
          if (failure) throw new errors[failure]("Unavailable");
          return {
            card: {
              id: input.studyCardId,
              templateKey: "recognition",
              state: { state: 1 },
            },
            exposure: {
              id: input.exposureId,
              studyCardId: input.studyCardId,
              wordSetItemId: "note",
              activatedAt: input.now,
              stateBefore: 1,
              repsBefore: 2,
            },
            studyDay: day,
          };
        },
      },
    };
    if (!(name in modules)) throw new Error(`Unexpected dependency ${name}`);
    return modules[name];
  }, exports);
  const submit = (
    body = {
      studyCardId: "11111111-1111-4111-8111-111111111111",
      exposureId: "22222222-2222-4222-8222-222222222222",
    },
  ) =>
    exports.POST(
      new Request("http://localhost/api/word-sets/set/review/exposure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: "owned-set" }) },
    );
  return { calls, displays, submit };
}

test("display authorization returns the card, receipt and study-zone boundary", async () => {
  const app = setup();
  const response = await app.submit();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.card.id, body.exposure.studyCardId);
  assert.equal(body.exposure.id, "22222222-2222-4222-8222-222222222222");
  assert.equal(body.studyDay.timeZone, "Europe/Berlin");
  assert.equal(body.studyDay.nextStartAt, "2026-11-11T01:00:00.000Z");
  assert.equal(app.calls[0].wordSetId, "owned-set");
  assert.equal(app.calls[0].userId, "user-1");
  assert(app.calls[0].now instanceof Date);
});

test("authorization requires authentication and validated presentation/card UUIDs", async () => {
  const anonymous = setup({ session: null });
  assert.equal((await anonymous.submit()).status, 401);
  assert.equal(anonymous.calls.length, 0);
  const invalid = setup();
  assert.equal((await invalid.submit({ studyCardId: "bad" })).status, 400);
  assert.equal(invalid.calls.length, 0);
});

test("seen words provide an explicit skip reason; unavailable or unowned cards do not authorize", async () => {
  const seen = setup({ failure: "ReviewWordSeenTodayError" });
  const response = await seen.submit();
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "word_seen_today");
  assert.equal(body.studyDay.nextStartAt, "2026-11-11T01:00:00.000Z");
  assert.equal(seen.displays.length, 0);
  assert.equal(
    (await setup({ failure: "ReviewCardNotFoundError" }).submit()).status,
    404,
  );
  assert.equal(
    (await setup({ failure: "ReviewWriteConflictError" }).submit()).status,
    409,
  );
});

test("reported displays are recorded even when a stale prompt cannot be graded", async () => {
  for (const failure of [
    "ReviewWordSeenTodayError",
    "ReviewCardNotDueError",
    "ReviewCardNotFoundError",
    "ReviewWriteConflictError",
  ]) {
    const app = setup({ failure });
    const response = await app.submit({
      studyCardId: "11111111-1111-4111-8111-111111111111",
      exposureId: "22222222-2222-4222-8222-222222222222",
      displayed: true,
    });
    assert([404, 409].includes(response.status));
    assert.equal(app.displays.length, 1);
    assert.equal(app.displays[0].studyCardId, app.calls[0].studyCardId);
    assert.equal(app.displays[0].userId, "user-1");
    assert.equal(app.displays[0].wordSetId, "owned-set");
    assert.equal(app.displays[0].now.getTime(), app.calls[0].now.getTime());
  }
});
