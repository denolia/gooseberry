import assert from "node:assert/strict";
import test from "node:test";
import { getReadingFollowTarget } from "../src/lib/analyzer/readingFollow.ts";

const defaults = {
  viewport: { top: 0, height: 800 },
  lineHeight: 30,
  scrollY: 500,
  maxScroll: 5000,
};

test("a readable sentence keeps the page still with two lines and dock space reserved", () => {
  assert.equal(
    getReadingFollowTarget({ ...defaults, rects: [{ top: 100, bottom: 600 }] }),
    null,
  );
});

test("following a lower sentence moves only enough to preserve two lines and the floating dock", () => {
  assert.equal(
    getReadingFollowTarget({ ...defaults, rects: [{ top: 680, bottom: 740 }] }),
    580,
  );
});

test("following a sentence above the reading margin scrolls upward minimally", () => {
  assert.equal(
    getReadingFollowTarget({ ...defaults, rects: [{ top: 20, bottom: 80 }] }),
    460,
  );
});

test("visual viewport offsets and the computed reader line height define the reading area", () => {
  assert.equal(
    getReadingFollowTarget({
      ...defaults,
      viewport: { top: 200, height: 600 },
      lineHeight: 40,
      rects: [{ top: 640, bottom: 700 }],
    }),
    560,
  );
});

test("a new oversized sentence follows its first line and never alternates to its final line", () => {
  const first = getReadingFollowTarget({
    ...defaults,
    newSentence: true,
    rects: [
      { top: 1000, bottom: 1030 },
      { top: 1800, bottom: 1830 },
    ],
  });
  assert.equal(first, 1440);
  assert.equal(
    getReadingFollowTarget({
      ...defaults,
      scrollY: first,
      rects: [
        { top: 60, bottom: 90 },
        { top: 860, bottom: 890 },
      ],
    }),
    null,
  );
});

test("resuming the same long sentence preserves the visible middle after manual reading", () => {
  assert.equal(
    getReadingFollowTarget({
      ...defaults,
      rects: [
        { top: -600, bottom: -570 },
        { top: 100, bottom: 130 },
        { top: 1000, bottom: 1030 },
      ],
    }),
    null,
  );
  assert.equal(
    getReadingFollowTarget({
      ...defaults,
      rects: [
        { top: -1200, bottom: -1170 },
        { top: -400, bottom: -370 },
      ],
    }),
    0,
  );
});

test("document bounds prevent scrolling above the top or past the last page", () => {
  assert.equal(
    getReadingFollowTarget({
      ...defaults,
      scrollY: 20,
      rects: [{ top: 0, bottom: 30 }],
    }),
    0,
  );
  assert.equal(
    getReadingFollowTarget({
      ...defaults,
      maxScroll: 520,
      rects: [{ top: 1000, bottom: 1030 }],
    }),
    520,
  );
  assert.equal(
    getReadingFollowTarget({
      ...defaults,
      scrollY: 0,
      maxScroll: 0,
      rects: [{ top: 1000, bottom: 1030 }],
    }),
    null,
  );
});

test("small visible viewports reduce margins instead of creating an impossible reading band", () => {
  const target = getReadingFollowTarget({
    ...defaults,
    viewport: { top: 0, height: 200 },
    lineHeight: 40,
    rects: [{ top: 180, bottom: 220 }],
  });
  assert(target > 500 && target < 700);
});

test("empty or invalid geometry and imperceptible adjustments never trigger a scroll", () => {
  for (const rects of [
    [],
    [{ top: NaN, bottom: 40 }],
    [{ top: 40, bottom: 40 }],
  ])
    assert.equal(getReadingFollowTarget({ ...defaults, rects }), null);
  assert.equal(
    getReadingFollowTarget({ ...defaults, rects: [{ top: 59, bottom: 89 }] }),
    null,
  );
  assert.equal(
    getReadingFollowTarget({
      ...defaults,
      viewport: { top: 0, height: 0 },
      rects: [{ top: 0, bottom: 30 }],
    }),
    null,
  );
});
