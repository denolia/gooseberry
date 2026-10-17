import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "@typescript/typescript6";
import * as readerConfig from "../src/lib/audio/readerConfig.ts";
import { loadReaderSpeechCache } from "./helpers/readerSpeechCache.mjs";

function loadSpeech({
  model = "gpt-4o-mini-tts",
  voice = "marin",
  cache = loadReaderSpeechCache(),
} = {}) {
  const calls = [];
  const code = ts.transpileModule(
    readFileSync(
      new URL("../src/lib/audio/speech.ts", import.meta.url),
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
  new Function("require", "exports", "process", code)(
    (name) => {
      if (name === "./readerConfig") return readerConfig;
      if (name === "./readerSpeechCache") return cache.cache;
      if (name !== "openai") throw new Error(`Unexpected dependency ${name}`);
      return {
        __esModule: true,
        default: class {
          audio = {
            speech: {
              create: async (input, options) => {
                calls.push({ input, options });
                return {
                  arrayBuffer: async () => Uint8Array.from([73, 68, 51]).buffer,
                };
              },
            },
          };
        },
      };
    },
    exports,
    { env: { OPENAI_TTS_MODEL: model, OPENAI_TTS_VOICE: voice } },
  );
  return { speech: exports, calls, cache };
}

test("reader generator produces 1x base audio and caches repeated requests", async () => {
  const { speech, calls } = loadSpeech();
  const controller = new AbortController();
  for (const text of [
    "  Der Text bleibt auf Deutsch.  ",
    "Der Text bleibt auf Deutsch.",
  ]) {
    const audio = await speech.generateReaderSpeechMp3(
      text,
      "German",
      { voice: "cedar" },
      controller.signal,
    );
    assert.deepEqual(audio, Uint8Array.from([73, 68, 51]));
    const call = calls.at(-1);
    assert.equal(call.input.speed, 1);
    assert.equal(call.input.voice, "cedar");
    assert.equal(call.input.input, "Der Text bleibt auf Deutsch.");
    assert.equal(call.input.response_format, "mp3");
    assert.match(call.input.instructions, /German/);
    assert.match(call.input.instructions, /Do not translate/);
    assert.equal(call.options.signal, controller.signal);
    assert.deepEqual(call.input, calls[0].input);
  }
  assert.equal(
    calls.length,
    1,
    "Repeated requests reuse the same stored base audio",
  );
});

test("reader generator reuses persistent audio across generator instances and separates voice, language and model", async () => {
  const entries = new Map();
  const first = loadSpeech({ cache: loadReaderSpeechCache({ entries }) });
  await first.speech.generateReaderSpeechMp3("  Hallo.  ", "German", {
    voice: "marin",
  });
  const next = loadSpeech({ cache: loadReaderSpeechCache({ entries }) });
  await next.speech.generateReaderSpeechMp3("Hallo.", "German", {
    voice: "marin",
  });
  assert.equal(next.calls.length, 0);
  await next.speech.generateReaderSpeechMp3("Hallo.", "German", {
    voice: "cedar",
  });
  await next.speech.generateReaderSpeechMp3("Hallo.", "English", {
    voice: "marin",
  });
  await next.speech.generateReaderSpeechMp3("Anderer Text.", "German", {
    voice: "marin",
  });
  assert.equal(next.calls.length, 3);
  const changedModel = loadSpeech({
    model: "gpt-4o-mini-tts-2025-12-15",
    cache: loadReaderSpeechCache({ entries }),
  });
  await changedModel.speech.generateReaderSpeechMp3("Hallo.", "German", {
    voice: "marin",
  });
  assert.equal(changedModel.calls.length, 1);
});

test("native playback uses the Slower ID and label for the 0.7 multiplier", () => {
  assert.deepEqual(
    readerConfig.READER_SPEEDS.map((preset) => preset.speed),
    [0.3, 0.5, 0.7, 1, 1.5],
  );
  assert.deepEqual(
    readerConfig.READER_SPEEDS.map((preset) => preset.id),
    ["very-slow", "slow", "Slower", "normal", "fast"],
  );
  assert.equal(
    readerConfig.READER_SPEEDS.find((preset) => preset.id === "Slower").label,
    "Slower",
  );
});

test("reader supports legacy models without sending unsupported instructions or voices", async () => {
  for (const model of ["tts-1", "tts-1-hd", "tts-1-1106"]) {
    const { speech, calls } = loadSpeech({ model });
    const config = speech.getReaderSpeechConfig();
    assert.equal(config.voices.length, 6);
    assert.equal(config.defaultVoice, "alloy");
    await speech.generateReaderSpeechMp3("Hallo.", "German", {
      voice: "nova",
    });
    assert.equal("instructions" in calls[0].input, false);
    assert.equal(calls[0].input.speed, 1);
    await assert.rejects(
      speech.generateReaderSpeechMp3("Hallo.", "German", {
        voice: "marin",
      }),
      /Invalid reader voice/,
    );
    assert.equal(calls.length, 1);
  }
});

test("reader discovery honors a configured supported default and safely falls back", () => {
  const modern = loadSpeech({ voice: "cedar" }).speech.getReaderSpeechConfig();
  assert.equal(modern.voices.length, 13);
  assert.equal(modern.defaultVoice, "cedar");
  assert.equal(
    loadSpeech({ voice: "unavailable" }).speech.getReaderSpeechConfig()
      .defaultVoice,
    "marin",
  );
  assert.equal(
    loadSpeech({ model: "tts-1", voice: "nova" }).speech.getReaderSpeechConfig()
      .defaultVoice,
    "nova",
  );
});

test("reader generation rejects invalid input and aborts before contacting OpenAI", async () => {
  const { speech, calls } = loadSpeech();
  for (const [text, options] of [
    [" ", { voice: "marin" }],
    ["x".repeat(1001), { voice: "marin" }],
    ["Hallo", { voice: "unknown" }],
  ]) {
    await assert.rejects(
      speech.generateReaderSpeechMp3(text, "German", options),
    );
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    speech.generateReaderSpeechMp3(
      "Hallo",
      "German",
      { voice: "marin" },
      controller.signal,
    ),
    { name: "AbortError" },
  );
  assert.equal(calls.length, 0);
});

test("full-text generation keeps individual pronunciation's 500-character guard", async () => {
  const { speech, calls } = loadSpeech();
  await assert.rejects(
    speech.generateSpeechMp3("x".repeat(501), "German"),
    /too long/,
  );
  await speech.generateReaderSpeechMp3("x".repeat(1000), "German", {
    voice: "marin",
  });
  assert.equal(calls.length, 1);
});
