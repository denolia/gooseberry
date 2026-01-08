import { z } from "zod";

const TranslationDetailsSchema = z.object({
  article: z.string().nullable(),

  plural: z.string().nullable(),
  genitive: z.string().nullable(),
  verb_forms: z
    .object({
      infinitive: z.string(),
      third_person: z.string(),
      preterite: z.string(),
      perfect: z.string(),
    })
    .nullable(),
  verb_preposition_case: z
    .array(
      z.object({
        sample: z.string(),
        sample_translation: z.string(),
      }),
    )
    .nullable(),
  verb_noun: z
    .array(
      z.object({
        sample: z.string(),
        sample_translation: z.string(),
      }),
    )
    .nullable(),
  alternative_translations: z.array(z.string()).nullable(),
  common_phrases: z
    .array(
      z.object({
        sample: z.string(),
        sample_translation: z.string(),
      }),
    )
    .nullable(),
  idioms: z
    .array(
      z.object({
        sample: z.string(),
        sample_translation: z.string(),
      }),
    )
    .nullable(),
  usage_frequency: z.enum(["✅", "⚠️", "❌"]).nullable(),

  stylistic_kind: z
    .enum([
      "formal",
      "informal",
      "neutral",
      "rude",
      "poetic",
      "technical",
      "archaic",
    ])
    .nullable(), // Stylistic classification
  sentence_grammatical_analysis: z.string().nullable(), // Sentence analysis
  comments: z.string().nullable(), // Additional comments
});

export const TranslationResponseSchema = z.object({
  original: z.string(), // The original German sentence
  type: z
    .enum(["noun", "verb", "adjective", "adverb", "sentence", "other"])
    .nullable(),
  translation: z.string(), // The natural Russian translation
  details: TranslationDetailsSchema,
  example_usage: z
    .array(
      // Optional additional example usages if needed
      z.object({
        sample: z.string(),
        sample_translation: z.string(),
      }),
    )
    .nullable(),
});

// TypeScript type
export type TranslationResponse = z.infer<typeof TranslationResponseSchema>;
