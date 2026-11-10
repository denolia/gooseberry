import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "@typescript/typescript6";
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
  const activations = [];
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
    if (url.endsWith("/exposure")) {
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
  const jsx = (type, props) => ({ type, props });
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
      "next/link": { default: "a" },
      "next/navigation": { useRouter: () => router },
      "next-auth/react": { useSession: () => ({ status: "authenticated" }) },
      "@tanstack/react-query": { useQueryClient: () => queryClient },
      "@/components/ui/SourceAudioButton": { SourceAudioButton },
      "@/lib/review/controls": controls,
      "@/lib/review/queue": queue,
      "@/lib/review/formatInterval": { formatReviewInterval: () => "1 day" },
      "@/lib/review/retry": retries,
      "./useStudyExposure": exposureHook,
      "@/lib/review/templates": templates,
      "./exercises": exercises,
      "./ReviewSession.module.css": {
        default: new Proxy({}, { get: (_target, key) => key }),
      },
    },
  );

  return {
    submissions,
    activations,
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

test("the question and rating shortcuts stay hidden until display authorization succeeds", async (t) => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const session = setup(t, [fixture], ReviewMode.Simple, {
    openExposure: async () => {
      await pending;
    },
  });
  const opening = await session.ready();
  assert.match(text(opening), /Loading review/);
  assert.equal(nodes(opening, (node) => node.type === "h2").length, 0);
  session.key(" ");
  session.render();
  session.key("2");
  assert.equal(session.submissions.length, 0);
  finish();
  const ready = await session.ready();
  assert.deepEqual(nodes(ready, (node) => node.type === "h2").map(text), [
    fixture.original,
  ]);
  assert.equal(session.activations.length, 1);
});

test("an activation error retries the same presentation ID instead of opening a second attempt", async (t) => {
  let attempts = 0;
  const session = setup(t, [fixture], ReviewMode.Simple, {
    openExposure: async () => {
      if (++attempts === 1) throw new Error("Connection lost");
    },
  });
  const failure = await session.ready();
  assert.match(text(failure), /Connection lost/);
  nodes(
    failure,
    (node) => node.type === "button" && text(node) === "Try again",
  )[0].props.onClick();
  await session.ready();
  assert.equal(session.activations.length, 2);
  assert.equal(
    session.activations[0].exposureId,
    session.activations[1].exposureId,
  );
  session.key(" ");
  session.render();
  session.key("2");
  assert.equal(
    session.submissions[0].exposureId,
    session.activations[0].exposureId,
  );
});

test("a stale card rejected by another tab is skipped before its prompt appears", async (t) => {
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
    "next word",
  ]);
  assert.deepEqual(
    session.activations.map((entry) => entry.studyCardId),
    ["blocked", "other-word"],
  );
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

test("completion explains deferred repetitions and their study-zone reset", async (t) => {
  const session = setup(t, [], ReviewMode.Simple, { exposureDeferredCount: 3 });
  assert.match(
    text(await session.ready()),
    /Repetitions of words you’ve seen today resume after 2 am/,
  );
});
