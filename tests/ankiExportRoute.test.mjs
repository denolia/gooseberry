import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";

function loadRoute() {
  const speechCalls = [];
  const packageCalls = [];
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
        getWordSetItems: async () => [
          { id: "item-1", original: "Hallo", isEnabled: true },
          { id: "item-2", original: "Hallo", isEnabled: true },
        ],
        updateLastExportedAt: async () => {},
      },
      "@/app/utils/ankiMapper": {
        mapWordSetItemToAnkiNote: (item) => ({
          original: item.original,
          translation: "hello",
          wordForms: "",
          sample: "",
          sampleTranslation: "",
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
      "@/lib/anki/csvExporter": { createCsvContent: () => "csv" },
      "@/lib/audio/speech": {
        generateSpeechMp3: async (...args) => {
          speechCalls.push(args);
          return Uint8Array.from([73, 68, 51]);
        },
      },
      "node:crypto": { createHash },
    };
    if (!(name in mocks)) throw new Error(`Unexpected dependency ${name}`);
    return mocks[name];
  }, exports);

  return { route: exports, packageCalls, speechCalls };
}

test("audio deck export generates duplicate pronunciations once and embeds them", async () => {
  const { route, packageCalls, speechCalls } = loadRoute();
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
  assert.equal(
    packageCalls[0][4][0].filename,
    packageCalls[0][1][0].sourceAudio,
  );
});
