import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function loadRoute({
  session = { user: { id: "user-1" } },
  result = {
    kind: "created",
    request: { id: "request-1", createdAt: new Date("2026-09-13T10:00:00Z") },
    user: { name: "Ada", email: "ada@example.com" },
  },
} = {}) {
  const emailCalls = [];
  const requestCalls = [];
  const code = ts.transpileModule(
    readFileSync(
      new URL("../src/app/api/premium-requests/route.ts", import.meta.url),
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
      "@/auth": { auth: async () => session },
      "@/db/profileRepo": {
        createPremiumRequest: async (input) => {
          requestCalls.push(input);
          return result;
        },
      },
      "@/lib/premium/email": {
        sendPremiumRequestEmail: async (input) => {
          emailCalls.push(input);
          return true;
        },
      },
    };
    if (!(name in mocks)) throw new Error(`Unexpected dependency ${name}`);
    return mocks[name];
  }, exports);
  return { route: exports, emailCalls, requestCalls };
}

test("saves a premium request and then sends the admin notification", async () => {
  const previousAppUrl = process.env.APP_URL;
  process.env.APP_URL = "https://learn.example.com";
  const { route, emailCalls, requestCalls } = loadRoute();
  const response = await route.POST(
    new Request("http://localhost/api/premium-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Audio decks, please" }),
    }),
  );
  if (previousAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = previousAppUrl;

  assert.equal(response.status, 201);
  assert.deepEqual(requestCalls, [
    { userId: "user-1", message: "Audio decks, please" },
  ]);
  assert.equal(emailCalls.length, 1);
  assert.equal(emailCalls[0].adminUrl, "https://learn.example.com/admin");
  assert.equal(emailCalls[0].email, "ada@example.com");
});

test("does not notify again when a request is already pending", async () => {
  const { route, emailCalls } = loadRoute({
    result: { kind: "already-pending" },
  });
  const response = await route.POST(
    new Request("http://localhost/api/premium-requests", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  );
  assert.equal(response.status, 409);
  assert.equal(emailCalls.length, 0);
});

test("requires authentication and rejects oversized messages", async () => {
  const signedOut = loadRoute({ session: null });
  assert.equal(
    (
      await signedOut.route.POST(
        new Request("http://localhost/api/premium-requests", {
          method: "POST",
        }),
      )
    ).status,
    401,
  );

  const signedIn = loadRoute();
  const response = await signedIn.route.POST(
    new Request("http://localhost/api/premium-requests", {
      method: "POST",
      body: JSON.stringify({ message: "x".repeat(501) }),
    }),
  );
  assert.equal(response.status, 400);
  assert.equal(signedIn.requestCalls.length, 0);
  assert.equal(signedIn.emailCalls.length, 0);
});
