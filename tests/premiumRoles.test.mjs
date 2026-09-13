import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function loadModule(path, mocks) {
  const code = ts.transpileModule(
    readFileSync(new URL(path, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const exports = {};
  new Function("require", "exports", code)((name) => {
    if (!(name in mocks)) throw new Error(`Unexpected dependency ${name}`);
    return mocks[name];
  }, exports);
  return exports;
}

test("premium entitlement follows the stored tier and not the admin role", async () => {
  for (const [tier, expected] of [
    ["free", false],
    ["premium", true],
  ]) {
    const { hasPremiumAccess } = loadModule(
      "../src/lib/premium/entitlements.ts",
      {
        "drizzle-orm": { eq: () => true },
        "@/db/schema": { appUser: { id: "id", tier: "tier" } },
        "@/db/drizzle": {
          getDb: () => ({
            select: () => ({
              from: () => ({
                where: () => ({ limit: async () => [{ tier }] }),
              }),
            }),
          }),
        },
      },
    );
    assert.equal(await hasPremiumAccess("admin-user"), expected);
  }
});

test("an admin profile displays its actual free tier", async () => {
  const appUser = { id: "user-id" };
  const userPreference = { userId: "preference-user-id" };
  const premiumRequest = { userId: "request-user-id", status: "status" };
  const user = {
    id: "admin-user",
    email: "admin@example.com",
    name: "Admin",
    imageUrl: null,
    tier: "free",
    createdAt: new Date(),
    premiumGrantedAt: null,
  };
  const { getUserProfile } = loadModule("../src/db/profileRepo.ts", {
    "drizzle-orm": {
      and: () => true,
      desc: () => true,
      eq: () => true,
    },
    "@/db/schema": { appUser, userPreference, premiumRequest },
    "@/lib/admin/access": {
      isAdminEmail: (email) => email === "admin@example.com",
    },
    "@/components/ui/Languages": {
      isSourceLanguage: (value) => value === "German",
      isTargetLanguage: (value) => value === "English",
    },
    "@/db/drizzle": {
      getDb: () => ({
        select: () => ({
          from: (table) => {
            if (table === appUser) {
              return { where: () => ({ limit: async () => [user] }) };
            }
            if (table === userPreference) {
              return { where: () => ({ limit: async () => [] }) };
            }
            return {
              where: () => ({
                orderBy: () => ({ limit: async () => [] }),
              }),
            };
          },
        }),
      }),
    },
  });

  const profile = await getUserProfile("admin-user");
  assert.equal(profile.tier, "free");
  assert.equal(profile.isAdmin, true);
});
