import assert from "node:assert/strict";
import test from "node:test";
import { createAnkiDroidIntentUrl } from "../src/lib/anki/ankiDroidIntent.ts";

test("creates an explicit AnkiDroid intent with a download fallback", () => {
  const downloadUrl =
    "https://example.com/api/word-sets/123/export/deck.apkg?expires=2000000000&signature=abc_123";

  assert.equal(
    createAnkiDroidIntentUrl(downloadUrl),
    "intent://example.com/api/word-sets/123/export/deck.apkg?expires=2000000000&signature=abc_123" +
      "#Intent;scheme=https;package=com.ichi2.anki;action=android.intent.action.VIEW;" +
      "category=android.intent.category.BROWSABLE;" +
      `S.browser_fallback_url=${encodeURIComponent(downloadUrl)};end`,
  );
});

test("rejects non-web fallback URLs", () => {
  assert.throws(
    () => createAnkiDroidIntentUrl("file:///tmp/deck.apkg"),
    /HTTP or HTTPS/,
  );
});
