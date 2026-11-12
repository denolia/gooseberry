import { messageErrors, i18n, translations } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "@typescript/typescript6";
import { loadSourceModule } from "./helpers/sourceModule.mjs";
import * as diff from "diff";
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
    if (name === "@/i18n/errors") return messageErrors;
    if (name === "@/i18n/client") return dependencies[name] ?? i18n;
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency ${name}`);
  }, exports);
  return exports;
}

const exercises = transpile("../src/components/review/exercises.ts", { diff });
const controls = transpile("../src/lib/review/controls.ts", {
  "@/lib/review/model": { FsrsCardState, ReviewMode, ReviewRating },
});
const policy = transpile("../src/lib/review/policy.ts", {
  "@/lib/review/model": { FsrsCardState },
});
const queue = transpile("../src/lib/review/queue.ts", {
  "@/lib/review/model": { FsrsCardState },
  "@/lib/review/policy": policy,
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

function setup(t, cards, reviewMode = ReviewMode.Simple, options = {}) {
  const knownCards = new Map();
  const remember = (incoming) =>
    incoming.map((card) => {
      const complete = {
        ...card,
        wordSetItemId: card.wordSetItemId ?? `note-${card.id}`,
      };
      knownCards.set(card.id, complete);
      return complete;
    });
  cards = remember(cards);
  const hooks = [];
  let cursor = 0;
  let effects = [];
  let firstLoad = true;
  let audioPlays = 0;
  const audioRefs = [];
  const keyboardListeners = new Set();
  const focusListeners = new Set();
  const submissions = [];
  const undos = [];
  const activations = [];
  const requests = [];
  const invalidations = [];
  const activityActions = { add: [], start: [], complete: [], fail: [] };
  const activityMethods = {
    addReview: (id) => activityActions.add.push(id),
    startSave: (id) => activityActions.start.push(id),
    completeSave: (id, date) => activityActions.complete.push({ id, date }),
    failSave: (id) => activityActions.fail.push(id),
  };
  const scrolls = [];
  const router = { replace() {} };
  const queryClient = {
    invalidateQueries(input) {
      invalidations.push(input);
    },
  };
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
    scrollTo(options) {
      scrolls.push(options);
    },
    addEventListener(event, callback) {
      if (event === "keydown") keyboardListeners.add(callback);
      if (event === "focus") focusListeners.add(callback);
    },
    removeEventListener(event, callback) {
      if (event === "keydown") keyboardListeners.delete(callback);
      if (event === "focus") focusListeners.delete(callback);
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
  const day = () => {
    const instant = new Date();
    const start = new Date(
      Date.UTC(
        instant.getUTCFullYear(),
        instant.getUTCMonth(),
        instant.getUTCDate(),
        2,
      ),
    );
    if (instant < start) start.setUTCDate(start.getUTCDate() - 1);
    return {
      startAt: start.toISOString(),
      nextStartAt: new Date(start.getTime() + 86_400_000).toISOString(),
      timeZone: "UTC",
      serverNow: instant.toISOString(),
    };
  };
  t.mock.method(globalThis, "fetch", async (url, requestOptions) => {
    requests.push({ url, options: requestOptions });
    if (url.endsWith("/activate")) {
      const activation = JSON.parse(requestOptions.body);
      activations.push(activation);
      const card = knownCards.get(activation.studyCardId);
      const result = await options.openExposure?.(activation, card);
      if (result instanceof Response) return result;
      return Response.json(
        result ?? {
          card,
          studyDay: day(),
          exposedAt: new Date().toISOString(),
          exposure: {
            id: activation.exposureId,
            studyCardId: card.id,
            wordSetItemId: card.wordSetItemId,
            activatedAt: new Date().toISOString(),
            stateBefore: card.state.state,
            repsBefore: card.state.reps ?? 0,
          },
        },
      );
    }
    if (url.endsWith("/reviews/undo")) {
      const operation = JSON.parse(requestOptions.body);
      undos.push(operation);
      const result = await options.undoReview?.(operation);
      if (result instanceof Response) return result;
      return Response.json(
        result ?? {
          card: knownCards.get(operation.studyCardId),
          studyDay: day(),
          exposedAt: new Date().toISOString(),
          exposure: {
            id: operation.replacementExposureId,
            studyCardId: operation.studyCardId,
          },
        },
      );
    }
    if (requestOptions?.method === "POST") {
      const submission = JSON.parse(requestOptions.body);
      submissions.push(submission);
      return Response.json((await options.saveReview?.(submission)) ?? {});
    }
    if (firstLoad) {
      firstLoad = false;
      return Response.json({
        cards,
        nextDueAt: options.nextDueAt,
        studyDay: day(),
        exposureDeferredCount: options.exposureDeferredCount ?? 0,
        allowanceBlockedCount: options.allowanceBlockedCount ?? 0,
      });
    }
    const body = (await options.loadQueue?.()) ?? { cards: [] };
    return Response.json({
      ...body,
      cards: remember(body.cards ?? []),
      studyDay: body.studyDay ?? day(),
    });
  });

  function SourceAudioButton() {}
  function BottomPanelLayout({ children, panel, label }) {
    return {
      type: "div",
      props: {
        children: [
          children,
          { type: "section", props: { "aria-label": label, children: panel } },
        ],
      },
    };
  }
  const jsx = (type, props) =>
    type === BottomPanelLayout ? type(props) : { type, props };
  const retries = { withAutomaticRetries: (operation) => operation() };
  const exposureHook = transpile(
    "../src/components/review/useStudyExposure.ts",
    {
      react,
      "@/lib/review/retry": retries,
    },
  );
  const { ReviewSession } = transpile(
    "../src/components/review/ReviewSession.tsx",
    {
      react,
      "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
      "lucide-react": {
        BookOpen: "svg",
        Leaf: "svg",
        Repeat2: "svg",
        Undo2: "svg",
        X: "svg",
      },
      "next/link": { default: "a" },
      "next/navigation": { useRouter: () => router },
      "next-auth/react": { useSession: () => ({ status: "authenticated" }) },
      "@/i18n/client": { useI18n: () => translations(options.locale ?? "en") },
      "@tanstack/react-query": { useQueryClient: () => queryClient },
      "@/components/ui/SourceAudioButton": { SourceAudioButton },
      "@/components/ui/BottomPanelLayout": { BottomPanelLayout },
      "@/lib/review/controls": controls,
      "@/lib/review/queue": queue,
      "@/lib/review/scope": loadSourceModule("src/lib/review/scope.ts"),
      "@/lib/review/formatInterval": { formatReviewInterval: () => "1 day" },
      "@/lib/review/retry": retries,
      "./useStudyExposure": exposureHook,
      "./useStudyActivity": {
        useStudyActivity: () => ({
          ...activityMethods,
          data: options.activity?.(),
          isError: false,
        }),
      },
      "./StudyActivityPanel": { StudyActivitySummary: () => null },
      "@/lib/review/templates": templates,
      "./exercises": exercises,
      "./ReviewSession.module.css": {
        default: new Proxy({}, { get: (_target, key) => key }),
      },
    },
  );

  return {
    submissions,
    undos,
    activations,
    requests,
    invalidations,
    activityActions,
    scrolls,
    focus() {
      focusListeners.forEach((callback) => callback());
    },
    get audioPlays() {
      return audioPlays;
    },
    audioNodes(tree) {
      return nodes(tree, (node) => node.type === SourceAudioButton);
    },
    render() {
      cursor = 0;
      effects = [];
      const tree = ReviewSession({
        scope: options.scope ?? { kind: "sets", setIds: ["set-1"] },
        filter: options.filter,
        reviewMode,
      });
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
      for (let tick = 0; tick < 4; tick++) {
        this.render();
        await nextTick();
      }
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

test("selected due-only sessions keep scope on refills and switch set, direction and audio with each card", async (t) => {
  const scope = { kind: "sets", setIds: ["set-1", "set-2"] };
  const second = {
    ...fixture,
    id: "card-2",
    wordSetId: "set-2",
    wordSetName: "Spanish vocabulary",
    sourceLang: "es",
    targetLang: "de",
    original: "casa",
    translation: "Haus",
    templateKey: "production",
  };
  const session = setup(t, [fixture, second], ReviewMode.Simple, {
    scope,
    filter: "due_only",
  });
  let tree = await session.ready();
  assert.match(text(tree), /Finnish vocabulary/);
  assert.match(text(tree), /FI → RU · 2 sets · Due only/);
  assert.equal(session.audioNodes(tree)[0].props.sourceLanguage, "fi");
  session.key(" ");
  session.render();
  session.key("2");
  tree = await session.ready();
  assert.match(text(tree), /Spanish vocabulary/);
  assert.match(text(tree), /DE → ES · 2 sets · Due only/);
  assert.equal(session.audioNodes(tree).length, 0);
  session.key(" ");
  tree = session.render();
  assert.equal(session.audioNodes(tree)[0].props.sourceLanguage, "es");
  assert.equal(session.audioNodes(tree)[0].props.text, "casa");
  for (const { url, options } of session.requests) {
    if (options?.method === "POST") {
      assert(["/api/study/activate", "/api/study/reviews"].includes(url));
      assert.equal(JSON.parse(options.body).wordSetId, undefined);
    } else {
      const search = new URL(url, "http://localhost").searchParams;
      assert.equal(search.get("scope"), "sets");
      assert.deepEqual(search.getAll("set"), scope.setIds);
      assert.equal(search.get("filter"), "due_only");
    }
  }
  assert(
    session.requests.filter(({ options }) => options?.method !== "POST")
      .length >= 2,
  );
  assert(
    session.invalidations.some(({ queryKey }) => queryKey[0] === "wordSets"),
  );
});

test("due-only completion explains excluded introductions without suggesting the daily limit was consumed", async (t) => {
  const session = setup(t, [], ReviewMode.Simple, {
    scope: { kind: "all" },
    filter: "due_only",
  });
  const tree = await session.ready();
  assert.match(text(tree), /No more repetitions are due/);
  assert.match(text(tree), /New exercises are excluded/);
  assert.doesNotMatch(text(tree), /daily new-word allowance/);
  assert.equal(
    new URL(session.requests[0].url, "http://localhost").searchParams.get(
      "scope",
    ),
    "all",
  );
});

test("combined study scope and due-only labels honor the Russian interface locale", async (t) => {
  const session = setup(t, [fixture], ReviewMode.Simple, {
    scope: { kind: "all" },
    filter: "due_only",
    locale: "ru",
  });
  const tree = await session.ready();
  assert.match(text(tree), /FI → RU · Все наборы · Только повторение/);
  assert.doesNotMatch(text(tree), /All sets|Due only|Repeating/);
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
  assert.equal(
    nodes(tree, (node) => node.props?.["aria-label"] === "Your answer matches")
      .length,
    1,
  );
  assert.doesNotMatch(
    text(tree),
    /Capitalization and spacing|Rate your own recall/,
  );
  assert.equal(session.submissions.length, 0);
  assert.equal(nodes(tree, (node) => node.type === "input").length, 0);
  session.key("1");
  assert.equal(session.submissions[0].rating, ReviewRating.Again);
});

test("typed mistakes highlight only changed fragments after revealing the answer", async (t) => {
  const session = setup(t, [
    { ...fixture, templateKey: "type_answer", original: "opettaja" },
  ]);
  let tree = await session.ready();
  nodes(tree, (node) => node.type === "input")[0].props.onChange({
    target: { value: "opettaiä" },
  });
  tree = session.render();
  assert.equal(
    nodes(tree, (node) => node.type === "del" || node.type === "ins").length,
    0,
  );
  nodes(
    tree,
    (node) => node.type === "button" && /Check answer/.test(text(node)),
  )[0].props.onClick();
  tree = session.render();
  assert.deepEqual(nodes(tree, (node) => node.type === "del").map(text), [
    "iä",
  ]);
  assert.deepEqual(nodes(tree, (node) => node.type === "ins").map(text), [
    "ja",
  ]);
  assert.equal(
    nodes(tree, (node) => node.props?.["aria-label"] === "Your answer differs")
      .length,
    1,
  );
  assert.doesNotMatch(
    text(tree),
    /Compare with the answer|Capitalization and spacing|Rate your own recall/,
  );
  assert.ok(
    nodes(tree, (node) => node.type === "h2")
      .map(text)
      .includes("opettaja"),
  );
  assert.equal(session.submissions.length, 0);
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
  tree = await session.ready();
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

test("a due repetition fetched on focus comes before waiting new exercises", async (t) => {
  const active = { ...fixture, state: { state: FsrsCardState.New } };
  const repeated = {
    ...fixture,
    id: "due-review",
    original: "repeat me",
    state: { state: FsrsCardState.Review, dueAt: new Date().toISOString() },
  };
  const session = setup(
    t,
    [active, { ...active, id: "fresh-2" }],
    ReviewMode.Simple,
    {
      loadQueue: async () => ({ cards: [repeated] }),
    },
  );
  await session.ready();
  session.focus();
  await nextTick();
  assert.deepEqual(
    nodes(session.render(), (node) => node.type === "h2").map(text),
    [active.original],
  );
  session.key(" ");
  session.render();
  session.key(" ");
  assert.deepEqual(
    nodes(await session.ready(), (node) => node.type === "h2").map(text),
    [repeated.original],
  );
});

test("an answer submitted during a refill never returns from the old queue snapshot", async (t) => {
  let finishRefill;
  const waiting = new Promise((resolve) => {
    finishRefill = resolve;
  });
  const cards = Array.from({ length: 7 }, (_, i) => ({
    ...fixture,
    id: `card-${i + 1}`,
    original: `word-${i + 1}`,
  }));
  const session = setup(t, cards, ReviewMode.Simple, {
    loadQueue: () => waiting,
  });
  await session.ready();
  session.focus();
  await nextTick();
  session.key(" ");
  session.render();
  session.key("2");
  assert.deepEqual(
    nodes(await session.ready(), (node) => node.type === "h2").map(text),
    ["word-2"],
  );
  finishRefill({ cards: [{ ...fixture, id: "card-8", original: "word-8" }] });
  await nextTick();
  assert.deepEqual(
    nodes(session.render(), (node) => node.type === "h2").map(text),
    ["word-2"],
  );
});

test("a completion screen refreshes when the next scheduled repetition becomes due", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let refills = 0;
  const session = setup(t, [], ReviewMode.Simple, {
    nextDueAt: new Date(Date.now() + 1000).toISOString(),
    loadQueue: async () => {
      refills++;
      return { cards: [fixture] };
    },
  });
  const complete = await session.ready();
  assert.match(text(complete), /daily new-word allowance/);
  assert.match(text(complete), /Next review:/);
  t.mock.timers.tick(1000);
  await nextTick();
  assert.equal(refills, 1);
  assert.deepEqual(
    nodes(await session.ready(), (node) => node.type === "h2").map(text),
    [fixture.original],
  );
});

test("a saved introduction refetches unlocked siblings after an older refill finishes", async (t) => {
  let finishSave;
  let finishRefill;
  const saving = new Promise((resolve) => {
    finishSave = resolve;
  });
  const waiting = new Promise((resolve) => {
    finishRefill = resolve;
  });
  let refills = 0;
  const recognition = { ...fixture, state: { state: FsrsCardState.New } };
  const production = {
    ...recognition,
    id: "production-card",
    templateKey: "production",
  };
  const session = setup(t, [recognition], ReviewMode.Simple, {
    saveReview: () => saving,
    loadQueue: () => (++refills === 1 ? waiting : { cards: [production] }),
  });
  await session.ready();
  session.key(" ");
  session.render();
  session.key(" ");
  assert.equal(refills, 1);
  finishSave({
    state: { dueAt: new Date(Date.now() + 600_000).toISOString() },
  });
  await nextTick();
  assert.equal(refills, 1);
  finishRefill({ cards: [] });
  await nextTick();
  assert.equal(refills, 2);
  const tree = await session.ready();
  assert.match(text(tree), /Production/);
  assert.deepEqual(nodes(tree, (node) => node.type === "h2").map(text), [
    fixture.translation,
  ]);
});

test("only the active prompt is authorized; showing a word removes mature siblings but keeps Learning and examples", async (t) => {
  const cards = [
    {
      ...fixture,
      id: "intro",
      wordSetItemId: "same-note",
      state: { state: 1 },
    },
    {
      ...fixture,
      id: "mature-reverse",
      wordSetItemId: "same-note",
      templateKey: "production",
      state: { state: 2 },
    },
    {
      ...fixture,
      id: "learning-reverse",
      wordSetItemId: "same-note",
      templateKey: "production",
      state: { state: 1 },
    },
    {
      ...fixture,
      id: "forms",
      wordSetItemId: "same-note",
      templateKey: "word_forms",
      state: { state: 2 },
    },
    {
      ...fixture,
      id: "example",
      wordSetItemId: "same-note",
      templateKey: "example",
      state: { state: 2 },
    },
  ];
  const session = setup(t, cards);
  await session.ready();
  assert.deepEqual(
    session.activations.map((entry) => entry.studyCardId),
    ["intro"],
  );
  session.render();
  session.key(" ");
  session.render();
  session.key("2");
  await session.ready();
  assert.equal(
    session.submissions[0].exposureId,
    session.activations[0].exposureId,
  );
  assert.equal(session.activations[1].studyCardId, "learning-reverse");
  session.key(" ");
  session.render();
  session.key("2");
  await session.ready();
  assert.equal(session.activations[2].studyCardId, "forms");
  session.key(" ");
  session.render();
  session.key("2");
  await session.ready();
  assert.equal(session.activations[3].studyCardId, "example");
  assert(
    !session.activations.some(
      (entry) => entry.studyCardId === "mature-reverse",
    ),
  );
});

test("cards and ratings work immediately while exposure confirmation is pending", async (t) => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const session = setup(
    t,
    [fixture, { ...fixture, id: "next", original: "next word" }],
    ReviewMode.Simple,
    {
      openExposure: async () => {
        await pending;
      },
    },
  );
  const opening = await session.ready();
  assert.doesNotMatch(text(opening), /Loading review/);
  assert.deepEqual(nodes(opening, (node) => node.type === "h2").map(text), [
    fixture.original,
  ]);
  session.key(" ");
  const revealed = session.render();
  assert(text(revealed).includes(fixture.translation));
  assert.doesNotMatch(text(revealed), /Syncing exercise/);
  assert(
    nodes(
      revealed,
      (node) => node.type === "button" && /Yes|No/.test(text(node)),
    ).every((node) => !node.props.disabled),
  );
  session.key("2");
  assert.equal(session.submissions.length, 1);
  assert.equal(
    session.submissions[0].exposureId,
    session.activations[0].exposureId,
  );
  assert.deepEqual(
    nodes(session.render(), (node) => node.type === "h2").map(text),
    ["next word"],
  );
  finish();
  const ready = await session.ready();
  assert.deepEqual(nodes(ready, (node) => node.type === "h2").map(text), [
    "next word",
  ]);
  assert.equal(session.activations.length, 2);
  assert.equal(session.activations[0].displayed, true);
});

test("advancing uses the existing batch immediately even when the next display request is slow", async (t) => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  let refills = 0;
  const cards = Array.from({ length: 8 }, (_, index) => ({
    ...fixture,
    id: `word-${index}`,
    original: `word ${index}`,
  }));
  const session = setup(t, cards, ReviewMode.Simple, {
    openExposure: async ({ studyCardId }) => {
      if (studyCardId === "word-1") await pending;
    },
    loadQueue: async () => {
      refills++;
      return { cards: [] };
    },
  });
  await session.ready();
  assert.equal(session.activations.length, 1);
  session.key(" ");
  session.render();
  session.key("2");
  const next = session.render();
  assert.deepEqual(nodes(next, (node) => node.type === "h2").map(text), [
    "word 1",
  ]);
  assert.doesNotMatch(text(next), /Loading review/);
  await session.ready();
  assert.equal(refills, 0);
  assert.equal(session.submissions.length, 1);
  assert.deepEqual(
    session.activations.map((entry) => entry.studyCardId),
    ["word-0", "word-1"],
  );
  finish();
  await session.ready();
});

test("exposure errors are silent and focus can retry the same presentation without clearing an answer", async (t) => {
  let attempts = 0;
  const session = setup(t, [fixture], ReviewMode.Simple, {
    openExposure: async () => {
      if (++attempts === 1) throw new Error("Connection lost");
    },
  });
  const failure = await session.ready();
  assert.doesNotMatch(
    text(failure),
    /Connection lost|Try again|Syncing exercise/,
  );
  assert.deepEqual(nodes(failure, (node) => node.type === "h2").map(text), [
    fixture.original,
  ]);
  session.key(" ");
  assert(text(session.render()).includes(fixture.translation));
  session.focus();
  await session.ready();
  assert(text(session.render()).includes(fixture.translation));
  assert.equal(session.activations.length, 2);
  assert.equal(
    session.activations[0].exposureId,
    session.activations[1].exposureId,
  );
  session.key("2");
  assert.equal(
    session.submissions[0].exposureId,
    session.activations[0].exposureId,
  );
});

test("a stale exposure response never removes the visible prompt, while its mature sibling stays filtered", async (t) => {
  const blocked = {
    ...fixture,
    id: "blocked",
    wordSetItemId: "seen-note",
    state: { state: 2 },
  };
  const sibling = {
    ...blocked,
    id: "blocked-sibling",
    templateKey: "production",
  };
  const next = { ...fixture, id: "other-word", original: "next word" };
  const session = setup(t, [blocked, sibling, next], ReviewMode.Simple, {
    openExposure: async ({ studyCardId }) => {
      if (studyCardId === blocked.id)
        return Response.json(
          {
            code: "word_seen_today",
            studyDay: {
              startAt: new Date(Date.now() - 3_600_000).toISOString(),
              nextStartAt: new Date(Date.now() + 3_600_000).toISOString(),
              timeZone: "UTC",
              serverNow: new Date().toISOString(),
            },
          },
          { status: 409 },
        );
    },
  });
  const tree = await session.ready();
  assert.deepEqual(nodes(tree, (node) => node.type === "h2").map(text), [
    fixture.original,
  ]);
  assert.equal(session.activations.length, 1);
  session.key(" ");
  session.render();
  session.key("2");
  const advanced = await session.ready();
  assert.deepEqual(nodes(advanced, (node) => node.type === "h2").map(text), [
    "next word",
  ]);
  assert.deepEqual(
    session.activations.map((entry) => entry.studyCardId),
    ["blocked", "other-word"],
  );
});

test("an exposure request that keeps failing does not block rating or advancing", async (t) => {
  const session = setup(
    t,
    [fixture, { ...fixture, id: "next", original: "next word" }],
    ReviewMode.Simple,
    {
      openExposure: async () => {
        throw new Error("Offline exposure");
      },
    },
  );
  await session.ready();
  session.key(" ");
  const revealed = session.render();
  assert.doesNotMatch(text(revealed), /Offline exposure|Syncing exercise/);
  const ratings = nodes(
    revealed,
    (node) => node.type === "button" && /Yes|No/.test(text(node)),
  );
  assert(ratings.length > 0 && ratings.every((node) => !node.props.disabled));
  session.key("2");
  const next = await session.ready();
  assert.deepEqual(nodes(next, (node) => node.type === "h2").map(text), [
    "next word",
  ]);
  assert.equal(session.submissions.length, 1);
});

test("the 2 am rollover renews a visible prompt without clearing the revealed answer", async (t) => {
  t.mock.timers.enable({
    apis: ["Date", "setTimeout"],
    now: new Date("2026-11-10T01:59:59Z").getTime(),
  });
  const session = setup(t, [fixture]);
  await session.ready();
  session.key(" ");
  assert(text(session.render()).includes(fixture.translation));
  t.mock.timers.tick(1000);
  const renewed = await session.ready();
  assert.equal(session.activations.length, 2);
  assert.equal(
    session.activations[0].exposureId,
    session.activations[1].exposureId,
  );
  assert(text(renewed).includes(fixture.translation));
  assert.equal(session.submissions.length, 0);
});

test("rollover can renew a visible prompt even while its first confirmation is pending", async (t) => {
  t.mock.timers.enable({
    apis: ["Date", "setTimeout"],
    now: new Date("2026-11-10T01:59:59Z").getTime(),
  });
  let finish;
  let attempts = 0;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const session = setup(t, [fixture], ReviewMode.Simple, {
    openExposure: async () => {
      if (++attempts === 1) {
        await pending;
        throw new Error("Old response lost");
      }
    },
  });
  await session.ready();
  session.key(" ");
  assert(text(session.render()).includes(fixture.translation));
  t.mock.timers.tick(1000);
  const renewed = await session.ready();
  assert.equal(session.activations.length, 2);
  assert.equal(
    session.activations[0].exposureId,
    session.activations[1].exposureId,
  );
  assert(text(renewed).includes(fixture.translation));
  assert.doesNotMatch(text(renewed), /Syncing exercise/);
  finish();
  const settled = await session.ready();
  assert.doesNotMatch(text(settled), /Old response lost/);
  session.key("2");
  assert.equal(session.submissions.length, 1);
});

test("study controls stay outside long card content and advancing returns to the next word", async (t) => {
  const comments = Array.from(
    { length: 60 },
    (_, index) => `Usage note ${index + 1}`,
  ).join("\n");
  const session = setup(t, [
    { ...fixture, comments },
    { ...fixture, id: "next", original: "next word" },
  ]);
  let tree = await session.ready();
  const panel = (view) =>
    nodes(
      view,
      (node) =>
        node.type === "section" &&
        node.props["aria-label"] === "Study controls",
    );
  assert.equal(panel(tree).length, 1);
  assert.match(text(panel(tree)), /Show answer/);
  assert.doesNotMatch(
    text(nodes(tree, (node) => node.type === "article")),
    /Show answer/,
  );
  session.key(" ");
  tree = session.render();
  assert.equal(panel(tree).length, 1);
  assert.match(text(panel(tree)), /No/);
  assert.match(text(panel(tree)), /Yes/);
  assert.equal(text(panel(tree)).includes(comments), false);
  assert(
    text(nodes(tree, (node) => node.type === "article")).includes(comments),
  );
  assert.equal(
    session.scrolls.length,
    0,
    "revealing content must not scroll it away",
  );
  session.key("2");
  tree = await session.ready();
  assert.deepEqual(session.scrolls, [{ top: 0, behavior: "instant" }]);
  assert.deepEqual(nodes(tree, (node) => node.type === "h2").map(text), [
    "next word",
  ]);
  assert.match(text(panel(tree)), /Show answer/);
});

test("completion explains deferred repetitions and their study-zone reset", async (t) => {
  const session = setup(t, [], ReviewMode.Simple, { exposureDeferredCount: 3 });
  assert.match(
    text(await session.ready()),
    /Repetitions of words you’ve seen today resume after 2 am/,
  );
});

test("pending saves stay silent and never block the next exercise or exit", async (t) => {
  let finish;
  const saving = new Promise((resolve) => {
    finish = resolve;
  });
  const session = setup(
    t,
    [fixture, { ...fixture, id: "next", original: "next word" }],
    ReviewMode.Simple,
    {
      saveReview: () => saving,
    },
  );
  await session.ready();
  session.key(" ");
  session.render();
  session.key("2");
  assert.deepEqual(session.activityActions.add, [
    session.submissions[0].reviewId,
  ]);
  assert.equal(session.activityActions.complete.length, 0);
  let tree = await session.ready();
  assert.doesNotMatch(
    text(tree),
    /review is saving|Saving progress|Finishing your saves/,
  );
  assert.deepEqual(nodes(tree, (node) => node.type === "h2").map(text), [
    "next word",
  ]);
  const exit = nodes(tree, (node) => node.props?.href === "/anki")[0];
  assert.equal(exit.props["aria-disabled"], undefined);
  assert.equal(exit.props.onClick, undefined);
  session.key(" ");
  assert(text(session.render()).includes(fixture.translation));
  finish({});
  tree = await session.ready();
  assert.equal(session.activityActions.add.length, 1);
  assert.equal(session.activityActions.complete.length, 1);
  assert.doesNotMatch(text(tree), /review is saving/);
  assert.deepEqual(nodes(tree, (node) => node.type === "h2").map(text), [
    "next word",
    fixture.translation,
  ]);
});

test("failed saves and retries reuse the optimistic rating identity without another increment", async (t) => {
  let attempts = 0;
  const session = setup(t, [fixture], ReviewMode.Simple, {
    saveReview: () => {
      if (++attempts === 1) throw new Error("offline");
      return { activityCredit: { creditedDate: "2026-11-12" } };
    },
  });
  await session.ready();
  session.key(" ");
  session.render();
  session.key("2");
  const failed = await session.ready();
  const id = session.submissions[0].reviewId;
  assert.deepEqual(session.activityActions.add, [id]);
  assert.deepEqual(session.activityActions.fail, [id]);
  nodes(
    failed,
    (node) => node.type === "button" && text(node) === "Retry",
  )[0].props.onClick();
  await session.ready();
  assert.deepEqual(
    session.submissions.map((review) => review.reviewId),
    [id, id],
  );
  assert.deepEqual(session.activityActions.add, [id]);
  assert.deepEqual(session.activityActions.complete, [
    { id, date: "2026-11-12" },
  ]);
});

test("confirmed leaf milestones leave the active answer and keyboard flow uninterrupted", async (t) => {
  let activity = { today: { date: "2026-11-10", leaves: 0 } };
  const session = setup(t, [fixture], ReviewMode.Simple, {
    activity: () => activity,
  });
  await session.ready();
  session.key(" ");
  session.render();
  activity = { today: { date: "2026-11-10", leaves: 1 } };
  let tree = await session.ready();
  assert.doesNotMatch(text(tree), /leaf earned today|Continue|Finish/);
  assert(text(tree).includes(fixture.translation));
  assert.equal(session.submissions.length, 0);
  activity = { today: { date: "2026-11-11", leaves: 2 } };
  assert.doesNotMatch(text(await session.ready()), /leaves earned today/);
  session.key("2");
  assert.equal(session.submissions.length, 1);
});

test("rejoining existing partial progress never announces an old milestone", async (t) => {
  const activity = { today: { date: "2026-11-10", leaves: 2 } };
  const session = setup(t, [fixture], ReviewMode.Simple, {
    activity: () => activity,
  });
  assert.doesNotMatch(text(await session.ready()), /leaves earned today/);
});

test("completion explicitly identifies exhausted new-word allowances", async (t) => {
  const session = setup(t, [], ReviewMode.Simple, { allowanceBlockedCount: 2 });
  assert.match(
    text(await session.ready()),
    /daily new-word allowance has been reached/,
  );
});

const undoButton = (tree) =>
  nodes(
    tree,
    (node) =>
      node.type === "button" &&
      /^Undo$|^Undoing…$|^Retry undo$/.test(text(node)),
  )[0];

test("Undo restores the previous answer and a fresh presentation, retaining the unfinished typed draft", async (t) => {
  const first = { ...fixture, templateKey: "type_answer" };
  const second = { ...first, id: "card-2", original: "talo" };
  const session = setup(t, [first, second]);
  let tree = await session.ready();
  assert.equal(undoButton(tree).props.disabled, true);
  nodes(tree, (node) => node.type === "input")[0].props.onChange({
    target: { value: "moniko" },
  });
  session.render();
  session.key(" ");
  session.render();
  session.key("2");
  tree = await session.ready();
  const originalExposure = session.submissions[0].exposureId;
  nodes(tree, (node) => node.type === "input")[0].props.onChange({
    target: { value: "unfinished draft" },
  });
  tree = session.render();
  undoButton(tree).props.onClick();
  tree = await session.ready();
  assert.match(text(tree), /moniko/);
  assert.equal(
    nodes(tree, (node) => node.props?.["aria-label"] === "Your answer differs")
      .length,
    1,
  );
  assert.equal(session.undos.length, 1);
  assert.equal(session.undos[0].reviewId, session.submissions[0].reviewId);
  assert.equal(undoButton(tree).props.disabled, true);
  session.key("2");
  tree = await session.ready();
  assert.notEqual(
    session.submissions[1].reviewId,
    session.submissions[0].reviewId,
  );
  assert.equal(
    session.submissions[1].sessionId,
    session.submissions[0].sessionId,
  );
  assert.equal(
    session.submissions[1].exposureId,
    session.undos[0].replacementExposureId,
  );
  assert.notEqual(session.submissions[1].exposureId, originalExposure);
  assert.equal(
    nodes(tree, (node) => node.type === "input")[0].props.value,
    "unfinished draft",
  );
});

test("every answer in a long session can be undone back to the first, including from completion", async (t) => {
  const cards = Array.from({ length: 125 }, (_, i) => ({
    ...fixture,
    id: `card-${i}`,
    original: `word ${i}`,
  }));
  const session = setup(t, cards);
  let tree = await session.ready();
  for (let i = 0; i < cards.length; i++) {
    session.key(" ");
    session.render();
    session.key("2");
    tree = await session.ready();
  }
  assert.match(text(tree), /caught up/);
  assert.equal(session.submissions.length, 125);
  for (let i = cards.length - 1; i >= 0; i--) {
    undoButton(tree).props.onClick();
    tree = await session.ready();
    assert.equal(
      nodes(tree, (node) => node.type === "h2").map(text)[0],
      `word ${i}`,
    );
  }
  assert.equal(session.undos.length, 125);
  assert.equal(undoButton(tree).props.disabled, true);
  assert.equal(
    new Set(session.submissions.map((answer) => answer.sessionId)).size,
    1,
  );
});

test("Cmd/Ctrl+Z undoes answers outside editable fields and preserves native text undo", async (t) => {
  const session = setup(t, [fixture]);
  await session.ready();
  session.key(" ");
  session.render();
  session.key("2");
  await session.ready();
  for (const tag of ["input", "textarea", "[contenteditable]"])
    assert.equal(
      session.key("z", { tag, ctrlKey: true }).defaultPrevented,
      false,
    );
  assert.equal(
    session.key("z", { metaKey: true, shiftKey: true }).defaultPrevented,
    false,
  );
  assert.equal(session.key("z", { metaKey: true }).defaultPrevented, true);
  const tree = await session.ready();
  assert.equal(session.undos.length, 1);
  assert.match(text(tree), /monikko/);
});

test("a late grade response after undo cannot restore provisional credit or a failed-save notice", async (t) => {
  let finish;
  const session = setup(t, [fixture], ReviewMode.Simple, {
    saveReview: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  await session.ready();
  session.key(" ");
  session.render();
  session.key("2");
  let tree = await session.ready();
  undoButton(tree).props.onClick();
  tree = await session.ready();
  const reviewId = session.submissions[0].reviewId;
  assert(session.activityActions.fail.includes(reviewId));
  finish({
    activityCredit: { creditedDate: "2026-11-12" },
    nextAvailableAt: "2099-01-01T00:00:00Z",
  });
  tree = await session.ready();
  assert(
    !session.activityActions.complete.some((save) => save.id === reviewId),
  );
  assert.doesNotMatch(text(tree), /We had an issue/);
  assert.match(text(tree), /monikko/);
});

test("an uncertain undo freezes grading until the same reversal is confirmed by Retry", async (t) => {
  let attempts = 0;
  const session = setup(t, [fixture], ReviewMode.Simple, {
    undoReview: () => {
      if (attempts++ === 0) throw new Error("Lost response");
    },
  });
  await session.ready();
  session.key(" ");
  session.render();
  session.key("2");
  let tree = await session.ready();
  undoButton(tree).props.onClick();
  tree = await session.ready();
  assert.match(text(tree), /Could not confirm the undo/);
  assert.match(text(tree), /Retry undo/);
  undoButton(tree).props.onClick();
  tree = await session.ready();
  assert.equal(
    session.undos[0].replacementExposureId,
    session.undos[1].replacementExposureId,
  );
  assert.equal(session.undos[0].reviewId, session.undos[1].reviewId);
  assert.match(text(tree), /monikko/);
  assert.equal(undoButton(tree).props.disabled, true);
});

test("undo invalidates stale queue responses and removes siblings of a reverted introduction", async (t) => {
  let finish;
  let loads = 0;
  const initial = { ...fixture, state: { state: FsrsCardState.New } };
  const sibling = {
    ...fixture,
    id: "production",
    wordSetItemId: "note-card-1",
    templateKey: "production",
    state: { state: FsrsCardState.New },
  };
  const session = setup(t, [initial], ReviewMode.Simple, {
    loadQueue: () => {
      if (loads++ === 0)
        return new Promise((resolve) => {
          finish = resolve;
        });
      return { cards: [] };
    },
  });
  await session.ready();
  session.key(" ");
  session.render();
  session.key(" ");
  let tree = await session.ready();
  undoButton(tree).props.onClick();
  tree = await session.ready();
  finish({ cards: [sibling] });
  tree = await session.ready();
  assert.match(text(tree), /monikko/);
  assert.equal(
    nodes(tree, (node) => node.type === "h2").map(text)[0],
    "monikko",
  );
  assert.equal(session.undos.length, 1);
});

test("repeated occurrences of one exercise unwind without duplicate queued copies", async (t) => {
  let repeat = false;
  const second = { ...fixture, id: "card-2", original: "talo" };
  const session = setup(t, [fixture, second], ReviewMode.Simple, {
    loadQueue: () => {
      if (!repeat) return { cards: [] };
      repeat = false;
      return {
        cards: [{ ...fixture, state: { state: FsrsCardState.Learning } }],
      };
    },
  });
  await session.ready();
  session.key(" ");
  session.render();
  session.key("2");
  await session.ready();
  repeat = true;
  session.focus();
  await session.ready();
  session.key(" ");
  session.render();
  session.key("2");
  await session.ready();
  session.key(" ");
  session.render();
  session.key("2");
  let tree = await session.ready();
  assert.equal(session.submissions.length, 3);
  for (let i = 0; i < 3; i++) {
    undoButton(tree).props.onClick();
    tree = await session.ready();
  }
  assert.deepEqual(
    session.undos.map((entry) => entry.reviewId),
    session.submissions
      .slice(0, 3)
      .reverse()
      .map((entry) => entry.reviewId),
  );
  assert.equal(undoButton(tree).props.disabled, true);
  session.key("2");
  tree = await session.ready();
  assert.equal(nodes(tree, (node) => node.type === "h2").map(text)[0], "talo");
  session.key("2");
  tree = await session.ready();
  assert.match(text(tree), /caught up/);
  assert.equal(session.submissions.length, 5);
});

test("an acknowledged undo with newer external progress preserves the next exercise instead of restoring a stale receipt", async (t) => {
  const second = { ...fixture, id: "card-2", original: "talo" };
  const session = setup(t, [fixture, second], ReviewMode.Simple, {
    undoReview: (operation) => ({
      card: fixture,
      exposure: { id: operation.replacementExposureId },
      studyDay: {
        startAt: new Date().toISOString(),
        nextStartAt: new Date(Date.now() + 86400000).toISOString(),
        timeZone: "UTC",
      },
      resumable: false,
    }),
  });
  await session.ready();
  session.key(" ");
  session.render();
  session.key("2");
  let tree = await session.ready();
  undoButton(tree).props.onClick();
  tree = await session.ready();
  assert.equal(nodes(tree, (node) => node.type === "h2").map(text)[0], "talo");
  assert.match(text(tree), /answer was undone.*changed elsewhere/);
  assert.equal(undoButton(tree).props.disabled, true);
});

test("undoing an ignored failed save allows the corrected exercise back into later refills", async (t) => {
  let saves = 0;
  const session = setup(t, [fixture], ReviewMode.Simple, {
    saveReview: () => {
      if (saves++ === 0) throw new Error("Save unavailable");
    },
  });
  await session.ready();
  session.key(" ");
  session.render();
  session.key("2");
  let tree = await session.ready();
  nodes(
    tree,
    (node) => node.type === "button" && text(node) === "Ignore",
  )[0].props.onClick();
  tree = await session.ready();
  undoButton(tree).props.onClick();
  tree = await session.ready();
  session.key("2");
  await session.ready();
  session.focus();
  await session.ready();
  const lastQueue = session.requests
    .filter((request) => request.options?.method !== "POST")
    .at(-1);
  assert(
    !new URL(lastQueue.url, "https://gooseberry.test").searchParams
      .getAll("exclude")
      .includes(fixture.id),
  );
  assert.equal(session.submissions.length, 2);
});
