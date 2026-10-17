import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "@typescript/typescript6";
import * as languages from "../src/components/ui/Languages.ts";
import * as readerConfig from "../src/lib/audio/readerConfig.ts";
import * as bodies from "../src/lib/http/readJson.ts";
import { loadReaderSpeechCache } from "./helpers/readerSpeechCache.mjs";

const validInput = {
  text: "  Guten Morgen. Das ist ein ganzer Text.  ",
  sourceLanguage: "de",
  voice: "marin",
};

function loadRoute({
  session = { user: { id: "user-1", tier: "premium" } },
  premium = true,
  model = "gpt-4o-mini-tts",
  generate,
} = {}) {
  const calls = { speech: [], access: [] };
  const voices = readerConfig.getReaderVoices(model);
  const config = {
    voices,
    defaultVoice: voices.find((voice) => voice.id === "marin")?.id ?? "alloy",
  };
  const code = ts.transpileModule(
    readFileSync(
      new URL("../src/app/api/speech/reader/route.ts", import.meta.url),
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
      "@/auth": { auth: async () => session },
      "@/components/ui/Languages": languages,
      "@/lib/audio/readerConfig": readerConfig,
      "@/lib/audio/speech": {
        getReaderSpeechConfig: () => config,
        generateReaderSpeechMp3: async (...args) => {
          calls.speech.push(args);
          return generate ? generate(...args) : Uint8Array.from([73, 68, 51]);
        },
      },
      "@/lib/http/readJson": bodies,
      "@/lib/premium/entitlements": {
        hasPremiumAccess: async (userId) => {
          calls.access.push(userId);
          return typeof premium === "function" ? premium() : premium;
        },
      },
      "next/server": { NextResponse: Response },
    };
    if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`);
    return dependencies[name];
  }, exports);
  return { route: exports, calls, config };
}

function request(input = validInput, options = {}) {
  return new Request("http://localhost/api/speech/reader", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    ...options,
  });
}

test("reader generation and voice discovery require authentication", async () => {
  const { route, calls } = loadRoute({ session: null });
  assert.equal((await route.GET()).status, 401);
  assert.equal((await route.POST(request())).status, 401);
  assert.equal(calls.speech.length, 0);
  assert.equal(calls.access.length, 0);
});

test("reader checks the database tier even for short text and a Premium session claim", async () => {
  const { route, calls } = loadRoute({ premium: false });
  const response = await route.POST(request({ ...validInput, text: "Hallo" }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "premium_required");
  assert.deepEqual(calls.access, ["user-1"]);
  assert.equal(calls.speech.length, 0);
});

test("reader rechecks Premium access on every chunk after access is revoked", async () => {
  let premium = true;
  const { route, calls } = loadRoute({ premium: () => premium });
  assert.equal((await route.POST(request())).status, 200);
  premium = false;
  assert.equal((await route.POST(request())).status, 403);
  assert.equal(calls.access.length, 2);
  assert.equal(calls.speech.length, 1);
});

test("revoking Premium blocks even a persistent cache hit before any cache lookup", async () => {
  let premium = true;
  let generated = 0;
  const cached = loadReaderSpeechCache();
  const { route } = loadRoute({
    premium: () => premium,
    generate: (text, language, options, signal) =>
      cached.cache.getOrGenerateReaderSpeech(
        { text, language, voice: options.voice, model: "gpt-4o-mini-tts" },
        async () => {
          generated++;
          return Uint8Array.from([73, 68, 51]);
        },
        signal,
      ),
  });
  assert.equal((await route.POST(request())).status, 200);
  assert.equal(cached.entries.size, 1);
  premium = false;
  assert.equal((await route.POST(request())).status, 403);
  assert.equal(cached.reads.length, 1);
  assert.equal(generated, 1);
});

test("reader accepts source language names and codes and passes options and cancellation", async () => {
  for (const sourceLanguage of ["Finnish", "fi"]) {
    const { route, calls } = loadRoute();
    const req = request({
      ...validInput,
      text: "  Hyvää päivää.  ",
      sourceLanguage,
      targetLanguage: "ru",
      voice: "cedar",
    });
    const response = await route.POST(req);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "audio/mpeg");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(
      new Uint8Array(await response.arrayBuffer()),
      Uint8Array.from([73, 68, 51]),
    );
    assert.deepEqual(calls.speech[0].slice(0, 3), [
      "Hyvää päivää.",
      "Finnish",
      { voice: "cedar" },
    ]);
    assert.equal(calls.speech[0][3], req.signal);
  }
});

test("reader rejects missing or invalid source language instead of using the target language", async () => {
  for (const sourceLanguage of [undefined, "unknown", "de-DE", 1, null]) {
    const { route, calls } = loadRoute();
    assert.equal(
      (
        await route.POST(
          request({ ...validInput, sourceLanguage, targetLanguage: "de" }),
        )
      ).status,
      400,
    );
    assert.equal(calls.speech.length, 0);
  }
});

test("reader rejects malformed voice choices before synthesis", async () => {
  for (const change of [
    { voice: undefined },
    { voice: "__proto__" },
    { voice: "invalid" },
    { voice: { id: "marin" } },
  ]) {
    const { route, calls } = loadRoute();
    assert.equal(
      (await route.POST(request({ ...validInput, ...change }))).status,
      400,
    );
    assert.equal(calls.speech.length, 0);
  }
});

test("reader enforces the chunk limit independently of the free pronunciation limit", async () => {
  const { route, calls } = loadRoute();
  assert.equal(
    (await route.POST(request({ ...validInput, text: "x".repeat(1000) })))
      .status,
    200,
  );
  assert.equal(
    (await route.POST(request({ ...validInput, text: "x".repeat(1001) })))
      .status,
    400,
  );
  assert.equal(
    (await route.POST(request({ ...validInput, text: "  " }))).status,
    400,
  );
  assert.equal(calls.speech.length, 1);
});

test("reader validates JSON and caps actual request bytes even with a false content length", async () => {
  const { route, calls } = loadRoute();
  for (const body of ["not JSON", "[]", "null"]) {
    assert.equal((await route.POST(request(validInput, { body }))).status, 400);
  }
  const tooLarge = request(validInput, {
    body: JSON.stringify({ ...validInput, text: "ä".repeat(7000) }),
    headers: { "Content-Length": "1" },
  });
  assert.equal((await route.POST(tooLarge)).status, 413);
  assert.equal(calls.speech.length, 0);
});

test("voice discovery and synthesis both use the configured model's supported voices", async () => {
  const { route, calls } = loadRoute({ model: "tts-1-hd", premium: false });
  const response = await route.GET();
  assert.equal(response.status, 200);
  assert.deepEqual(
    (await response.json()).voices.map((voice) => voice.id),
    ["alloy", "echo", "fable", "nova", "onyx", "shimmer"],
  );
  assert.equal(
    calls.access.length,
    0,
    "free users may inspect available voices",
  );
  const premium = loadRoute({ model: "tts-1-hd" });
  assert.equal((await premium.route.POST(request())).status, 400);
  assert.equal(
    (await premium.route.POST(request({ ...validInput, voice: "alloy" })))
      .status,
    200,
  );
  assert.equal(premium.calls.speech.length, 1);
});

test("reader cancellation avoids synthesis or discards an in-flight result", async () => {
  const controller = new AbortController();
  controller.abort();
  const initial = loadRoute();
  assert.equal(
    (
      await initial.route.POST(
        request(validInput, { signal: controller.signal }),
      )
    ).status,
    499,
  );
  assert.equal(initial.calls.speech.length, 0);

  const during = new AbortController();
  const active = loadRoute({
    generate: () => {
      during.abort();
      throw new DOMException("Aborted", "AbortError");
    },
  });
  assert.equal(
    (await active.route.POST(request(validInput, { signal: during.signal })))
      .status,
    499,
  );
});
