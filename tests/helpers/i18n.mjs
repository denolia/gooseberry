import { isDeepStrictEqual } from "node:util";
import { readFileSync } from "node:fs";
import { createTranslator } from "next-intl";
import ts from "@typescript/typescript6";

export const messageErrors = loadSource(
  new URL("../../src/i18n/errors.ts", import.meta.url),
);
export const catalogs = Object.fromEntries(
  ["en", "ru"].map((locale) => [
    locale,
    JSON.parse(
      readFileSync(
        new URL(`../../messages/${locale}.json`, import.meta.url),
        "utf8",
      ),
    ),
  ]),
);
export function translations(locale = "en") {
  const t = createTranslator({
    locale,
    messages: catalogs[locale],
    onError(error) {
      throw error;
    },
  });
  return { locale, t };
}
export const i18n = { useI18n: () => translations() };

/** Load a source module in unit harnesses that provide explicit dependencies. */
export function loadSource(url, dependencies = {}) {
  const code = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  new Function("require", "exports", code)((name) => {
    if (name === "@/i18n/errors") return messageErrors;
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected source dependency ${name}`);
  }, exports);
  return exports;
}

export function hasError(key, values) {
  return (error) =>
    error?.userMessage?.key === key &&
    (values === undefined ||
      isDeepStrictEqual(error.userMessage.values, values));
}
