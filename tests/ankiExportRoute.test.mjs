import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "@typescript/typescript6";
import * as templates from "../src/lib/review/templates.ts";

function loadRoute({
  premium = true,
  cachedAudio = null,
  items = [
    { id: "item-1", original: "Hallo" },
    { id: "item-2", original: "Hallo" },
  ],
} = {}) {
  const speechCalls = [];
  const packageCalls = [];
  const cacheCalls = [];
  const cacheLookups = [];
  const exportedCalls = [];
  const csvCalls = [];
  const code = ts.transpileModule(
    readFileSync(
      new URL("../src/app/api/word-sets/[id]/export/route.ts", import.meta.url),
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
      "@/auth": { auth: async () => ({ user: { id: "user-1" } }) },
      "@/db/wordSetRepo": {
        getWordSet: async () => ({
          name: "Test",
          sourceLang: "de",
          targetLang: "ru",
        }),
        getWordSetItems: async () => items,
        updateLastExportedAt: async (...args) => exportedCalls.push(args),
      },
      "@/app/utils/ankiMapper": {
        mapWordSetItemToAnkiNote: (item) => ({
          original: item.original,
          translation: item.translation ?? "hello",
          wordForms: item.wordForms ?? "",
          sample: item.sample ?? "",
          sampleTranslation: item.sampleTranslation ?? "",
          comments: "",
          tags: "",
          sourceId: item.id,
          guid: item.id,
        }),
      },
      "@/lib/anki/apkgExporter": {
        createApkgPackage: async (...args) => {
          packageCalls.push(args);
          return Buffer.from("PK-test");
        },
      },
      "@/lib/anki/csvExporter": {
        createCsvContent: (...args) => {
          csvCalls.push(args);
          return "csv";
        },
      },
      "@/lib/review/templates": templates,
      "@/lib/audio/speech": {
        generateSpeechMp3: async (...args) => {
          speechCalls.push(args);
          return Uint8Array.from([73, 68, 51]);
        },
      },
      "@/lib/premium/entitlements": {
        hasPremiumAccess: async () => premium,
      },
      "@/db/speechCacheRepo": {
        getCachedSpeech: async (...args) => {
          cacheLookups.push(args);
          return cachedAudio;
        },
        cacheSpeech: async (...args) => cacheCalls.push(args),
      },
      "node:crypto": { createHash },
    };
    if (!(name in mocks)) throw new Error(`Unexpected dependency ${name}`);
    return mocks[name];
  }, exports);

  return {
    route: exports,
    packageCalls,
    speechCalls,
    cacheCalls,
    cacheLookups,
    exportedCalls,
    csvCalls,
  };
}

test("audio deck export generates duplicate pronunciations once and embeds them", async () => {
  const { route, packageCalls, speechCalls, cacheCalls } = loadRoute();
  const response = await route.POST(
    new Request(
      "http://localhost/api/word-sets/set-1/export?format=apkg&audio=1",
      { method: "POST" },
    ),
    { params: Promise.resolve({ id: "set-1" }) },
  );

  assert.equal(response.status, 200);
  assert.equal(speechCalls.length, 1);
  assert.equal(speechCalls[0][0], "Hallo");
  assert.equal(packageCalls.length, 1);
  assert.equal(
    packageCalls[0][1][0].sourceAudio,
    packageCalls[0][1][1].sourceAudio,
  );
  assert.match(
    packageCalls[0][1][0].sourceAudio,
    /^gooseberry-[a-f0-9]{24}\.mp3$/,
  );
  assert.equal(packageCalls[0][4].length, 1);
  assert.equal(cacheCalls.length, 1);
  assert.equal(
    packageCalls[0][4][0].filename,
    packageCalls[0][1][0].sourceAudio,
  );
});

test("free accounts cannot request an audio deck", async () => {
  const { route, packageCalls, speechCalls } = loadRoute({ premium: false });
  const response = await route.POST(
    new Request(
      "http://localhost/api/word-sets/set-1/export?format=apkg&audio=1",
      { method: "POST" },
    ),
    { params: Promise.resolve({ id: "set-1" }) },
  );
  assert.equal(response.status, 403);
  assert.equal(speechCalls.length, 0);
  assert.equal(packageCalls.length, 0);
});

test("cached pronunciation is reused without another speech request", async () => {
  const cachedAudio = Uint8Array.from([1, 2, 3]);
  const { route, packageCalls, speechCalls, cacheCalls } = loadRoute({
    cachedAudio,
  });
  const response = await route.POST(
    new Request(
      "http://localhost/api/word-sets/set-1/export?format=apkg&audio=1",
      { method: "POST" },
    ),
    { params: Promise.resolve({ id: "set-1" }) },
  );
  assert.equal(response.status, 200);
  assert.equal(speechCalls.length, 0);
  assert.equal(cacheCalls.length, 0);
  assert.equal(packageCalls[0][4][0].data, cachedAudio);
});

test("Anki export rejects any unusable imported note before pronunciation or package generation", async () => {
  for (const audio of ["", "&audio=1"]) {
    const calls = loadRoute({
      items: [
        { id: "ready", original: "Hallo" },
        { id: "incomplete", original: " ", translation: "hello" },
      ],
    });
    const response = await calls.route.POST(
      new Request(
        `http://localhost/api/word-sets/set-1/export?format=apkg${audio}`,
        { method: "POST" },
      ),
      { params: Promise.resolve({ id: "set-1" }) },
    );
    assert.equal(response.status, 400);
    assert.match(
      (await response.json()).error,
      /Complete their missing content/,
    );
    assert.equal(calls.packageCalls.length, 0);
    assert.equal(calls.speechCalls.length, 0);
    assert.equal(calls.cacheLookups.length, 0);
    assert.equal(calls.cacheCalls.length, 0);
    assert.equal(calls.exportedCalls.length, 0);
  }
});

test("Anki export allows every note with at least one usable exercise and omits blank-word audio", async () => {
  const calls = loadRoute({
    items: [
      {
        id: "forms-only",
        original: "Haus",
        translation: "",
        wordForms: "Häuser",
      },
      {
        id: "example-only",
        original: "",
        translation: "",
        sample: "Hallo!",
        sampleTranslation: "Привет!",
      },
    ],
  });
  const response = await calls.route.POST(
    new Request(
      "http://localhost/api/word-sets/set-1/export?format=apkg&audio=1",
      { method: "POST" },
    ),
    { params: Promise.resolve({ id: "set-1" }) },
  );
  assert.equal(response.status, 200);
  assert.equal(
    calls.packageCalls[0][1].length,
    2,
    "every usable note is exported",
  );
  assert.equal(calls.speechCalls.length, 1);
  assert.equal(calls.speechCalls[0][0], "Haus");
  assert.equal(calls.packageCalls[0][1][1].sourceAudio, undefined);
  assert.equal(calls.exportedCalls.length, 1);
});

test("CSV export retains incomplete notes as a portable text fallback", async () => {
  const calls = loadRoute({
    items: [{ id: "incomplete", original: "", translation: "hello" }],
  });
  const response = await calls.route.POST(
    new Request("http://localhost/api/word-sets/set-1/export?format=csv", {
      method: "POST",
    }),
    { params: Promise.resolve({ id: "set-1" }) },
  );
  assert.equal(response.status, 200);
  assert.equal(calls.csvCalls[0][0].length, 1);
  assert.equal(calls.csvCalls[0][0][0].original, "");
  assert.equal(calls.packageCalls.length, 0);
  assert.equal(calls.speechCalls.length, 0);
  assert.equal(calls.exportedCalls.length, 1);
});
