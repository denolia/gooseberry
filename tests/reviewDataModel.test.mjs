import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import {
  FsrsCardState,
  NATIVE_STUDY_CARD_TEMPLATE,
  ReviewRating,
  ReviewRatingSchema,
} from "../src/lib/review/model.ts";

test("review ratings and persisted states match the FSRS numeric contract", () => {
  assert.deepEqual(ReviewRating, { Again: 1, Hard: 2, Good: 3, Easy: 4 });
  assert.deepEqual(FsrsCardState, {
    New: 0,
    Learning: 1,
    Review: 2,
    Relearning: 3,
  });
  assert.equal(ReviewRatingSchema.safeParse(1).success, true);
  assert.equal(ReviewRatingSchema.safeParse(4).success, true);
  assert.equal(ReviewRatingSchema.safeParse(0).success, false);
  assert.equal(ReviewRatingSchema.safeParse(5).success, false);
});

test("the review migration backfills stable native card identities", () => {
  const migration = readFileSync(
    new URL("../migrations/0005_native_review_foundation.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /CREATE TABLE "study_card"/);
  assert.match(migration, /CREATE TABLE "review_event"/);
  assert.match(migration, /CREATE TABLE "fsrs_card_state"/);
  assert.match(
    migration,
    /SELECT "id", 'recognition', "created_at" FROM "word_set_item"/,
  );
});

test("adding content creates its native study card in the same transaction", async () => {
  const operations = [];
  const batchedQueries = [];
  const tables = {
    wordSet: { name: "wordSet" },
    wordSetItem: { name: "wordSetItem", id: "wordSetItem.id" },
    studyCard: { name: "studyCard" },
  };
  const db = {
    insert(table) {
      return {
        values(values) {
          operations.push({ table: table.name, values });
          if (table === tables.wordSetItem) {
            return {
              returning: () => ({ kind: "insert-items" }),
            };
          }
          return { kind: "insert-cards" };
        },
      };
    },
    async batch(queries) {
      batchedQueries.push(...queries);
      return [[{ id: "item-1" }], undefined];
    },
  };
  const code = ts.transpileModule(
    readFileSync(new URL("../src/db/wordSetRepo.ts", import.meta.url), "utf8"),
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
    const mocks = {
      "@/db/drizzle": {
        getDb: () => db,
      },
      "@/db/schema": tables,
      "@/lib/review/model": { NATIVE_STUDY_CARD_TEMPLATE },
      "drizzle-orm": {
        and: expression,
        desc: expression,
        eq: expression,
        inArray: expression,
      },
    };
    if (!(name in mocks)) throw new Error(`Unexpected dependency ${name}`);
    return mocks[name];
  }, exports);

  const inserted = await exports.addItemsToWordSet("set-1", [
    {
      ankiNoteGuid: "note-1",
      original: "Hallo",
      translation: "Hello",
      position: 0,
    },
  ]);

  assert.deepEqual(inserted, [{ id: "item-1" }]);
  assert.deepEqual(batchedQueries, [
    { kind: "insert-items" },
    { kind: "insert-cards" },
  ]);
  assert.equal(operations[0].table, "wordSetItem");
  assert.equal(operations[1].table, "studyCard");
  assert.equal(
    operations[1].values[0].wordSetItemId,
    operations[0].values[0].id,
  );
  assert.equal(operations[1].values[0].templateKey, NATIVE_STUDY_CARD_TEMPLATE);
});
