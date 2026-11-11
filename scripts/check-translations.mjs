import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTranslator } from "next-intl";

const root = new URL("../", import.meta.url);
const read = (locale) =>
  JSON.parse(readFileSync(new URL(`messages/${locale}.json`, root), "utf8"));
const flatten = (catalog) =>
  Object.fromEntries(
    Object.entries(catalog).flatMap(([namespace, values]) =>
      Object.entries(values).map(([key, value]) => [
        `${namespace}.${key}`,
        value,
      ]),
    ),
  );
const en = read("en");
const english = flatten(en);
for (const locale of ["en", "ru"]) {
  const catalog = read(locale);
  const messages = flatten(catalog);
  assert.deepEqual(
    Object.keys(messages).sort(),
    Object.keys(english).sort(),
    `${locale}: translation keys differ`,
  );
  const t = createTranslator({
    locale,
    messages: catalog,
    onError: (error) => {
      throw error;
    },
  });
  for (const [key, message] of Object.entries(messages)) {
    assert.equal(typeof message, "string", `${locale}:${key} must be text`);
    assert(message.trim(), `${locale}:${key} must not be empty`);
    const args = (value) =>
      [...value.matchAll(/\{(\w+)(?:[,}])/g)]
        .filter(
          (match) =>
            !/(?:=\d+|zero|one|two|few|many|other)\s*$/.test(
              value.slice(0, match.index),
            ),
        )
        .map((match) => match[1]);
    assert.deepEqual(
      [...new Set(args(message))].sort(),
      [...new Set(args(english[key]))].sort(),
      `${locale}:${key} interpolation arguments differ`,
    );
    const values = Object.fromEntries(
      args(message).map((name) => [
        name,
        /count|Count|number/.test(name) ? 5 : "example",
      ]),
    );
    t(key, values);
  }
}
console.log(
  `Validated ${Object.keys(english).length} messages in English and Russian.`,
);
