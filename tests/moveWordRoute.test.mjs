import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "@typescript/typescript6";
import { z } from "zod";

const sourceId = "11111111-1111-4111-8111-111111111111";
const itemId = "22222222-2222-4222-8222-222222222222";
const destinationId = "33333333-3333-4333-8333-333333333333";
function setup({ authenticated = true, failure } = {}) {
  const calls = [];
  class MoveWordSetItemError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }
  const code = ts.transpileModule(
    readFileSync(
      new URL(
        "../src/app/api/word-sets/[id]/items/[itemId]/move/route.ts",
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
    const mocks = {
      "next/server": { NextResponse: Response },
      zod: { z },
      "@/auth": {
        auth: async () => (authenticated ? { user: { id: "owner" } } : null),
      },
      "@/db/wordSetRepo": {
        MoveWordSetItemError,
        moveWordSetItem: async (input) => {
          calls.push(input);
          if (failure) throw new MoveWordSetItemError("Move rejected", failure);
          return { id: input.itemId, wordSetId: input.destinationWordSetId };
        },
      },
    };
    if (!(name in mocks)) throw new Error(`Unexpected dependency ${name}`);
    return mocks[name];
  }, exports);
  return {
    calls,
    submit: (
      body = { destinationWordSetId: destinationId },
      params = { id: sourceId, itemId },
    ) =>
      exports.POST(
        new Request("http://localhost/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: typeof body === "string" ? body : JSON.stringify(body),
        }),
        { params: Promise.resolve(params) },
      ),
  };
}

test("move route authenticates and supplies only the owned source, destination and note IDs", async () => {
  const route = setup();
  const response = await route.submit({
    destinationWordSetId: destinationId,
    userId: "forged",
  });
  assert.equal(response.status, 200);
  assert.deepEqual(route.calls, [
    {
      userId: "owner",
      sourceWordSetId: sourceId,
      destinationWordSetId: destinationId,
      itemId,
    },
  ]);
  assert.deepEqual((await response.json()).item, {
    id: itemId,
    wordSetId: destinationId,
  });
  const anonymous = setup({ authenticated: false });
  assert.equal((await anonymous.submit()).status, 401);
  assert.equal(anonymous.calls.length, 0);
});

test("move route rejects invalid IDs and malformed JSON before mutating", async () => {
  const route = setup();
  assert.equal(
    (await route.submit({ destinationWordSetId: "bad" })).status,
    400,
  );
  assert.equal((await route.submit({}, { id: "bad", itemId })).status, 400);
  assert.equal(
    (
      await route.submit(
        { destinationWordSetId: destinationId },
        { id: sourceId, itemId: "bad" },
      )
    ).status,
    400,
  );
  assert.equal((await route.submit("{")).status, 400);
  assert.equal(route.calls.length, 0);
});

test("move route preserves language, ownership and conflict error statuses", async () => {
  for (const failure of [400, 404, 409]) {
    const response = await setup({ failure }).submit();
    assert.equal(response.status, failure);
    assert.equal((await response.json()).error, "Move rejected");
  }
});
