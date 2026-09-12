import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function loadRoute({ session = { user: { id: "user-1" } } } = {}) {
  const calls = [];
  const code = ts.transpileModule(
    readFileSync(
      new URL("../src/app/api/speech/route.ts", import.meta.url),
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
      "@/auth": { auth: async () => session },
      "@/components/ui/Languages": {
        SourceLanguages: { German: "German", Finnish: "Finnish" },
        getLanguageCode: (language) =>
          ({ German: "de", Finnish: "fi" })[language],
        isSourceLanguage: (value) => ["German", "Finnish"].includes(value),
        isSourceLanguageCode: (value) => ["de", "fi"].includes(value),
      },
      openai: {
        default: class {
          audio = {
            speech: {
              create: async (input) => {
                calls.push(input);
                return {
                  arrayBuffer: async () =>
                    Uint8Array.from([73, 68, 51]).buffer,
                };
              },
            },
          };
        },
      },
      "next/server": { NextResponse: { json: Response.json } },
    };
    if (!(name in mocks)) throw new Error(`Unexpected dependency ${name}`);
    return mocks[name];
  }, exports);

  return { route: exports, calls };
}

test("speech route requires authentication", async () => {
  const { route, calls } = loadRoute({ session: null });
  const response = await route.POST(
    new Request("http://localhost/api/speech", {
      method: "POST",
      body: JSON.stringify({ text: "Hallo", sourceLanguage: "de" }),
    }),
  );

  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test("speech route accepts a source language code and returns an MP3", async () => {
  const { route, calls } = loadRoute();
  const response = await route.POST(
    new Request("http://localhost/api/speech", {
      method: "POST",
      body: JSON.stringify({ text: "  Hyvää päivää  ", sourceLanguage: "fi" }),
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, "Hyvää päivää");
  assert.match(calls[0].instructions, /Finnish/);
  assert.equal(calls[0].response_format, "mp3");
});

test("speech route rejects missing language and oversized input", async () => {
  for (const input of [
    { text: "Hallo", sourceLanguage: "unknown" },
    { text: "x".repeat(501), sourceLanguage: "German" },
  ]) {
    const { route, calls } = loadRoute();
    const response = await route.POST(
      new Request("http://localhost/api/speech", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );

    assert.equal(response.status, 400);
    assert.equal(calls.length, 0);
  }
});
