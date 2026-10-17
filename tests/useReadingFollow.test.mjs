import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "@typescript/typescript6";
import * as geometry from "../src/lib/analyzer/readingFollow.ts";

function setup(t) {
  const hooks = [];
  let cursor = 0;
  let layoutEffects = [];
  let effects = [];
  let mounted = true;
  let now = 0;
  let selection = null;
  let reducedMotion = false;
  let rects = [{ top: 900, bottom: 930 }];
  const frames = new Map();
  const timers = new Map();
  const observers = [];
  const scrolls = [];
  const windowListeners = new Map();
  const documentListeners = new Map();
  const viewportListeners = new Map();
  let nextId = 0;
  const sameDeps = (left, right) =>
    left &&
    right &&
    left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index]));
  function effect(queue, callback, deps) {
    const index = cursor++;
    const previous = hooks[index];
    if (!sameDeps(previous?.deps, deps)) {
      hooks[index] = { deps };
      queue.push(() => {
        previous?.cleanup?.();
        hooks[index].cleanup = callback();
      });
    }
  }
  const react = {
    useRef(current) {
      return (hooks[cursor++] ??= { current });
    },
    useEffect(callback, deps) {
      effect(effects, callback, deps);
    },
    useLayoutEffect(callback, deps) {
      effect(layoutEffects, callback, deps);
    },
  };
  const add = (listeners) => (type, callback) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(callback);
  };
  const remove = (listeners) => (type, callback) =>
    listeners.get(type)?.delete(callback);
  const body = { scrollHeight: 5000, closest: () => null };
  const input = {
    closest: (selector) => (/input/.test(selector) ? input : null),
  };
  const span = {
    textContent: "Ein langer Satz.",
    dataset: { textStart: "0", textEnd: "16" },
    getClientRects: () => rects,
  };
  const reader = { children: [span] };
  const fakeDocument = {
    body,
    documentElement: { scrollHeight: 5000 },
    hidden: false,
    activeElement: body,
    addEventListener: add(documentListeners),
    removeEventListener: remove(documentListeners),
  };
  const viewport = {
    offsetTop: 0,
    height: 800,
    addEventListener: add(viewportListeners),
    removeEventListener: remove(viewportListeners),
  };
  const fakeWindow = {
    innerHeight: 800,
    scrollX: 0,
    scrollY: 0,
    visualViewport: viewport,
    getSelection: () => selection,
    getComputedStyle: () => ({ lineHeight: "24px", fontSize: "16px" }),
    matchMedia: () => ({ matches: reducedMotion }),
    addEventListener: add(windowListeners),
    removeEventListener: remove(windowListeners),
    requestAnimationFrame(callback) {
      const id = ++nextId;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout(callback, delay) {
      const id = ++nextId;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    scrollTo(options) {
      const delta = options.top - fakeWindow.scrollY;
      scrolls.push({ ...options, moved: delta !== 0 });
      fakeWindow.scrollY = options.top;
      rects = rects.map((rect) => ({
        top: rect.top - delta,
        bottom: rect.bottom - delta,
      }));
    },
  };
  const globals = new Map(
    ["window", "document", "ResizeObserver"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  for (const [key, value] of Object.entries({
    window: fakeWindow,
    document: fakeDocument,
    ResizeObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.disconnected = false;
        observers.push(this);
      }
      observe() {}
      unobserve() {}
      disconnect() {
        this.disconnected = true;
      }
    },
  }))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  t.mock.method(Date, "now", () => now);
  const code = ts.transpileModule(
    readFileSync(
      new URL(
        "../src/components/analyzer/useReadingFollow.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const exports = {};
  new Function("require", "exports", code)((name) => {
    const dependencies = { react, "@/lib/analyzer/readingFollow": geometry };
    assert(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports);
  const options = {
    readerRef: { current: reader },
    range: { start: 0, end: 16 },
    active: false,
    suspended: false,
  };
  function render(next = {}) {
    assert(mounted);
    Object.assign(options, next);
    cursor = 0;
    exports.useReadingFollow(options);
    const layouts = layoutEffects;
    layoutEffects = [];
    layouts.forEach((callback) => callback());
    const pending = effects;
    effects = [];
    pending.forEach((callback) => callback());
  }
  function unmount() {
    if (!mounted) return;
    hooks.forEach((hook) => hook?.cleanup?.());
    mounted = false;
  }
  t.after(() => {
    unmount();
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  function dispatch(listeners, type, details = {}) {
    [...(listeners.get(type) ?? [])].forEach((callback) =>
      callback({ target: body, ...details }),
    );
  }
  return {
    options,
    frames,
    timers,
    observers,
    scrolls,
    render,
    unmount,
    get moves() {
      return scrolls.filter((scroll) => scroll.moved);
    },
    windowEvent(type, details) {
      dispatch(windowListeners, type, details);
    },
    documentEvent(type, details) {
      dispatch(documentListeners, type, details);
    },
    fireFrames() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback());
    },
    tick(milliseconds) {
      const end = now + milliseconds;
      let iterations = 0;
      while (true) {
        assert(++iterations < 1000, "Follow timer failed to settle");
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.at <= end)
          .sort((left, right) => left[1].at - right[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = end;
    },
    setRects(next) {
      rects = next;
    },
    reducedMotion(value) {
      reducedMotion = value;
    },
    select(value) {
      selection = value ? { isCollapsed: false } : null;
      dispatch(documentListeners, "selectionchange");
    },
    focusInput(value) {
      fakeDocument.activeElement = value ? input : body;
      dispatch(documentListeners, value ? "focusin" : "focusout", {
        target: input,
      });
    },
    hide(value) {
      fakeDocument.hidden = value;
      dispatch(documentListeners, "visibilitychange");
    },
    listeners() {
      return [windowListeners, documentListeners, viewportListeners];
    },
  };
}

test("follow starts only for actual playback, respects reduced motion, and cancels on pause or suspension", (t) => {
  const ui = setup(t);
  ui.render();
  ui.fireFrames();
  assert.equal(ui.moves.length, 0);
  ui.reducedMotion(true);
  ui.render({ active: true });
  ui.fireFrames();
  assert.equal(ui.moves.length, 1);
  assert.equal(ui.moves[0].behavior, "instant");
  ui.render({ active: false });
  assert.equal(
    ui.scrolls.at(-1).moved,
    false,
    "Pause must cancel ongoing scrolling without changing position",
  );
  ui.setRects([{ top: 1000, bottom: 1030 }]);
  ui.tick(5000);
  ui.fireFrames();
  assert.equal(ui.moves.length, 1);
  ui.render({ active: true, suspended: true });
  ui.fireFrames();
  assert.equal(ui.moves.length, 1);
  ui.render({ suspended: false });
  ui.fireFrames();
  assert.equal(ui.moves.length, 2);
});

test("a held pointer blocks follow beyond quiet time and resumes only after release plus 2,500 ms", (t) => {
  const ui = setup(t);
  ui.render();
  ui.documentEvent("pointerdown", { pointerId: 1 });
  ui.render({ active: true });
  ui.tick(6000);
  ui.fireFrames();
  assert.equal(ui.moves.length, 0);
  ui.documentEvent("pointerup", { pointerId: 1 });
  ui.tick(2499);
  ui.fireFrames();
  assert.equal(ui.moves.length, 0);
  ui.tick(1);
  ui.fireFrames();
  assert.equal(ui.moves.length, 1);
});

test("touch and momentum scroll events postpone following until the final quiet interval", (t) => {
  const ui = setup(t);
  ui.render();
  ui.documentEvent("touchstart");
  ui.render({ active: true });
  ui.tick(3000);
  ui.fireFrames();
  assert.equal(ui.moves.length, 0);
  ui.documentEvent("touchend", { touches: [] });
  ui.tick(2000);
  ui.windowEvent("scroll");
  ui.tick(2499);
  ui.fireFrames();
  assert.equal(ui.moves.length, 0);
  ui.tick(1);
  ui.fireFrames();
  assert.equal(ui.moves.length, 1);
});

test("selection and form focus suspend indefinitely and resume politely after clearing", (t) => {
  const ui = setup(t);
  ui.render();
  ui.select(true);
  ui.render({ active: true });
  ui.tick(5000);
  ui.fireFrames();
  assert.equal(ui.moves.length, 0);
  ui.select(false);
  ui.tick(2500);
  ui.fireFrames();
  assert.equal(ui.moves.length, 1);
  ui.setRects([{ top: 1000, bottom: 1030 }]);
  ui.focusInput(true);
  ui.tick(5000);
  ui.fireFrames();
  assert.equal(ui.moves.length, 1);
  ui.focusInput(false);
  ui.tick(2500);
  ui.fireFrames();
  assert.equal(ui.moves.length, 2);
});

test("Tab yields while unrelated programmatic scrolling does not arm a manual session", (t) => {
  const ui = setup(t);
  ui.render();
  ui.windowEvent("scroll");
  ui.render({ active: true });
  ui.fireFrames();
  assert.equal(ui.moves.length, 1);
  ui.setRects([{ top: 1000, bottom: 1030 }]);
  ui.documentEvent("keydown", { key: "Tab" });
  ui.render({ range: { start: 0, end: 15 } });
  ui.fireFrames();
  assert.equal(ui.moves.length, 1);
  ui.tick(2500);
  ui.fireFrames();
  assert.equal(ui.moves.length, 2);
});

test("own smooth scrolling does not delay a new sentence and long sentences do not bounce after manual reading", (t) => {
  const ui = setup(t);
  ui.render({ active: true });
  ui.fireFrames();
  assert.equal(ui.moves[0].behavior, "smooth");
  ui.windowEvent("scroll");
  ui.tick(160);
  ui.setRects([{ top: 1000, bottom: 1030 }]);
  ui.render({ range: { start: 1, end: 15 } });
  ui.fireFrames();
  assert.equal(
    ui.moves.length,
    2,
    "Our own scroll events must not create a 2,500 ms user pause",
  );
  ui.windowEvent("wheel");
  ui.setRects([
    { top: -400, bottom: -376 },
    { top: 150, bottom: 174 },
    { top: 1000, bottom: 1024 },
  ]);
  ui.windowEvent("scroll");
  ui.tick(2500);
  ui.fireFrames();
  assert.equal(
    ui.moves.length,
    2,
    "Keep visible lines of an already-followed long sentence instead of jumping to its beginning",
  );
});

test("buffering between pieces of the same long sentence keeps its visible middle instead of jumping back", (t) => {
  const ui = setup(t);
  const range = { start: 0, end: 16 };
  ui.setRects([
    { top: 900, bottom: 924 },
    { top: 1200, bottom: 1224 },
    { top: 1800, bottom: 1824 },
  ]);
  ui.render({ active: true, range });
  ui.fireFrames();
  assert.equal(ui.moves.length, 1);
  ui.windowEvent("wheel");
  ui.setRects([
    { top: -400, bottom: -376 },
    { top: 150, bottom: 174 },
    { top: 1000, bottom: 1024 },
  ]);
  ui.windowEvent("scroll");
  ui.tick(2500);
  ui.fireFrames();
  assert.equal(ui.moves.length, 1);
  ui.render({ active: false, range: null });
  ui.render({ active: true, range: { ...range } });
  ui.fireFrames();
  assert.equal(
    ui.moves.length,
    1,
    "A temporarily cleared reading range must preserve the sentence that was already followed",
  );
});

test("hidden pages and unmount cancel smooth scrolling, listeners, timers, frames, and observers", (t) => {
  const ui = setup(t);
  ui.render({ active: true });
  ui.fireFrames();
  ui.hide(true);
  assert.equal(ui.scrolls.at(-1).moved, false);
  ui.setRects([{ top: 1000, bottom: 1030 }]);
  ui.tick(5000);
  ui.fireFrames();
  assert.equal(ui.moves.length, 1);
  ui.hide(false);
  ui.fireFrames();
  assert.equal(ui.moves.length, 2);
  ui.windowEvent("wheel");
  assert(ui.timers.size > 0);
  ui.unmount();
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.frames.size, 0);
  assert(ui.observers.every((observer) => observer.disconnected));
  assert(
    ui
      .listeners()
      .every((listeners) =>
        [...listeners.values()].every((set) => set.size === 0),
      ),
  );
});
