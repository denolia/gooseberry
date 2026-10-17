import assert from "node:assert/strict";
import test from "node:test";
import { getAnalyzerPopoverPosition } from "../src/lib/analyzer/popoverPosition.ts";

const viewport = { left: 0, top: 0, width: 1200, height: 800 };
const rect = (left, top, width = 80, height = 30) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

test("translation popover prefers the space immediately above the selected line", () => {
  const position = getAnalyzerPopoverPosition([rect(500, 400)], viewport, {
    width: 480,
    height: 200,
  });
  assert.deepEqual(position, {
    left: 300,
    top: 192,
    width: 480,
    maxHeight: 380,
    placement: "above",
    anchorIndex: 0,
  });
});

test("translation popover goes below a word near the viewport top", () => {
  const position = getAnalyzerPopoverPosition([rect(500, 20)], viewport, {
    width: 480,
    height: 200,
  });
  assert.equal(position.placement, "below");
  assert.equal(position.top, 58);
  assert.equal(position.maxHeight, 730);
});

test("multiline selections anchor to their first visible line rather than offscreen text", () => {
  const position = getAnalyzerPopoverPosition(
    [rect(100, -50), rect(180, 100), rect(100, 150)],
    viewport,
    { width: 480, height: 200 },
  );
  assert.equal(position.anchorIndex, 1);
  assert.equal(position.top, 138);
  assert.equal(position.left, 12);
});

test("an offscreen selection hides instead of jumping to a viewport edge", () => {
  for (const anchor of [
    rect(100, -30),
    rect(100, 800),
    rect(-80, 100),
    rect(1200, 100),
  ]) {
    assert.equal(
      getAnalyzerPopoverPosition([anchor], viewport, {
        width: 480,
        height: 200,
      }),
      null,
    );
  }
});

test("desktop placement clamps both horizontal edges with a 12-pixel inset", () => {
  const left = getAnalyzerPopoverPosition([rect(0, 400)], viewport, {
    width: 480,
    height: 200,
  });
  const right = getAnalyzerPopoverPosition([rect(1150, 400)], viewport, {
    width: 480,
    height: 200,
  });
  assert.equal(left.left, 12);
  assert.equal(right.left + right.width, 1188);
});

test("a tall mobile translation prefers readable space above the word and scrolls internally", () => {
  const mobile = { left: 0, top: 0, width: 360, height: 640 };
  const position = getAnalyzerPopoverPosition([rect(300, 300)], mobile, {
    width: 480,
    height: 1200,
  });
  assert.equal(position.width, 336);
  assert.equal(position.left, 12);
  assert.equal(position.placement, "above");
  assert.equal(position.top, 12);
  assert.equal(position.maxHeight, 280);
  assert.ok(position.top + position.maxHeight <= 628);
});

test("keyboard and pinch-zoom visual viewport offsets bound the popup", () => {
  const visible = { left: 100, top: 200, width: 320, height: 300 };
  const position = getAnalyzerPopoverPosition([rect(350, 400)], visible, {
    width: 480,
    height: 1000,
  });
  assert.equal(position.left, 112);
  assert.equal(position.width, 296);
  assert.equal(position.placement, "above");
  assert.equal(position.top, 212);
  assert.equal(position.maxHeight, 180);
});

test("partially visible selected words remain anchored to their visible line", () => {
  const position = getAnalyzerPopoverPosition([rect(100, -10)], viewport, {
    width: 480,
    height: 200,
  });
  assert.equal(position.placement, "below");
  assert.equal(position.top, 28);
});

test("a sliver of a selected line still respects the top and bottom viewport insets", () => {
  const nearTop = getAnalyzerPopoverPosition([rect(100, -29)], viewport, {
    width: 480,
    height: 2000,
  });
  const nearBottom = getAnalyzerPopoverPosition([rect(100, 799)], viewport, {
    width: 480,
    height: 2000,
  });
  assert.equal(nearTop.top, 12);
  assert.equal(nearTop.top + nearTop.maxHeight, 788);
  assert.equal(nearBottom.top, 12);
  assert.equal(nearBottom.top + nearBottom.maxHeight, 788);
});

test("invalid dimensions and empty selections have no popup position", () => {
  for (const anchors of [[], [rect(100, 100, 0)], [rect(NaN, 100)]]) {
    assert.equal(
      getAnalyzerPopoverPosition(anchors, viewport, {
        width: 480,
        height: 200,
      }),
      null,
    );
  }
  assert.equal(
    getAnalyzerPopoverPosition(
      [rect(100, 100)],
      { ...viewport, width: 20 },
      { width: 480, height: 200 },
    ),
    null,
  );
  assert.equal(
    getAnalyzerPopoverPosition([rect(100, 100)], viewport, {
      width: 480,
      height: Infinity,
    }),
    null,
  );
});
