import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

test("speech generator requests a clear MP3 pronunciation", async () => {
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
  new Function("require", "exports", code)((name) => {
    if (name !== "openai") throw new Error(`Unexpected dependency ${name}`);
    return {
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
  }, exports);

  const controller = new AbortController();
  const audio = await exports.generateSpeechMp3(
    "  der Schwarm  ",
    "German",
    controller.signal,
  );

  assert.deepEqual(audio, Uint8Array.from([73, 68, 51]));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.input, "der Schwarm");
  assert.equal(calls[0].input.response_format, "mp3");
  assert.match(calls[0].input.instructions, /German/);
  assert.equal(calls[0].options.signal, controller.signal);
});
