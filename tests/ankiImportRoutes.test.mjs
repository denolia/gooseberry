import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "@typescript/typescript6";

const externalRequire = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../src", import.meta.url));
const jobId = "11111111-1111-4111-8111-111111111111";
class AnkiImportError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
function routes({ authorized = true, notFound = false } = {}) {
  const calls = [];
  const backend = { AnkiImportError };
  for (const name of [
    "beginAnkiImport",
    "listAnkiImports",
    "getAnkiImport",
    "stageAnkiImport",
    "commitAnkiImport",
    "removeAnkiImport",
    "getAnkiImportSource",
  ]) {
    backend[name] = async (...args) => {
      calls.push({ name, args });
      if (notFound) throw new AnkiImportError("Import not found", 404);
      return { jobId, status: "receiving", wordSetId: null };
    };
  }
  const overrides = {
    "@/auth": {
      auth: async () =>
        authorized ? { user: { id: "authenticated-user" } } : null,
    },
    "@/db/ankiImportRepo": backend,
    "next/server": { NextResponse: Response },
  };
  const cache = new Map();
  function load(name, parent = root) {
    if (name in overrides) return overrides[name];
    const filename = name.startsWith("@/")
      ? path.join(root, `${name.slice(2)}.ts`)
      : name.startsWith(".")
        ? path.resolve(parent, `${name}.ts`)
        : null;
    if (!filename) return externalRequire(name);
    if (cache.has(filename)) return cache.get(filename);
    const exports = {};
    cache.set(filename, exports);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    new Function("require", "exports", code)(
      (dependency) => load(dependency, path.dirname(filename)),
      exports,
    );
    return exports;
  }
  return {
    calls,
    begin: load("@/app/api/anki/imports/route"),
    job: load("@/app/api/anki/imports/[id]/route"),
    commit: load("@/app/api/anki/imports/[id]/commit/route"),
    source: load("@/app/api/anki/imports/[id]/source/route"),
    mapping: load("@/lib/anki/import/mapping"),
    schemas: load("@/lib/anki/import/schemas"),
  };
}
const context = (id = jobId) => ({ params: Promise.resolve({ id }) });
const request = (body, method = "POST", headers = {}) =>
  new Request("https://example.com/api/anki/imports", {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const model = {
  id: "123",
  name: "Basic",
  type: 0,
  fields: [
    { name: "Front", ord: 0, raw: {} },
    { name: "Back", ord: 1, raw: {} },
  ],
  templates: [
    {
      name: "Card",
      ord: 0,
      questionFormat: "{{Front}}",
      answerFormat: "{{Back}}",
      raw: {},
    },
  ],
  css: "",
  raw: {},
};
const note = {
  id: "10",
  guid: "guid",
  modelId: "123",
  fields: ["word", "translation"],
  tags: [],
  raw: {},
};
function input() {
  return {
    requestKey: crypto.randomUUID(),
    file: { name: "shared.apkg", size: 18000000, sha256: "a".repeat(64) },
    name: "Imported",
    sourceLang: "fi",
    targetLang: "ru",
    mapping: [
      {
        modelId: "123",
        original: { fields: [0], separator: "\n" },
        translation: { fields: [1], separator: "\n" },
      },
    ],
    packageMetadata: {
      packageVersion: 1,
      databaseFormat: "legacy",
      schemaVersion: 11,
      models: [model],
      decks: [],
      configs: [],
      collection: { creationTime: 0, config: {}, raw: {} },
      diagnostics: {
        sourceBytes: 18000000,
        databaseBytes: 10000,
        omittedMediaCount: 0,
        warnings: [],
      },
    },
  };
}

test("every import endpoint requires authentication before reading a body or touching storage", async () => {
  const api = routes({ authorized: false });
  const responses = await Promise.all([
    api.begin.POST(request("not JSON")),
    api.begin.GET(),
    api.job.GET(new Request("https://example.com"), context()),
    api.job.PUT(request("not JSON", "PUT"), context()),
    api.job.DELETE(new Request("https://example.com"), context()),
    api.commit.POST(request("not JSON"), context()),
    api.source.GET(new Request("https://example.com"), context()),
  ]);
  assert(responses.every((response) => response.status === 401));
  assert.equal(api.calls.length, 0);
});

test("3 MiB limits count actual streamed bytes and cannot be bypassed by a forged length", async () => {
  const api = routes();
  const body = " ".repeat(3 * 1024 * 1024 + 1);
  assert.equal(
    (
      await api.begin.POST(
        request("{}", "POST", { "content-length": String(body.length) }),
      )
    ).status,
    413,
  );
  assert.equal(
    (await api.begin.POST(request(body, "POST", { "content-length": "2" })))
      .status,
    413,
  );
  assert.equal(
    (await api.job.PUT(request(body, "PUT"), context())).status,
    413,
  );
  assert.equal(api.calls.length, 0);
});

test("invalid JSON, identifiers, languages and oversized batches are rejected before repository writes", async () => {
  const api = routes();
  assert.equal((await api.begin.POST(request("{"))).status, 400);
  assert.equal(
    (await api.begin.POST(request({ ...input(), sourceLang: "unknown" })))
      .status,
    400,
  );
  assert.equal(
    (
      await api.job.PUT(
        request({ batchIndex: 0, notes: [note] }, "PUT"),
        context("not-a-uuid"),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await api.job.PUT(
        request(
          { batchIndex: 0, notes: Array.from({ length: 201 }, () => note) },
          "PUT",
        ),
        context(),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await api.commit.POST(
        request({ expectedBatchCount: 0, expectedNoteCount: 1 }),
        context(),
      )
    ).status,
    400,
  );
  assert.equal(api.calls.length, 0);
});

test("valid calls always pass the authenticated owner and bounded private-source offset", async () => {
  const api = routes();
  assert.equal((await api.begin.POST(request(input()))).status, 201);
  await api.job.PUT(
    request({ batchIndex: 0, notes: [note] }, "PUT"),
    context(),
  );
  await api.commit.POST(
    request({ expectedBatchCount: 1, expectedNoteCount: 1 }),
    context(),
  );
  await api.job.DELETE(new Request("https://example.com"), context());
  await api.source.GET(new Request("https://example.com?offset=7"), context());
  assert.equal(api.calls[0].args[0], "authenticated-user");
  assert(
    api.calls
      .slice(1)
      .every(
        (call) =>
          call.args[0] === jobId && call.args[1] === "authenticated-user",
      ),
  );
  assert.equal(api.calls.at(-1).args[2], 7);
  const count = api.calls.length;
  assert.equal(
    (
      await api.source.GET(
        new Request("https://example.com?offset=-1"),
        context(),
      )
    ).status,
    400,
  );
  assert.equal(api.calls.length, count);
});

test("private job and raw-source reads return owner-scoped not-found responses", async () => {
  const api = routes({ notFound: true });
  assert.equal(
    (await api.job.GET(new Request("https://example.com"), context())).status,
    404,
  );
  const source = await api.source.GET(
    new Request("https://example.com"),
    context(),
  );
  assert.equal(source.status, 404);
  assert.deepEqual(await source.json(), { error: "Import not found" });
});

test("shared mapping strips media, preserves explicit example pairs and rejects invalid source ordinals", () => {
  const api = routes();
  assert.equal(
    api.mapping.sanitizeAnkiText(
      '<script>attack()</script><div>kiinteist&ouml;nv&auml;litt&auml;j&auml;<br>[sound:x.mp3]<img src="x"></div>',
    ),
    "kiinteistönvälittäjä",
  );
  assert.equal(api.mapping.sanitizeAnkiText("&#x41;&#66;&amp;&nbsp;"), "AB&");
  const mapped = api.mapping.mapAnkiNote(note, input().mapping[0], model);
  assert.equal(mapped.original, "word");
  assert.equal(mapped.fieldOrigins.original.origin, "imported");
  assert.equal(
    api.mapping.unsupportedNoteTypeReason({ ...model, type: 1 }) !== null,
    true,
  );
  assert.equal(
    api.mapping.mapAnkiNote(note, input().mapping[0], { ...model, type: 1 })
      .skipped,
    true,
  );
  assert.throws(
    () =>
      api.schemas.validateImportMapping({
        ...input(),
        mapping: [
          {
            ...input().mapping[0],
            original: { fields: [99], separator: "\n" },
          },
        ],
      }),
    /unknown source field/,
  );
});
