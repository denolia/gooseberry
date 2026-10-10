import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "@typescript/typescript6";
import * as enrichment from "../src/lib/anki/enrichment.ts";

const requestKey = "44444444-4444-4444-8444-444444444444";
const item = {
  id: "33333333-3333-4333-8333-333333333333",
  contentRevision: 2,
  original: "monikko",
  translation: "множественное число",
  wordForms: "",
  sample: "",
  sampleTranslation: "",
  comments: "",
};
const attempt = { requestKey, contentRevision: 2, fields: ["wordForms"] };
const proposal = {
  values: Object.fromEntries(
    enrichment.ENRICHMENT_FIELDS.map((field) => [field, null]),
  ),
  message: "More context is needed.",
};

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

function setup(t, responses, stored = attempt) {
  let hooks = [];
  let cursor = 0;
  const memory = new Map(
    stored
      ? [[`gooseberry-enrichment-${item.id}`, JSON.stringify(stored)]]
      : [],
  );
  const previous = Object.getOwnPropertyDescriptor(
    globalThis,
    "sessionStorage",
  );
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => memory.set(key, value),
      removeItem: (key) => memory.delete(key),
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "sessionStorage", previous);
    else delete globalThis.sessionStorage;
  });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    const response = responses.shift();
    assert(response, "Unexpected request");
    if (response instanceof Error) throw response;
    return Response.json(response.body, { status: response.status ?? 200 });
  });
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks))
        hooks[index] = typeof initial === "function" ? initial() : initial;
      return [
        hooks[index],
        (value) => {
          hooks[index] =
            typeof value === "function" ? value(hooks[index]) : value;
        },
      ];
    },
    useRef(current) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { current };
      return hooks[index];
    },
    useEffect() {},
  };
  const jsx = (type, props) => ({ type, props });
  const code = ts.transpileModule(
    readFileSync(
      new URL("../src/components/anki/EnrichmentDialog.tsx", import.meta.url),
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
      "@/lib/anki/enrichment": enrichment,
      "./EnrichmentDialog.module.css": { default: {} },
    };
    assert(name in dependencies, `Unexpected import ${name}`);
    return dependencies[name];
  }, exports);
  return {
    calls,
    memory,
    render() {
      cursor = 0;
      return exports.EnrichmentDialog({
        item,
        wordSetId: "set-1",
        onClose() {},
        onSaved() {},
      });
    },
    reopen() {
      hooks = [];
      return this.render();
    },
    async click(label) {
      const node = nodes(
        this.render(),
        (node) => node.type === "button" && text(node) === label,
      )[0];
      assert(node, `Missing button: ${label}`);
      assert(!node.props.disabled, `Disabled button: ${label}`);
      await node.props.onClick();
      await new Promise((resolve) => setImmediate(resolve));
      return this.render();
    },
  };
}

test("an unaccepted stored generation attempt can retry its original key after checking", async (t) => {
  const ui = setup(t, [
    { status: 404, body: { error: "Generation request not found." } },
    { body: { ...attempt, status: "completed", proposal } },
  ]);
  assert(text(ui.render()).includes("Check its status"));
  assert(!text(ui.render()).includes("still running"));
  const checked = await ui.click("Check again");
  assert(text(checked).includes("Retry request"));
  await ui.click("Retry request");
  assert.deepEqual(JSON.parse(ui.calls[1].options.body), attempt);
  assert.equal(ui.calls[1].options.method, "POST");
});

test("interrupted requests remain recoverable without starting another paid request", async (t) => {
  const ui = setup(
    t,
    [
      new Error("Connection lost"),
      { body: { ...attempt, status: "pending", proposal: null } },
      { body: { ...attempt, status: "failed", proposal: null } },
      { body: { ...attempt, status: "completed", proposal } },
    ],
    null,
  );
  await ui.click("Generate selected fields");
  const first = JSON.parse(ui.calls[0].options.body);
  assert(ui.memory.size === 1);
  ui.reopen();
  await ui.click("Check again");
  assert.equal(ui.calls.length, 2);
  assert(ui.calls[1].url.includes(first.requestKey));
  assert.equal(ui.calls[1].options.method, undefined);
  await ui.click("Check again");
  await ui.click("New request");
  assert.equal(ui.memory.size, 0);
  await ui.click("Generate selected fields");
  assert.notEqual(
    JSON.parse(ui.calls[3].options.body).requestKey,
    first.requestKey,
  );
});

test("a declined proposal can be discarded so missing fields remain editable", async (t) => {
  const ui = setup(t, [
    { body: { ...attempt, status: "completed", proposal } },
  ]);
  await ui.click("Check again");
  const save = nodes(
    ui.render(),
    (node) => node.type === "button" && text(node) === "Save selected content",
  )[0];
  assert(save.props.disabled);
  const discarded = await ui.click("Discard proposal");
  assert(text(discarded).includes("Generate selected fields"));
  assert.equal(ui.memory.size, 0);
  assert.equal(
    nodes(discarded, (node) => node.type === "fieldset")[0].props.disabled,
    false,
  );
});
