import { test } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { BaseTranslationResponseSchema } from "../src/app/utils/translationSchema.ts";
import { readJsonLines } from "../src/app/utils/readJsonLines.ts";

const encoder = new TextEncoder();
function byteStream(text) {
  const bytes = encoder.encode(text);
  return new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
}

test("JSON records survive split UTF-8, escaped newlines and an unterminated final line", async () => {
  const events = [
    { type: "preview", translation: 'Ёж 🦔\n"Straße"' },
    { type: "done" },
  ];
  const results = [];
  for await (const event of readJsonLines(
    byteStream(events.map(JSON.stringify).join("\r\n")),
  ))
    results.push(event);
  assert.deepEqual(results, events);
});

test("malformed/truncated records reject instead of becoming completed translations", async () => {
  await assert.rejects(async () => {
    for await (const event of readJsonLines(byteStream('{"type":"result"')))
      void event;
  }, SyntaxError);
});

test("stopping consumption cancels the underlying stream", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('{"type":"error"}\n'));
    },
    cancel() {
      cancelled = true;
    },
  });
  for await (const event of readJsonLines(body)) {
    void event;
    break;
  }
  assert.equal(cancelled, true);
});

function mockCompletion(finishReason) {
  const response = {
    original: "Straße",
    type: "noun",
    translation: "улица",
    details: Object.fromEntries(
      Object.keys(BaseTranslationResponseSchema.shape.details.shape).map(
        (key) => [key, null],
      ),
    ),
    example_usage: null,
  };
  const json = JSON.stringify(response);
  const chunks = [...json].map((content) => ({
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  }));
  chunks.unshift({
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: "" },
        finish_reason: null,
      },
    ],
  });
  chunks.push({
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
  });
  const wire =
    chunks
      .map(
        (chunk) =>
          `data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", created: 1, model: "gpt-5-mini", ...chunk })}\n\n`,
      )
      .join("") + "data: [DONE]\n\n";
  const client = new OpenAI({
    apiKey: "mock-key",
    maxRetries: 0,
    fetch: async () =>
      new Response(byteStream(wire), {
        headers: { "Content-Type": "text/event-stream" },
      }),
  });
  return {
    response,
    stream: client.chat.completions.stream({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: "Straße" }],
      response_format: zodResponseFormat(
        BaseTranslationResponseSchema,
        "translation_response",
      ),
    }),
  };
}

test("SDK exposes a readable translation while the structured card is still incomplete", async () => {
  const { response, stream } = mockCompletion("stop");
  let earlyTranslation = false;
  stream.on("content.delta", ({ parsed }) => {
    if (parsed?.translation === "улица" && !parsed?.details)
      earlyTranslation = true;
  });
  const result = await stream.finalChatCompletion();
  assert.equal(earlyTranslation, true);
  assert.deepEqual(
    BaseTranslationResponseSchema.parse(result.choices[0].message.parsed),
    response,
  );
});

test("SDK rejects token-limit termination even when JSON appears complete", async () => {
  const { stream } = mockCompletion("length");
  await assert.rejects(stream.finalChatCompletion());
});
