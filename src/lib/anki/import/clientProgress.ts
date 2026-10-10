import type { StudyCardTemplateKey } from "@/lib/review/templates";
import type { NoteTypeMapping } from "./mapping";
import { unsupportedNoteTypeReason } from "./mapping";
import { convertAnkiProgress } from "./progress";
import type { AnkiCard, AnkiNote, AnkiPackage } from "./readerTypes";
import {
  duplicateAnkiStudyTemplates,
  resolveAnkiStudyTemplate,
} from "./templateMapping";

export function isValidSchedulingTimeZone(value: string): boolean {
  if (!value.trim() || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function defaultSchedulingTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isValidSchedulingTimeZone(zone) ? zone : "UTC";
  } catch {
    return "UTC";
  }
}

export type ImportProgressPreview = {
  studiedCount: number;
  matchedCount: number;
  unsupportedCount: number;
  unmatchedTemplates: {
    modelId: string;
    modelName: string;
    ord: number;
    templateName: string;
    count: number;
  }[];
  duplicateMappings: {
    modelId: string;
    modelName: string;
    templateKeys: StudyCardTemplateKey[];
  }[];
};

export function previewImportProgress(
  pkg: Pick<AnkiPackage, "models" | "collection">,
  content: { notes: AnkiNote[]; cards: AnkiCard[] },
  mapping: NoteTypeMapping[],
  timeZone: string,
  now = new Date(),
): ImportProgressPreview {
  const models = new Map(pkg.models.map((model) => [model.id, model]));
  const mappings = new Map(mapping.map((value) => [value.modelId, value]));
  const notes = new Map(content.notes.map((note) => [note.id, note]));
  const includedModels = new Set(
    content.notes.flatMap((note) => {
      const model = models.get(note.modelId);
      const value = model && mappings.get(model.id);
      return model && value && !value.skip && !unsupportedNoteTypeReason(model)
        ? [model.id]
        : [];
    }),
  );
  const duplicateMappings = pkg.models.flatMap((model) => {
    const value = mappings.get(model.id);
    if (!value || !includedModels.has(model.id)) return [];
    const templateKeys = duplicateAnkiStudyTemplates(model, value);
    return templateKeys.length
      ? [{ modelId: model.id, modelName: model.name, templateKeys }]
      : [];
  });
  const unmatched = new Map<
    string,
    ImportProgressPreview["unmatchedTemplates"][number]
  >();
  let studiedCount = 0;
  let matchedCount = 0;
  let unsupportedCount = 0;
  for (const card of content.cards) {
    // A reset Anki card can retain historical repetitions while being new.
    if (card.type <= 0) continue;
    studiedCount++;
    const note = notes.get(card.nid);
    const model = note && models.get(note.modelId);
    const value = model && mappings.get(model.id);
    const key =
      model && value && includedModels.has(model.id)
        ? resolveAnkiStudyTemplate(model, value, card.ord)
        : null;
    if (!key) {
      const identity = `${model?.id ?? "unknown"}:${card.ord}`;
      const existing = unmatched.get(identity);
      if (existing) existing.count++;
      else
        unmatched.set(identity, {
          modelId: model?.id ?? "unknown",
          modelName: model?.name ?? "Unknown note type",
          ord: card.ord,
          templateName:
            model?.templates.find((template) => template.ord === card.ord)
              ?.name ?? `Card type ${card.ord + 1}`,
          count: 1,
        });
      continue;
    }
    if (
      convertAnkiProgress(card, { collection: pkg.collection, timeZone, now })
    ) {
      matchedCount++;
    } else {
      unsupportedCount++;
    }
  }
  return {
    studiedCount,
    matchedCount,
    unsupportedCount,
    unmatchedTemplates: [...unmatched.values()],
    duplicateMappings,
  };
}
