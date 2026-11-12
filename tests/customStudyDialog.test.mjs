import assert from "node:assert/strict";
import test from "node:test";
import { translations } from "./helpers/i18n.mjs";
import { loadSourceModule } from "./helpers/sourceModule.mjs";

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

const sets = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "German",
    sourceLang: "de",
    targetLang: "en",
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    name: "Finnish",
    sourceLang: "fi",
    targetLang: "ru",
  },
];

// Native dialog behavior is mocked; browser layout and keyboard behavior are
// checked manually. These checks protect scope/filter selection and dismissal.
function setup(t, { locale = "en", options = sets } = {}) {
  const hooks = [];
  let cursor = 0;
  let effects = [];
  let closes = 0;
  const paths = [];
  const dialog = {
    opens: 0,
    showModal() {
      this.opens++;
    },
    close() {},
  };
  const searchInput = { focus() {} };
  class Element {
    isConnected = true;
    focused = false;
    focus() {
      this.focused = true;
    }
  }
  const trigger = new Element();
  const previous = new Map(
    ["document", "HTMLElement"].map((key) => [
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
    value: { activeElement: trigger, body: { style: { overflow: "auto" } } },
  });
  function unmount() {
    for (const hook of hooks) {
      hook?.cleanup?.();
      if (hook) hook.cleanup = undefined;
    }
  }
  t.after(() => {
    unmount();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
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
    useEffect(effect) {
      const slot = cursor++;
      if (!hooks[slot]) {
        hooks[slot] = {};
        effects.push(() => {
          hooks[slot].cleanup = effect();
        });
      }
    },
  };
  const jsx = (type, props) => {
    if (typeof type === "function") return type(props);
    if (props.ref && type === "dialog") props.ref.current = dialog;
    if (props.ref && type === "input") props.ref.current = searchInput;
    return { type, props };
  };
  const mocks = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "@/i18n/client": { useI18n: () => translations(locale) },
    "next/navigation": {
      useRouter: () => ({ push: (path) => paths.push(path) }),
    },
    "./WordSetPicker.module.css": { default: {} },
    "./MoveWordDialog.module.css": { default: {} },
    "./CustomStudyDialog.module.css": { default: {} },
  };
  mocks["./WordSetPicker"] = loadSourceModule(
    "src/components/anki/WordSetPicker.tsx",
    mocks,
  );
  const { CustomStudyDialog } = loadSourceModule(
    "src/components/anki/CustomStudyDialog.tsx",
    mocks,
  );
  const props = { sets: options, onClose: () => closes++ };
  function render() {
    cursor = 0;
    effects = [];
    const tree = CustomStudyDialog(props);
    effects.forEach((effect) => effect());
    return tree;
  }
  return {
    render,
    paths,
    props,
    dialog,
    trigger,
    unmount,
    closed: () => closes,
    button: (label) =>
      nodes(
        render(),
        (node) => node.type === "button" && text(node) === label,
      )[0],
    toggle: (name) =>
      nodes(
        render(),
        (node) =>
          node.type === "input" &&
          node.props["aria-label"] === `Select ${name}`,
      )[0].props.onChange(),
    search: (value) =>
      nodes(
        render(),
        (node) => node.type === "input" && node.props.type === "search",
      )[0].props.onChange({ target: { value } }),
    submit: () =>
      nodes(render(), (node) => node.type === "form")[0].props.onSubmit({
        preventDefault() {},
      }),
  };
}

test("custom study keeps selections through search and starts the exact selected scope with either filter", (t) => {
  const app = setup(t);
  const footer = nodes(app.render(), (node) => node.type === "footer")[0];
  assert.deepEqual(nodes(footer, (node) => node.type === "button").map(text), [
    "Cancel",
    "Repeat due only",
    "Study",
  ]);
  assert(app.button("Study").props.disabled);
  assert(app.button("Repeat due only").props.disabled);
  app.submit();
  assert.deepEqual(app.paths, []);
  app.toggle("German");
  app.search("Finnish");
  assert.equal(
    nodes(app.render(), (node) => node.props?.type === "checkbox").length,
    1,
  );
  app.toggle("Finnish");
  assert.match(text(app.render()), /2 sets selected/);
  assert.match(text(app.render()), /FI → RU/);
  app.button("Repeat due only").props.onClick();
  const due = new URL(app.paths[0], "http://localhost").searchParams;
  assert.equal(due.get("scope"), "sets");
  assert.deepEqual(
    due.getAll("set"),
    sets.map((set) => set.id),
  );
  assert.equal(due.get("filter"), "due_only");
  app.submit();
  const all = new URL(app.paths[1], "http://localhost").searchParams;
  assert.deepEqual(
    all.getAll("set"),
    sets.map((set) => set.id),
  );
  assert.equal(all.get("filter"), "all_available");
  app.props.sets = [];
  assert(app.button("Study").props.disabled);
  app.submit();
  assert.equal(
    app.paths.length,
    2,
    "removed sets cannot turn an explicit selection into all sets",
  );
});

test("Cancel and Escape dismiss without navigating and cleanup restores focus and scrolling", (t) => {
  const app = setup(t);
  app.render();
  assert.equal(app.dialog.opens, 1);
  assert.equal(document.body.style.overflow, "hidden");
  app.toggle("German");
  app.button("Cancel").props.onClick();
  nodes(app.render(), (node) => node.type === "dialog")[0].props.onCancel({
    preventDefault() {},
  });
  assert.equal(app.closed(), 2);
  assert.deepEqual(app.paths, []);
  app.unmount();
  assert.equal(document.body.style.overflow, "auto");
  assert(app.trigger.focused);
});

test("selection caps keep checked sets available for deselection", (t) => {
  const options = Array.from({ length: 101 }, (_, i) => ({
    ...sets[0],
    id: String(i),
    name: `Set ${i}`,
  }));
  const app = setup(t, { options });
  for (let i = 0; i < 100; i++) app.toggle(`Set ${i}`);
  const checkboxes = nodes(
    app.render(),
    (node) => node.props?.type === "checkbox",
  );
  assert.equal(checkboxes.filter((node) => node.props.disabled).length, 1);
  assert.equal(checkboxes.filter((node) => node.props.checked).length, 100);
  app.toggle("Set 0");
  assert(
    nodes(app.render(), (node) => node.props?.type === "checkbox").every(
      (node) => !node.props.disabled,
    ),
  );
});

test("custom study footer and selection count follow the interface locale", (t) => {
  const app = setup(t, { locale: "ru" });
  const tree = app.render();
  assert.match(text(tree), /Выборочное обучение/);
  assert.match(text(tree), /Выбрано 0 наборов/);
  const footer = nodes(tree, (node) => node.type === "footer")[0];
  assert.deepEqual(nodes(footer, (node) => node.type === "button").map(text), [
    "Отмена",
    "Только повторение",
    "Учить",
  ]);
});
