import type { AnkiNoteType } from "./readerTypes";
import type { FieldMapping, NoteTypeMapping } from "./mapping";
import type { StudyCardTemplateKey } from "@/lib/review/templates";

const resolvedTemplates = new WeakMap<
  AnkiNoteType,
  WeakMap<NoteTypeMapping, Map<number, StudyCardTemplateKey | null>>
>();

// Template ordinals are local to a note type. Never assume that Anki's second
// card means production: many vocabulary decks use a typed answer instead.
export function resolveAnkiStudyTemplate(
  model: AnkiNoteType,
  mapping: NoteTypeMapping,
  ord: number,
): StudyCardTemplateKey | null {
  const explicit = mapping.exerciseTemplates?.find(
    (entry) => entry.ord === ord,
  );
  if (explicit) return explicit.templateKey;
  // Field selections are immutable in the importer. Cache only inference;
  // explicit progress choices are read directly on every call.
  let modelCache = resolvedTemplates.get(model);
  if (!modelCache) resolvedTemplates.set(model, (modelCache = new WeakMap()));
  let mappingCache = modelCache.get(mapping);
  if (!mappingCache) modelCache.set(mapping, (mappingCache = new Map()));
  if (mappingCache.has(ord)) return mappingCache.get(ord)!;
  const result = inferAnkiStudyTemplate(model, mapping, ord);
  mappingCache.set(ord, result);
  return result;
}

function inferAnkiStudyTemplate(
  model: AnkiNoteType,
  mapping: NoteTypeMapping,
  ord: number,
): StudyCardTemplateKey | null {
  const template = model.templates.find((entry) => entry.ord === ord);
  if (!template || model.type !== 0 || mapping.skip) return null;
  const fields = new Map(model.fields.map((field) => [field.name, field.ord]));
  const tokens = (format: string) =>
    [
      ...format
        .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
        .replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
        .matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g),
    ]
      .filter((match) => !/^[#^/]/.test(match[1]))
      .map((match) => {
        const parts = match[1].split(":").map((part) => part.trim());
        return {
          ord: fields.get(parts.at(-1)!),
          typed: parts.includes("type"),
        };
      })
      .filter((token) => token.ord !== undefined);
  const primaryBlock = (format: string, className: string) =>
    format.match(
      new RegExp(
        `<([a-z][a-z0-9]*)\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1\\s*>`,
        "i",
      ),
    )?.[2];
  const mainPrompt = primaryBlock(template.questionFormat, "prompt");
  const question = tokens(mainPrompt ?? template.questionFormat);
  const allQuestion = tokens(template.questionFormat);
  const answer = tokens(template.answerFormat);
  const mainAnswer = primaryBlock(template.answerFormat, "answer");
  const primaryAnswer = mainAnswer ? tokens(mainAnswer) : answer;
  // A typed placeholder represents the answer, not a revealed prompt field.
  const contains = (
    selection: FieldMapping | undefined,
    ordinal: number | undefined,
  ) => ordinal !== undefined && !!selection?.fields.includes(ordinal);
  const mappedFields = [
    mapping.original,
    mapping.translation,
    mapping.wordForms,
    ...(mapping.examples ?? []).flatMap((pair) => [
      pair.sample,
      pair.translation,
    ]),
  ];
  const prompt = question.find(
    (token) =>
      !token.typed &&
      mappedFields.some((selection) => contains(selection, token.ord)),
  )?.ord;
  if (
    !mainPrompt &&
    question.some(
      (token) => !token.typed && contains(mapping.original, token.ord),
    ) &&
    question.some(
      (token) => !token.typed && contains(mapping.translation, token.ord),
    )
  )
    return null;
  const answers = (selection: FieldMapping | undefined) =>
    answer.some((token) => contains(selection, token.ord));
  const typesSource = allQuestion.some(
    (token) => token.typed && contains(mapping.original, token.ord),
  );
  if (contains(mapping.translation, prompt) && answers(mapping.original))
    return typesSource ? "type_answer" : "production";
  const firstAnswer = primaryAnswer.find((token) =>
    mappedFields.some((selection) => contains(selection, token.ord)),
  )?.ord;
  if (
    contains(mapping.original, prompt) &&
    contains(mapping.wordForms, firstAnswer)
  )
    return "word_forms";
  if (contains(mapping.original, prompt) && answers(mapping.translation))
    return "recognition";
  if (
    mapping.examples?.some(
      (pair) => contains(pair.translation, prompt) && answers(pair.sample),
    )
  )
    return "example";
  return null;
}

export function duplicateAnkiStudyTemplates(
  model: AnkiNoteType,
  mapping: NoteTypeMapping,
): StudyCardTemplateKey[] {
  const seen = new Set<StudyCardTemplateKey>();
  const duplicates = new Set<StudyCardTemplateKey>();
  for (const template of model.templates) {
    const key = resolveAnkiStudyTemplate(model, mapping, template.ord);
    if (!key) continue;
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates];
}
