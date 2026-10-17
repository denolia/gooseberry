import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "@typescript/typescript6";

const code = ts.transpileModule(
  readFileSync(
    new URL("../src/lib/audio/readerText.ts", import.meta.url),
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
  assert.equal(name, "./readerConfig");
  return { READER_CHUNK_CHARACTERS: 1000, MAX_READER_CHARACTERS: 20000 };
}, exports);
const { splitReaderText } = exports;

test("reader chunks preserve the full 20,000-character text within the API limit", () => {
  const text = "Er liest einen langen Text.\n\n"
    .repeat(800)
    .slice(0, 20000)
    .trim();
  const chunks = splitReaderText(text, "de", "normal");
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 1000 && chunk.trim()));
  assert.equal(chunks.join(""), text);
});

test("normal reading keeps sentences together when they fit", () => {
  const text = `${"a".repeat(800)}. ${"b".repeat(800)}.`;
  const chunks = splitReaderText(text, "de", "normal");
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0], `${"a".repeat(800)}. `);
  assert.equal(chunks.join(""), text);
});

test("pause mode keeps each sentence separate in the selected source language", () => {
  const text = "Hyvää päivää. Mitä kuuluu?\n\nKaikki hyvin!";
  const chunks = splitReaderText(text, "fi", "normal-pauses");
  assert.equal(chunks.length, 3);
  assert.equal(chunks.join(""), text);
});

test("long sentences split at spaces without losing words or punctuation", () => {
  const text = `${"langes Wort ".repeat(210)}Ende.`;
  const chunks = splitReaderText(text, "de", "normal");
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 1000));
  assert.ok(chunks.slice(0, -1).every((chunk) => /\s$/u.test(chunk)));
  assert.equal(chunks.join(""), text);
});

test("unbroken Unicode text never splits a surrogate pair", () => {
  const text = `a${"🫐".repeat(1200)}`;
  const chunks = splitReaderText(text, "ja", "normal");
  assert.ok(
    chunks.every((chunk) => chunk.length <= 1000 && chunk.isWellFormed()),
  );
  assert.equal(chunks.join(""), text);
});

test("empty input and input above the analyzer limit are handled before requests", () => {
  assert.deepEqual(splitReaderText(" \n\t ", "de", "normal"), []);
  assert.throws(
    () => splitReaderText("x".repeat(20001), "de", "normal"),
    /20,000/,
  );
});

test("invalid locale falls back without losing source text", () => {
  const text = "Hallo. Guten Tag!";
  assert.equal(
    splitReaderText(text, "invalid locale", "normal").join(""),
    text,
  );
});
