import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "@typescript/typescript6";
import * as languages from "../src/components/ui/Languages.ts";

function load(path, dependencies) {
  const code = ts.transpileModule(
    readFileSync(new URL(path, import.meta.url), "utf8"),
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
    if (!(name in dependencies))
      throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

function setup(t, source = "Finnish", target = "Russian") {
  const memory = new Map([
    ["currentSourceLanguage", source],
    ["currentTargetLanguage", target],
  ]);
  const writes = [];
  const storage = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => {
      writes.push([key, value]);
      memory.set(key, value);
    },
  };
  const previous = new Map(
    ["window", "localStorage"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { addEventListener() {}, removeEventListener() {} },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  t.after(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const { LanguageStore } = load("../src/lib/languages/languageStore.ts", {
    "@/components/ui/Languages": languages,
  });
  return { store: LanguageStore, memory, writes, storage };
}

test("swap publishes one complete language pair and persists both selections", (t) => {
  const { store, memory, writes } = setup(t);
  const seen = [];
  const unsubscribe = store.subscribe(() => {
    const state = store.getSnapshot();
    seen.push([state.currentSourceLanguage, state.currentTargetLanguage]);
  });
  store.swapLanguages();
  assert.deepEqual(seen, [["Russian", "Finnish"]]);
  assert.deepEqual(writes, [
    ["currentSourceLanguage", "Russian"],
    ["currentTargetLanguage", "Finnish"],
  ]);
  assert.equal(memory.get("currentSourceLanguage"), "Russian");
  assert.equal(memory.get("currentTargetLanguage"), "Finnish");
  store.swapLanguages();
  assert.deepEqual(seen, [
    ["Russian", "Finnish"],
    ["Finnish", "Russian"],
  ]);
  unsubscribe();
});

test("identical source and target remain unchanged without unnecessary notifications", (t) => {
  const { store, writes } = setup(t, "Finnish", "Finnish");
  let notifications = 0;
  const unsubscribe = store.subscribe(() => notifications++);
  const before = store.getSnapshot();
  store.swapLanguages();
  assert.equal(store.getSnapshot(), before);
  assert.equal(notifications, 0);
  assert.equal(writes.length, 0);
  unsubscribe();
});

test("blocked local storage does not prevent swapping the live language pair", (t) => {
  const { store, storage } = setup(t);
  t.mock.method(storage, "setItem", () => {
    throw new Error("Blocked");
  });
  t.mock.method(console, "error", () => {});
  let notifications = 0;
  const unsubscribe = store.subscribe(() => notifications++);
  store.swapLanguages();
  assert.equal(store.getSnapshot().currentSourceLanguage, "Russian");
  assert.equal(store.getSnapshot().currentTargetLanguage, "Finnish");
  assert.equal(notifications, 1);
  unsubscribe();
});

function nodes(tree, predicate) {
  if (Array.isArray(tree))
    return tree.flatMap((child) => nodes(child, predicate));
  if (!tree || typeof tree !== "object") return [];
  return [
    ...(predicate(tree) ? [tree] : []),
    ...nodes(tree.props?.children, predicate),
  ];
}

test("desktop and mobile put a keyboard-accessible swap button between their language selects", (t) => {
  const { store } = setup(t);
  const jsx = (type, props) =>
    typeof type === "function" ? type(props) : { type, props };
  const { Header } = load("../src/components/ui/Header.tsx", {
    react: {
      useState: (initial) => [initial, () => {}],
      useRef: (current) => ({ current }),
      useEffect: () => {},
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "next-auth/react": {
      useSession: () => ({ data: { user: { name: "Test" } } }),
    },
    "next/link": { default: "a" },
    "lucide-react": { ArrowRightLeft: "swap-icon" },
    "@/components/ui/Languages": languages,
    "@/lib/languages/useLanguages": { useLanguages: store.getSnapshot },
    "@/lib/languages/languageStore": { LanguageStore: store },
    "./Header.module.css": { default: {} },
  });
  const controls = () =>
    nodes(
      Header(),
      (node) =>
        node.type === "select" ||
        node.props?.["aria-label"] === "Swap source and target languages",
    );
  let elements = controls();
  assert.deepEqual(
    elements.map((node) => node.type),
    ["select", "button", "select", "select", "button", "select"],
  );
  assert.equal(elements[1].props.type, "button");
  elements[1].props.onClick();
  elements = controls();
  assert.deepEqual(
    [elements[0], elements[2], elements[3], elements[5]].map(
      (node) => node.props.value,
    ),
    ["Russian", "Finnish", "Russian", "Finnish"],
  );
  elements[4].props.onClick();
  assert.equal(store.getSnapshot().currentSourceLanguage, "Finnish");
});
