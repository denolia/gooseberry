import { messageErrors } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "@typescript/typescript6";

const reviewedAt = new Date("2026-01-01T12:00:00.000Z");
const nextState = {
  dueAt: new Date("2026-01-01T12:10:00.000Z"),
  stability: 2.3,
  difficulty: 2.1,
  elapsedDays: 0,
  scheduledDays: 0,
  learningSteps: 1,
  reps: 1,
  lapses: 0,
  state: 1,
  lastReviewAt: reviewedAt,
  schedulerVersion: "test-scheduler",
};

function loadRepo({
  conflictOnce = false,
  existingReview = false,
  templateKey = "recognition",
  owned = true,
} = {}) {
  const calls = { batches: [], executes: [], selects: 0, ownedCardReads: 0 };
  const row = {
    id: "11111111-1111-4111-8111-111111111111",
    wordSetItemId: "item-1",
    wordSetId: "set-1",
    wordSetName: "Test",
    sourceLang: "de",
    targetLang: "en",
    templateKey,
    original: "Hallo",
    translation: "Hello",
    wordForms: "",
    sample: "",
    sampleTranslation: "",
    comments: "",
    tags: "",
    introducedAt: new Date("2026-01-01T11:00:00.000Z"),
    introductionAllowed: true,
    projection: null,
  };
  const query = (rows) => ({
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
    orderBy() {
      return this;
    },
    as() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(rows).then(resolve, reject);
    },
    limit: async () => rows,
  });
  const db = {
    $with: () => ({ as: () => ({ id: "id", rank: "rank" }) }),
    with() {
      return this;
    },
    select(fields) {
      calls.selects += 1;
      if (Object.hasOwn(fields, "id")) calls.ownedCardReads += 1;
      const isRecordedReviewLookup =
        fields &&
        Object.hasOwn(fields, "studyCardId") &&
        Object.hasOwn(fields, "reviewedAt") &&
        !Object.hasOwn(fields, "id");
      return query(
        isRecordedReviewLookup
          ? existingReview
            ? [
                {
                  studyCardId: row.id,
                  rating: 3,
                  reviewedAt,
                  projection: { ...nextState, revision: 1 },
                },
              ]
            : []
          : Object.hasOwn(fields, "sequence")
            ? []
            : owned
              ? [row]
              : [],
      );
    },
    insert() {
      return {
        values: (values) => ({ kind: "event", values }),
      };
    },
    execute(statement) {
      calls.executes.push(statement);
      return { kind: "state", statement };
    },
    async batch(queries) {
      calls.batches.push(queries);
      if (conflictOnce && calls.batches.length === 1) {
        throw new Error("division by zero");
      }
      return [undefined, { rows: [{ committed: 1 }] }];
    },
  };
  const code = ts.transpileModule(
    readFileSync(new URL("../src/db/reviewRepo.ts", import.meta.url), "utf8"),
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
    const expression =
      (op) =>
      (...args) => ({ op, args });
    const tables = new Proxy(
      {},
      { get: (_target, property) => String(property) },
    );
    const mocks = {
      "@/db/drizzle": { getDb: () => db },
      "@/db/schema": {
        fsrsCardState: tables,
        reviewEvent: tables,
        studyCard: tables,
        studyCardImportBaseline: tables,
        wordSet: tables,
        wordSetItem: tables,
      },
      "drizzle-orm": {
        and: expression("and"),
        asc: expression("asc"),
        eq: expression("eq"),
        isNull: expression("isNull"),
        lte: expression("lte"),
        notInArray: expression("notInArray"),
        or: expression("or"),
        sql: Object.assign(
          (strings, ...values) => ({
            strings,
            values,
            as() {
              return this;
            },
          }),
          {
            raw: (value) => value,
            join: (values) => values,
          },
        ),
      },
      "@/lib/review/fsrs": {
        applyReview: () => nextState,
        createInitialFsrsState: (introducedAt) => ({
          ...nextState,
          dueAt: introducedAt,
          reps: 0,
        }),
        FSRS_SCHEDULER_VERSION: "test-scheduler",
        replayReviewHistory: (introducedAt) => ({
          ...nextState,
          dueAt: introducedAt,
          reps: 0,
        }),
      },
      "@/lib/review/model": {
        FsrsCardState: { New: 0 },
        ReviewRatingSchema: { parse: (value) => value },
      },
      "@/db/studyCardRepo": {
        availableStudyCardCondition: () => ({ op: "available" }),
        eligibleStudyCardCondition: () => ({ op: "eligible" }),
        studyCardContentCondition: () => ({ op: "content-eligible" }),
        ensureStudyCards: async (userId, wordSetId) => {
          calls.executes.push({
            strings: ["INSERT INTO study_card (...) ON CONFLICT"],
            values: [userId, wordSetId],
          });
        },
      },
      "@/db/reviewProjectionRepo": { ensureReviewProjections: async () => {} },
      "@/db/studyScope": {
        studySetSelection: (input) => input.wordSetId,
        studySetCondition: () => ({ op: "scope" }),
        studyFilterCondition: () => ({ op: "filter" }),
      },
      "@/db/studyAllowance": {
        studyWordAvailabilityCondition: () => ({ op: "allowance" }),
      },
      "@/db/studyPolicy": {
        studyCardIntroductionCondition: () => ({ op: "introduction" }),
      },
      "@/db/studyDay": {
        getStudyDay: async (_userId, instant) => ({
          startAt: new Date(instant.getTime() - 3600000),
          nextStartAt: new Date(instant.getTime() + 3600000),
          timeZone: "UTC",
        }),
      },
      "@/db/studyExposurePolicy": {
        studyExposureAllowedCondition: () => ({ op: "exposure" }),
        firstSensitiveStudyCardCondition: () => ({ op: "first-sensitive" }),
      },
      "@/db/studyExposureRepo": {
        getStudyExposure: async () => ({
          id: "presentation",
          studyCardId: row.id,
          wordSetItemId: row.wordSetItemId,
          stateBefore: 1,
          repsBefore: 0,
          reviewEventId: null,
        }),
        consumeStudyExposure: () => ({ op: "consume" }),
      },
      "@/lib/review/policy": {
        STUDY_CARD_INTRODUCTION_ORDER: [
          "recognition",
          "production",
          "type_answer",
          "word_forms",
          "example",
        ],
      },
    };
    if (!(name in mocks)) throw new Error(`Unexpected dependency ${name}`);
    return mocks[name];
  }, exports);

  return { repo: exports, calls };
}

test("reconciles missing native card identities before selecting a due card", async () => {
  const { repo, calls } = loadRepo();
  const result = await repo.getNextDueReviewCard({
    userId: "user-1",
    wordSetId: "set-1",
    now: reviewedAt,
  });

  assert.equal(result.id, "11111111-1111-4111-8111-111111111111");
  assert.equal(calls.executes.length, 1);
  assert.match(
    calls.executes[0].strings.join(" "),
    /INSERT INTO study_card .* ON CONFLICT/s,
  );
  // The candidate CTE and the card SELECT form one executed SQL statement.
  assert.equal(calls.selects, 2);
});

test("records the review event and state projection in one atomic batch", async () => {
  const { repo, calls } = loadRepo();
  const result = await repo.recordReview({
    userId: "user-1",
    wordSetId: "set-1",
    studyCardId: "11111111-1111-4111-8111-111111111111",
    reviewEventId: "22222222-2222-4222-8222-222222222222",
    rating: 3,
    reviewedAt,
    durationMs: 1200,
  });

  assert.equal(result, nextState);
  assert.equal(calls.batches.length, 1);
  assert.equal(calls.batches[0][2].kind, "event");
  assert.equal(calls.batches[0][2].values.rating, 3);
  assert.equal(calls.batches[0][3].kind, "state");
});

test("records a production exercise using its own card identity", async () => {
  const { repo, calls } = loadRepo({ templateKey: "production" });
  await repo.recordReview({
    userId: "user-1",
    wordSetId: "set-1",
    studyCardId: "11111111-1111-4111-8111-111111111111",
    reviewEventId: "22222222-2222-4222-8222-222222222222",
    rating: 3,
    reviewedAt,
  });

  assert.equal(
    calls.batches[0][2].values.studyCardId,
    "11111111-1111-4111-8111-111111111111",
  );
  assert(
    calls.batches[0][3].statement.values.includes(
      "11111111-1111-4111-8111-111111111111",
    ),
  );
});

test("rejects missing, inactive, or unowned exercises before writing history", async () => {
  const { repo, calls } = loadRepo({ owned: false });
  await assert.rejects(
    repo.recordReview({
      userId: "user-1",
      wordSetId: "set-1",
      studyCardId: "11111111-1111-4111-8111-111111111111",
      reviewEventId: "22222222-2222-4222-8222-222222222222",
      rating: 3,
      reviewedAt,
    }),
    repo.ReviewCardNotFoundError,
  );
  assert.equal(calls.batches.length, 0);
});

test("reloads and retries after an optimistic revision conflict", async () => {
  const { repo, calls } = loadRepo({ conflictOnce: true });
  await repo.recordReview({
    userId: "user-1",
    wordSetId: "set-1",
    studyCardId: "11111111-1111-4111-8111-111111111111",
    reviewEventId: "22222222-2222-4222-8222-222222222222",
    rating: 3,
    reviewedAt,
  });

  assert.equal(calls.batches.length, 2);
  assert.equal(calls.ownedCardReads, 2);
  assert.equal(calls.batches[0][2].values.id, calls.batches[1][2].values.id);
});

test("returns an already-recorded review without writing it twice", async () => {
  const { repo, calls } = loadRepo({ existingReview: true });
  const result = await repo.recordReview({
    userId: "user-1",
    wordSetId: "set-1",
    studyCardId: "11111111-1111-4111-8111-111111111111",
    reviewEventId: "22222222-2222-4222-8222-222222222222",
    rating: 3,
    reviewedAt,
  });

  assert.equal(result.dueAt, nextState.dueAt);
  assert.equal(calls.selects, 1);
  assert.equal(calls.batches.length, 0);
});
