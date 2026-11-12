import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { loadSourceModule } from "./helpers/sourceModule.mjs";
import { translations } from "./helpers/i18n.mjs";

const base = {
  studyDay: { timeZone: "UTC", nextStartAt: "2026-11-11T02:00:00Z" },
  today: { date: "2026-11-10", completions: 27, leaves: 1, progress: 7 },
  totalLeaves: 4,
  currentStreak: 2,
  longestStreak: 3,
  days: [
    { date: "2026-11-09", completions: 0, leaves: 0 },
    { date: "2026-11-10", completions: 27, leaves: 1 },
  ],
};
function render(query, locale = "en") {
  const panel = loadSourceModule(
    "src/components/review/StudyActivityPanel.tsx",
    {
      "@/i18n/client": { useI18n: () => translations(locale) },
      "./useStudyActivity": { useStudyActivity: () => query },
      "./StudyActivityPanel.module.css": { default: {} },
    },
  );
  return renderToStaticMarkup(createElement(panel.StudyActivityPanel));
}

test("compact activity counters retain accessible labels, a meter and daily counts", () => {
  const html = render({ data: base });
  assert.match(html, /role="img" aria-label="1 leaf today"/);
  assert.match(html, /<strong aria-hidden="true">1<\/strong>/);
  assert.match(html, /<strong>7<\/strong><span>\/ 20<\/span>/);
  assert.match(html, /role="img" aria-label="2 day streak"/);
  assert.match(
    html,
    /role="progressbar"[^>]*aria-valuemin="0"[^>]*aria-valuemax="20"[^>]*aria-valuenow="7"[^>]*aria-label="Progress toward the next leaf"/,
  );
  assert.match(html, /aria-valuetext="27 saved exercises today · 7\/20/);
  assert.doesNotMatch(html, /<p>27 saved exercises today/);
  assert.match(html, /data-level="0"/);
  assert.match(html, /data-level="3"/);
  assert.match(html, /<table>/);
  assert.match(
    html,
    /<th scope="row"><time dateTime="2026-11-09">2026-11-09<\/time><\/th><td>0<\/td><td>0<\/td>/,
  );
  assert.match(html, /4 leaves earned/);
  assert.match(html, /Longest streak: 3 days/);
});

test("empty, loading and failed activity never invent rewards and failures offer retry", () => {
  assert.match(render({}), /Loading activity/);
  const html = render({ isError: true, refetch() {} });
  assert.match(html, /Could not load your activity/);
  assert.match(html, />Retry<\/button>/);
  assert.doesNotMatch(html, /role="progressbar"/);
  assert.match(
    render({
      data: {
        ...base,
        today: { ...base.today, completions: 0, leaves: 0, progress: 0 },
      },
    }),
    /0 saved exercises today/,
  );
  assert.match(
    render({ data: base, isError: true }),
    /Showing the last confirmed progress/,
  );
});

test("activity text and calendar equivalents honor the Russian locale", () => {
  const html = render({ data: base }, "ru");
  assert.match(html, /1 лист сегодня/);
  assert.match(html, /Сохранено упражнений сегодня: 27/);
  assert.match(html, /История занятий/);
  assert.doesNotMatch(html, /Study history|leaf today|Saved exercises/);
});
