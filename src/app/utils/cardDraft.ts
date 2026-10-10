import { z } from "zod";

export const CardFieldsSchema = z.object({
  original: z.string().trim().min(1).max(10000),
  translation: z.string().trim().min(1).max(10000),
  wordForms: z.string().max(20000),
  sample: z.string().max(50000),
  sampleTranslation: z.string().max(50000),
  comments: z.string().max(50000),
  tags: z.string().max(2000),
});
export type CardFields = z.infer<typeof CardFieldsSchema>;
export type CardDraft = Omit<CardFields, "sample" | "sampleTranslation"> & {
  examples: { sample: string; translation: string }[];
};

export function draftFromFields(
  fields: CardFields & {
    examplePairs?: { sample: string; translation: string }[];
  },
): CardDraft {
  const samples = fields.sample ? fields.sample.split("; ") : [];
  const translations = fields.sampleTranslation
    ? fields.sampleTranslation.split("; ")
    : [];
  return {
    ...fields,
    examples: fields.examplePairs?.length
      ? fields.examplePairs.map((pair) => ({ ...pair }))
      : Array.from(
          { length: Math.max(samples.length, translations.length) },
          (_, i) => ({
            sample: samples[i] ?? "",
            translation: translations[i] ?? "",
          }),
        ),
  };
}

// Imported examples are explicit pairs, never reconstructed from punctuation.
// Native study uses the first complete pair and retains the rest for editing.
export function studyFieldsFromDraft(draft: CardDraft) {
  const pair = draft.examples.find(
    (example) => example.sample.trim() && example.translation.trim(),
  );
  return {
    ...fieldsFromDraft(draft),
    sample: pair?.sample ?? draft.examples[0]?.sample ?? "",
    sampleTranslation:
      pair?.translation ?? draft.examples[0]?.translation ?? "",
    examplePairs: draft.examples,
  };
}

export function fieldsFromDraft(draft: CardDraft): CardFields {
  return {
    original: draft.original,
    translation: draft.translation,
    wordForms: draft.wordForms,
    comments: draft.comments,
    tags: draft.tags,
    sample: draft.examples.map((e) => e.sample).join("; "),
    sampleTranslation: draft.examples.map((e) => e.translation).join("; "),
  };
}
