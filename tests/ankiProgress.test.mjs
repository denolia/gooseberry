import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "@typescript/typescript6";

const requireExternal = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../src/", import.meta.url));
const cache = new Map();
function load(name, parent = root) {
  const filename = name.startsWith("@/")
    ? path.join(root, `${name.slice(2)}.ts`)
    : name.startsWith(".")
      ? path.resolve(parent, `${name}.ts`)
      : null;
  if (!filename) return requireExternal(name);
  if (cache.has(filename)) return cache.get(filename);
  const exports = {};
  cache.set(filename, exports);
  const code = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  new Function("require", "exports", code)(
    (dependency) => load(dependency, path.dirname(filename)),
    exports,
  );
  return exports;
}
const { convertAnkiProgress, ankiDayDueDate } = load(
  "@/lib/anki/import/progress",
);
const { resolveAnkiStudyTemplate, duplicateAnkiStudyTemplates } = load(
  "@/lib/anki/import/templateMapping",
);
const { applyReview } = load("@/lib/review/fsrs");
const { BeginImportSchema, validateImportMapping } = load(
  "@/lib/anki/import/schemas",
);
const context = {
  collection: {
    creationTime: 1738638000,
    config: { schedVer: 2, creationOffset: -120 },
    raw: {},
  },
  timeZone: "Europe/Berlin",
  now: new Date("2026-10-10T12:00:00Z"),
};
const card = (extra = {}) => ({
  id: "1",
  nid: "2",
  did: "3",
  ord: 0,
  mod: 1791388800,
  usn: 0,
  type: 2,
  queue: 2,
  due: 610,
  ivl: 37,
  factor: 2500,
  reps: 11,
  lapses: 2,
  left: 0,
  odue: 0,
  odid: "0",
  flags: 0,
  data: '{"lrt":1791360000}',
  ...extra,
});
const field = (ord) => ({ fields: [ord], separator: " " });
const mapping = {
  modelId: "1",
  original: field(0),
  translation: field(1),
  wordForms: field(2),
  examples: [{ sample: field(3), translation: field(4) }],
};
const model = {
  id: "1",
  name: "Words",
  type: 0,
  css: "",
  raw: {},
  fields: [
    "Word",
    "Meaning",
    "Forms",
    "Example",
    "Example Meaning",
    "Sound",
    "Hint",
  ].map((name, ord) => ({ name, ord, raw: {} })),
  templates: [
    {
      ord: 0,
      name: "Front",
      questionFormat: "{{Sound}}{{Word}}",
      answerFormat: "{{FrontSide}}{{Meaning}}",
      raw: {},
    },
    {
      ord: 1,
      name: "Back",
      questionFormat: "{{Meaning}}{{type:Word}}{{Hint}}",
      answerFormat: "{{type:Word}}",
      raw: {},
    },
  ],
};

test("source card ordinals map by fields and typed answer semantics, ignoring audio/hints", () => {
  assert.equal(resolveAnkiStudyTemplate(model, mapping, 0), "recognition");
  assert.equal(resolveAnkiStudyTemplate(model, mapping, 1), "type_answer");
  assert.equal(
    resolveAnkiStudyTemplate(
      model,
      {
        ...mapping,
        exerciseTemplates: [{ ord: 1, templateKey: "production" }],
      },
      1,
    ),
    "production",
  );
  assert.equal(
    resolveAnkiStudyTemplate(
      model,
      { ...mapping, exerciseTemplates: [{ ord: 0, templateKey: null }] },
      0,
    ),
    null,
  );
  assert.equal(resolveAnkiStudyTemplate(model, mapping, 99), null);
});

test("native prompt/answer blocks separate exercise targets from context and language labels", () => {
  const examples = [
    [
      "recognition",
      '{{Source Language}}<div class="prompt">{{Word}}</div>',
      '<div class="answer">{{Meaning}}</div>{{Forms}}',
    ],
    [
      "production",
      '{{Source Language}}<div class="prompt">{{Meaning}}</div>',
      '<div class="answer">{{Word}}</div>{{Forms}}',
    ],
    [
      "word_forms",
      '<div class="prompt">{{Word}}</div>{{Meaning}}',
      '<div class="answer">{{Forms}}</div>{{Example}}',
    ],
    [
      "example",
      '{{Meaning}}<div class="prompt example">{{Example Meaning}}</div>',
      '<div class="answer">{{Word}}</div>{{Example}}',
    ],
    [
      "type_answer",
      '<div class="prompt">{{Meaning}}</div>{{type:Word}}',
      "{{type:Word}}{{Forms}}",
    ],
  ];
  for (const [expected, questionFormat, answerFormat] of examples) {
    assert.equal(
      resolveAnkiStudyTemplate(
        {
          ...model,
          templates: [{ ...model.templates[0], questionFormat, answerFormat }],
        },
        mapping,
        0,
      ),
      expected,
    );
  }
  assert.equal(
    resolveAnkiStudyTemplate(
      {
        ...model,
        templates: [
          { ...model.templates[0], questionFormat: "{{Word}} {{Meaning}}" },
        ],
      },
      mapping,
      0,
    ),
    null,
  );
});

test("multiple source templates cannot silently share one native schedule", () => {
  const duplicate = {
    ...model,
    templates: [model.templates[0], { ...model.templates[0], ord: 1 }],
  };
  assert.deepEqual(duplicateAnkiStudyTemplates(duplicate, mapping), [
    "recognition",
  ]);
  assert.throws(
    () =>
      validateImportMapping({
        mapping: [mapping],
        importProgress: true,
        packageMetadata: { models: [duplicate] },
      }),
    /at most one/,
  );
  assert.doesNotThrow(() =>
    validateImportMapping({
      mapping: [mapping],
      importProgress: false,
      packageMetadata: { models: [duplicate] },
    }),
  );
  assert.throws(
    () =>
      validateImportMapping({
        mapping: [
          {
            ...mapping,
            exerciseTemplates: [{ ord: 99, templateKey: "recognition" }],
          },
        ],
        packageMetadata: { models: [model] },
      }),
    /unknown/,
  );
  assert.equal(
    BeginImportSchema.shape.schedulingTimeZone.safeParse("Not/AZone").success,
    false,
  );
});

test("day coordinates use source creation wall date, local rollover, and daylight saving time", () => {
  assert.equal(
    ankiDayDueDate(598, context).toISOString(),
    "2026-09-25T02:00:00.000Z",
  );
  assert.equal(
    ankiDayDueDate(610, context).toISOString(),
    "2026-10-07T02:00:00.000Z",
  );
  assert.equal(
    ankiDayDueDate(640, context).toISOString(),
    "2026-11-06T03:00:00.000Z",
  );
  assert.equal(
    ankiDayDueDate(643, context).toISOString(),
    "2026-11-09T03:00:00.000Z",
  );
  const v1 = {
    ...context,
    collection: { ...context.collection, config: { schedVer: 1 } },
  };
  assert.equal(
    ankiDayDueDate(1, v1).getTime(),
    context.collection.creationTime * 1000 + 86400000,
  );
  assert.equal(
    ankiDayDueDate(1, {
      ...v1,
      collection: { ...v1.collection, config: {} },
    }).getTime(),
    ankiDayDueDate(1, v1).getTime(),
  );
});

test("SM2 progress keeps the source due date, interval and counters and continues as mature FSRS", () => {
  const converted = convertAnkiProgress(card(), context);
  assert.equal(converted.method, "anki-sm2");
  assert.equal(converted.state.state, 2);
  assert.equal(converted.state.dueAt.toISOString(), "2026-10-07T02:00:00.000Z");
  assert.equal(converted.state.scheduledDays, 37);
  assert.equal(converted.state.reps, 11);
  assert.equal(converted.state.lapses, 2);
  assert.equal(converted.state.stability, 37);
  const next = applyReview(converted.state, 3, context.now);
  assert.equal(next.reps, 12);
  assert.equal(next.lapses, 2);
  assert.equal(next.state, 2);
  assert.ok(
    next.scheduledDays > 37,
    "a successful mature card should not restart the learning steps",
  );
});

test("implausible source counters cannot overflow after a native review", () => {
  assert.equal(
    convertAnkiProgress(card({ reps: 2_147_483_647 }), context),
    null,
  );
  assert.equal(
    convertAnkiProgress(card({ lapses: 2_147_483_647 }), context),
    null,
  );
  const converted = convertAnkiProgress(
    card({ reps: 1_000_000, lapses: 999_999 }),
    context,
  );
  const next = applyReview(converted.state, 1, context.now);
  assert.equal(next.reps, 1_000_001);
  assert.equal(next.lapses, 1_000_000);
});

test("stored Anki FSRS memory is retained instead of replacing it with SM2 estimates", () => {
  const converted = convertAnkiProgress(
    card({ data: '{"s":48.5,"d":6.2,"lrt":1791360000}' }),
    context,
  );
  assert.equal(converted.method, "anki-fsrs");
  assert.equal(converted.state.stability, 48.5);
  assert.equal(converted.state.difficulty, 6.2);
  assert.equal(converted.state.lastReviewAt.getTime(), 1791360000000);
  const invalid = convertAnkiProgress(
    card({ data: '{"s":1e-300,"d":1}' }),
    context,
  );
  assert.equal(invalid.method, "anki-sm2");
  assert.ok(applyReview(invalid.state, 3, context.now).stability > 0);
});

test("learning and filtered cards use the proper due units and restore original scheduling", () => {
  const due = Math.floor(context.now.getTime() / 1000) + 600;
  const learning = convertAnkiProgress(
    card({ type: 1, queue: 1, due, ivl: 0, left: 1001 }),
    context,
  );
  assert.equal(learning.state.dueAt.getTime(), due * 1000);
  assert.equal(learning.state.state, 1);
  assert.equal(learning.state.learningSteps, 1);
  const dayLearn = convertAnkiProgress(
    card({ type: 3, queue: 3, due: 640, left: 1001 }),
    context,
  );
  assert.equal(dayLearn.state.dueAt.toISOString(), "2026-11-06T03:00:00.000Z");
  assert.equal(dayLearn.state.state, 3);
  const filtered = convertAnkiProgress(
    card({ queue: 4, due, odid: "456", odue: 640 }),
    context,
  );
  assert.equal(filtered.state.dueAt.toISOString(), "2026-11-06T03:00:00.000Z");
});

test("new/reset cards remain new and source suspension/bury state is retained separately", () => {
  const fresh = convertAnkiProgress(
    card({ type: 0, queue: 0, reps: 999, due: 5 }),
    context,
  );
  assert.equal(fresh.state.state, 0);
  assert.equal(fresh.state.reps, 0);
  assert.equal(fresh.state.dueAt.getTime(), context.now.getTime());
  assert.equal(
    convertAnkiProgress(card({ queue: -1 }), context).isSuspended,
    true,
  );
  const buried = convertAnkiProgress(
    card({ queue: -3, mod: Math.floor(context.now.getTime() / 1000) }),
    context,
  );
  assert.equal(buried.buriedUntil.toISOString(), "2026-10-11T02:00:00.000Z");
  assert.ok(
    convertAnkiProgress(card({ queue: -2, mod: 1738638000 }), context)
      .buriedUntil < context.now,
    "an old export must not restart a one-day bury period",
  );
});

test("incomplete histories use a stable interval anchor and invalid source schedules are rejected", () => {
  const converted = convertAnkiProgress(
    card({ data: "garbage" }),
    context,
    9007199254741001,
  );
  assert.equal(
    converted.state.lastReviewAt.getTime(),
    converted.state.dueAt.getTime() - 37 * 86400000,
  );
  assert.equal(convertAnkiProgress(card({ reps: -1 }), context), null);
  assert.equal(convertAnkiProgress(card({ type: 9 }), context), null);
  assert.equal(convertAnkiProgress(card({ queue: 99 }), context), null);
  assert.equal(convertAnkiProgress(card({ due: -5000000 }), context), null);
});
