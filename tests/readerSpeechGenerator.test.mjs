import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "@typescript/typescript6";
import * as readerConfig from "../src/lib/audio/readerConfig.ts";

function loadSpeech({ model = "gpt-4o-mini-tts", voice = "marin" } = {}) {
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
  return { speech: exports, calls };
}

test("reader generator maps every speed preset and forwards the selected voice and signal", async () => {
  const { speech, calls } = loadSpeech();
  const controller = new AbortController();
  for (const preset of readerConfig.READER_SPEEDS) {
    const audio = await speech.generateReaderSpeechMp3(
      "  Der Text bleibt auf Deutsch.  ",
      "German",
      { voice: "cedar", speed: preset.id },
      controller.signal,
    );
    assert.deepEqual(audio, Uint8Array.from([73, 68, 51]));
    const call = calls.at(-1);
    assert.equal(call.input.speed, preset.speed);
    assert.equal(call.input.voice, "cedar");
    assert.equal(call.input.input, "Der Text bleibt auf Deutsch.");
    assert.equal(call.input.response_format, "mp3");
    assert.match(call.input.instructions, /German/);
    assert.match(call.input.instructions, /Do not translate/);
    assert.equal(call.options.signal, controller.signal);
    if (preset.id === "normal-pauses")
      assert.match(call.input.instructions, /distinct pause between sentences/);
  }
});

test("reader supports legacy models without sending unsupported instructions or voices", async () => {
  for (const model of ["tts-1", "tts-1-hd", "tts-1-1106"]) {
    const { speech, calls } = loadSpeech({ model });
    const config = speech.getReaderSpeechConfig();
    assert.equal(config.voices.length, 6);
    assert.equal(config.defaultVoice, "alloy");
    await speech.generateReaderSpeechMp3("Hallo.", "German", {
      voice: "nova",
      speed: "normal-pauses",
    });
    assert.equal("instructions" in calls[0].input, false);
    assert.equal(calls[0].input.speed, 1);
    await assert.rejects(
      speech.generateReaderSpeechMp3("Hallo.", "German", {
        voice: "marin",
        speed: "normal",
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
    [" ", { voice: "marin", speed: "normal" }],
    ["x".repeat(1001), { voice: "marin", speed: "normal" }],
    ["Hallo", { voice: "unknown", speed: "normal" }],
    ["Hallo", { voice: "marin", speed: 1 }],
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
      { voice: "marin", speed: "normal" },
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
    speed: "normal",
  });
  assert.equal(calls.length, 1);
});
