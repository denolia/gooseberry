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

function setup(t, { response = async () => Response.json(analysis()) } = {}) {
  const hooks = [];
  let cursor = 0;
  let effects = [];
  let dirty = false;
  let mounted = true;
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
  const reader = {
    contains: (node) => node === reader || tokenElements.includes(node),
    querySelectorAll: () => tokenElements,
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
          data: { user: { id: "user-1", tier: "premium" } },
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
      "./TextAnalyzer.module.css": { __esModule: true, default: {} },
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
          focus() {},
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
    timers,
    listeners,
    render,
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
  ui.select([0, 2]);
  ui.tokens().props.onMouseUp();
  await ui.settle();
  assert.deepEqual(ui.requests[0].body.selectedTokenIds, [0, 2]);
  assert.deepEqual(ui.popup().props.tokenIds, [0, 2]);
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
