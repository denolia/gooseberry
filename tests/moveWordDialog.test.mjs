import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "@typescript/typescript6";

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
  if (typeof tree === "string") return tree;
  return tree && typeof tree === "object" ? text(tree.props?.children) : "";
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const source = {
  id: "source",
  name: "Source",
  sourceLang: "de",
  targetLang: "ru",
};
const destination = { ...source, id: "destination", name: "Travel" };

function setup(t, { save, queryOverrides } = {}) {
  const hooks = [];
  let cursor = 0;
  let effects = [];
  let closed = 0;
  const moved = [];
  const requests = [];
  const invalidations = [];
  const query = {
    data: [
      source,
      destination,
      { ...source, id: "different", name: "Finnish", sourceLang: "fi" },
    ],
    isPending: false,
    error: null,
    refetch: async () => {},
    ...queryOverrides,
  };
  const sameDeps = (a, b) =>
    a &&
    b &&
    a.length === b.length &&
    a.every((value, index) => value === b[index]);
  const react = {
    useState(initial) {
      const slot = cursor++;
      hooks[slot] ??= { value: initial };
      return [
        hooks[slot].value,
        (value) => {
          hooks[slot].value =
            typeof value === "function" ? value(hooks[slot].value) : value;
        },
      ];
    },
    useRef(current) {
      return (hooks[cursor++] ??= { current });
    },
    useId() {
      return `id-${cursor++}`;
    },
    useEffect(effect, deps) {
      const slot = cursor++;
      const previous = hooks[slot];
      if (!sameDeps(previous?.deps, deps)) {
        hooks[slot] = { deps };
        effects.push(() => {
          previous?.cleanup?.();
          hooks[slot].cleanup = effect();
        });
      }
    },
  };
  class Element {
    isConnected = true;
    focusCount = 0;
    focus() {
      this.focusCount++;
    }
  }
  const previousFocus = new Element();
  const dialog = {
    showCount: 0,
    closeCount: 0,
    showModal() {
      this.showCount++;
    },
    close() {
      this.closeCount++;
    },
  };
  const searchInput = new Element();
  const previousGlobals = new Map(
    ["document", "HTMLElement"].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  Object.defineProperty(globalThis, "HTMLElement", {
    configurable: true,
    value: Element,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      activeElement: previousFocus,
      body: { style: { overflow: "auto" } },
    },
  });
  function unmount() {
    hooks.forEach((hook) => {
      hook?.cleanup?.();
      if (hook) hook.cleanup = undefined;
    });
  }
  t.after(() => {
    unmount();
    for (const [name, value] of previousGlobals) {
      if (value) Object.defineProperty(globalThis, name, value);
      else delete globalThis[name];
    }
  });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return save ? save() : Response.json({ success: true });
  });
  const picker = {};
  const jsx = (type, props) => {
    if (type === picker.WordSetPicker) return type(props);
    if (props.ref && type === "dialog") props.ref.current = dialog;
    if (props.ref && type === "input") props.ref.current = searchInput;
    return { type, props };
  };
  function load(filename, mocks) {
    const code = ts.transpileModule(
      readFileSync(new URL(filename, import.meta.url), "utf8"),
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
      if (name === "react/jsx-runtime")
        return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (name.endsWith(".module.css")) return { default: {} };
      if (name in mocks) return mocks[name];
      throw new Error(`Unexpected dependency ${name}`);
    }, exports);
    return exports;
  }
  Object.assign(picker, load("../src/components/anki/WordSetPicker.tsx", {}));
  const { MoveWordDialog } = load("../src/components/anki/MoveWordDialog.tsx", {
    react,
    "./WordSetPicker": picker,
    "./useWordSets": { useWordSets: () => query },
    "next-auth/react": {
      useSession: () => ({ data: { user: { id: "owner" } } }),
    },
    "@tanstack/react-query": {
      useQueryClient: () => ({
        invalidateQueries: (input) => invalidations.push(input),
      }),
    },
  });
  const props = {
    item: { id: "word", original: "Haus", translation: "дом" },
    sourceSet: source,
    onClose: () => closed++,
    onMoved: (set) => moved.push(set),
  };
  function render() {
    cursor = 0;
    effects = [];
    const tree = MoveWordDialog(props);
    effects.forEach((effect) => effect());
    return tree;
  }
  const button = (label) =>
    nodes(
      render(),
      (node) => node.type === "button" && text(node) === label,
    )[0];
  return {
    render,
    button,
    query,
    requests,
    moved,
    invalidations,
    dialog,
    previousFocus,
    unmount,
    closed: () => closed,
    choose: (name) =>
      nodes(
        render(),
        (node) => node.type === "button" && node.props.title === name,
      )[0].props.onClick(),
    submit: () =>
      nodes(render(), (node) => node.type === "form")[0].props.onSubmit({
        preventDefault() {},
      }),
  };
}

// Native modal behavior is mocked here; the user verifies browser layout/focus.
test("move dialog lists all sets and Cancel or Escape makes no request", async (t) => {
  const app = setup(t);
  let tree = app.render();
  assert.equal(app.dialog.showCount, 1);
  assert.equal(document.body.style.overflow, "hidden");
  assert(app.button("Move").props.disabled);
  const options = nodes(
    tree,
    (node) => node.type === "button" && node.props.title,
  );
  assert.equal(options.length, 3);
  assert(options.find((node) => node.props.title === "Source").props.disabled);
  assert(options.find((node) => node.props.title === "Finnish").props.disabled);
  assert(!options.find((node) => node.props.title === "Travel").props.disabled);
  nodes(tree, (node) => node.type === "input")[0].props.onChange({
    target: { value: "travel" },
  });
  tree = app.render();
  assert.equal(
    nodes(tree, (node) => node.type === "button" && node.props.title).length,
    1,
  );
  app.choose("Travel");
  assert(!app.button("Move").props.disabled);
  nodes(app.render(), (node) => node.type === "input")[0].props.onChange({
    target: { value: "Source" },
  });
  assert(
    app.button("Move").props.disabled,
    "a new search must not silently keep a hidden destination selected",
  );
  app.button("Cancel").props.onClick();
  assert.equal(app.closed(), 1);
  nodes(tree, (node) => node.type === "dialog")[0].props.onCancel({
    preventDefault() {},
  });
  assert.equal(app.closed(), 2);
  assert.equal(app.requests.length, 0);
  app.unmount();
  assert.equal(document.body.style.overflow, "auto");
  assert.equal(app.previousFocus.focusCount, 1);
});

test("Move submits once, retains the chosen destination and updates the shared set cache", async (t) => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const app = setup(t, {
    save: async () => {
      await pending;
      return Response.json({ success: true });
    },
  });
  app.render();
  app.choose("Travel");
  assert(!app.button("Move").props.disabled);
  app.submit();
  app.submit();
  assert.deepEqual(app.requests, [
    {
      url: "/api/word-sets/source/items/word/move",
      body: { destinationWordSetId: "destination" },
    },
  ]);
  assert(app.button("Cancel").props.disabled);
  finish();
  await tick();
  assert.deepEqual(app.moved, [destination]);
  assert.deepEqual(app.invalidations, [{ queryKey: ["wordSets"] }]);
});

test("a failed move keeps the modal and destination ready for retry", async (t) => {
  let attempts = 0;
  const app = setup(t, {
    save: async () =>
      ++attempts === 1
        ? Response.json({ error: "Destination changed" }, { status: 409 })
        : Response.json({ success: true }),
  });
  app.render();
  app.choose("Travel");
  app.submit();
  await tick();
  assert.match(text(app.render()), /Destination changed/);
  assert.equal(app.moved.length, 0);
  assert(!app.button("Move").props.disabled);
  app.submit();
  await tick();
  assert.deepEqual(app.requests[0], app.requests[1]);
  assert.equal(app.moved.length, 1);
});

test("loading, failed and empty set lists retain Cancel without enabling Move", (t) => {
  let retries = 0;
  const app = setup(t, {
    queryOverrides: {
      data: undefined,
      isPending: true,
      refetch: () => {
        retries++;
      },
    },
  });
  assert.match(text(app.render()), /Loading sets/);
  assert(app.button("Move").props.disabled);
  app.query.isPending = false;
  app.query.error = new Error("Load failed");
  assert.match(text(app.render()), /Could not load your sets/);
  app.button("Try again").props.onClick();
  assert.equal(retries, 1);
  app.query.error = null;
  app.query.data = [];
  assert.match(text(app.render()), /No sets available/);
  assert(app.button("Move").props.disabled);
  app.button("Cancel").props.onClick();
  assert.equal(app.closed(), 1);
  assert.equal(app.requests.length, 0);
});
