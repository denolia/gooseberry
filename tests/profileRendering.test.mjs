import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { renderProfile } from "./helpers/profileRendering.mjs";
import { translations } from "./helpers/i18n.mjs";
import { languageLabelKey } from "../src/components/ui/Languages.ts";

for (const locale of ["en", "ru"]) {
  test(`${locale} profile dates render identically across machine locales and time zones`, () => {
    const script = `
      import { renderProfile } from "./tests/helpers/profileRendering.mjs";
      process.stdout.write(renderProfile(process.argv[1]));
    `;
    const outputs = [
      { LANG: "en_US.UTF-8", TZ: "UTC" },
      { LANG: "en_GB.UTF-8", TZ: "Pacific/Honolulu" },
      { LANG: "ru_RU.UTF-8", TZ: "Asia/Tokyo" },
    ].map((defaults) =>
      execFileSync(
        process.execPath,
        ["--input-type=module", "-e", script, locale],
        {
          cwd: new URL("../", import.meta.url),
          env: { ...process.env, ...defaults },
          encoding: "utf8",
        },
      ),
    );
    for (const output of outputs) assert.equal(output, outputs[0]);
    const memberDate = locale === "ru" ? "08.01.2026" : "1/8/2026";
    const requestDate = locale === "ru" ? "11.11.2026" : "11/11/2026";
    assert(outputs[0].includes(`<dd>${memberDate}</dd>`));
    assert(
      outputs[0].includes(
        translations(locale).t("profileClient.requestSent", {
          date: requestDate,
        }),
      ),
    );
  });
}

test("the saved locale renders profile and header controls with the real translation provider", () => {
  for (const locale of ["en", "ru"]) {
    const html = renderProfile(locale);
    const { t } = translations(locale);
    assert(html.includes(t("profileClient.memberSince")));
    assert(html.includes(t("profileClient.saveSettings")));
    assert(html.includes(t("header.profile")));
    assert(
      html.includes(
        `value="English">${t(languageLabelKey("English"))}</option>`,
      ),
    );
    assert(
      html.includes(
        `value="Russian">${t(languageLabelKey("Russian"))}</option>`,
      ),
    );
    assert(
      html.includes(
        `value="${locale}" selected="">${locale === "ru" ? "Русский" : "English"}</option>`,
      ),
    );
  }
});
