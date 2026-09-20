import assert from "node:assert/strict";
import test from "node:test";
import { withAutomaticRetries } from "../src/lib/review/retry.ts";

test("an optimistic review write is retried three times", async () => {
  let attempts = 0;
  const delays = [];

  await assert.rejects(() =>
    withAutomaticRetries(
      async () => {
        attempts += 1;
        throw new Error("offline");
      },
      3,
      async (delay) => {
        delays.push(delay);
      },
    ),
  );

  assert.equal(attempts, 4);
  assert.deepEqual(delays, [300, 900, 1800]);
});

test("automatic retries stop as soon as a write succeeds", async () => {
  let attempts = 0;
  const result = await withAutomaticRetries(
    async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("temporary failure");
      return "saved";
    },
    3,
    async () => {},
  );

  assert.equal(result, "saved");
  assert.equal(attempts, 3);
});
