import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createPostgresFixture } from "./helpers/postgres.mjs";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
let userId = owner;
const fixture = await createPostgresFixture({
  "next/server": { NextResponse: Response },
  "@/auth": { auth: async () => (userId ? { user: { id: userId } } : null) },
});
const { client, load } = fixture;
const collection = load("@/app/api/reader-texts/route");
const detail = load("@/app/api/reader-texts/[id]/route");
const repo = load("@/db/readerTextRepo");
const { defaultReaderTitle } = load("@/lib/reader/library");

after(() => fixture.close());
beforeEach(async () => {
  userId = owner;
  await client.exec("TRUNCATE app_user CASCADE");
  await client.query(
    "INSERT INTO app_user (id, provider, provider_user_id) VALUES ($1, 'google', 'owner'), ($2, 'google', 'other')",
    [owner, other],
  );
});

function input(extra = {}) {
  return {
    id: crypto.randomUUID(),
    text: "Eins zwei drei vier fünf sechs sieben.",
    sourceLang: "de",
    targetLang: "en",
    ...extra,
  };
}
function request(method, body, query = "") {
  return new Request(`http://localhost/api/reader-texts${query}`, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: typeof body === "string" ? body : JSON.stringify(body),
        }),
  });
}
function context(id) {
  return { params: Promise.resolve({ id }) };
}
async function create(extra = {}) {
  const response = await collection.POST(request("POST", input(extra)));
  assert.equal(response.status, 201);
  return (await response.json()).text;
}

test("reader saves full text in PostgreSQL and generates a bounded five-word title", async () => {
  const text = await create({
    userId: other,
    text: "  Eins zwei drei vier fünf sechs sieben.  ",
  });
  assert.equal(text.title, "Eins zwei drei vier fünf…");
  assert.equal(text.text, "Eins zwei drei vier fünf sechs sieben.");
  const stored = await repo.getReaderText(owner, text.id);
  assert.equal(
    stored.userId,
    owner,
    "Ownership comes from the session, never the request",
  );
  assert.equal(stored.text, text.text);
  assert.equal(stored.sourceLang, "de");
  assert.equal(stored.targetLang, "en");
  assert.equal(defaultReaderTitle("Hello\n\tworld!", "en"), "Hello world!");
  assert.equal(defaultReaderTitle("!?!", "en"), "!?!");
  const long = defaultReaderTitle("🫐" + "字".repeat(150), "zh");
  assert(Array.from(long).length <= 80);
  assert(!/[\uD800-\uDBFF]$/.test(long));
});

test("retried creation has one identity and preserves a renamed title", async () => {
  const body = input();
  const first = await create(body);
  const renamed = await detail.PATCH(
    request("PATCH", { title: "  My story  " }),
    context(first.id),
  );
  assert.equal(renamed.status, 200);
  assert.equal((await renamed.json()).text.title, "My story");
  const second = await create({
    ...body,
    text: "Updated after a connection failure.",
  });
  assert.equal(second.id, first.id);
  assert.equal(second.title, "My story");
  assert.equal(second.text, "Updated after a connection failure.");
  assert.equal(
    (await client.query("SELECT count(*)::int AS count FROM reader_text"))
      .rows[0].count,
    1,
  );
});

test("editing updates the saved entry while title-only changes preserve its content", async () => {
  const first = await create();
  const updated = await detail.PATCH(
    request("PATCH", {
      text: "Uusi suomalainen teksti.",
      sourceLang: "fi",
      targetLang: "ru",
    }),
    context(first.id),
  );
  assert.equal(updated.status, 200);
  const document = (await updated.json()).text;
  assert.equal(document.id, first.id);
  assert.equal(document.title, first.title);
  assert.equal(document.createdAt, first.createdAt);
  assert.equal(document.text, "Uusi suomalainen teksti.");
  await detail.PATCH(
    request("PATCH", { title: "Finnish story" }),
    context(first.id),
  );
  const response = await detail.GET(request("GET"), context(first.id));
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.json()).text.text, document.text);
});

test("anonymous users cannot list, read, create, edit, or delete reader texts", async () => {
  const text = await create();
  userId = null;
  const responses = await Promise.all([
    collection.GET(request("GET")),
    collection.POST(request("POST", input())),
    detail.GET(request("GET"), context(text.id)),
    detail.PATCH(request("PATCH", { title: "No" }), context(text.id)),
    detail.DELETE(request("DELETE"), context(text.id)),
  ]);
  assert(responses.every((response) => response.status === 401));
});

test("all reader operations isolate accounts, including colliding creation IDs", async () => {
  const text = await create();
  userId = other;
  assert.deepEqual(
    (await (await collection.GET(request("GET"))).json()).texts,
    [],
  );
  for (const method of ["GET", "PATCH", "DELETE"]) {
    const response = await detail[method](
      request(
        method,
        method === "PATCH" ? { title: "Stolen", text: "Stolen" } : undefined,
      ),
      context(text.id),
    );
    assert.equal(response.status, 404);
  }
  const conflict = await collection.POST(
    request("POST", input({ id: text.id, text: "Stolen" })),
  );
  assert.equal(conflict.status, 409);
  assert.equal((await repo.getReaderText(owner, text.id)).text, text.text);
});

test("history searches titles and full content across all entries using literal search characters", async () => {
  const text = await create({
    text:
      "Opening words for a long story " +
      "padding ".repeat(60) +
      "hidden needle 100% under_score back\\slash",
  });
  await detail.PATCH(
    request("PATCH", { title: "A custom heading" }),
    context(text.id),
  );
  for (const q of [
    "CUSTOM HEADING",
    "hidden needle",
    "100%",
    "under_score",
    "back\\slash",
  ]) {
    const response = await collection.GET(
      request("GET", undefined, `?${new URLSearchParams({ q })}`),
    );
    const page = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(
      page.texts.map((row) => row.id),
      [text.id],
      q,
    );
    assert.equal(page.texts[0].preview.length, 160);
    assert.equal(
      page.texts[0].text,
      undefined,
      "The list returns summaries rather than every full text",
    );
  }
  const missing = await collection.GET(request("GET", undefined, "?q=100_"));
  assert.equal(
    (await missing.json()).texts.length,
    0,
    "An underscore is not a wildcard",
  );
});

test("history pagination preserves timestamp precision and stable ordering when dates tie", async () => {
  const ids = Array.from({ length: 53 }, () => crypto.randomUUID());
  await client.query(
    "INSERT INTO reader_text (id, user_id, title, text, source_lang, target_lang, created_at) SELECT id::uuid, $1::uuid, 'A title', 'A complete text.', 'de', 'en', '2026-11-11 12:00:00.123456+00'::timestamptz FROM unnest($2::text[]) AS id",
    [owner, ids],
  );
  const firstResponse = await collection.GET(request("GET"));
  assert.equal(firstResponse.headers.get("cache-control"), "private, no-store");
  const first = await firstResponse.json();
  assert.equal(first.texts.length, 50);
  assert(first.nextCursor);
  const secondResponse = await collection.GET(
    request("GET", undefined, `?cursor=${first.nextCursor}`),
  );
  assert.equal(secondResponse.status, 200);
  const second = await secondResponse.json();
  assert.equal(second.texts.length, 3);
  assert.equal(second.nextCursor, null);
  const combined = [...first.texts, ...second.texts].map((row) => row.id);
  assert.deepEqual(combined, ids.sort().reverse());
  assert.equal(new Set(combined).size, 53);
});

test("invalid bodies, IDs, languages, titles, sizes and cursors fail before writing", async () => {
  const saved = await create();
  for (const body of [
    "{",
    input({ text: "  " }),
    input({ text: "a".repeat(20_001) }),
    input({ sourceLang: "xx" }),
    input({ targetLang: "xx" }),
    input({ id: "not-a-uuid" }),
  ]) {
    assert.equal((await collection.POST(request("POST", body))).status, 400);
  }
  for (const body of [
    {},
    { title: " " },
    { title: "x".repeat(201) },
    { text: " " },
    { userId: other },
    "{",
  ]) {
    assert.equal(
      (await detail.PATCH(request("PATCH", body), context(saved.id))).status,
      400,
    );
  }
  assert.equal(
    (
      await collection.POST(
        request("POST", input({ text: "x".repeat(128_001) })),
      )
    ).status,
    413,
  );
  for (const method of ["GET", "PATCH", "DELETE"]) {
    assert.equal(
      (
        await detail[method](
          request(method, method === "PATCH" ? { title: "valid" } : undefined),
          context("invalid"),
        )
      ).status,
      400,
    );
  }
  for (const cursor of [
    "broken",
    Buffer.from(
      JSON.stringify({ id: saved.id, createdAt: "yesterday" }),
    ).toString("base64url"),
    "x".repeat(513),
  ]) {
    assert.equal(
      (await collection.GET(request("GET", undefined, `?cursor=${cursor}`)))
        .status,
      400,
    );
  }
  assert.equal(
    (await collection.GET(request("GET", undefined, `?q=${"x".repeat(201)}`)))
      .status,
    400,
  );
  assert.equal(
    (await client.query("SELECT count(*)::int AS count FROM reader_text"))
      .rows[0].count,
    1,
  );
});

test("deleting a saved text is scoped and account deletion cascades to its library", async () => {
  const saved = await create();
  const removed = await detail.DELETE(request("DELETE"), context(saved.id));
  assert.equal(removed.status, 200);
  assert.equal(
    (await detail.GET(request("GET"), context(saved.id))).status,
    404,
  );
  await create();
  await client.query("DELETE FROM app_user WHERE id = $1", [owner]);
  assert.equal(
    (await client.query("SELECT count(*)::int AS count FROM reader_text"))
      .rows[0].count,
    0,
  );
});

test("reader API errors use the shared locale-independent error envelope", async () => {
  userId = null;
  assert.deepEqual(await (await collection.GET(request("GET"))).json(), {
    errorCode: "errors.unauthorized",
  });
  userId = owner;
  assert.deepEqual(
    await (await collection.POST(request("POST", input({ text: " " })))).json(),
    { errorCode: "errors.readerInvalidInput" },
  );
  assert.deepEqual(
    await (
      await detail.GET(request("GET"), context(crypto.randomUUID()))
    ).json(),
    { errorCode: "errors.readerTextNotFound" },
  );
  const tooLarge = await collection.POST(
    request("POST", input({ text: "x".repeat(128_001) })),
  );
  assert.equal(tooLarge.status, 413);
  assert.deepEqual(await tooLarge.json(), {
    errorCode: "errors.theRequestIsTooLarge",
  });
});
