import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "@typescript/typescript6";
import { messageErrors, translations } from "./helpers/i18n.mjs";

const first = {
  id: "first",
  title: "A German story",
  preview: "Berlin ist schön.",
  sourceLang: "de",
  targetLang: "en",
  createdAt: "2026-11-11T12:00:00Z",
};
const second = {
  ...first,
  id: "second",
  title: "A Finnish story",
  sourceLang: "fi",
  targetLang: "ru",
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

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

function setup(
  t,
  {
    locale = "en",
    activeId = "first",
    query: queryOverrides = {},
    open = async () => {},
    remove = async () => Response.json({ success: true }),
  } = {},
) {
  const hooks = [];
  let cursor = 0;
  let effects = [];
  let dirty = false;
  let mounted = true;
  let queryOptions;
  let closes = 0;
  let creates = 0;
  let refetches = 0;
  let pages = 0;
  let restoredFocus = 0;
  let searchFocus = 0;
  let shows = 0;
  let dialogCloses = 0;
  const opened = [];
  const deleted = [];
  const invalidations = [];
  const requests = [];
  const timers = new Map();
  let timerId = 0;
  const depsEqual = (a, b) =>
    a &&
    b &&
    a.length === b.length &&
    a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(initial) {
      const index = cursor++;
      hooks[index] ??= { value: initial };
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
      return `history-${cursor++}`;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = hooks[index];
      if (!depsEqual(previous?.deps, deps)) {
        hooks[index] = { deps };
        effects.push(() => {
          previous?.cleanup?.();
          hooks[index].cleanup = effect();
        });
      }
    },
  };
  const query = {
    data: { pages: [{ texts: [first, second], nextCursor: null }] },
    isPending: false,
    isError: false,
    isFetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    refetch: () => {
      refetches++;
    },
    fetchNextPage: () => {
      pages++;
    },
    ...queryOverrides,
  };
  class Element {
    isConnected = true;
    focus() {
      restoredFocus++;
    }
  }
  const previousFocus = new Element();
  const body = { style: { overflow: "auto" } };
  const globals = new Map(
    ["window", "document", "HTMLElement"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  Object.defineProperty(globalThis, "HTMLElement", {
    configurable: true,
    value: Element,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { activeElement: previousFocus, body },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setTimeout(callback) {
        const id = ++timerId;
        timers.set(id, callback);
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    return remove(url, options);
  });
  const jsx = (type, props) => ({ type, props });
  const code = ts.transpileModule(
    readFileSync(
      new URL(
        "../src/components/analyzer/ReaderHistoryDialog.tsx",
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
  const css = {
    __esModule: true,
    default: new Proxy({}, { get: (_, key) => key }),
  };
  new Function("require", "exports", code)((name) => {
    if (name === "@/i18n/errors") return messageErrors;
    if (name === "@/i18n/client")
      return { useI18n: () => translations(locale) };
    const mocks = {
      react,
      "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
      "@tanstack/react-query": {
        useInfiniteQuery(options) {
          queryOptions = options;
          return query;
        },
        useQueryClient: () => ({
          invalidateQueries: (options) => invalidations.push(options),
        }),
      },
      "lucide-react": new Proxy({}, { get: (_, key) => `icon:${String(key)}` }),
      "@/components/anki/MoveWordDialog.module.css": css,
      "./ReaderHistoryDialog.module.css": css,
    };
    assert(name in mocks, `Unexpected dependency ${name}`);
    return mocks[name];
  }, exports);
  function render() {
    let tree;
    let passes = 0;
    do {
      assert(++passes < 15);
      cursor = 0;
      dirty = false;
      tree = exports.ReaderHistoryDialog({
        accountId: "owner",
        activeId,
        onClose: () => {
          closes++;
        },
        onNew: () => {
          creates++;
        },
        onDeleted: (id) => deleted.push(id),
        onOpen: async (id) => {
          opened.push(id);
          await open(id);
        },
      });
      for (const node of nodes(tree, (node) => node.props?.ref)) {
        node.props.ref.current =
          node.type === "dialog"
            ? {
                showModal() {
                  shows++;
                },
                close() {
                  dialogCloses++;
                },
              }
            : {
                focus() {
                  searchFocus++;
                },
              };
      }
      const pending = effects;
      effects = [];
      pending.forEach((effect) => effect());
    } while (dirty);
    return tree;
  }
  function unmount() {
    if (!mounted) return;
    mounted = false;
    hooks.forEach((hook) => hook?.cleanup?.());
  }
  t.after(() => {
    unmount();
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return {
    render,
    unmount,
    query,
    opened,
    deleted,
    invalidations,
    requests,
    body,
    button(label) {
      const button = nodes(
        render(),
        (node) =>
          node.type === "button" &&
          (text(node).trim() === label || node.props["aria-label"] === label),
      )[0];
      assert(button, `Missing button ${label}`);
      return button;
    },
    choose(title) {
      this.button(title).props.onClick();
      return render();
    },
    select(id) {
      nodes(render(), (node) => node.props?.role === "radio")
        .find((node) => text(node).includes(id))
        .props.onClick();
    },
    search(value) {
      nodes(render(), (node) => node.type === "input")[0].props.onChange({
        target: { value },
      });
      return render();
    },
    flushTimers() {
      for (const [id, callback] of [...timers]) {
        timers.delete(id);
        callback();
      }
      return render();
    },
    submit() {
      nodes(render(), (node) => node.type === "form")[0].props.onSubmit({
        preventDefault() {},
      });
      return render();
    },
    get options() {
      return queryOptions;
    },
    get counts() {
      return {
        closes,
        creates,
        refetches,
        pages,
        restoredFocus,
        searchFocus,
        shows,
        dialogCloses,
      };
    },
  };
}

test("history is a labelled native modal with initial focus, selection and focus restoration", (t) => {
  const ui = setup(t);
  const tree = ui.render();
  assert(tree.props["aria-labelledby"]);
  assert.equal(ui.counts.shows, 1);
  assert.equal(ui.body.style.overflow, "hidden");
  assert.equal(ui.counts.searchFocus, 1);
  const radios = nodes(tree, (node) => node.props?.role === "radio");
  assert.deepEqual(
    radios.map((node) => [node.props["aria-checked"], node.props.tabIndex]),
    [
      [true, 0],
      [false, -1],
    ],
  );
  ui.button("Close").props.onClick();
  assert.equal(ui.counts.closes, 1);
  ui.unmount();
  assert.equal(ui.body.style.overflow, "auto");
  assert.equal(ui.counts.restoredFocus, 1);
  assert.equal(ui.counts.dialogCloses, 1);
});

test("an older active text outside the first page leaves the list keyboard-accessible", (t) => {
  const ui = setup(t, { activeId: "not-on-this-page" });
  const options = nodes(ui.render(), (node) => node.props?.role === "radio");
  assert.equal(options[0].props.tabIndex, 0);
  assert(ui.button("Open").props.disabled);
  const focuses = [];
  let prevented = false;
  options[0].props.onKeyDown({
    key: "ArrowDown",
    preventDefault() {
      prevented = true;
    },
    currentTarget: {
      closest: () => ({
        querySelectorAll: () =>
          options.map((_, index) => ({ focus: () => focuses.push(index) })),
      }),
    },
  });
  assert(prevented);
  assert.deepEqual(focuses, [1]);
  assert.equal(
    nodes(ui.render(), (node) => node.props?.role === "radio")[1].props[
      "aria-checked"
    ],
    true,
  );
});

test("search is debounced, account-scoped, and passes its cursor and abort signal to the server", async (t) => {
  const ui = setup(t);
  ui.render();
  ui.search("  Finnish  ");
  assert(ui.button("Open").props.disabled);
  assert.match(text(ui.render()), /Searching texts/);
  ui.flushTimers();
  assert.deepEqual(ui.options.queryKey, ["readerTexts", "owner", "Finnish"]);
  const signal = new AbortController().signal;
  await ui.options.queryFn({ pageParam: "next-page", signal });
  const url = new URL(ui.requests[0].url, "http://localhost");
  assert.equal(url.searchParams.get("q"), "Finnish");
  assert.equal(url.searchParams.get("cursor"), "next-page");
  assert.equal(ui.requests[0].options.signal, signal);
  assert.equal(ui.options.getNextPageParam({ nextCursor: "next" }), "next");
});

test("opening uses the selected entry and failures retain the modal for retry", async (t) => {
  let attempts = 0;
  const ui = setup(t, {
    open: async () => {
      if (++attempts === 1) throw new Error("Connection lost");
    },
  });
  const options = nodes(ui.render(), (node) => node.props?.role === "radio");
  options[1].props.onClick();
  ui.submit();
  assert(ui.button("Opening…").props.disabled);
  await tick();
  assert.match(text(ui.render()), /Could not open this text/);
  ui.submit();
  await tick();
  assert.deepEqual(ui.opened, ["second", "second"]);
  assert(!ui.button("Open").props.disabled);
});

test("deleting requires confirmation, does not open a text, and refreshes only this account's history", async (t) => {
  const ui = setup(t);
  ui.button("Delete A German story").props.onClick();
  assert.equal(ui.requests.length, 0);
  assert.match(text(ui.render()), /Any unsaved edits/);
  ui.button("Keep text").props.onClick();
  assert.equal(ui.requests.length, 0);
  ui.button("Delete A German story").props.onClick();
  ui.button("Delete text").props.onClick();
  await tick();
  assert.equal(ui.requests[0].url, "/api/reader-texts/first");
  assert.equal(ui.requests[0].options.method, "DELETE");
  assert.deepEqual(ui.deleted, ["first"]);
  assert.deepEqual(ui.opened, []);
  assert.deepEqual(ui.invalidations, [{ queryKey: ["readerTexts", "owner"] }]);
  assert(ui.button("Open").props.disabled);
});

test("a failed deletion keeps its confirmation and can be retried", async (t) => {
  let attempts = 0;
  const ui = setup(t, {
    remove: async () =>
      ++attempts === 1
        ? Response.json(
            { errorCode: "errors.readerStorageFailed" },
            { status: 503 },
          )
        : Response.json({ success: true }),
  });
  ui.button("Delete A German story").props.onClick();
  ui.button("Delete text").props.onClick();
  await tick();
  assert.match(text(ui.render()), /Could not access your saved texts/);
  assert.deepEqual(ui.deleted, []);
  ui.button("Delete text").props.onClick();
  await tick();
  assert.deepEqual(ui.deleted, ["first"]);
});

test("loading, empty, failed, and unmatched lists retain the New text action", (t) => {
  const ui = setup(t, { query: { data: undefined, isPending: true } });
  assert.match(text(ui.render()), /Loading texts/);
  assert(!ui.button("New text").props.disabled);
  ui.query.isPending = false;
  ui.query.isError = true;
  assert.match(text(ui.render()), /Could not load your texts/);
  ui.button("Try again").props.onClick();
  assert.equal(ui.counts.refetches, 1);
  ui.query.isError = false;
  ui.query.data = { pages: [{ texts: [], nextCursor: null }] };
  assert.match(text(ui.render()), /No saved texts yet/);
  ui.search("missing");
  ui.flushTimers();
  assert.match(text(ui.render()), /No texts match/);
  ui.button("New text").props.onClick();
  assert.equal(ui.counts.creates, 1);
});

test("Load more requests another page and Escape closes an idle modal", (t) => {
  const ui = setup(t, { query: { hasNextPage: true } });
  ui.button("Load more").props.onClick();
  assert.equal(ui.counts.pages, 1);
  let prevented = false;
  ui.render().props.onCancel({
    preventDefault() {
      prevented = true;
    },
  });
  assert(prevented);
  assert.equal(ui.counts.closes, 1);
});

test("Russian history translates controls, confirmations and errors while preserving text titles", async (t) => {
  const ui = setup(t, {
    locale: "ru",
    open: async () => {
      throw new Error("Internal connection diagnostic");
    },
  });
  assert.match(text(ui.render()), /История текстов/);
  assert(ui.button("Новый текст"));
  assert.equal(
    nodes(ui.render(), (node) => node.type === "input")[0].props.placeholder,
    "Найти текст…",
  );
  assert.match(text(ui.render()), /A German story/);
  ui.submit();
  await tick();
  assert.match(text(ui.render()), /Не удалось открыть текст/);
  assert.doesNotMatch(text(ui.render()), /Internal connection diagnostic/);
  ui.button("Удалить «A German story»").props.onClick();
  assert.match(
    text(ui.render()),
    /Удалить «A German story»\? Это действие нельзя отменить/,
  );
  assert(ui.button("Оставить текст"));
});
