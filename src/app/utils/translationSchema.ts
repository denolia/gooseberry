import { z } from "zod";

const TranslationDetailsSchema = z.object({
  article: z.string().optional(),

  plural: z.string().optional(),
  genitive: z.string().optional(),
  verb_forms: z
    .object({
      infinitive: z.string(),
      third_person: z.string(),
      preterite: z.string(),
      perfect: z.string(),
    })
    .optional(),
  alternative_translations: z.array(z.string()).optional(),
  common_phrases: z
    .array(
      z.object({
        sample: z.string(),
        sample_translation: z.string(),
      }),
    )
    .optional(),
  idioms: z
    .array(
      z.object({
        sample: z.string(),
        sample_translation: z.string(),
      }),
    )
    .optional(),
  usage_frequency: z.enum(["✅", "⚠️", "❌"]).optional(),

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
    .optional(), // Stylistic classification
  sentence_grammatical_analysis: z.string().optional(), // Sentence analysis
});

export const TranslationResponseSchema = z.object({
  original: z.string(), // The original German sentence
  type: z
    .enum(["noun", "verb", "adjective", "adverb", "sentence", "other"])
    .optional(),
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
    .optional(),
});

// TypeScript type
export type TranslationResponse = z.infer<typeof TranslationResponseSchema>;
