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
const { getReaderSpeechChunks, splitReaderText } = exports;

function assertOriginalOffsets(text, chunks) {
  for (const chunk of chunks) {
    assert.equal(text.slice(chunk.start, chunk.end), chunk.text);
    assert(chunk.text.trim(), "Whitespace-only chunks need no audio request");
    assert(chunk.text.length <= 1000);
    assert(chunk.text.isWellFormed());
    assert(chunk.sentenceStart >= 0);
    assert(chunk.sentenceEnd <= text.length);
    assert(chunk.sentenceStart < chunk.sentenceEnd);
    const sentence = text.slice(chunk.sentenceStart, chunk.sentenceEnd);
    assert.equal(sentence, sentence.trim());
  }
}

test("reader chunks preserve the full 20,000-character text within the API limit", () => {
  const text = "Er liest einen langen Text.\n\n"
    .repeat(800)
    .slice(0, 20000)
    .trim();
  const chunks = splitReaderText(text, "de");
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 1000 && chunk.trim()));
  assert.equal(chunks.join(""), text);
});

test("normal reading keeps separate requests for complete sentences that fit", () => {
  const text = `${"a".repeat(800)}. ${"b".repeat(800)}.`;
  const chunks = splitReaderText(text, "de");
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0], `${"a".repeat(800)}. `);
  assert.equal(chunks.join(""), text);
});

test("reading generates each sentence separately in the source language", () => {
  const text = "Hyvää päivää. Mitä kuuluu?\n\nKaikki hyvin!";
  const chunks = splitReaderText(text, "fi");
  assert.deepEqual(chunks, [
    "Hyvää päivää. ",
    "Mitä kuuluu?\n\n",
    "Kaikki hyvin!",
  ]);
  assert.equal(chunks.join(""), text);
});

test("long sentences split at spaces without losing words or punctuation", () => {
  const text = `${"langes Wort ".repeat(210)}Ende.`;
  const chunks = splitReaderText(text, "de");
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 1000));
  assert.ok(chunks.slice(0, -1).every((chunk) => /\s$/u.test(chunk)));
  assert.equal(chunks.join(""), text);
});

test("unbroken Unicode text never splits a surrogate pair", () => {
  const text = `a${"🫐".repeat(1200)}`;
  const chunks = splitReaderText(text, "ja");
  assert.ok(
    chunks.every((chunk) => chunk.length <= 1000 && chunk.isWellFormed()),
  );
  assert.equal(chunks.join(""), text);
});

test("empty input and input above the analyzer limit are handled before requests", () => {
  assert.deepEqual(splitReaderText(" \n\t ", "de"), []);
  assert.throws(() => splitReaderText("x".repeat(20001), "de"), /20,000/);
});

test("invalid locale falls back without losing source text", () => {
  const text = "Hallo. Guten Tag!";
  assert.equal(splitReaderText(text, "invalid locale").join(""), text);
});

test("sentence metadata uses original UTF-16 offsets after trimming outer whitespace", () => {
  const text = "\n  Hallo.  Wiedersehen!\n\t";
  const chunks = getReaderSpeechChunks(text, "de");
  assert.deepEqual(chunks, [
    {
      text: "Hallo.  ",
      start: 3,
      end: 11,
      sentenceStart: 3,
      sentenceEnd: 9,
      sentenceIndex: 0,
    },
    {
      text: "Wiedersehen!",
      start: 11,
      end: 23,
      sentenceStart: 11,
      sentenceEnd: 23,
      sentenceIndex: 1,
    },
  ]);
  assertOriginalOffsets(text, chunks);
});

test("identical sentences have distinct positions and sentence indices", () => {
  const text = "🫐 Hallo. Hallo. Hallo.";
  const chunks = getReaderSpeechChunks(text, "de");
  assert.deepEqual(
    chunks.map((chunk) => chunk.sentenceIndex),
    [0, 1, 2],
  );
  assert.deepEqual(
    chunks.map((chunk) => chunk.sentenceStart),
    [0, 10, 17],
  );
  assert.deepEqual(
    chunks.map((chunk) => chunk.sentenceEnd),
    [9, 16, 23],
  );
  assert.equal(
    text.slice(chunks[1].sentenceStart, chunks[1].sentenceEnd),
    "Hallo.",
  );
  assert.equal(
    text.slice(chunks[2].sentenceStart, chunks[2].sentenceEnd),
    "Hallo.",
  );
  assertOriginalOffsets(text, chunks);
});

test("CJK sentences and paragraph breaks retain exact punctuation and source offsets", () => {
  const text = "\u2003第一文です。\n\n第二文です！\n第三文です？  ";
  const chunks = getReaderSpeechChunks(text, "ja");
  assert.deepEqual(
    chunks.map((chunk) => text.slice(chunk.sentenceStart, chunk.sentenceEnd)),
    ["第一文です。", "第二文です！", "第三文です？"],
  );
  assert.equal(chunks.map((chunk) => chunk.text).join(""), text.trim());
  assertOriginalOffsets(text, chunks);
});

test("pieces of an oversized sentence share a highlight range without splitting Unicode", () => {
  const text = ` \n${"ein Wort 🫐 ".repeat(200)}Ende. Nächster Satz!  `;
  const chunks = getReaderSpeechChunks(text, "de");
  const firstSentence = chunks.filter((chunk) => chunk.sentenceIndex === 0);
  assert(firstSentence.length > 2);
  assert(firstSentence.every((chunk) => chunk.sentenceStart === 2));
  assert(
    firstSentence.every(
      (chunk) => chunk.sentenceEnd === text.indexOf("Ende.") + 5,
    ),
  );
  assert.equal(chunks.at(-1).sentenceIndex, 1);
  assert.equal(chunks.at(-1).sentenceStart, text.indexOf("Nächster"));
  assert.equal(chunks.map((chunk) => chunk.text).join(""), text.trim());
  assertOriginalOffsets(text, chunks);
});

test("skipping large whitespace-only pieces never shifts later sentence offsets", () => {
  const text = `  Hallo.${"\n".repeat(2300)}Wieder.  `;
  const chunks = getReaderSpeechChunks(text, "de");
  assertOriginalOffsets(text, chunks);
  assert.equal(
    chunks.filter((chunk) => chunk.text.trim() === "Hallo.").length,
    1,
  );
  const nextSentence = chunks.find((chunk) => chunk.sentenceIndex === 1);
  assert.equal(nextSentence.start, text.indexOf("Wieder."));
  assert.equal(nextSentence.sentenceStart, text.indexOf("Wieder."));
  assert.equal(nextSentence.sentenceEnd, text.indexOf("Wieder.") + 7);
});

test("oversized unbroken Unicode preserves both text and one sentence highlight range", () => {
  const text = `\t a${"🫐".repeat(1200)}  `;
  const chunks = getReaderSpeechChunks(text, "ja");
  assertOriginalOffsets(text, chunks);
  assert(chunks.length > 2);
  assert(chunks.every((chunk) => chunk.sentenceIndex === 0));
  assert(chunks.every((chunk) => chunk.sentenceStart === 2));
  assert(chunks.every((chunk) => chunk.sentenceEnd === text.length - 2));
  assert.equal(chunks.map((chunk) => chunk.text).join(""), text.trim());
});
