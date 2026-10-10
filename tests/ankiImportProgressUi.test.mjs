import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "@typescript/typescript6";
import * as tsFsrs from "ts-fsrs";
import * as templates from "../src/lib/review/templates.ts";
import * as mapping from "../src/lib/anki/import/mapping.ts";
import * as clientHelpers from "../src/lib/anki/import/clientHelpers.ts";
import * as clientTransport from "../src/lib/anki/import/clientTransport.ts";

function load(path, dependencies = {}) {
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
    assert(name in dependencies, `Unexpected import ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

const fsrs = load("../src/lib/review/fsrs.ts", { "ts-fsrs": tsFsrs });
const progress = load("../src/lib/anki/import/progress.ts", {
  "ts-fsrs": tsFsrs,
  "@/lib/review/fsrs": fsrs,
});
const templateMapping = load("../src/lib/anki/import/templateMapping.ts");
const clientProgress = load("../src/lib/anki/import/clientProgress.ts", {
  "./mapping": mapping,
  "./progress": progress,
  "./templateMapping": templateMapping,
});
const languages = load("../src/components/ui/Languages.ts");
const now = new Date("2026-10-10T12:00:00Z");

function fixture({ duplicate = false } = {}) {
  const model = {
    id: "11",
    name: "Vocabulary",
    type: 0,
    css: "",
    raw: {},
    fields: ["Front", "Back"].map((name, ord) => ({ name, ord, raw: {} })),
    templates: [
      {
        name: "Recognition card",
        ord: 0,
        questionFormat: "{{Front}}",
        answerFormat: "{{Back}}",
        raw: {},
      },
      {
        name: "Second card",
        ord: 1,
        questionFormat: duplicate ? "{{Front}}" : "{{Back}}{{type:Front}}",
        answerFormat: duplicate ? "{{Back}}" : "{{Front}}",
        raw: {},
      },
    ],
  };
  const note = {
    id: "21",
    guid: "word-guid",
    modelId: model.id,
    fields: ["monikko", "множественное число"],
    tags: [],
    raw: {},
  };
  const card = {
    id: "31",
    nid: note.id,
    did: "1",
    ord: 0,
    mod: 1600000000,
    usn: 0,
    type: 2,
    queue: 2,
    due: 2000,
    ivl: 10,
    factor: 2500,
    reps: 8,
    lapses: 1,
    left: 0,
    odue: 0,
    odid: "0",
    flags: 0,
    data: "",
  };
  return {
    packageVersion: 1,
    databaseFormat: "legacy",
    schemaVersion: 11,
    models: [model],
    decks: [{ id: "1", name: "Finnish", configId: "1", raw: {} }],
    configs: [],
    notes: [note],
    cards: [card],
    revlogs: [],
    collection: {
      creationTime: 1600000000,
      config: { schedVer: 2, creationOffset: 0, rollover: 4 },
      raw: {},
    },
    diagnostics: {
      sourceBytes: 100,
      databaseBytes: 100,
      omittedMediaCount: 0,
      warnings: [],
    },
  };
}

test("progress preview counts studied cards, including temporarily unavailable exercises", () => {
  const pkg = fixture();
  pkg.notes[0].fields = ["", ""];
  pkg.cards.push(
    { ...pkg.cards[0], id: "32", ord: 1 },
    { ...pkg.cards[0], id: "33", type: 0, reps: 100 },
    { ...pkg.cards[0], id: "34", ord: 7 },
    { ...pkg.cards[0], id: "35", queue: 99 },
  );
  const result = clientProgress.previewImportProgress(
    pkg,
    pkg,
    clientHelpers.suggestNoteTypeMappings(pkg.models),
    "Europe/Helsinki",
    now,
  );
  assert.equal(result.studiedCount, 4);
  assert.equal(result.matchedCount, 2);
  assert.equal(result.unsupportedCount, 1);
  assert.deepEqual(
    result.unmatchedTemplates.map((entry) => [entry.ord, entry.count]),
    [[7, 1]],
  );
});

test("progress preview catches duplicate inferred matches and explicit opt-outs", () => {
  const pkg = fixture({ duplicate: true });
  const mappings = clientHelpers.suggestNoteTypeMappings(pkg.models);
  let result = clientProgress.previewImportProgress(
    pkg,
    pkg,
    mappings,
    "UTC",
    now,
  );
  assert.deepEqual(result.duplicateMappings[0].templateKeys, ["recognition"]);
  mappings[0].exerciseTemplates = [
    { ord: 0, templateKey: null },
    { ord: 1, templateKey: "production" },
  ];
  result = clientProgress.previewImportProgress(pkg, pkg, mappings, "UTC", now);
  assert.equal(result.duplicateMappings.length, 0);
  assert.equal(result.matchedCount, 0);
  assert.equal(result.unmatchedTemplates[0].count, 1);
});

test("progress preview ignores duplicate mappings for note types outside the selected decks", () => {
  const pkg = fixture();
  const unused = { ...fixture({ duplicate: true }).models[0], id: "99" };
  pkg.models.push(unused);
  const result = clientProgress.previewImportProgress(
    pkg,
    pkg,
    clientHelpers.suggestNoteTypeMappings(pkg.models),
    "UTC",
    now,
  );
  assert.equal(result.duplicateMappings.length, 0);
  assert.equal(result.matchedCount, 1);
});

test("time zones require a recognized identifier and have a safe default", () => {
  assert(clientProgress.isValidSchedulingTimeZone("Europe/Helsinki"));
  assert(clientProgress.isValidSchedulingTimeZone("UTC"));
  assert(!clientProgress.isValidSchedulingTimeZone(""));
  assert(!clientProgress.isValidSchedulingTimeZone("not/a/time-zone"));
  assert(
    clientProgress.isValidSchedulingTimeZone(
      clientProgress.defaultSchedulingTimeZone(),
    ),
  );
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
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return tree && typeof tree === "object" ? text(tree.props?.children) : "";
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function setup(t, pkg = fixture(), saved, controls = {}) {
  const file = new File(["isolated package fixture"], "vocabulary.apkg");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  const hash = Buffer.from(digest).toString("hex");
  const memory = new Map();
  if (saved)
    memory.set(
      `gooseberry.anki-import.v1.user-1.${hash}`,
      JSON.stringify({
        version: 1,
        sha256: hash,
        requestKey: "44444444-4444-4444-8444-444444444444",
        name: "Saved set",
        sourceLang: "fi",
        targetLang: "ru",
        targetSetId: "",
        selectedDeckIds: ["1"],
        mapping: clientHelpers.suggestNoteTypeMappings(pkg.models),
        ...saved,
      }),
    );
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const writes = [];
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => {
        memory.set(key, value);
        writes.push(JSON.parse(value));
      },
      removeItem: (key) => memory.delete(key),
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete globalThis.localStorage;
  });
  const calls = [];
  const pendingRequests = [];
  let begun;
  let job = {
    jobId: "job-1",
    status: "receiving",
    wordSetId: null,
    nextBatchIndex: 0,
    stagedNoteCount: 0,
    stagedCardCount: 0,
    stagedReviewCount: 0,
    addedCount: 0,
    skippedCount: 0,
    needsAttentionCount: 0,
    importedProgressCount: 0,
    ...controls.initialJob,
  };
  const hooks = [];
  let cursor = 0;
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
    useRef(value) {
      const index = cursor++;
      return (hooks[index] ??= { current: value });
    },
    useMemo(factory) {
      cursor++;
      return factory();
    },
    useEffect() {
      cursor++;
    },
  };
  const jsx = (type, props) => ({ type, props });
  let packageRead;
  const inspected = new Promise((resolve) => {
    packageRead = resolve;
  });
  const component = load("../src/components/anki/ImportDeck.tsx", {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "next/link": { default: "a" },
    "next-auth/react": {
      useSession: () => ({
        status: "authenticated",
        data: { user: { id: "user-1" } },
      }),
    },
    "@tanstack/react-query": {
      useQuery: () => ({ data: [] }),
      useQueryClient: () => ({ invalidateQueries() {} }),
    },
    "@/components/ui/Languages": languages,
    "@/lib/languages/useLanguages": {
      useLanguages: () => ({
        currentSourceLanguage: "Finnish",
        currentTargetLanguage: "Russian",
      }),
    },
    "@/lib/anki/import/clientHelpers": clientHelpers,
    "@/lib/anki/import/clientProgress": clientProgress,
    "@/lib/anki/import/templateMapping": templateMapping,
    "@/lib/anki/import/clientTransport": {
      ...clientTransport,
      async importRequest(path, method, payload) {
        calls.push({ path, method, payload });
        if (controls.gated) {
          const response = await new Promise((resolve, reject) => {
            pendingRequests.push({ path, method, payload, resolve, reject });
          });
          if (response) job = { ...job, ...response };
        }
        if (path === "/api/anki/imports" && method === "POST") begun = payload;
        if (method === "PUT")
          job = {
            ...job,
            nextBatchIndex: payload.batchIndex + 1,
            stagedNoteCount: job.stagedNoteCount + payload.notes.length,
            stagedCardCount: job.stagedCardCount + payload.cards.length,
            stagedReviewCount: job.stagedReviewCount + payload.revlogs.length,
          };
        if (path.endsWith("/commit"))
          job = {
            ...job,
            status: "completed",
            wordSetId: "set-1",
            addedCount: pkg.notes.length,
            importedProgressCount: (begun?.importProgress ?? true) ? 1 : 0,
          };
        return job;
      },
    },
    "@/lib/anki/import/mapping": mapping,
    "@/lib/anki/import/readerClient": {
      readPackageFile: async () => {
        packageRead();
        return pkg;
      },
    },
    "@/lib/review/templates": templates,
    "./ImportDeck.module.css": { default: {} },
  });
  const harness = {
    calls,
    writes,
    pendingRequests,
    get job() {
      return { ...job };
    },
    async releaseNext(method, response) {
      const pending = pendingRequests.shift();
      assert(pending, `Missing pending ${method} request`);
      assert.equal(pending.method, method);
      pending.resolve(response);
      await tick();
      await tick();
    },
    async rejectNext(method, error) {
      const pending = pendingRequests.shift();
      assert(pending, `Missing pending ${method} request`);
      assert.equal(pending.method, method);
      pending.reject(error);
      await tick();
      await tick();
    },
    render() {
      cursor = 0;
      return component.ImportDeck();
    },
    inputFor(label) {
      const node = nodes(
        this.render(),
        (node) => node.type === "label" && text(node).startsWith(label),
      )[0];
      assert(node, `Missing label: ${label}`);
      return nodes(
        node,
        (child) => child.type === "input" || child.type === "select",
      )[0];
    },
    async change(label, value) {
      this.inputFor(label).props.onChange({
        target: typeof value === "boolean" ? { checked: value } : { value },
      });
      await tick();
    },
    importButton() {
      return nodes(
        this.render(),
        (node) =>
          node.type === "button" &&
          /^(Import \d+ words?|Resume import)$/.test(text(node)),
      )[0];
    },
    async start() {
      const button = this.importButton();
      assert(button && !button.props.disabled, "Import must be enabled");
      button.props.onClick();
      await tick();
      await tick();
    },
  };
  nodes(
    harness.render(),
    (node) => node.type === "input" && node.props.type === "file",
  )[0].props.onChange({
    target: { files: [file] },
    currentTarget: { value: "file" },
  });
  await inspected;
  await tick();
  return harness;
}

test("import UI defaults to keeping progress and sends confirmed matches with a stable time zone", async (t) => {
  const harness = await setup(t);
  assert(harness.inputFor("Keep Anki learning progress").props.checked);
  await harness.change("Study time zone", "Europe/Helsinki");
  await harness.change("Second card", "none");
  await harness.change("I confirm the words", true);
  await harness.start();
  const begin = harness.calls.find(
    (call) => call.path === "/api/anki/imports",
  ).payload;
  assert.equal(begin.importProgress, true);
  assert.equal(begin.schedulingTimeZone, "Europe/Helsinki");
  assert.deepEqual(begin.mapping[0].exerciseTemplates, [
    { ord: 1, templateKey: null },
  ]);
  assert(
    harness.writes.every(
      (value) =>
        value.importProgress === true &&
        value.schedulingTimeZone === "Europe/Helsinki",
    ),
  );
  assert.match(text(harness.render()), /kept for 1 studied exercises/);
});

test("duplicate template matches block transfer but still allow an explicit fresh import", async (t) => {
  const harness = await setup(t, fixture({ duplicate: true }));
  await harness.change("I confirm the words", true);
  assert(harness.importButton().props.disabled);
  assert.match(
    text(harness.render()),
    /Resolve the duplicate exercise matches/,
  );
  await harness.change("Keep Anki learning progress", false);
  assert(!harness.importButton().props.disabled);
  await harness.start();
  assert.equal(harness.calls[0].payload.importProgress, false);
  assert.match(text(harness.render()), /fresh study progress/);
});

test("resuming restores immutable progress settings", async (t) => {
  const harness = await setup(t, fixture(), {
    importProgress: false,
    schedulingTimeZone: "Europe/Helsinki",
  });
  assert.equal(
    harness.inputFor("Keep Anki learning progress").props.checked,
    false,
  );
  assert.equal(
    harness.inputFor("Study time zone").props.value,
    "Europe/Helsinki",
  );
  await harness.start();
  assert.equal(harness.calls[0].payload.importProgress, false);
  assert.equal(harness.calls[0].payload.schedulingTimeZone, "Europe/Helsinki");
});

test("older resumes restore the API defaults for progress and time zone", async (t) => {
  const older = await setup(t, fixture(), {});
  assert.equal(
    older.inputFor("Keep Anki learning progress").props.checked,
    true,
  );
  assert.equal(older.inputFor("Study time zone").props.value, "UTC");
});

test("an invalid time zone blocks the import until corrected", async (t) => {
  const harness = await setup(t);
  await harness.change("I confirm the words", true);
  await harness.change("Study time zone", "not/a/time-zone");
  assert(harness.importButton().props.disabled);
  assert.match(text(harness.render()), /Enter a valid time zone/);
  await harness.change("Study time zone", "UTC");
  assert(!harness.importButton().props.disabled);
});

function multiBatchFixture() {
  const pkg = fixture();
  const note = pkg.notes[0];
  pkg.notes = Array.from({ length: 101 }, (_, index) => ({
    ...note,
    id: String(100 + index),
    guid: `word-guid-${index}`,
  }));
  const card = pkg.cards[0];
  pkg.cards = [0, 1].map((ord) => ({
    ...card,
    id: String(300 + ord),
    nid: pkg.notes[0].id,
    ord,
  }));
  pkg.revlogs = pkg.cards.map((card, index) => ({
    id: String(1_600_000_000_000 + index),
    cid: card.id,
    ease: 3,
    ivl: 10,
    lastIvl: 5,
    factor: 2500,
    time: 1000,
    type: 1,
    usn: 0,
  }));
  return pkg;
}

function progressBar(harness, label) {
  return nodes(
    harness.render(),
    (node) => node.type === "progress" && node.props["aria-label"] === label,
  )[0];
}

function assertReceived(harness, notes, cards, reviews) {
  const rendered = text(harness.render());
  assert.match(rendered, new RegExp(`${notes} of 101 words received`));
  assert.match(rendered, new RegExp(`${cards} of 2 Anki cards received`));
  assert.match(rendered, new RegExp(`${reviews} of 2 reviews received`));
}

test("upload progress advances before the atomic commit and finalization stays indeterminate", async (t) => {
  const harness = await setup(t, multiBatchFixture(), undefined, {
    gated: true,
  });
  await harness.change("I confirm the words", true);
  await harness.start();
  assert.match(text(harness.render()), /Uploading your vocabulary… 0%/);
  assert.equal(progressBar(harness, "Deck upload progress").props.value, 0);
  await harness.releaseNext("POST");
  assertReceived(harness, 0, 0, 0);

  await harness.releaseNext("PUT");
  assert.match(text(harness.render()), /Uploading your vocabulary… 50%/);
  const halfway = progressBar(harness, "Deck upload progress");
  assert.equal(halfway.props.value / halfway.props.max, 0.5);
  assertReceived(harness, 100, 0, 0);
  assert.equal(harness.job.addedCount, 0);
  assert.equal(harness.job.importedProgressCount, 0);

  await harness.releaseNext("PUT");
  assert.match(text(harness.render()), /Finishing your import…/);
  assertReceived(harness, 101, 2, 2);
  const finalizing = progressBar(harness, "Saving your study set");
  assert(finalizing, "Finalization should retain an accessible busy indicator");
  assert.equal(finalizing.props.value, undefined);
  assert.equal(progressBar(harness, "Deck upload progress"), undefined);
  assert.equal(harness.job.addedCount, 0);
  assert.equal(harness.job.importedProgressCount, 0);
  assert.equal(harness.job.status, "receiving");
  assert(harness.pendingRequests[0].path.endsWith("/commit"));

  await harness.releaseNext("POST");
  assert.equal(harness.job.status, "completed");
  assert.equal(harness.job.addedCount, 101);
  assert.equal(harness.job.importedProgressCount, 1);
  assert.match(text(harness.render()), /101 words added/);
  assert.equal(harness.pendingRequests.length, 0);
});

test("a fully staged resumed import restores received counts and proceeds directly to commit", async (t) => {
  const harness = await setup(
    t,
    multiBatchFixture(),
    {},
    {
      gated: true,
      initialJob: {
        nextBatchIndex: 2,
        stagedNoteCount: 101,
        stagedCardCount: 2,
        stagedReviewCount: 2,
      },
    },
  );
  await harness.start();
  await harness.releaseNext("POST");
  assertReceived(harness, 101, 2, 2);
  assert.match(text(harness.render()), /Finishing your import…/);
  assert.equal(harness.calls.filter((call) => call.method === "PUT").length, 0);
  assert(harness.pendingRequests[0].path.endsWith("/commit"));
  assert.equal(harness.job.addedCount, 0);
  await harness.releaseNext("POST");
  assert.match(text(harness.render()), /101 words added/);
});

test("resuming an existing request immediately restores acknowledged upload progress", async (t) => {
  const harness = await setup(
    t,
    multiBatchFixture(),
    {},
    {
      gated: true,
      initialJob: {
        nextBatchIndex: 1,
        stagedNoteCount: 100,
      },
    },
  );
  await harness.start();
  await harness.releaseNext("POST");

  // The next batch is still pending: progress must come from the begin response.
  assert.equal(harness.pendingRequests[0].method, "PUT");
  assert.equal(harness.pendingRequests[0].payload.batchIndex, 1);
  assert.match(text(harness.render()), /Uploading your vocabulary… 50%/);
  const resumed = progressBar(harness, "Deck upload progress");
  assert.equal(resumed.props.value / resumed.props.max, 0.5);
  assertReceived(harness, 100, 0, 0);
  assert.equal(harness.job.addedCount, 0);
  assert.equal(harness.job.importedProgressCount, 0);

  await harness.releaseNext("PUT");
  assert.match(text(harness.render()), /Finishing your import…/);
  assertReceived(harness, 101, 2, 2);
  await harness.releaseNext("POST");
  assert.equal(harness.job.status, "completed");
  assert.equal(harness.calls.filter((call) => call.method === "PUT").length, 1);
});

test("a paused import keeps received progress and resumes from authoritative server state", async (t) => {
  const harness = await setup(t, multiBatchFixture(), undefined, {
    gated: true,
  });
  await harness.change("I confirm the words", true);
  await harness.start();
  await harness.releaseNext("POST");
  await harness.releaseNext("PUT");
  await harness.rejectNext("PUT", new Error("The connection was interrupted."));
  assert.match(text(harness.render()), /Your progress is saved/);
  assertReceived(harness, 100, 0, 0);
  const paused = progressBar(harness, "Deck upload progress");
  assert.equal(paused.props.value / paused.props.max, 0.5);

  await harness.start();
  assert.equal(harness.pendingRequests[0].method, "GET");
  // The failed response can hide a batch that the server actually received.
  await harness.releaseNext("GET", {
    nextBatchIndex: 2,
    stagedNoteCount: 101,
    stagedCardCount: 2,
    stagedReviewCount: 2,
  });
  assertReceived(harness, 101, 2, 2);
  assert.match(text(harness.render()), /Finishing your import…/);
  assert.equal(harness.calls.filter((call) => call.method === "PUT").length, 2);
  assert(harness.pendingRequests[0].path.endsWith("/commit"));
  await harness.releaseNext("POST");
  assert.equal(harness.job.status, "completed");
});
