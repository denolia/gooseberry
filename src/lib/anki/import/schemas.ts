import { z } from "zod";
import {
  isSourceLanguageCode,
  isTargetLanguageCode,
} from "@/components/ui/Languages";
import type { NoteTypeMapping } from "./mapping";
import type { AnkiPackage } from "./readerTypes";
import { STUDY_CARD_TEMPLATE_KEYS } from "@/lib/review/templates";
import { duplicateAnkiStudyTemplates } from "./templateMapping";

export const IMPORT_BODY_LIMIT = 3 * 1024 * 1024;
export const IMPORT_NOTE_LIMIT = 20000;
export const IMPORT_CARD_LIMIT = 100000;
export const IMPORT_REVIEW_LIMIT = 1000000;
export const IMPORT_BATCH_LIMIT = 2000;
export const IMPORT_TEXT_BYTE_LIMIT = 64 * 1024 * 1024;
// The current library endpoint returns a whole set. Until it is paginated,
// conservatively bound visible content before publishing an imported set.
export const IMPORT_VISIBLE_BYTE_LIMIT = 3 * 1024 * 1024;
const sourceId = z.string().regex(/^\d{1,30}$/);
const raw = z.record(z.string(), z.json());
const fieldMapping = z.object({
  fields: z.array(z.number().int().min(0).max(99)).max(100),
  separator: z.string().max(50).default("\n"),
});
export const NoteTypeMappingSchema = z.object({
  modelId: sourceId,
  skip: z.boolean().default(false),
  original: fieldMapping,
  translation: fieldMapping,
  wordForms: fieldMapping.optional(),
  comments: fieldMapping.optional(),
  examples: z
    .array(z.object({ sample: fieldMapping, translation: fieldMapping }))
    .max(20)
    .optional(),
  exerciseTemplates: z
    .array(
      z.object({
        ord: z.number().int().min(0).max(100),
        templateKey: z.enum(STUDY_CARD_TEMPLATE_KEYS).nullable(),
      }),
    )
    .max(100)
    .optional(),
});
const modelSchema = z.object({
  id: sourceId,
  name: z.string().max(500),
  type: z.number().int(),
  fields: z
    .array(
      z.object({
        name: z.string().max(500),
        ord: z.number().int().min(0).max(99),
        raw,
      }),
    )
    .max(100),
  templates: z
    .array(
      z.object({
        name: z.string().max(500),
        ord: z.number().int().min(0).max(100),
        questionFormat: z.string().max(100000),
        answerFormat: z.string().max(100000),
        raw,
      }),
    )
    .max(100),
  css: z.string().max(100000),
  raw,
});
export const PackageMetadataSchema = z.object({
  packageVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  databaseFormat: z.enum(["legacy", "modern"]),
  schemaVersion: z.number().int(),
  models: z.array(modelSchema).max(100),
  decks: z
    .array(
      z.object({
        id: sourceId,
        name: z.string().max(500),
        configId: sourceId.nullable(),
        raw,
      }),
    )
    .max(5000),
  configs: z
    .array(z.object({ id: sourceId, name: z.string().max(500), raw }))
    .max(5000),
  collection: z.object({ creationTime: z.number(), config: raw, raw }),
  diagnostics: z.object({
    sourceBytes: z.number().int().nonnegative(),
    databaseBytes: z.number().int().nonnegative(),
    omittedMediaCount: z.number().int().nonnegative(),
    warnings: z.array(z.string().max(2000)).max(100),
  }),
});
export const BeginImportSchema = z.object({
  requestKey: z.string().uuid(),
  file: z.object({
    name: z.string().min(1).max(500),
    size: z
      .number()
      .int()
      .min(1)
      .max(200 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  name: z.string().trim().min(1).max(200),
  sourceLang: z.string().refine(isSourceLanguageCode),
  targetLang: z.string().refine(isTargetLanguageCode),
  targetSetId: z.string().uuid().optional(),
  importProgress: z.boolean().default(true),
  schedulingTimeZone: z
    .string()
    .max(100)
    .default("UTC")
    .refine((zone) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    }, "Choose a valid study timezone"),
  mapping: z.array(NoteTypeMappingSchema).min(1).max(100),
  packageMetadata: PackageMetadataSchema,
});
export type BeginImportInput = Omit<
  z.infer<typeof BeginImportSchema>,
  "mapping" | "packageMetadata"
> & {
  mapping: NoteTypeMapping[];
  packageMetadata: Omit<AnkiPackage, "notes" | "cards" | "revlogs">;
};
export const NoteSchema = z.object({
  id: sourceId,
  guid: z.string().min(1).max(255),
  modelId: sourceId,
  fields: z.array(z.string().max(50000)).max(100),
  tags: z.array(z.string().max(1000)).max(500),
  raw,
});
const number = z.number().finite();
export const CardSchema = z.object({
  id: sourceId,
  nid: sourceId,
  did: sourceId,
  ord: number,
  mod: number,
  usn: number,
  type: number,
  queue: number,
  due: number,
  ivl: number,
  factor: number,
  reps: number,
  lapses: number,
  left: number,
  odue: number,
  odid: sourceId,
  flags: number,
  data: z.string().max(100000),
});
export const RevlogSchema = z.object({
  id: sourceId,
  cid: sourceId,
  usn: number,
  ease: number,
  ivl: number,
  lastIvl: number,
  factor: number,
  time: number,
  type: number,
});
export const ImportBatchSchema = z
  .object({
    batchIndex: z
      .number()
      .int()
      .min(0)
      .max(IMPORT_BATCH_LIMIT - 1),
    notes: z.array(NoteSchema).max(200).default([]),
    cards: z.array(CardSchema).max(2000).default([]),
    revlogs: z.array(RevlogSchema).max(10000).default([]),
  })
  .refine(
    (batch) =>
      batch.notes.length + batch.cards.length + batch.revlogs.length > 0,
    "Empty batch",
  );
export type ImportBatchInput = z.infer<typeof ImportBatchSchema>;
export const CommitImportSchema = z.object({
  expectedBatchCount: z.number().int().min(1).max(IMPORT_BATCH_LIMIT),
  expectedNoteCount: z.number().int().min(1).max(IMPORT_NOTE_LIMIT),
});

export function validateImportMapping(input: BeginImportInput): void {
  const models = new Map(
    input.packageMetadata.models.map((model) => [model.id, model]),
  );
  if (models.size !== input.packageMetadata.models.length)
    throw new Error("Duplicate note type IDs");
  const seen = new Set<string>();
  for (const mapping of input.mapping) {
    if (seen.has(mapping.modelId))
      throw new Error("Duplicate note type mapping");
    seen.add(mapping.modelId);
    const model = models.get(mapping.modelId);
    if (!model) throw new Error("Mapping references an unknown note type");
    const templateOrdinals = new Set(
      model.templates.map((template) => template.ord),
    );
    const overrides = mapping.exerciseTemplates ?? [];
    if (
      new Set(overrides.map((entry) => entry.ord)).size !== overrides.length ||
      overrides.some((entry) => !templateOrdinals.has(entry.ord))
    ) {
      throw new Error(
        "Exercise mapping references an unknown or duplicate Anki template",
      );
    }
    if (
      input.importProgress &&
      !mapping.skip &&
      duplicateAnkiStudyTemplates(model, mapping).length
    ) {
      throw new Error(
        "Match each Gooseberry exercise to at most one Anki card type",
      );
    }
    const selections = [
      mapping.original,
      mapping.translation,
      mapping.wordForms,
      mapping.comments,
      ...(mapping.examples ?? []).flatMap((pair) => [
        pair.sample,
        pair.translation,
      ]),
    ];
    const ordinals = new Set(model.fields.map((field) => field.ord));
    if (
      selections.some((selection) =>
        selection?.fields.some((ordinal) => !ordinals.has(ordinal)),
      )
    ) {
      throw new Error("Mapping references an unknown source field");
    }
  }
}
