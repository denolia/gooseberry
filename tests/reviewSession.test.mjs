import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "@typescript/typescript6";
import {
  FsrsCardState,
  ReviewMode,
  ReviewRating,
} from "../src/lib/review/model.ts";
import * as templates from "../src/lib/review/templates.ts";

function transpile(path, dependencies = {}) {
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
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency ${name}`);
  }, exports);
  return exports;
}

const exercises = transpile("../src/components/review/exercises.ts");
const controls = transpile("../src/lib/review/controls.ts", {
  "@/lib/review/model": { FsrsCardState, ReviewMode, ReviewRating },
});

const fixture = {
  id: "card-1",
  templateKey: "recognition",
  wordSetId: "set-1",
  wordSetName: "Finnish vocabulary",
  sourceLang: "fi",
  targetLang: "ru",
  original: "monikko",
  translation: "множественное число",
  wordForms: "monikon; monikkoa",
  sample: "Sana on monikossa.",
  sampleTranslation: "Слово во множественном числе.",
  comments: "A grammar term",
  tags: "",
  state: { state: FsrsCardState.Learning },
  ratings: [1, 2, 3, 4].map((rating) => ({
    rating,
    dueAt: "2026-10-11T10:00:00Z",
    intervalMs: 86_400_000,
    state: FsrsCardState.Review,
  })),
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

const nextTick = () => new Promise((resolve) => setImmediate(resolve));

function setup(t, cards, reviewMode = ReviewMode.Simple) {
  const hooks = [];
  let cursor = 0;
  let effects = [];
  let firstLoad = true;
  let audioPlays = 0;
  const audioRefs = [];
  const keyboardListeners = new Set();
  const submissions = [];
  const router = { replace() {} };
  const queryClient = { invalidateQueries() {} };
  const sameDeps = (left, right) =>
    left &&
    right &&
    left.length === right.length &&
    left.every((v, i) => v === right[i]);

  const react = {
    useState(initial) {
      const index = cursor++;
      hooks[index] ??= { value: initial };
      return [
        hooks[index].value,
        (value) => {
          hooks[index].value =
            typeof value === "function" ? value(hooks[index].value) : value;
        },
      ];
    },
    useRef(current) {
      const index = cursor++;
      return (hooks[index] ??= { current });
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!sameDeps(hooks[index]?.deps, deps))
        hooks[index] = { value: callback, deps };
      return hooks[index].value;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!sameDeps(hooks[index]?.deps, deps)) {
        const previous = hooks[index];
        hooks[index] = { deps };
        effects.push(() => {
          previous?.cleanup?.();
          hooks[index].cleanup = effect();
        });
      }
    },
  };

  const originalWindow = globalThis.window;
  const originalElement = globalThis.Element;
  globalThis.window = {
    addEventListener(event, callback) {
      if (event === "keydown") keyboardListeners.add(callback);
    },
    removeEventListener(event, callback) {
      if (event === "keydown") keyboardListeners.delete(callback);
    },
  };
  globalThis.Element = class {
    constructor(tag) {
      this.tag = tag;
    }
    closest(selector) {
      return selector.split(",").some((tag) => tag.trim() === this.tag)
        ? this
        : null;
    }
  };
  t.after(() => {
    hooks.forEach((hook) => hook?.cleanup?.());
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalElement === undefined) delete globalThis.Element;
    else globalThis.Element = originalElement;
  });
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    if (options?.method === "POST") {
      submissions.push(JSON.parse(options.body));
      return Response.json({});
    }
    const incoming = firstLoad ? cards : [];
    firstLoad = false;
    return Response.json({ cards: incoming });
  });

  function SourceAudioButton() {}
  const jsx = (type, props) => ({ type, props });
  const { ReviewSession } = transpile(
    "../src/components/review/ReviewSession.tsx",
    {
      react,
      "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
      "next/link": { default: "a" },
      "next/navigation": { useRouter: () => router },
      "next-auth/react": { useSession: () => ({ status: "authenticated" }) },
      "@tanstack/react-query": { useQueryClient: () => queryClient },
      "@/components/ui/SourceAudioButton": { SourceAudioButton },
      "@/lib/review/controls": controls,
      "@/lib/review/formatInterval": { formatReviewInterval: () => "1 day" },
      "@/lib/review/retry": {
        withAutomaticRetries: (operation) => operation(),
      },
      "@/lib/review/templates": templates,
      "./exercises": exercises,
      "./ReviewSession.module.css": {
        default: new Proxy({}, { get: (_target, key) => key }),
      },
    },
  );

  return {
    submissions,
    get audioPlays() {
      return audioPlays;
    },
    audioNodes(tree) {
      return nodes(tree, (node) => node.type === SourceAudioButton);
    },
    render() {
      cursor = 0;
      effects = [];
      const tree = ReviewSession({ wordSetId: "set-1", reviewMode });
      audioRefs.forEach((ref) => (ref.current = null));
      audioRefs.length = 0;
      this.audioNodes(tree).forEach((node) => {
        node.props.ref.current = { click: () => audioPlays++ };
        audioRefs.push(node.props.ref);
      });
      effects.forEach((effect) => effect());
      return tree;
    },
    async ready() {
      this.render();
      await nextTick();
      return this.render();
    },
    key(key, { tag, ...overrides } = {}) {
      const event = {
        key,
        target: tag ? new Element(tag) : null,
        repeat: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        isComposing: false,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        ...overrides,
      };
      keyboardListeners.forEach((callback) => callback(event));
      return event;
    },
  };
}

test("each exercise shows its own prompt and reveals the expected answer", async (t) => {
  for (const template of templates.STUDY_CARD_TEMPLATES) {
    await t.test(template.key, async (t) => {
      const session = setup(t, [{ ...fixture, templateKey: template.key }]);
      let tree = await session.ready();
      assert.deepEqual(nodes(tree, (node) => node.type === "h2").map(text), [
        fixture[template.promptField],
      ]);
      assert.equal(text(tree).includes(fixture[template.answerField]), false);
      assert.equal(
        session.audioNodes(tree).length,
        template.promptField === "original" ? 1 : 0,
      );
      const hasSourcePrompt = template.promptField === "original";
      session.key("p");
      assert.equal(session.audioPlays, hasSourcePrompt ? 1 : 0);

      nodes(
        tree,
        (node) =>
          node.type === "button" && /Show answer|Check answer/.test(text(node)),
      )[0].props.onClick();
      tree = session.render();
      assert.ok(
        nodes(tree, (node) => node.type === "h2")
          .map(text)
          .includes(fixture[template.answerField]),
      );
      assert.equal(session.audioNodes(tree).length, 1);
      session.key("p");
      assert.equal(session.audioPlays, hasSourcePrompt ? 2 : 1);
      if (template.key === "example")
        assert.ok(text(tree).includes(fixture.original));
      assert.equal(session.submissions.length, 0);
    });
  }
});

test("typing spaces, digits, P and Enter never triggers global shortcuts", async (t) => {
  const session = setup(t, [{ ...fixture, templateKey: "type_answer" }]);
  let tree = await session.ready();
  for (const key of [" ", "1", "2", "3", "4", "p", "Enter"]) {
    assert.equal(session.key(key, { tag: "input" }).defaultPrevented, false);
  }
  assert.equal(session.audioPlays, 0);
  assert.equal(session.submissions.length, 0);
  assert.equal(
    nodes(session.render(), (node) => node.type === "input").length,
    1,
  );

  let input = nodes(tree, (node) => node.type === "input")[0];
  input.props.onChange({ target: { value: " MONIKKO " } });
  tree = session.render();
  input = nodes(tree, (node) => node.type === "input")[0];
  let prevented = false;
  input.props.onKeyDown({
    key: "Enter",
    nativeEvent: { isComposing: true },
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, false);
  assert.equal(
    nodes(session.render(), (node) => node.type === "input").length,
    1,
  );
  input.props.onKeyDown({
    key: "Enter",
    nativeEvent: { isComposing: false },
    preventDefault() {
      prevented = true;
    },
  });
  tree = session.render();
  assert.equal(prevented, true);
  assert.match(text(tree), /Matches the answer/);
  assert.equal(session.submissions.length, 0);
  assert.equal(nodes(tree, (node) => node.type === "input").length, 0);
  session.key("1");
  assert.equal(session.submissions[0].rating, ReviewRating.Again);
});

test("the next typed card starts empty and submits its own card ID", async (t) => {
  const session = setup(t, [
    { ...fixture, templateKey: "type_answer" },
    { ...fixture, id: "card-2", templateKey: "type_answer", original: "talo" },
  ]);
  let tree = await session.ready();
  nodes(tree, (node) => node.type === "input")[0].props.onChange({
    target: { value: "monikko" },
  });
  tree = session.render();
  nodes(
    tree,
    (node) => node.type === "button" && /Check answer/.test(text(node)),
  )[0].props.onClick();
  session.render();
  session.key("2");
  tree = session.render();
  assert.equal(session.submissions[0].studyCardId, "card-1");
  assert.equal(nodes(tree, (node) => node.type === "input")[0].props.value, "");
  assert.equal(session.audioNodes(tree).length, 0);
});

test("full rating controls still self-rate typed exercises", async (t) => {
  const session = setup(
    t,
    [{ ...fixture, templateKey: "type_answer" }],
    ReviewMode.Full,
  );
  let tree = await session.ready();
  nodes(
    tree,
    (node) => node.type === "button" && /Check answer/.test(text(node)),
  )[0].props.onClick();
  tree = session.render();
  assert.deepEqual(nodes(tree, (node) => node.type === "strong").map(text), [
    "Hard",
    "Good",
    "Easy",
    "Again",
  ]);
  session.key("4");
  assert.equal(session.submissions[0].rating, ReviewRating.Easy);
});

test("typed comparison normalizes spacing and Unicode without dropping accents or punctuation", () => {
  assert.equal(
    exercises.typedAnswerMatches(
      "  KIINTEISTÖVÄLITTÄJÄ  ",
      "kiinteistövälittäjä",
      "fi",
    ),
    true,
  );
  assert.equal(exercises.typedAnswerMatches("cafe\u0301", "café", "fr"), true);
  assert.equal(
    exercises.typedAnswerMatches("Hyvää   huomenta", "Hyvää huomenta", "fi"),
    true,
  );
  assert.equal(
    exercises.typedAnswerMatches(
      "kiinteistovalittaja",
      "kiinteistövälittäjä",
      "fi",
    ),
    false,
  );
  assert.equal(exercises.typedAnswerMatches("Hei", "Hei!", "fi"), false);
  assert.equal(exercises.typedAnswerMatches("   ", "", "fi"), false);
});
