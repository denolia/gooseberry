import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createPostgresFixture } from "./helpers/postgres.mjs";
import { catalogs, loadSource } from "./helpers/i18n.mjs";
import * as locales from "../src/i18n/locale.ts";
import * as reviewModel from "../src/lib/review/model.ts";
import * as reviewSettings from "../src/lib/review/settings.ts";

const fixture = await createPostgresFixture();
const { client, load } = fixture;
const repo = load("@/db/profileRepo");
const userId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
beforeEach(async () => {
  await client.exec("TRUNCATE app_user CASCADE");
  await client.query(
    "INSERT INTO app_user(id,provider,provider_user_id) VALUES ($1,'test','one'),($2,'test','two')",
    [userId, otherId],
  );
});
after(() => fixture.close());

test("the first detected language is persisted and later browser changes cannot override it", async () => {
  assert.equal(await repo.getOrInitializeUserLocale(userId, "ru"), "ru");
  assert.equal(await repo.getOrInitializeUserLocale(userId, "en"), "ru");
  assert.equal((await repo.getUserProfile(userId)).preferences.uiLocale, "ru");
  assert.equal(await repo.getOrInitializeUserLocale(otherId, "en"), "en");
});

test("initializing legacy preferences and locale-only saves preserve all study settings", async () => {
  await repo.updateUserPreferences({
    userId,
    reviewMode: "full",
    newWordsPerDay: 7,
    studyTimeZone: "Europe/Berlin",
  });
  assert.equal(await repo.getOrInitializeUserLocale(userId, "ru"), "ru");
  await repo.updateUserPreferences({ userId, uiLocale: "en" });
  assert.deepEqual((await repo.getUserProfile(userId)).preferences, {
    uiLocale: "en",
    reviewMode: "full",
    newWordsPerDay: 7,
    studyTimeZone: "Europe/Berlin",
  });
  await repo.updateUserPreferences({ userId, reviewMode: "simple" });
  assert.equal((await repo.getUserProfile(userId)).preferences.uiLocale, "en");
});

test("concurrent initialization converges on one choice and a saved choice always wins", async () => {
  const results = await Promise.all([
    repo.getOrInitializeUserLocale(userId, "en"),
    repo.getOrInitializeUserLocale(userId, "ru"),
  ]);
  assert.equal(results[0], results[1]);
  await repo.updateUserPreferences({ userId, uiLocale: "ru" });
  assert.equal(await repo.getOrInitializeUserLocale(userId, "en"), "ru");
  await assert.rejects(
    client.query("UPDATE user_preference SET ui_locale='de' WHERE user_id=$1", [
      userId,
    ]),
    /user_preference_ui_locale_check/,
  );
});

test("a language save changes the next render's catalog without renewing the session", async () => {
  const session = { user: { id: userId } };
  const { PATCH } = loadSource(
    new URL("../src/app/api/profile/route.ts", import.meta.url),
    {
      "next/server": { NextResponse: Response },
      "@/auth": { auth: async () => session },
      "@/db/profileRepo": repo,
      "@/i18n/locale": locales,
      "@/lib/review/model": reviewModel,
      "@/lib/review/settings": reviewSettings,
    },
  );
  const { default: requestConfig } = loadSource(
    new URL("../src/i18n/request.ts", import.meta.url),
    {
      "next/headers": {
        headers: async () => new Headers({ "accept-language": "en-US" }),
      },
      "next-intl/server": { getRequestConfig: (factory) => factory },
      "@/auth": { auth: async () => session },
      "@/db/profileRepo": repo,
      "./locale": locales,
      "../../messages/en.json": catalogs.en,
      "../../messages/ru.json": catalogs.ru,
    },
  );
  assert.equal((await requestConfig()).locale, "en");
  for (const uiLocale of ["ru", "en"]) {
    const response = await PATCH(
      new Request("http://localhost/api/profile", {
        method: "PATCH",
        body: JSON.stringify({ uiLocale }),
      }),
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).preferences.uiLocale, uiLocale);
    const rendered = await requestConfig();
    assert.equal(rendered.locale, uiLocale);
    assert.equal(
      rendered.messages.profileClient.saveSettings,
      catalogs[uiLocale].profileClient.saveSettings,
    );
    assert.equal(
      (await repo.getUserProfile(userId)).preferences.uiLocale,
      uiLocale,
    );
  }
});
