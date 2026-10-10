import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "@typescript/typescript6";
import { z } from "zod";
import * as enrichment from "../src/lib/anki/enrichment.ts";
import * as bodies from "../src/lib/http/readJson.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const setId = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333";
const requestKey = "44444444-4444-4444-8444-444444444444";
const context = { params: Promise.resolve({ id: setId, itemId }) };
const content = {
  original: "monikko",
  translation: "множественное число",
  wordForms: "",
  sample: "",
  sampleTranslation: "",
  comments: "",
};
const proposal = {
  values: Object.fromEntries(
    enrichment.ENRICHMENT_FIELDS.map((field) => [
      field,
      field === "wordForms"
        ? "monikot"
        : field === "translation"
          ? "MUST NOT OVERWRITE"
          : null,
    ]),
  ),
  message: "Check the intended sense.",
};

function loadRoute({
  authenticated = true,
  existing = null,
  providerFails = false,
  item = content,
  staleApply = false,
} = {}) {
  const calls = { provider: 0, reserve: [], usage: [], apply: [], lookups: [] };
  let saved = existing;
  class EnrichmentError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }
  class Provider {
    chat = {
      completions: {
        create: async () => {
          calls.provider += 1;
          if (providerFails) throw new Error("Provider unavailable");
          return {
            id: "response-1",
            model: "test-model",
            usage: { prompt_tokens: 25, completion_tokens: 15 },
            choices: [
              {
                finish_reason: "stop",
                message: { content: JSON.stringify(proposal) },
              },
            ],
          };
        },
      },
    };
  }
  const code = ts.transpileModule(
    readFileSync(
      new URL(
        "../src/app/api/word-sets/[id]/items/[itemId]/enrichment/route.ts",
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
    const dependencies = {
      openai: { __esModule: true, default: Provider },
      "openai/helpers/zod": {
        zodResponseFormat: () => ({ type: "json_schema" }),
      },
      "next/server": { NextResponse: Response },
      zod: { z },
      "@/auth": {
        auth: async () => (authenticated ? { user: { id: userId } } : null),
      },
      "@/lib/admin/wordCount": {
        countInputWords: (value) => value.split(/\s+/u).length,
      },
      "@/db/usageRepo": {
        finishUsage: async (...args) => calls.usage.push(args),
      },
      "@/lib/anki/enrichment": enrichment,
      "@/lib/http/readJson": bodies,
      "@/db/enrichmentRepo": {
        EnrichmentError,
        getEnrichmentItem: async (...args) => {
          calls.lookups.push(args);
          return {
            item: { ...item, contentRevision: 2 },
            sourceLang: "fi",
            targetLang: "ru",
            sourceFields: {},
          };
        },
        getEnrichmentRequest: async () => saved,
        reserveEnrichment: async (input) => {
          calls.reserve.push(input);
          saved = {
            id: "usage-1",
            ...input,
            status: "pending",
            proposal: null,
          };
          return { request: saved, isNew: true };
        },
        finishEnrichment: async (_id, value) => {
          saved = {
            ...saved,
            status: value ? "completed" : "failed",
            proposal: value,
          };
        },
        enrichmentResponse: (value) => value,
        applyEnrichment: async (input) => {
          calls.apply.push(input);
          if (staleApply) throw new EnrichmentError("Word changed", 409);
        },
      },
    };
    if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`);
    return dependencies[name];
  }, exports);
  return { route: exports, calls };
}
function request(body, method = "POST") {
  return new Request(
    `http://localhost/api/word-sets/${setId}/items/${itemId}/enrichment`,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}
const input = { requestKey, contentRevision: 2, fields: ["wordForms"] };

test("enrichment is explicit, reserves before the provider and retries without a second call", async () => {
  const { route, calls } = loadRoute();
  const result = await route.POST(request(input), context);
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.proposal.values.wordForms, "monikot");
  assert.equal(body.proposal.values.translation, null);
  assert.equal(calls.provider, 1);
  assert.equal(calls.reserve.length, 1);
  assert(calls.reserve[0].reservedTokens > 4000);
  assert.equal(calls.reserve[0].userId, userId);
  assert.equal(calls.usage[0][1], "succeeded");
  assert.equal((await route.POST(request(input), context)).status, 200);
  assert.equal(calls.provider, 1);
  assert.equal(calls.reserve.length, 1);
});

test("enrichment rejects unauthenticated, stale and already-populated requests before spending", async () => {
  for (const [options, body, status] of [
    [{ authenticated: false }, input, 401],
    [{}, { ...input, contentRevision: 1 }, 409],
    [{}, { ...input, fields: ["translation"] }, 400],
    [{}, { ...input, fields: ["wordForms", "wordForms"] }, 400],
    [
      {
        item: Object.fromEntries(
          enrichment.ENRICHMENT_FIELDS.map((field) => [field, ""]),
        ),
      },
      input,
      400,
    ],
  ]) {
    const { route, calls } = loadRoute(options);
    assert.equal((await route.POST(request(body), context)).status, status);
    assert.equal(calls.provider, 0);
    assert.equal(calls.reserve.length, 0);
  }
});

test("failed calls retain their usage record and the same request does not retry spending", async () => {
  const { route, calls } = loadRoute({ providerFails: true });
  assert.equal((await route.POST(request(input), context)).status, 502);
  assert.equal(calls.usage[0][1], "failed");
  const retry = await route.POST(request(input), context);
  assert.equal((await retry.json()).status, "failed");
  assert.equal(calls.provider, 1);
});

test("pending requests recover without contacting the provider", async () => {
  const { route, calls } = loadRoute({
    existing: { ...input, status: "pending", proposal: null },
  });
  assert.equal((await route.POST(request(input), context)).status, 202);
  assert.equal(calls.provider, 0);
});

test("applying a reviewed proposal keeps ownership context and surfaces stale edits", async () => {
  const { route, calls } = loadRoute({ staleApply: true });
  const result = await route.PATCH(
    request(
      { requestKey, contentRevision: 2, values: { wordForms: "monikot" } },
      "PATCH",
    ),
    context,
  );
  assert.equal(result.status, 409);
  assert.deepEqual(calls.apply[0], {
    userId,
    wordSetId: setId,
    itemId,
    requestKey,
    contentRevision: 2,
    values: { wordForms: "monikot" },
  });
});

test("prompt contains only vocabulary content, and selection never writes unrequested values", () => {
  const prompt = enrichment.buildEnrichmentPrompt({
    sourceLang: "fi",
    targetLang: "ru",
    fields: ["wordForms"],
    content: { ...content, userId: "private-id" },
    sourceFields: { Hint: "m..." },
  });
  assert(!prompt.includes("private-id"));
  assert(prompt.includes("множественное число"));
  assert.deepEqual(
    enrichment.selectEnrichmentValues(["wordForms"], proposal.values),
    { wordForms: "monikot" },
  );
});

test("JSON limits count actual UTF-8 stream bytes even with a false Content-Length", async () => {
  const body = JSON.stringify({ text: "ä".repeat(30) });
  const req = new Request("http://localhost/", {
    method: "POST",
    headers: { "Content-Length": "1" },
    body,
  });
  await assert.rejects(
    bodies.readBoundedJson(req, 40),
    (error) => error.status === 413,
  );
  const invalid = new Request("http://localhost/", {
    method: "POST",
    body: "not JSON",
  });
  await assert.rejects(
    bodies.readBoundedJson(invalid, 100),
    (error) => error.status === 400,
  );
});
