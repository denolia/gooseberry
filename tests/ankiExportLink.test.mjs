import assert from "node:assert/strict";
import test from "node:test";
import {
  signAnkiExportLink,
  verifyAnkiExportLink,
} from "../src/lib/anki/exportLink.ts";

process.env.AUTH_SECRET = "test-only-anki-export-secret";

test("accepts a valid unexpired Anki export signature", () => {
  const expires = 2_000_000_000;
  const signature = signAnkiExportLink("word-set-1", expires);

  assert.equal(
    verifyAnkiExportLink(
      "word-set-1",
      expires.toString(),
      signature,
      expires - 60,
    ),
    true,
  );
});

test("rejects expired, altered and malformed Anki export links", () => {
  const expires = 2_000_000_000;
  const signature = signAnkiExportLink("word-set-1", expires);

  assert.equal(
    verifyAnkiExportLink(
      "word-set-1",
      expires.toString(),
      signature,
      expires + 1,
    ),
    false,
  );
  assert.equal(
    verifyAnkiExportLink(
      "word-set-2",
      expires.toString(),
      signature,
      expires - 60,
    ),
    false,
  );
  assert.equal(
    verifyAnkiExportLink("word-set-1", "not-a-time", signature, expires - 60),
    false,
  );
  assert.equal(
    verifyAnkiExportLink(
      "word-set-1",
      expires.toString(),
      `${signature}altered`,
      expires - 60,
    ),
    false,
  );
});
