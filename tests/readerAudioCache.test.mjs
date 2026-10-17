import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "@typescript/typescript6";
import * as languages from "../src/components/ui/Languages.ts";

const code = ts.transpileModule(
  readFileSync(
    new URL("../src/lib/audio/readerAudioCache.ts", import.meta.url),
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
  assert.equal(name, "@/components/ui/Languages");
  return languages;
}, exports);
const { ReaderAudioCache, getReaderAudioCacheKey } = exports;
const blob = (size) => new Blob([new Uint8Array(size)], { type: "audio/mpeg" });

test("content keys normalize outer whitespace and source-language aliases while preserving speech content and voice", () => {
  const key = getReaderAudioCacheKey("  Guten Tag. \n", "German", "marin");
  for (const language of ["de", "DE", " german ", "GERMAN"]) {
    assert.equal(getReaderAudioCacheKey("Guten Tag.", language, "marin"), key);
  }
  for (const [text, language, voice] of [
    ["Guten  Tag.", "de", "marin"],
    ["guten Tag.", "de", "marin"],
    ["Guten Tag!", "de", "marin"],
    ["Guten Tag.", "fi", "marin"],
    ["Guten Tag.", "de", "cedar"],
  ])
    assert.notEqual(getReaderAudioCacheKey(text, language, voice), key);
  assert.equal(
    getReaderAudioCacheKey("Hallo.", "Finnish", "nova"),
    getReaderAudioCacheKey("Hallo.", "fi", "nova"),
  );
});

test("content key fields remain unambiguous when text contains separators and quotes", () => {
  assert.notEqual(
    getReaderAudioCacheKey("a,b", "de", "c"),
    getReaderAudioCacheKey("a", "b,de", "c"),
  );
  assert.notEqual(
    getReaderAudioCacheKey('["de","marin"]', "de", "marin"),
    getReaderAudioCacheKey("de", "marin", '["de","marin"]'),
  );
});

test("byte-budget eviction removes the least recently used blob and a read refreshes recency", () => {
  const cache = new ReaderAudioCache(6, 10);
  const a = blob(2);
  const b = blob(2);
  const c = blob(2);
  const d = blob(2);
  cache.set("a", a);
  cache.set("b", b);
  cache.set("c", c);
  assert.equal(cache.get("a"), a);
  cache.set("d", d);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), a);
  assert.equal(cache.get("c"), c);
  assert.equal(cache.get("d"), d);
  assert.equal(cache.size, 3);
  assert.equal(cache.byteLength, 6);
});

test("replacement, deletion, and clear maintain exact byte accounting", () => {
  const cache = new ReaderAudioCache(6, 10);
  const replacement = blob(3);
  cache.set("a", blob(2));
  cache.set("b", blob(2));
  cache.set("a", replacement);
  assert.equal(cache.size, 2);
  assert.equal(cache.byteLength, 5);
  cache.set("c", blob(2));
  assert.equal(
    cache.get("b"),
    undefined,
    "Replacing a value must refresh its LRU position",
  );
  assert.equal(cache.get("a"), replacement);
  assert.equal(cache.byteLength, 5);
  cache.delete("a");
  cache.delete("missing");
  assert.equal(cache.size, 1);
  assert.equal(cache.byteLength, 2);
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.byteLength, 0);
  assert.equal(cache.get("c"), undefined);
});

test("empty and oversized blobs do not evict unrelated valid cache entries", () => {
  const cache = new ReaderAudioCache(6, 10);
  const valid = blob(2);
  cache.set("valid", valid);
  cache.set("large", blob(7));
  cache.set("empty", blob(0));
  assert.equal(cache.get("valid"), valid);
  assert.equal(cache.get("large"), undefined);
  assert.equal(cache.get("empty"), undefined);
  assert.equal(cache.byteLength, 2);
  cache.set("valid", blob(7));
  assert.equal(
    cache.get("valid"),
    undefined,
    "An uncachable replacement must not leave a stale value for that key",
  );
  assert.equal(cache.byteLength, 0);
});

test("entry limits independently bound small blobs and zero budgets disable caching", () => {
  const cache = new ReaderAudioCache(100, 2);
  cache.set("a", blob(1));
  cache.set("b", blob(1));
  cache.set("c", blob(1));
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.size, 2);
  assert.equal(cache.byteLength, 2);
  for (const disabled of [
    new ReaderAudioCache(0),
    new ReaderAudioCache(100, 0),
  ]) {
    disabled.set("a", blob(1));
    assert.equal(disabled.size, 0);
    assert.equal(disabled.byteLength, 0);
  }
  const defaultCache = new ReaderAudioCache();
  for (let index = 0; index < 257; index++)
    defaultCache.set(String(index), blob(1));
  assert.equal(defaultCache.size, 256);
  assert.equal(defaultCache.get("0"), undefined);
});

test("invalid resource limits are rejected before storing any audio", () => {
  for (const limit of [-1, Infinity, NaN]) {
    assert.throws(() => new ReaderAudioCache(limit), RangeError);
    assert.throws(() => new ReaderAudioCache(100, limit), RangeError);
  }
});
