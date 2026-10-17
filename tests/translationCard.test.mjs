import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "@typescript/typescript6";
import { fieldsFromDraft } from "../src/app/utils/cardDraft.ts";

const code = ts.transpileModule(
  readFileSync(
    new URL("../src/components/anki/TranslationCard.tsx", import.meta.url),
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

function nodes(tree, predicate) {
  if (Array.isArray(tree))
    return tree.flatMap((node) => nodes(node, predicate));
  if (!tree || typeof tree !== "object") return [];
  return [
    ...(predicate(tree) ? [tree] : []),
    ...nodes(tree.props?.children, predicate),
  ];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (tree?.props?.["aria-hidden"]) return "";
  return tree && typeof tree === "object" ? text(tree.props?.children) : "";
}
const nextTick = () => new Promise((resolve) => setImmediate(resolve));

function setup(t, props = {}, queryOverrides = {}) {
  const hooks = [];
  const listeners = new Map();
  const frames = new Map();
  const memory = new Map();
  const requests = [];
  const focused = [];
  const refElements = new WeakMap();
  let refs = new Set();
  let cursor = 0;
  let effects = [];
  let dirty = false;
  let tree;
  let frameId = 0;
  const currentProps = {
    response: {
      original: "Haus",
      translation: "дом",
      example_usage: [{ sample: "Ein Haus.", sample_translation: "Дом." }],
    },
    sourceLang: "de",
    targetLang: "ru",
    children: "Translated meaning",
    ...props,
  };
  const query = {
    data: [
      { id: "set-1", name: "German", sourceLang: "de", targetLang: "ru" },
      { id: "set-2", name: "Travel", sourceLang: "de", targetLang: "ru" },
    ],
    isPending: false,
    error: null,
    refetch: async () => {},
    ...queryOverrides,
  };
  const client = {
    setQueryData(_key, updater) {
      query.data = updater(query.data);
    },
    invalidateQueries() {},
  };
  const sameDeps = (left, right) =>
    left &&
    right &&
    left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      hooks[index] ??= {
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
      return (hooks[cursor++] ??= { current });
    },
    useId() {
      return `card-${cursor++}`;
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
  const fakeDocument = {
    activeElement: null,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type, event) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
    },
  };
  const storage = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
  };
  const globals = new Map(
    ["window", "document", "localStorage"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: fakeDocument,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: storage,
      requestAnimationFrame(callback) {
        const id = ++frameId;
        frames.set(id, callback);
        return id;
      },
      cancelAnimationFrame(id) {
        frames.delete(id);
      },
    },
  });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    if (url === "/api/word-sets")
      return Response.json({
        wordSet: {
          id: "new-set",
          name: "New",
          sourceLang: "de",
          targetLang: "ru",
        },
      });
    return Response.json({ itemId: "item-1" });
  });
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  new Function("require", "exports", code)((name) => {
    const dependencies = {
      react,
      "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
      "@tanstack/react-query": {
        useQuery: () => query,
        useQueryClient: () => client,
      },
      "next-auth/react": {
        useSession: () => ({ data: { user: { id: "user-1" } } }),
      },
      "next/link": { __esModule: true, default: "a" },
      "lucide-react": { Ellipsis: "ellipsis-icon" },
      "@/app/utils/ankiMapper": {
        mapTranslationToWordSetItem: (response) => ({
          original: response.original,
          translation: response.translation,
          wordForms: "",
          comments: "",
          tags: "",
        }),
      },
      "@/app/utils/cardDraft": { fieldsFromDraft },
      "./CardEditor": { CardEditor: "CardEditor" },
      "./TranslationCard.module.css": { default: {} },
    };
    assert(name in dependencies, `Unexpected import ${name}`);
    return dependencies[name];
  }, exports);
  function attach(tree, parent, nextRefs) {
    if (Array.isArray(tree)) {
      tree.forEach((node) => attach(node, parent, nextRefs));
      return;
    }
    if (!tree || typeof tree !== "object") return;
    const ref = tree.props?.ref;
    let element = ref && refElements.get(ref);
    if (!element) {
      element = {
        focus(options) {
          fakeDocument.activeElement = this;
          focused.push({ element: this, options });
        },
        contains(target) {
          for (let current = target; current; current = current.parent)
            if (current === this) return true;
          return false;
        },
      };
      if (ref) refElements.set(ref, element);
    }
    tree.element = element;
    element.parent = parent;
    if (ref) {
      ref.current = element;
      nextRefs.add(ref);
    }
    attach(tree.props?.children, element, nextRefs);
  }
  function render(nextProps = {}) {
    Object.assign(currentProps, nextProps);
    let renders = 0;
    do {
      assert(++renders < 20, "Card effects failed to settle");
      cursor = 0;
      dirty = false;
      tree = exports.TranslationCard(currentProps);
      const nextRefs = new Set();
      attach(tree, null, nextRefs);
      for (const ref of refs) if (!nextRefs.has(ref)) ref.current = null;
      refs = nextRefs;
      const pending = effects;
      effects = [];
      pending.forEach((effect) => effect());
    } while (dirty);
    return tree;
  }
  t.after(() => {
    hooks.forEach((hook) => hook?.cleanup?.());
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return {
    requests,
    memory,
    focused,
    document: fakeDocument,
    render,
    button(label) {
      const button = nodes(
        render(),
        (node) =>
          node.type === "button" &&
          (node.props["aria-label"] === label || text(node) === label),
      )[0];
      assert(button, `Missing ${label}`);
      return button;
    },
    menu() {
      return nodes(render(), (node) => node.props?.role === "menu")[0];
    },
    actionArea() {
      return nodes(
        render(),
        (node) => node.type === "div" && node.props?.onKeyDown,
      )[0];
    },
    flushFrames() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback());
      return render();
    },
    async click(label) {
      const button = this.button(label);
      assert(!button.props.disabled);
      button.props.onClick();
      await nextTick();
      render();
      this.flushFrames();
    },
    async settle() {
      await nextTick();
      render();
      this.flushFrames();
    },
  };
}

test("cards without the optional action preserve direct saving and saved-card editing", async (t) => {
  const card = setup(t);
  assert.equal(
    nodes(card.render(), (node) => node.props?.["aria-haspopup"] === "menu")
      .length,
    0,
  );
  await card.click("Save card to “German”");
  assert.equal(card.requests.length, 1);
  assert.equal(card.requests[0].url, "/api/word-sets/set-1/items");
  assert.equal(card.requests[0].options.method, "POST");
  assert.equal(card.requests[0].body.card.original, "Haus");
  assert.equal(card.requests[0].body.card.sample, "Ein Haus.");
  await card.click("Edit card in “German”");
  assert.equal(
    nodes(card.render(), (node) => node.type === "CardEditor").length,
    1,
  );
});

test("optional overflow action opens the translation exactly once without saving a card", async (t) => {
  let opens = 0;
  const card = setup(t, { onOpenTranslation: () => opens++ });
  await card.click("More translation actions");
  assert.equal(
    card.button("More translation actions").props["aria-expanded"],
    true,
  );
  const item = card.button("Open in Translation");
  assert.equal(item.props.role, "menuitem");
  assert.equal(card.document.activeElement, item.element);
  assert.equal(
    card.focused.at(-1).options,
    undefined,
    "opening focus must reveal a menu below the popup scroll viewport",
  );
  await card.click("Open in Translation");
  assert.equal(opens, 1);
  assert.equal(card.menu(), undefined);
  assert.equal(card.requests.length, 0);
  assert.equal(
    card.document.activeElement,
    card.button("More translation actions").element,
  );
  assert.deepEqual(card.focused.at(-1).options, { preventScroll: true });
});

test("overflow keyboard opening, Escape and Tab preserve focus without dismissing an outer popup", async (t) => {
  const card = setup(t, { onOpenTranslation() {} });
  const trigger = card.button("More translation actions");
  let prevented = false;
  trigger.props.onKeyDown({
    key: "ArrowDown",
    preventDefault() {
      prevented = true;
    },
  });
  card.render();
  card.flushFrames();
  assert.equal(prevented, true);
  assert.equal(
    card.document.activeElement,
    card.button("Open in Translation").element,
  );
  let stopped = false;
  card.actionArea().props.onKeyDown({
    key: "Escape",
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {
      stopped = true;
    },
  });
  card.render();
  card.flushFrames();
  assert.equal(stopped, true);
  assert.equal(card.menu(), undefined);
  assert.equal(card.document.activeElement, trigger.element);
  await card.click("More translation actions");
  let tabPrevented = false;
  card.actionArea().props.onKeyDown({
    key: "Tab",
    preventDefault() {
      tabPrevented = true;
    },
  });
  card.render();
  assert.equal(
    tabPrevented,
    false,
    "Native Tab must continue to the next control",
  );
  assert.equal(card.menu(), undefined);
  assert.equal(card.document.activeElement, trigger.element);
});

test("outside pointer dismissal leaves outside focus alone while inside clicks keep the menu open", async (t) => {
  const card = setup(t, { onOpenTranslation() {} });
  await card.click("More translation actions");
  card.document.dispatch("pointerdown", {
    target: card.button("Open in Translation").element,
  });
  assert(card.menu());
  const outside = {};
  card.document.activeElement = outside;
  card.document.dispatch("pointerdown", { target: outside });
  card.render();
  card.flushFrames();
  assert.equal(card.menu(), undefined);
  assert.equal(card.document.activeElement, outside);
});

test("set picker and overflow are mutually exclusive and the selected destination still saves correctly", async (t) => {
  const card = setup(t, { onOpenTranslation() {} });
  await card.click("More translation actions");
  await card.click("Choose Anki set. Current set: German");
  assert.equal(card.menu(), undefined);
  assert.equal(
    nodes(card.render(), (node) => node.props?.role === "dialog").length,
    1,
  );
  await card.click("More translation actions");
  assert.equal(
    nodes(card.render(), (node) => node.props?.role === "dialog").length,
    0,
  );
  await card.click("Choose Anki set. Current set: German");
  await card.click("Travel");
  await card.click("Save card to “Travel”");
  assert.equal(card.requests[0].url, "/api/word-sets/set-2/items");
});

test("opening Translation remains available while the independent Save destinations load", async (t) => {
  let opens = 0;
  const card = setup(
    t,
    { onOpenTranslation: () => opens++ },
    { isPending: true },
  );
  assert.equal(card.button("Loading sets…").props.disabled, true);
  await card.click("More translation actions");
  await card.click("Open in Translation");
  assert.equal(opens, 1);
  assert.equal(card.requests.length, 0);
});

test("lazy prepared cards still save once and later editor changes PATCH the same saved item", async (t) => {
  let prepared = 0;
  const draft = {
    original: "vorbereitet",
    translation: "готовый",
    wordForms: "",
    comments: "",
    tags: "verb",
    examples: [],
  };
  const card = setup(t, {
    onOpenTranslation() {},
    prepareCard: async () => {
      prepared++;
      return draft;
    },
  });
  await card.click("More translation actions");
  assert.equal(prepared, 0);
  await card.click("Save card to “German”");
  assert.equal(prepared, 1);
  assert.equal(card.requests[0].body.card.original, draft.original);
  assert.equal(card.menu(), undefined);
  await card.click("Edit card in “German”");
  const editor = nodes(card.render(), (node) => node.type === "CardEditor")[0];
  editor.props.onChange({ ...draft, translation: "обновлённый" });
  card.render();
  await card.click("Save changes");
  assert.equal(prepared, 1);
  assert.equal(card.requests[1].options.method, "PATCH");
  assert.equal(card.requests[1].body.itemId, "item-1");
  assert.equal(card.requests[1].body.translation, "обновлённый");
});
