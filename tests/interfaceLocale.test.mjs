import { messageErrors, catalogs, translations } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "@typescript/typescript6";
import { detectUiLocale, isUiLocale } from "../src/i18n/locale.ts";

test("browser detection respects preferences, regional locales, quality and unsupported languages", () => {
  for (const [header, expected] of [
    [null, "en"],
    ["", "en"],
    ["ru-RU,ru;q=0.9,en;q=0.8", "ru"],
    ["en-GB,ru;q=0.9", "en"],
    ["de-DE,ru;q=0.8,en;q=0.7", "ru"],
    ["ru;q=0.2,en-US;q=0.9", "en"],
    ["RU-ru;q=1", "ru"],
    ["fr,ja;q=0.8", "en"],
    ["ru;q=0,en;q=1", "en"],
    ["ru;q=garbage,en", "en"],
    ["ru;q=2,en", "en"],
  ])
    assert.equal(detectUiLocale(header), expected, header);
  for (const value of [undefined, null, "de", "ru-RU", "RU", 1])
    assert.equal(isUiLocale(value), false);
  assert(isUiLocale("ru"));
  assert(isUiLocale("en"));
});

test("stable label keys and structured errors translate without inspecting English text", () => {
  const { t } = translations("ru");
  assert.equal(t("common.studySets"), "Учебные наборы");
  assert.equal(t("common.again"), "Снова");
  assert.equal(
    t("errors.couldNotSaveSettings"),
    "Не удалось сохранить настройки.",
  );
  assert.equal(
    t("translationCard.editCardInValue", { value0: "My set" }),
    "Изменить карточку в наборе «My set»",
  );
  const original = new messageErrors.MessageError("errors.expectedBatchValue", {
    value0: 42,
  });
  const envelope = structuredClone(
    messageErrors.errorEnvelope(original, "errors.invalidRequest"),
  );
  assert.deepEqual(envelope, {
    errorCode: "errors.expectedBatchValue",
    errorValues: { value0: 42 },
  });
  const restored = messageErrors.errorFromResponse(
    envelope,
    "errors.invalidRequest",
  );
  const message = messageErrors.messageFromError(
    restored,
    "errors.invalidRequest",
  );
  assert.equal(t(message.key, message.values), "Ожидается пакет 42");
  assert.equal(
    messageErrors.formatError(
      t,
      new Error("Private diagnostic text"),
      "errors.couldNotSaveSettings",
    ),
    "Не удалось сохранить настройки.",
  );
  // Legacy English copy is not used as an identifier or parsed for parameters.
  assert.equal(
    messageErrors.errorFromResponse(
      { error: "Expected batch 42" },
      "errors.invalidRequest",
    ).userMessage.key,
    "errors.invalidRequest",
  );
  assert.equal(
    messageErrors.errorFromResponse(
      { errorCode: "not-a-message-key" },
      "errors.invalidRequest",
    ).userMessage.key,
    "errors.invalidRequest",
  );
});

test("Russian messages use singular, few and many forms while preserving user data", () => {
  const { t } = translations("ru");
  for (const [count, expected] of [
    [0, "0 слов"],
    [1, "1 слово"],
    [2, "2 слова"],
    [5, "5 слов"],
    [21, "21 слово"],
    [22, "22 слова"],
    [25, "25 слов"],
  ]) {
    assert.equal(t("common.wordCount", { count }), expected);
  }
  assert.equal(
    t("translationCard.savedToValue", { value0: "My words" }),
    "Сохранено в набор «My words».",
  );
});

test("all locale catalogs have matching keys, arguments and valid ICU messages", () => {
  execFileSync(process.execPath, ["scripts/check-translations.mjs"], {
    cwd: new URL("../", import.meta.url),
    stdio: "pipe",
  });
});

test("server rendering uses the account locale, detects signed-out visitors and falls back per message", async () => {
  let session = null;
  let acceptLanguage = "ru-RU,en;q=0.8";
  let savedLocale;
  const reads = [];
  const russian = structuredClone(catalogs.ru);
  delete russian.header.signIn;
  const code = ts.transpileModule(
    readFileSync(new URL("../src/i18n/request.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const dependencies = {
    "next/headers": { headers: async () => ({ get: () => acceptLanguage }) },
    "next-intl/server": { getRequestConfig: (factory) => factory },
    "@/auth": { auth: async () => session },
    "@/db/profileRepo": {
      getOrInitializeUserLocale: async (userId, detected) => {
        reads.push({ userId, detected });
        savedLocale ??= detected;
        return savedLocale;
      },
    },
    "./locale": { detectUiLocale },
    "../../messages/en.json": catalogs.en,
    "../../messages/ru.json": russian,
  };
  const requestConfig = {};
  new Function("require", "exports", code)((name) => {
    if (name === "@/i18n/errors") return messageErrors;
    assert(
      name in dependencies,
      `Unexpected request-config dependency ${name}`,
    );
    return dependencies[name];
  }, requestConfig);
  assert.equal((await requestConfig.default()).locale, "ru");
  assert.equal(
    (await requestConfig.default()).messages.header.signIn,
    "Sign in",
  );
  assert.equal(reads.length, 0);
  session = { user: { id: "user-1" } };
  assert.equal((await requestConfig.default()).locale, "ru");
  assert.deepEqual(reads[0], { userId: "user-1", detected: "ru" });
  savedLocale = "en";
  assert.equal((await requestConfig.default()).locale, "en");
  acceptLanguage = "en-US";
  savedLocale = "ru";
  // An older session must not hide a newer profile preference.
  session = { user: { id: "user-1", uiLocale: "en" } };
  assert.equal((await requestConfig.default()).locale, "ru");
  assert.equal(
    (await requestConfig.default()).messages.profileClient.saveSettings,
    catalogs.ru.profileClient.saveSettings,
  );
  session = null;
  assert.equal((await requestConfig.default()).locale, "en");
});
