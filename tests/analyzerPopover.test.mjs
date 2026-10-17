import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "@typescript/typescript6";
import * as positioning from "../src/lib/analyzer/popoverPosition.ts";

function nodes(tree, predicate) {
  if (Array.isArray(tree))
    return tree.flatMap((child) => nodes(child, predicate));
  if (!tree || typeof tree !== "object") return [];
  return [
    ...(predicate(tree) ? [tree] : []),
    ...nodes(tree.props?.children, predicate),
  ];
}

const nextTick = () => new Promise((resolve) => setImmediate(resolve));

function setup(
  t,
  { keyboard = false, compact = false, listenDisabled = false } = {},
) {
  const hooks = [];
  let cursor = 0;
  let dirty = false;
  let layoutEffects = [];
  let effects = [];
  let mounted = true;
  const sameDeps = (left, right) =>
    left &&
    right &&
    left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index]));
  function registerEffect(queue, effect, deps) {
    const index = cursor++;
    const previous = hooks[index];
    if (!sameDeps(previous?.deps, deps)) {
      hooks[index] = { deps };
      queue.push(() => {
        previous?.cleanup?.();
        hooks[index].cleanup = effect();
      });
    }
  }
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
    useSyncExternalStore(_subscribe, getSnapshot) {
      cursor++;
      return getSnapshot();
    },
    useEffect(effect, deps) {
      registerEffect(effects, effect, deps);
    },
    useLayoutEffect(effect, deps) {
      registerEffect(layoutEffects, effect, deps);
    },
  };
  const focuses = [];
  const documentListeners = new Map();
  const windowListeners = new Map();
  const viewportListeners = new Map();
  const frames = new Map();
  const observers = [];
  let frameId = 0;
  let closeCount = 0;
  let selection = null;
  let nestedDialogs = [];
  const add = (listeners) => (event, listener) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(listener);
  };
  const remove = (listeners) => (event, listener) =>
    listeners.get(event)?.delete(listener);
  class FakeNode {
    constructor(name, parent = null) {
      this.name = name;
      this.parent = parent;
    }
    contains(node) {
      for (let current = node; current; current = current.parent)
        if (current === this) return true;
      return false;
    }
    focus(options) {
      focuses.push({ name: this.name, options });
      fakeDocument.activeElement = this;
    }
  }
  const body = new FakeNode("body");
  const reader = new FakeNode("reader", body);
  const anchor = new FakeNode("anchor", reader);
  let anchorRect = { left: 200, right: 270, top: 400, bottom: 430 };
  anchor.dataset = { tokenId: "0" };
  anchor.getClientRects = () => [anchorRect];
  const secondAnchor = new FakeNode("second-anchor", reader);
  secondAnchor.dataset = { tokenId: "2" };
  secondAnchor.getClientRects = () => [
    { left: 280, right: 320, top: 400, bottom: 430 },
  ];
  reader.querySelectorAll = () => [anchor, secondAnchor];
  const popup = new FakeNode("popup", body);
  popup.querySelectorAll = () => nestedDialogs;
  const content = new FakeNode("content", popup);
  content.scrollHeight = 180;
  const contentInner = new FakeNode("inner", content);
  const listenButton = new FakeNode("listen", contentInner);
  const translateButton = new FakeNode("translate", contentInner);
  contentInner.querySelector = () => {
    const first = nodes(
      props.children,
      (node) => node.type === "button" && !node.props.disabled,
    )[0];
    if (!first) return null;
    return first.props.children === "Listen" ? listenButton : translateButton;
  };
  const closeButton = new FakeNode("close", popup);
  const fakeDocument = {
    body,
    activeElement: body,
    addEventListener: add(documentListeners),
    removeEventListener: remove(documentListeners),
  };
  const visualViewport = {
    offsetLeft: 0,
    offsetTop: 0,
    width: 900,
    height: 800,
    addEventListener: add(viewportListeners),
    removeEventListener: remove(viewportListeners),
  };
  const fakeWindow = {
    visualViewport,
    innerWidth: 900,
    innerHeight: 800,
    requestAnimationFrame(callback) {
      const id = ++frameId;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    addEventListener: add(windowListeners),
    removeEventListener: remove(windowListeners),
    getSelection: () => selection,
  };
  const globals = new Map(
    ["window", "document", "Node", "ResizeObserver"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  for (const [key, value] of Object.entries({
    window: fakeWindow,
    document: fakeDocument,
    Node: FakeNode,
    ResizeObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.observed = [];
        this.disconnected = false;
        observers.push(this);
      }
      observe(node) {
        this.observed.push(node);
      }
      disconnect() {
        this.disconnected = true;
      }
    },
  }))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  const jsx = (type, props) => ({ type, props });
  const portalTargets = [];
  const code = ts.transpileModule(
    readFileSync(
      new URL(
        "../src/components/analyzer/AnalyzerPopover.tsx",
        import.meta.url,
      ),
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
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "react-dom": {
        createPortal: (tree, root) => {
          portalTargets.push(root);
          return tree;
        },
      },
      "@/lib/analyzer/popoverPosition": positioning,
      "./AnalyzerPopover.module.css": {
        __esModule: true,
        default: {
          popover: "popover",
          content: "content",
          closeButton: "close",
          compact: "compact",
        },
      },
    };
    assert(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports);
  const props = {
    id: "analyzer-popup",
    readerRef: { current: reader },
    tokenIds: [0],
    focusOnOpen: keyboard,
    compact,
    onClose() {
      closeCount++;
    },
    children: compact
      ? [
          {
            type: "button",
            props: { children: "Listen", disabled: listenDisabled },
          },
          { type: "button", props: { children: "Translate" } },
        ]
      : "Translation result",
  };
  const refNodes = {
    popover: popup,
    content,
    inner: contentInner,
    close: closeButton,
  };
  function render(next = {}) {
    assert(mounted);
    Object.assign(props, next);
    let tree;
    let passes = 0;
    do {
      assert(++passes < 20, "Popover effects never settle");
      dirty = false;
      cursor = 0;
      tree = exports.AnalyzerPopover(props);
      for (const node of nodes(tree, (node) => node.props?.ref))
        node.props.ref.current =
          refNodes[node.props.className?.split(" ")[0] ?? "inner"];
      const layouts = layoutEffects;
      layoutEffects = [];
      layouts.forEach((effect) => effect());
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
    body,
    reader,
    anchor,
    popup,
    content,
    closeButton,
    focuses,
    frames,
    observers,
    portalTargets,
    documentListeners,
    windowListeners,
    viewportListeners,
    viewport: visualViewport,
    render,
    unmount,
    get closeCount() {
      return closeCount;
    },
    async ready() {
      render();
      await nextTick();
      return render();
    },
    outside() {
      return new FakeNode("outside", body);
    },
    dispatchDocument(type, details = {}) {
      const event = {
        target: body,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        ...details,
      };
      [...(documentListeners.get(type) ?? [])].forEach((listener) =>
        listener(event),
      );
      return event;
    },
    dispatchWindow(type, details = {}) {
      [...(windowListeners.get(type) ?? [])].forEach((listener) =>
        listener({ target: body, ...details }),
      );
    },
    fireFrames() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback());
      return render();
    },
    scrollAnchor(rect) {
      anchorRect = { ...anchorRect, ...rect };
    },
    selectNative() {
      selection = { isCollapsed: false, anchorNode: anchor, focusNode: anchor };
    },
    nestedDialog() {
      const dialog = new FakeNode("nested-dialog", popup);
      const input = new FakeNode("nested-input", dialog);
      nestedDialogs = [dialog];
      fakeDocument.activeElement = input;
      return input;
    },
    focus(node) {
      fakeDocument.activeElement = node;
    },
  };
}

test("popover portals a nonmodal dialog and keyboard activation focuses without scrolling", async (t) => {
  const ui = setup(t, { keyboard: true });
  const tree = await ui.ready();
  assert(ui.portalTargets.every((root) => root === ui.body));
  assert.equal(tree.props.role, "dialog");
  assert.equal(tree.props["aria-label"], "Selected text translation");
  assert.equal(tree.props["aria-modal"], undefined);
  assert.equal(tree.props.style.visibility, "visible");
  const closeControl = nodes(tree, (node) => node.type === "button")[0];
  assert.equal(closeControl.props["aria-label"], "Close translation");
  assert.equal(closeControl.props.children.type, "svg");
  assert.equal(nodes(tree, (node) => node.type === "strong").length, 0);
  assert.deepEqual(ui.focuses, [
    { name: "close", options: { preventScroll: true } },
  ]);
  ui.render({ children: "Loaded translation content" });
  assert.equal(
    ui.focuses.length,
    1,
    "Loading results must not steal focus again",
  );
  const escape = ui.dispatchDocument("keydown", {
    key: "Escape",
    target: ui.closeButton,
  });
  assert.equal(escape.defaultPrevented, true);
  assert.equal(ui.closeCount, 1);
  assert.deepEqual(ui.focuses.at(-1), {
    name: "anchor",
    options: { preventScroll: true },
  });
});

test("compact keyboard actions use a smaller anchored popup and focus the first available action", async (t) => {
  const ui = setup(t, { keyboard: true, compact: true });
  ui.content.scrollHeight = 68;
  const tree = await ui.ready();
  assert.equal(tree.props["aria-label"], "Selected text actions");
  assert.equal(tree.props.style.width, 256);
  assert.equal(tree.props.style.top, 324);
  assert.equal(tree.props.style.visibility, "visible");
  assert.equal(
    nodes(tree, (node) => node.props?.["aria-label"] === "Close actions")
      .length,
    1,
  );
  assert.deepEqual(ui.focuses, [
    { name: "listen", options: { preventScroll: true } },
  ]);
  const escape = ui.dispatchDocument("keydown", { key: "Escape" });
  assert.equal(escape.defaultPrevented, true);
  assert.deepEqual(ui.focuses.at(-1), {
    name: "anchor",
    options: { preventScroll: true },
  });
  assert.equal(ui.closeCount, 1);
});

test("compact keyboard actions skip a disabled Premium or unavailable Listen action", async (t) => {
  const ui = setup(t, {
    keyboard: true,
    compact: true,
    listenDisabled: true,
  });
  await ui.ready();
  assert.deepEqual(ui.focuses, [
    { name: "translate", options: { preventScroll: true } },
  ]);
});

test("Translate expands the same word anchor before paint and focuses results once", async (t) => {
  const ui = setup(t, { keyboard: true, compact: true });
  ui.viewport.width = 320;
  ui.viewport.height = 740;
  ui.content.scrollHeight = 68;
  const actions = await ui.ready();
  assert.equal(actions.props.style.width, 256);
  ui.dispatchWindow("resize");
  assert.equal(ui.frames.size, 1);
  ui.content.scrollHeight = 523;
  const translation = ui.render({
    compact: false,
    children: "Loading the requested translation",
  });
  assert.equal(translation.props["aria-label"], "Selected text translation");
  assert.equal(translation.props.style.width, 296);
  assert.equal(translation.props.style.top, 12);
  assert.equal(ui.frames.size, 0);
  assert.equal(ui.closeCount, 0);
  assert.equal(ui.observers[0].disconnected, true);
  assert.deepEqual(ui.focuses, [
    { name: "listen", options: { preventScroll: true } },
    { name: "close", options: { preventScroll: true } },
  ]);
  ui.render({ children: "Translation and examples have arrived" });
  assert.equal(ui.focuses.length, 2, "Async results must preserve user focus");
  assert.equal(ui.observers.length, 2);
});

test("an Escape handled by a nested translation action menu does not dismiss its parent", async (t) => {
  const ui = setup(t);
  await ui.ready();
  ui.dispatchDocument("keydown", { key: "Escape", defaultPrevented: true });
  assert.equal(ui.closeCount, 0);
});

test("Escape inside a nested Anki dialog leaves the translation popover open", async (t) => {
  const ui = setup(t);
  await ui.ready();
  const input = ui.nestedDialog();
  const event = ui.dispatchDocument("keydown", {
    key: "Escape",
    target: input,
  });
  assert.equal(ui.closeCount, 0);
  assert.equal(event.defaultPrevented, false);
});

test("keyboard focus returns when reopening a word after a different pointer selection", async (t) => {
  const ui = setup(t, { keyboard: true });
  await ui.ready();
  assert.equal(ui.focuses.length, 1);
  ui.render({ tokenIds: [2], focusOnOpen: false });
  assert.equal(ui.focuses.length, 1);
  ui.render({ tokenIds: [0], focusOnOpen: true });
  assert.deepEqual(ui.focuses, [
    { name: "close", options: { preventScroll: true } },
    { name: "close", options: { preventScroll: true } },
  ]);
});

test("loading results reposition taller content before an animation frame can paint", async (t) => {
  const ui = setup(t);
  ui.viewport.width = 320;
  ui.viewport.height = 740;
  ui.content.scrollHeight = 56;
  const loading = await ui.ready();
  assert.equal(loading.props.style.top, 336);
  ui.content.scrollHeight = 523;
  const result = ui.render({ children: "Loaded translation and card actions" });
  assert.equal(
    ui.frames.size,
    0,
    "Updated results must not wait for ResizeObserver/RAF",
  );
  assert.equal(result.props.style.top, 12);
  assert.equal(result.props.style.width, 296);
  assert(result.props.style.top + result.props.style.maxHeight <= 728);
});

test("synchronous content measurement cancels a queued animation frame before cleanup", async (t) => {
  const ui = setup(t);
  await ui.ready();
  ui.dispatchWindow("resize");
  assert.equal(ui.frames.size, 1);
  ui.content.scrollHeight = 600;
  ui.render({ children: "A longer result arrived while resize was pending" });
  assert.equal(ui.frames.size, 0);
  ui.unmount();
  assert.equal(ui.frames.size, 0);
});

test("outside dismissal preserves reader selection gestures and popup interaction", async (t) => {
  const ui = setup(t);
  await ui.ready();
  assert.deepEqual(
    ui.focuses,
    [],
    "Pointer selection must not move keyboard focus",
  );
  ui.dispatchDocument("pointerdown", {
    target: ui.content,
    pointerType: "mouse",
  });
  ui.dispatchDocument("pointerdown", {
    target: ui.anchor,
    pointerType: "mouse",
  });
  assert.equal(ui.closeCount, 0);
  ui.selectNative();
  ui.dispatchDocument("pointerdown", {
    target: ui.outside(),
    pointerType: "touch",
  });
  assert.equal(
    ui.closeCount,
    0,
    "Mobile selection handles may occur outside the reader",
  );
  ui.dispatchDocument("pointerdown", {
    target: ui.outside(),
    pointerType: "mouse",
  });
  assert.equal(ui.closeCount, 1);
});

test("reader scrolling updates the anchor while popup scrolling does not, and offscreen selection closes", async (t) => {
  const ui = setup(t);
  const original = await ui.ready();
  ui.dispatchWindow("scroll", { target: ui.content });
  assert.equal(ui.frames.size, 0);
  ui.scrollAnchor({ top: 500, bottom: 530 });
  ui.dispatchWindow("scroll");
  assert.equal(ui.frames.size, 1);
  const moved = ui.fireFrames();
  assert.equal(moved.props.style.top - original.props.style.top, 100);
  ui.scrollAnchor({ top: -80, bottom: -50 });
  ui.dispatchWindow("scroll");
  ui.fireFrames();
  assert.equal(ui.closeCount, 1);
});

test("unmount removes document and viewport listeners, frames, and resize observers", async (t) => {
  const ui = setup(t);
  await ui.ready();
  ui.dispatchWindow("resize");
  assert.equal(ui.frames.size, 1);
  assert.equal(ui.observers[0].observed.length, 3);
  ui.unmount();
  assert.equal(ui.frames.size, 0);
  assert(ui.observers.every((observer) => observer.disconnected));
  for (const listeners of [
    ui.documentListeners,
    ui.windowListeners,
    ui.viewportListeners,
  ])
    assert([...listeners.values()].every((set) => set.size === 0));
});
