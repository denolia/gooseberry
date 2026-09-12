import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { isAdminEmail } from "../src/lib/admin/access.ts";
import { countInputWords } from "../src/lib/admin/wordCount.ts";

process.env.ADMIN_EMAILS = "admin-one@example.com, ADMIN-TWO@example.com";

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

function guard(session, user) {
  let dbReads = 0;
  const { requireAdmin } = loadModule("../src/lib/admin/requireAdmin.ts", {
    "@/auth": { auth: async () => session },
    "@/db/drizzle": {
      getDb: () => {
        dbReads++;
        return {
          select: () => ({
            from: () => ({
              where: () => ({ limit: async () => (user ? [user] : []) }),
            }),
          }),
        };
      },
    },
    "@/db/schema": { appUser: { id: "id" } },
    "drizzle-orm": { eq: () => true },
    "next/navigation": {
      notFound: () => {
        throw new Error("NOT_FOUND");
      },
    },
    "@/lib/admin/access": { isAdminEmail },
  });
  return { requireAdmin, reads: () => dbReads };
}

test("admin access fails closed for signed-out, ordinary and lookalike accounts before database access", async () => {
  for (const session of [
    null,
    { user: {} },
    { user: { id: "1", email: "normal@gmail.com" } },
    { user: { id: "1", email: "admin-one@example.com.evil.org" } },
  ]) {
    const instance = guard(session);
    await assert.rejects(instance.requireAdmin(), /NOT_FOUND/);
    assert.equal(instance.reads(), 0);
  }
});
test("configured admins are accepted, but a missing, non-Google or changed database account is denied", async () => {
  for (const email of ["admin-one@example.com", "admin-two@example.com"]) {
    const session = { user: { id: "1", email: email.toUpperCase() } };
    const user = { id: "1", email, provider: "google" };
    assert.equal(await guard(session, user).requireAdmin(), user);
    for (const denied of [
      undefined,
      { ...user, provider: "other" },
      { ...user, email: "ordinary@gmail.com" },
    ]) {
      await assert.rejects(guard(session, denied).requireAdmin(), /NOT_FOUND/);
    }
  }
});
test("admin access fails closed when ADMIN_EMAILS is missing or empty", () => {
  const configuredAdminEmails = process.env.ADMIN_EMAILS;

  delete process.env.ADMIN_EMAILS;
  assert.equal(isAdminEmail("admin-one@example.com"), false);

  process.env.ADMIN_EMAILS = "  ,  ";
  assert.equal(isAdminEmail("admin-one@example.com"), false);

  process.env.ADMIN_EMAILS = configuredAdminEmails;
});
test("word counts handle phrases, punctuation and non-Latin input", () => {
  assert.equal(countInputWords("  Guten Tag!  "), 2);
  assert.equal(countInputWords("Привет, мир!"), 2);
  assert.equal(countInputWords("... 🦔"), 0);
});

test("usage is attributed to the user, preserves billable failures and distinguishes missing usage from zero", async () => {
  let recorded, updated;
  const { startUsage, finishUsage } = loadModule("../src/db/usageRepo.ts", {
    "drizzle-orm": {
      eq: (column, id) => {
        assert.equal(id, "usage-1");
      },
    },
    "@/db/schema": { aiUsage: { id: "id" } },
    "@/db/drizzle": {
      getDb: () => ({
        insert: () => ({
          values: (value) => {
            recorded = value;
            return { returning: async () => [{ id: "usage-1" }] };
          },
        }),
        update: () => ({
          set: (value) => {
            updated = value;
            return { where: async () => {} };
          },
        }),
      }),
    },
  });
  assert.equal(
    await startUsage({
      userId: "user-1",
      operation: "translate",
      model: "test",
      inputWords: 2,
    }),
    "usage-1",
  );
  assert.equal(recorded.userId, "user-1");
  await finishUsage("usage-1", "failed", {
    id: "response-1",
    model: "actual-model",
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      prompt_tokens_details: { cached_tokens: 20 },
      completion_tokens_details: { reasoning_tokens: 30 },
    },
  });
  assert.equal(updated.status, "failed");
  assert.equal(updated.inputTokens, 100);
  assert.equal(updated.outputTokens, 50);
  assert.equal(updated.cachedInputTokens, 20);
  assert.equal(updated.reasoningTokens, 30);
  assert.equal(updated.model, "actual-model");
  await finishUsage("usage-1", "failed");
  assert.equal(updated.inputTokens, null);
  assert.equal(updated.outputTokens, null);
  await finishUsage("usage-1", "succeeded", {
    id: "response-2",
    model: "test",
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
  assert.equal(updated.inputTokens, 0);
});

test("translation route records tokens for invalid output and persists usage before completing successful streams", async () => {
  for (const valid of [true, false]) {
    const calls = [];
    const completion = {
      id: "response-1",
      model: "test",
      usage: { prompt_tokens: 100, completion_tokens: 20 },
      choices: [
        {
          message: { content: valid ? "{}" : "invalid JSON" },
          finish_reason: "stop",
        },
      ],
    };
    const route = loadModule("../src/app/api/translate/route.ts", {
      openai: {
        default: class {
          chat = {
            completions: {
              stream: () => {
                calls.push("openai");
                return {
                  on: () => {},
                  finalChatCompletion: async () => completion,
                };
              },
            },
          };
        },
      },
      "next/server": { NextResponse: { json: Response.json } },
      "openai/helpers/zod": { zodResponseFormat: () => ({}) },
      "@/app/utils/translationSchema": {
        BaseTranslationResponseSchema: { parse: (value) => value },
      },
      "@/auth": { auth: async () => ({ user: { id: "authenticated-user" } }) },
      "@/app/api/translate/getTranslationPrompt": {
        getTranslationPrompt: () => "test",
      },
      "@/db/translationRepo": {
        insertTranslation: async () => {
          calls.push("history");
        },
      },
      "@/components/ui/Languages": {
        isSourceLanguage: (value) => value === "German",
        isTargetLanguage: (value) => value === "English",
        SourceLanguages: { German: "German", Finnish: "Finnish" },
        TargetLanguages: { English: "English" },
        getLanguageCode: () => "en",
      },
      "@/lib/admin/wordCount": { countInputWords },
      "@/db/usageRepo": {
        startUsage: async (input) => {
          assert.equal(input.userId, "authenticated-user");
          calls.push("reserve");
          return "usage-1";
        },
        finishUsage: async (id, status, response) => {
          assert.equal(id, "usage-1");
          assert.equal(status, valid ? "succeeded" : "failed");
          assert.equal(response.usage.prompt_tokens, 100);
          calls.push("usage");
        },
      },
    });
    const response = await route.POST(
      new Request("http://localhost/api/translate", {
        method: "POST",
        body: JSON.stringify({
          text: "Guten Tag",
          sourceLanguage: "German",
          targetLanguage: "English",
          userId: "spoofed-user",
        }),
      }),
    );
    const events = (await response.text()).trim().split("\n").map(JSON.parse);
    assert.deepEqual(
      calls,
      valid
        ? ["reserve", "openai", "history", "usage"]
        : ["reserve", "openai", "usage"],
    );
    assert.equal(events.at(-1).type, valid ? "done" : "error");
  }
});
