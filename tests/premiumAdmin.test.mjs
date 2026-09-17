import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function loadPremiumRepo() {
  const state = {
    adminChecks: 0,
    executed: [],
    updatedValues: null,
    whereUserId: null,
  };
  const sql = (strings, ...values) => ({ strings, values });
  const appUser = {
    id: "app-user-id-column",
    tier: "tier-column",
    premiumGrantedAt: "premium-granted-at-column",
    premiumGrantedBy: "premium-granted-by-column",
  };
  const premiumRequest = {
    id: "premium-request-id-column",
    status: "premium-request-status-column",
  };
  const code = ts.transpileModule(
    readFileSync(new URL("../src/db/premiumRepo.ts", import.meta.url), "utf8"),
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
      "drizzle-orm": {
        and: () => true,
        asc: () => true,
        eq: (_column, value) => {
          state.whereUserId = value;
          return true;
        },
        sql,
      },
      "@/db/schema": { appUser, premiumRequest },
      "@/lib/admin/requireAdmin": {
        requireAdmin: async () => {
          state.adminChecks++;
          return { id: "admin-1" };
        },
      },
      "@/db/drizzle": {
        getDb: () => ({
          execute: async (query) => {
            state.executed.push(query);
            return { rows: [{ user_found: true }] };
          },
          update: () => ({
            set: (values) => {
              state.updatedValues = values;
              return {
                where: () => ({
                  returning: async () => [{ id: "user-1" }],
                }),
              };
            },
          }),
        }),
      },
    };
    if (!(name in mocks)) throw new Error(`Unexpected dependency ${name}`);
    return mocks[name];
  }, exports);
  return { repo: exports, state };
}

test("direct grant records the admin and resolves pending requests atomically", async () => {
  const { repo, state } = loadPremiumRepo();
  assert.equal(await repo.setUserPremiumTier("user-1", "premium"), true);
  assert.equal(state.adminChecks, 1);
  assert.equal(state.executed.length, 1);
  const query = state.executed[0];
  assert.deepEqual(query.values, ["admin-1", "user-1", "admin-1"]);
  const statement = query.strings.join("?");
  assert.match(statement, /UPDATE app_user/);
  assert.match(statement, /UPDATE premium_request/);
  assert.match(statement, /status = 'pending'/);
});

test("revoking Premium clears the active grant metadata", async () => {
  const { repo, state } = loadPremiumRepo();
  assert.equal(await repo.setUserPremiumTier("user-1", "free"), true);
  assert.equal(state.adminChecks, 1);
  assert.deepEqual(state.updatedValues, {
    tier: "free",
    premiumGrantedAt: null,
    premiumGrantedBy: null,
  });
  assert.equal(state.whereUserId, "user-1");
  assert.equal(state.executed.length, 0);
});
