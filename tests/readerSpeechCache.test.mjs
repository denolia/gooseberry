import assert from "node:assert/strict";
import test from "node:test";
import { loadReaderSpeechCache } from "./helpers/readerSpeechCache.mjs";

const input = {
  text: "Hallo. Guten Tag!",
  language: "German",
  voice: "marin",
  model: "gpt-4o-mini-tts",
  instructions: "Read clearly in German at normal speed.",
};
const mp3 = Uint8Array.from([73, 68, 51]);

test("reader cache keys are versioned and contain every generation setting while ignoring playback settings", () => {
  const { cache } = loadReaderSpeechCache();
  const key = cache.readerSpeechCacheKey(input);
  assert.match(key, /^reader-base1x-v1-[a-f0-9]{64}\.mp3$/);
  assert.equal(
    cache.readerSpeechCacheKey({
      ...input,
      text: `  ${input.text}\n`,
      language: " german ",
    }),
    key,
  );
  assert.equal(
    cache.readerSpeechCacheKey({ ...input, speed: 0.3, style: "feminine" }),
    key,
  );
  for (const change of [
    { text: "Anderer Text." },
    { language: "English" },
    { voice: "cedar" },
    { model: "gpt-4o-mini-tts-2025-12-15" },
    { instructions: "Updated pronunciation instructions." },
  ])
    assert.notEqual(cache.readerSpeechCacheKey({ ...input, ...change }), key);
});

test("stored reader audio is returned without synthesis and survives a new helper instance", async () => {
  let generations = 0;
  const entries = new Map();
  const first = loadReaderSpeechCache({ entries });
  const generate = async () => {
    generations++;
    return mp3;
  };
  assert.deepEqual(
    await first.cache.getOrGenerateReaderSpeech(input, generate),
    mp3,
  );
  const next = loadReaderSpeechCache({ entries });
  assert.deepEqual(
    await next.cache.getOrGenerateReaderSpeech(
      { ...input, text: ` ${input.text} ` },
      generate,
    ),
    mp3,
  );
  assert.equal(generations, 1);
  assert.equal(first.writes.length, 1);
  assert.equal(next.writes.length, 0);
});

test("cache read and save failures return one generated result without repeated synthesis", async () => {
  const failed = loadReaderSpeechCache({
    read: async () => {
      throw new Error("Read unavailable");
    },
    write: async () => {
      throw new Error("Write unavailable");
    },
  });
  let generations = 0;
  assert.deepEqual(
    await failed.cache.getOrGenerateReaderSpeech(input, async () => {
      generations++;
      return mp3;
    }),
    mp3,
  );
  assert.equal(generations, 1);
  assert.equal(failed.writes.length, 1);
  assert.equal(failed.warnings.length, 2);
});

test("empty cached audio regenerates but failed or empty provider output is never stored", async () => {
  const emptyHit = loadReaderSpeechCache({
    read: async () => new Uint8Array(),
  });
  assert.deepEqual(
    await emptyHit.cache.getOrGenerateReaderSpeech(input, async () => mp3),
    mp3,
  );
  assert.equal(emptyHit.writes.length, 1);
  for (const generate of [
    async () => new Uint8Array(),
    async () => {
      throw new Error("Provider unavailable");
    },
  ]) {
    const failed = loadReaderSpeechCache();
    await assert.rejects(
      failed.cache.getOrGenerateReaderSpeech(input, generate),
    );
    assert.equal(failed.writes.length, 0);
  }
});

test("aborting before or during a cache lookup never generates or returns cached audio", async () => {
  const before = new AbortController();
  before.abort();
  const initial = loadReaderSpeechCache();
  await assert.rejects(
    initial.cache.getOrGenerateReaderSpeech(
      input,
      async () => mp3,
      before.signal,
    ),
    { name: "AbortError" },
  );
  assert.equal(initial.reads.length, 0);
  const during = new AbortController();
  const hit = loadReaderSpeechCache({
    read: async () => {
      during.abort();
      return mp3;
    },
  });
  let generations = 0;
  await assert.rejects(
    hit.cache.getOrGenerateReaderSpeech(
      input,
      async () => {
        generations++;
        return mp3;
      },
      during.signal,
    ),
    { name: "AbortError" },
  );
  assert.equal(generations, 0);
  assert.equal(hit.writes.length, 0);
});

test("aborting generation prevents persistence and aborting during a save discards the response", async () => {
  const controller = new AbortController();
  const first = loadReaderSpeechCache();
  await assert.rejects(
    first.cache.getOrGenerateReaderSpeech(
      input,
      async () => {
        controller.abort();
        return mp3;
      },
      controller.signal,
    ),
    { name: "AbortError" },
  );
  assert.equal(first.writes.length, 0);
  const saving = new AbortController();
  const next = loadReaderSpeechCache({
    write: async () => {
      saving.abort();
    },
  });
  await assert.rejects(
    next.cache.getOrGenerateReaderSpeech(input, async () => mp3, saving.signal),
    { name: "AbortError" },
  );
  assert.equal(next.writes.length, 1);
});
