import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "@typescript/typescript6";
import * as textAnalysis from "../src/app/utils/textAnalysisSchema.ts";
import * as languages from "../src/components/ui/Languages.ts";

const SAMPLE = "Berlin ist schön.";
const nextTick = () => new Promise((resolve) => setImmediate(resolve));

function nodes(tree, predicate) {
  if (Array.isArray(tree))
    return tree.flatMap((child) => nodes(child, predicate));
  if (!tree || typeof tree !== "object") return [];
  return [
    ...(predicate(tree) ? [tree] : []),
    ...nodes(tree.props?.children, predicate),
  ];
}

function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return tree && typeof tree === "object" ? text(tree.props?.children) : "";
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function analysis(expression = "Berlin", tokenIds = [0]) {
  return {
    selection: {
      id: `selection-${tokenIds.join("-")}`,
      tokenIds,
      expression,
      translation: `Translation: ${expression}`,
      kind: tokenIds.length > 1 ? "selection" : "word",
      explanation: "",
      stability: 100,
    },
    constructions: [],
  };
}

function setup(
  t,
  { response = async () => Response.json(analysis()), tier = "premium" } = {},
) {
  const hooks = [];
  let cursor = 0;
  let effects = [];
  let dirty = false;
  let mounted = true;
  let followOptions;
  const pair = {
    currentSourceLanguage: "German",
    currentTargetLanguage: "Russian",
  };
  const sameDeps = (left, right) =>
    left &&
    right &&
    left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks))
        hooks[index] = {
          value: typeof initial === "function" ? initial() : initial,
        };
      return [
        hooks[index].value,
        (value) => {
          const next =
            typeof value === "function" ? value(hooks[index].value) : value;
          if (!Object.is(next, hooks[index].value)) {
            hooks[index].value = next;
            dirty = true;
          }
        },
      ];
    },
    useRef(current) {
      const index = cursor++;
      return (hooks[index] ??= { current });
    },
    useId() {
      return `analyzer-${cursor++}`;
    },
    useMemo(callback, deps) {
      const index = cursor++;
      if (!sameDeps(hooks[index]?.deps, deps))
        hooks[index] = { deps, value: callback() };
      return hooks[index].value;
    },
    useCallback(callback, deps) {
      return react.useMemo(() => callback, deps);
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = hooks[index];
      if (!sameDeps(previous?.deps, deps)) {
        hooks[index] = { deps };
        effects.push(() => {
          previous?.cleanup?.();
          hooks[index].cleanup = effect();
        });
      }
    },
  };
  const listeners = new Map();
  const timers = new Map();
  const rafs = [];
  const requests = [];
  let timerId = 0;
  let selectedIds = [];
  let tokenElements = [];
  let editorFocuses = 0;
  const readingCalls = [];
  const focusCalls = [];
  const actionEvents = [];
  const audioHandle = {
    readFrom(offset) {
      readingCalls.push(offset);
      actionEvents.push("read");
    },
  };
  const reader = {
    contains: (node) => node === reader || tokenElements.includes(node),
    querySelectorAll: () => tokenElements,
    querySelector(selector) {
      const id = selector.match(/^\[data-token-id="(\d+)"\]$/)?.[1];
      return tokenElements.find((element) => element.dataset.tokenId === id);
    },
  };
  const selection = {
    get isCollapsed() {
      return selectedIds.length === 0;
    },
    rangeCount: 1,
    getRangeAt: () => ({
      commonAncestorContainer: reader,
      intersectsNode: (node) =>
        selectedIds.includes(Number(node.dataset.tokenId)),
    }),
    removeAllRanges() {
      selectedIds = [];
    },
  };
  const addEventListener = (event, listener) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(listener);
  };
  const removeEventListener = (event, listener) =>
    listeners.get(event)?.delete(listener);
  const storage = new Map();
  const globals = new Map(
    ["window", "document", "localStorage"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      getSelection: () => selection,
      setTimeout(callback, delay) {
        const id = ++timerId;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
      requestAnimationFrame: (callback) => rafs.push(callback),
      addEventListener,
      removeEventListener,
      dispatchEvent() {},
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { addEventListener, removeEventListener },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const request = { url, options, body: JSON.parse(options.body) };
    requests.push(request);
    return response(request, requests.length);
  });
  const jsx = (type, props) => ({ type, props });
  const code = ts.transpileModule(
    readFileSync(
      new URL("../src/components/analyzer/TextAnalyzer.tsx", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  const exports = {};
  new Function("require", "exports", code)((name) => {
    const dependencies = {
      react,
      "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
      "next/navigation": { useRouter: () => ({ push() {} }) },
      "next-auth/react": {
        useSession: () => ({
          data: { user: { id: "user-1", tier } },
          status: "authenticated",
        }),
      },
      "@/components/anki/TranslationCard": {
        TranslationCard: "TranslationCard",
      },
      "@/app/utils/ankiMapper": {
        mapTranslationToWordSetItem() {
          throw new Error("Unexpected card preparation");
        },
      },
      "@/app/utils/readJsonLines": {
        readJsonLines() {
          throw new Error("Unexpected translation stream");
        },
      },
      "@/app/utils/textAnalysisSchema": textAnalysis,
      "@/app/utils/translationSchema": {
        TranslationResponseSchema: { parse: (value) => value },
      },
      "@/components/ui/Languages": languages,
      "@/lib/languages/useLanguages": { useLanguages: () => pair },
      "./ReaderAudioPlayer": { ReaderAudioPlayer: "ReaderAudioPlayer" },
      "./AnalyzerPopover": { AnalyzerPopover: "AnalyzerPopover" },
      "./useReadingFollow": {
        useReadingFollow(options) {
          followOptions = options;
        },
      },
      "./TextAnalyzer.module.css": {
        __esModule: true,
        default: new Proxy({}, { get: (_target, name) => name }),
      },
    };
    assert(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports);

  function render() {
    assert(mounted);
    let tree;
    let passes = 0;
    do {
      assert(++passes < 20, "Analyzer effects never settle");
      dirty = false;
      cursor = 0;
      tree = exports.TextAnalyzer();
      tokenElements = nodes(
        tree,
        (node) => node.props?.["data-token-id"] !== undefined,
      ).map((node) => {
        const element = {
          dataset: { tokenId: String(node.props["data-token-id"]) },
          focus(options) {
            focusCalls.push({ id: node.props["data-token-id"], options });
            actionEvents.push("focus");
          },
          closest: () => element,
        };
        return element;
      });
      for (const node of nodes(
        tree,
        (node) => node.props?.ref && typeof node.type === "string",
      )) {
        if (node.type === "textarea")
          node.props.ref.current = {
            focus() {
              editorFocuses++;
            },
          };
        else if (node.type === "ReaderAudioPlayer")
          node.props.ref.current = audioHandle;
        else if (node.props.onMouseUp) node.props.ref.current = reader;
      }
      const pending = effects;
      effects = [];
      pending.forEach((effect) => effect());
    } while (dirty);
    return tree;
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
  return {
    requests,
    readingCalls,
    focusCalls,
    actionEvents,
    timers,
    listeners,
    render,
    get followOptions() {
      return followOptions;
    },
    get editorFocuses() {
      return editorFocuses;
    },
    async ready() {
      render();
      await nextTick();
      render();
    },
    async open(value = SAMPLE) {
      const area = nodes(render(), (node) => node.type === "textarea")[0];
      assert(area, "Missing text editor");
      area.props.onChange({ target: { value } });
      this.button("Open text").props.onClick();
      await nextTick();
      return render();
    },
    button(label) {
      const button = nodes(
        render(),
        (node) => node.type === "button" && text(node) === label,
      )[0];
      assert(button, `Missing button ${label}`);
      return button;
    },
    popup() {
      return nodes(render(), (node) => node.type === "AnalyzerPopover")[0];
    },
    tokens() {
      return nodes(
        render(),
        (node) => typeof node.props?.onMouseUp === "function",
      )[0];
    },
    player() {
      return nodes(render(), (node) => node.type === "ReaderAudioPlayer")[0];
    },
    readRange(range) {
      this.player().props.onReadingRangeChange(range);
      return render();
    },
    playbackActive(active) {
      this.player().props.onPlaybackActiveChange(active);
      return render();
    },
    audioAvailable(available) {
      this.player().props.onAvailabilityChange(available);
      return render();
    },
    spoken() {
      return nodes(
        this.tokens(),
        (node) =>
          node.type === "span" &&
          node.props.className?.split(/\s+/).includes("spokenText"),
      );
    },
    select(ids) {
      selectedIds = ids;
    },
    clickWord(id) {
      const token = tokenElements.find(
        (element) => Number(element.dataset.tokenId) === id,
      );
      assert(token, `Missing token ${id}`);
      this.tokens().props.onClick({ target: token });
      return render();
    },
    keyWord(id, key = "Enter") {
      const token = tokenElements.find(
        (element) => Number(element.dataset.tokenId) === id,
      );
      let prevented = false;
      this.tokens().props.onKeyDown({
        target: token,
        key,
        preventDefault() {
          prevented = true;
        },
      });
      assert(prevented);
      return render();
    },
    close() {
      this.popup().props.onClose();
      return render();
    },
    language(source, target = "Russian") {
      pair.currentSourceLanguage = source;
      pair.currentTargetLanguage = target;
      return render();
    },
    fireTimers() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach(({ callback }) => callback());
    },
    fireRafs() {
      rafs.splice(0).forEach((callback) => callback());
    },
    async settle() {
      await nextTick();
      return render();
    },
  };
}

test("opened text has one reader, standalone audio above it, and Edit text in the footer", async (t) => {
  const ui = setup(t);
  await ui.ready();
  const tree = await ui.open();
  const all = nodes(tree, () => true);
  const player = all.find((node) => node.type === "ReaderAudioPlayer");
  const reader = all.find(
    (node) => node.props?.["aria-label"] === "Text reader",
  );
  assert(player && reader);
  assert.equal(player.props.accountId, "user-1");
  assert(all.indexOf(player) < all.indexOf(reader));
  assert.equal(
    nodes(reader, (node) => node.type === "ReaderAudioPlayer").length,
    0,
  );
  assert.equal(
    text(tree).split(SAMPLE).length - 1,
    1,
    "Do not repeat the full text in a compact preview",
  );
  assert.equal(nodes(tree, (node) => node.type === "textarea").length, 0);
  assert.equal(
    nodes(
      reader,
      (node) => node.type === "button" && text(node) === "Edit text",
    ).length,
    1,
  );
  assert.equal(ui.popup(), undefined);
  ui.button("Edit text").props.onClick();
  ui.render();
  ui.fireRafs();
  assert.equal(
    nodes(ui.render(), (node) => node.type === "textarea")[0].props.value,
    SAMPLE,
  );
  assert.equal(ui.editorFocuses, 1);
});

test("word selection opens anchored loading content and Close cancels an in-flight analysis", async (t) => {
  const pending = deferred();
  const ui = setup(t, { response: () => pending.promise });
  await ui.ready();
  await ui.open();
  ui.clickWord(0);
  assert(ui.popup());
  assert.deepEqual(ui.popup().props.tokenIds, [0]);
  assert.equal(ui.popup().props.focusOnOpen, false);
  assert.match(text(ui.popup()), /Checking the selected words/);
  assert.deepEqual(ui.requests[0].body.selectedTokenIds, [0]);
  ui.close();
  assert.equal(ui.requests[0].options.signal.aborted, true);
  assert.equal(ui.popup(), undefined);
  pending.resolve(Response.json(analysis()));
  await ui.settle();
  assert.equal(
    ui.popup(),
    undefined,
    "A late response must not reopen the closed popup",
  );
  ui.clickWord(0);
  assert.equal(
    ui.requests.length,
    2,
    "A cancelled result must not become cached analysis",
  );
});

test("a newer word selection cannot be replaced by an older late success", async (t) => {
  const older = deferred();
  const ui = setup(t, {
    response: (_request, index) =>
      index === 1 ? older.promise : Response.json(analysis("schön", [4])),
  });
  await ui.ready();
  await ui.open();
  ui.clickWord(0);
  ui.clickWord(4);
  await ui.settle();
  assert.equal(ui.requests[0].options.signal.aborted, true);
  assert.match(text(ui.popup()), /Translation: schön/);
  older.resolve(Response.json(analysis("Berlin", [0])));
  await ui.settle();
  assert.deepEqual(ui.popup().props.tokenIds, [4]);
  assert.match(text(ui.popup()), /Translation: schön/);
  assert.doesNotMatch(text(ui.popup()), /Translation: Berlin/);
});

test("native phrase selection submits every selected word and suppresses the following click", async (t) => {
  const ui = setup(t, {
    response: () => Response.json(analysis("Berlin ist", [0, 2])),
  });
  await ui.ready();
  await ui.open();
  ui.readRange({ start: 0, end: SAMPLE.length });
  ui.select([0, 2]);
  ui.tokens().props.onMouseUp();
  await ui.settle();
  assert.deepEqual(ui.requests[0].body.selectedTokenIds, [0, 2]);
  assert.deepEqual(ui.popup().props.tokenIds, [0, 2]);
  assert.equal(ui.spoken().map(text).join(""), SAMPLE);
  ui.clickWord(0);
  assert.equal(ui.requests.length, 1);
  ui.fireTimers();
});

test("keyboard word activation requests popover focus and exposes dialog relationships", async (t) => {
  const ui = setup(t);
  await ui.ready();
  await ui.open();
  ui.keyWord(0);
  assert.equal(ui.popup().props.focusOnOpen, true);
  const token = nodes(
    ui.render(),
    (node) => node.props?.["data-token-id"] === 0,
  )[0];
  assert.equal(token.props["aria-haspopup"], "dialog");
  assert.equal(token.props["aria-expanded"], true);
  assert.equal(token.props["aria-controls"], ui.popup().props.id);
});

test("changing the language pair closes the popup, cancels selection timers, and invalidates results", async (t) => {
  const pending = deferred();
  const ui = setup(t, { response: () => pending.promise });
  await ui.ready();
  await ui.open();
  ui.clickWord(0);
  ui.tokens().props.onTouchEnd();
  assert.equal(ui.timers.size, 1);
  ui.language("Finnish");
  assert.equal(ui.popup(), undefined);
  assert.equal(ui.requests[0].options.signal.aborted, true);
  assert.equal(ui.timers.size, 0);
  pending.resolve(Response.json(analysis()));
  await ui.settle();
  assert.equal(ui.popup(), undefined);
  ui.clickWord(0);
  assert.equal(ui.requests.at(-1).body.sourceLanguage, "Finnish");
});

test("Edit text closes analysis and clears delayed touch selection before showing the editor", async (t) => {
  const pending = deferred();
  const ui = setup(t, { response: () => pending.promise });
  await ui.ready();
  await ui.open();
  ui.clickWord(0);
  ui.tokens().props.onTouchEnd();
  ui.button("Edit text").props.onClick();
  ui.render();
  assert.equal(ui.popup(), undefined);
  assert.equal(ui.requests[0].options.signal.aborted, true);
  assert.equal(ui.timers.size, 0);
  assert.equal(
    nodes(ui.render(), (node) => node.type === "textarea").length,
    1,
  );
  pending.resolve(Response.json(analysis()));
  await ui.settle();
  assert.equal(ui.popup(), undefined);
});

test("reopening the same successful selection reuses its analysis without another request", async (t) => {
  const ui = setup(t);
  await ui.ready();
  await ui.open();
  ui.clickWord(0);
  await ui.settle();
  ui.close();
  ui.clickWord(0);
  assert.equal(ui.requests.length, 1);
  assert.match(text(ui.popup()), /Translation: Berlin/);
});

test("sentence highlighting uses exact UTF-16 positions for repeated text, including spaces and punctuation", async (t) => {
  const ui = setup(t);
  const value = "🫐 Hallo Welt! Hallo Welt!";
  await ui.ready();
  await ui.open(value);
  const before = nodes(
    ui.tokens(),
    (node) => node.props?.["data-token-id"] !== undefined,
  ).map((node) => ({ id: node.props["data-token-id"], text: text(node) }));
  const secondStart = value.lastIndexOf("Hallo Welt!");
  ui.readRange({ start: secondStart, end: value.length });
  assert.equal(ui.spoken().map(text).join(""), "Hallo Welt!");
  const highlightedWords = ui
    .spoken()
    .filter((node) => node.props["data-token-id"] !== undefined);
  const words = textAnalysis
    .tokenizeText(value, "de")
    .filter((token) => token.isWord);
  assert.deepEqual(
    highlightedWords.map((node) => node.props["data-token-id"]),
    words.slice(2).map((token) => token.id),
  );
  assert.deepEqual(
    ui
      .spoken()
      .filter((node) => node.props["data-token-id"] === undefined)
      .map(text),
    [" ", "!"],
  );
  const after = nodes(
    ui.tokens(),
    (node) => node.props?.["data-token-id"] !== undefined,
  ).map((node) => ({ id: node.props["data-token-id"], text: text(node) }));
  assert.deepEqual(
    after,
    before,
    "Speech highlighting must not change API token IDs or anchor spans",
  );
  assert.equal(text(ui.tokens()), value);
});

test("reading highlight survives selection rerenders and coexists with the selected word and popover", async (t) => {
  const pending = deferred();
  const ui = setup(t, { response: () => pending.promise });
  const value = "Berlin ist schön. Noch ein Satz.";
  await ui.ready();
  await ui.open(value);
  const callback = ui.player().props.onReadingRangeChange;
  ui.readRange({ start: 0, end: value.indexOf(" Noch") });
  ui.clickWord(0);
  assert.equal(ui.player().props.onReadingRangeChange, callback);
  assert.equal(
    ui.spoken().map(text).join(""),
    "Berlin ist schön.",
    "An unrelated rerender while paused must preserve the sentence",
  );
  const firstWord = nodes(
    ui.tokens(),
    (node) => node.props?.["data-token-id"] === 0,
  )[0];
  assert(firstWord.props.className.split(/\s+/).includes("selectedToken"));
  assert(firstWord.props.className.split(/\s+/).includes("spokenText"));
  assert.deepEqual(ui.popup().props.tokenIds, [0]);
  assert.deepEqual(ui.requests[0].body.selectedTokenIds, [0]);
  ui.readRange({ start: value.indexOf("Noch"), end: value.length });
  assert.equal(ui.spoken().map(text).join(""), "Noch ein Satz.");
  assert.deepEqual(
    ui.popup().props.tokenIds,
    [0],
    "Advancing speech must not move the translation selection",
  );
  ui.readRange(null);
  assert.equal(ui.spoken().length, 0);
  assert.deepEqual(
    ui.popup().props.tokenIds,
    [0],
    "Stopping speech must not close word analysis",
  );
  pending.resolve(Response.json(analysis()));
  await ui.settle();
});

test("changing source language or text immediately ignores sentence ranges from the previous input", async (t) => {
  const ui = setup(t);
  await ui.ready();
  await ui.open();
  const oldCallback = ui.player().props.onReadingRangeChange;
  ui.readRange({ start: 0, end: SAMPLE.length });
  assert.equal(ui.spoken().map(text).join(""), SAMPLE);
  ui.language("Finnish");
  assert.equal(ui.spoken().length, 0);
  oldCallback({ start: 0, end: SAMPLE.length });
  ui.render();
  assert.equal(
    ui.spoken().length,
    0,
    "A stale German callback must not highlight Finnish playback",
  );
  ui.readRange({ start: 0, end: SAMPLE.length });
  assert.equal(ui.spoken().map(text).join(""), SAMPLE);
  const previousTextCallback = ui.player().props.onReadingRangeChange;
  ui.button("Edit text").props.onClick();
  ui.render();
  await ui.open("Ein ganz anderer längerer Text.");
  assert.equal(ui.spoken().length, 0);
  previousTextCallback({ start: 0, end: SAMPLE.length });
  ui.render();
  assert.equal(
    ui.spoken().length,
    0,
    "A stale range must not paint a replacement text",
  );
});

test("null and invalid reading ranges clear sentence highlighting", async (t) => {
  const ui = setup(t);
  await ui.ready();
  await ui.open();
  for (const range of [
    null,
    { start: -1, end: 5 },
    { start: 5, end: 5 },
    { start: 9, end: 4 },
    { start: 0, end: SAMPLE.length + 1 },
  ]) {
    ui.readRange({ start: 0, end: SAMPLE.length });
    assert(ui.spoken().length > 0);
    ui.readRange(range);
    assert.equal(ui.spoken().length, 0);
  }
});

test("reading follow receives exact token offsets and pauses or suspends without clearing the blue sentence", async (t) => {
  const ui = setup(t);
  const value = "🫐 Hallo Welt! Noch ein Satz.";
  await ui.ready();
  assert.equal(ui.followOptions.suspended, true);
  await ui.open(value);
  const spans = nodes(ui.tokens(), (node) => node.type === "span");
  let offset = 0;
  for (const span of spans) {
    assert.equal(span.props["data-text-start"], offset);
    offset += text(span).length;
    assert.equal(span.props["data-text-end"], offset);
  }
  assert.equal(offset, value.length);
  assert.equal(ui.followOptions.suspended, false);
  const range = { start: 0, end: value.indexOf(" Noch") };
  ui.readRange(range);
  ui.playbackActive(true);
  assert.deepEqual(ui.followOptions.range, range);
  assert.equal(ui.followOptions.active, true);
  ui.playbackActive(false);
  assert.equal(ui.followOptions.active, false);
  assert.equal(ui.spoken().map(text).join(""), "🫐 Hallo Welt!");
  const wordId = spans.find((span) => text(span) === "Hallo").props[
    "data-token-id"
  ];
  ui.clickWord(wordId);
  assert.equal(ui.followOptions.suspended, true);
  assert.deepEqual(ui.followOptions.range, range);
  ui.close();
  assert.equal(ui.followOptions.suspended, false);
  ui.button("Edit text").props.onClick();
  ui.render();
  assert.equal(ui.followOptions.suspended, true);
  assert.equal(ui.spoken().map(text).join(""), "🫐 Hallo Welt!");
  ui.language("Finnish");
  assert.equal(
    ui.followOptions.range,
    null,
    "An old source-language range must not drive automatic scrolling",
  );
});

test("read-from-selection waits for audio readiness, then synchronously closes analysis and starts at the earliest selected UTF-16 offset", async (t) => {
  const pending = deferred();
  const ui = setup(t, { response: () => pending.promise });
  const value = "🫐 Hallo Welt! Hallo Welt!";
  await ui.ready();
  await ui.open(value);
  const secondStart = value.lastIndexOf("Hallo Welt!");
  const selectedWords = nodes(
    ui.tokens(),
    (node) =>
      node.props?.["data-token-id"] !== undefined &&
      node.props["data-text-start"] >= secondStart,
  );
  const selectedIds = selectedWords.map((node) => node.props["data-token-id"]);
  ui.select([...selectedIds].reverse());
  ui.tokens().props.onMouseUp();
  ui.render();
  assert.match(text(ui.popup()), /Checking the selected words/);
  const unavailable = ui.button("Listen from this sentence");
  assert.equal(unavailable.props.disabled, true);
  assert.match(unavailable.props.title, /Loading audio settings/);
  unavailable.props.onClick();
  assert.deepEqual(ui.readingCalls, []);
  assert(ui.popup(), "The unavailable action must leave translation open");

  ui.audioAvailable(true);
  assert.equal(ui.button("Listen from this sentence").props.disabled, false);
  ui.fireTimers();
  ui.tokens().props.onTouchEnd();
  assert(ui.timers.size > 0);
  ui.button("Listen from this sentence").props.onClick();
  assert.deepEqual(
    ui.readingCalls,
    [secondStart],
    "Invoke the reader within the click, using original UTF-16 positions",
  );
  assert.deepEqual(ui.actionEvents, ["focus", "read"]);
  assert.deepEqual(ui.focusCalls, [
    { id: selectedIds[0], options: { preventScroll: true } },
  ]);
  assert.equal(ui.requests[0].options.signal.aborted, true);
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.popup(), undefined);
  assert.equal(ui.followOptions.suspended, false);
  pending.resolve(Response.json(analysis("Hallo Welt", selectedIds)));
  await ui.settle();
  assert.equal(ui.popup(), undefined, "A late translation must stay closed");
});

test("read-from-selection remains available in translation error and results states and reflects revoked audio readiness", async (t) => {
  const ui = setup(t, {
    response: (_request, index) =>
      index === 1
        ? Response.json({ error: "Analysis unavailable" }, { status: 503 })
        : Response.json(analysis()),
  });
  await ui.ready();
  await ui.open();
  ui.audioAvailable(true);
  ui.keyWord(0);
  await ui.settle();
  assert.match(text(ui.popup()), /Analysis unavailable/);
  assert.equal(ui.button("Listen from this sentence").props.disabled, false);
  ui.button("Retry analysis").props.onClick();
  await ui.settle();
  assert.match(text(ui.popup()), /Translation: Berlin/);
  assert.equal(ui.button("Listen from this sentence").props.disabled, false);
  ui.audioAvailable(false);
  assert.equal(ui.button("Listen from this sentence").props.disabled, true);
  ui.button("Listen from this sentence").props.onClick();
  assert.deepEqual(ui.readingCalls, []);
  assert(ui.popup());
  ui.audioAvailable(true);
  ui.button("Listen from this sentence").props.onClick();
  assert.deepEqual(ui.readingCalls, [0]);
  assert.equal(ui.popup(), undefined);
});

test("free accounts keep translation and a Premium notice but cannot read from the selected sentence", async (t) => {
  const ui = setup(t, { tier: "free" });
  await ui.ready();
  await ui.open();
  ui.audioAvailable(true);
  ui.clickWord(0);
  await ui.settle();
  assert.match(text(ui.popup()), /Translation: Berlin/);
  const action = ui.button("Listen from this sentence");
  assert.equal(action.props.disabled, true);
  assert.equal(action.props.title, "Available with Premium");
  assert.equal(
    nodes(
      ui.popup(),
      (node) => node.type === "a" && node.props.href === "/profile",
    ).some((node) => text(node) === "Premium"),
    true,
  );
  action.props.onClick();
  assert.deepEqual(ui.readingCalls, []);
  assert.deepEqual(ui.focusCalls, []);
  assert(ui.popup());
});
