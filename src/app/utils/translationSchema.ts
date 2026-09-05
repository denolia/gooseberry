import { z } from "zod";

const LanguageVariantSchema = z.enum([
  "standard",
  "colloquial",
  "register-neutral",
]);

const BaseTranslationDetailsSchema = z.object({
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

const BaseExampleUsageSchema = z.object({
  sample: z.string(),
  sample_translation: z.string(),
});

export const BaseTranslationResponseSchema = z.object({
  original: z.string(), // The original German sentence
  type: z
    .enum(["noun", "verb", "adjective", "adverb", "sentence", "other"])
    .nullable(),
  translation: z.string(), // The natural Russian translation
  details: BaseTranslationDetailsSchema,
  example_usage: z.array(BaseExampleUsageSchema).nullable(),
});

export const FinnishTranslationResponseSchema =
  BaseTranslationResponseSchema.extend({
    details: BaseTranslationDetailsSchema.extend({
      language_variant: LanguageVariantSchema.nullable(),
      standard_form: z.string().nullable(),
      colloquial_form: z.string().nullable(),
    }),
    example_usage: z
      .array(
        BaseExampleUsageSchema.extend({
          language_variant: LanguageVariantSchema.nullable(),
        }),
      )
      .nullable(),
  });

// The application-level schema accepts both base and Finnish responses. Finnish-only
// fields stay optional so translations saved before their introduction remain valid.
export const TranslationResponseSchema = BaseTranslationResponseSchema.extend({
  details: BaseTranslationDetailsSchema.extend({
    language_variant: LanguageVariantSchema.nullable().optional(),
    standard_form: z.string().nullable().optional(),
    colloquial_form: z.string().nullable().optional(),
  }),
  example_usage: z
    .array(
      BaseExampleUsageSchema.extend({
        language_variant: LanguageVariantSchema.nullable().optional(),
      }),
    )
    .nullable(),
});

// TypeScript type
export type TranslationResponse = z.infer<typeof TranslationResponseSchema>;
