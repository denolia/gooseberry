import { TranslationResponse } from "@/app/utils/translationSchema";
import { AnkiNote } from "@/app/utils/ankiSchema";

/**
 * Converts a translation from history to word_set_item fields
 * Used when initially adding translation items to a word set
 */
export function mapTranslationToWordSetItem(
  translation: TranslationResponse,
  translationHistoryId: string,
): {
  original: string;
  translation: string;
  wordForms: string;
  sample: string;
  sampleTranslation: string;
  comments: string;
  tags: string;
  sourceTranslationId: string;
} {
  const {
    original,
    translation: trans,
    details,
    example_usage,
    type,
  } = translation;

  // Field 1: Original (with article for nouns)
  let originalField = original;
  if (type === "noun" && details.article) {
    originalField = `${details.article} ${original}`;
  }

  // Field 2: Translation
  const translationField = trans;

  // Field 3: Word forms (intelligent combination based on type)
  let wordFormsField = "";

  if (type === "verb" && details.verb_forms) {
    const { infinitive, third_person, preterite, perfect } = details.verb_forms;
    const forms = [infinitive, third_person, preterite, perfect].filter(
      (f) => f && f !== "-",
    );
    if (forms.length > 0) {
      wordFormsField = forms.join(" * ");
    }
  } else if (type === "noun") {
    const parts: string[] = [];
    if (details.article) parts.push(details.article);
    if (details.plural && details.plural !== "-")
      parts.push(`Pl: ${details.plural}`);
    if (details.genitive && details.genitive !== "-")
      parts.push(`Gen: ${details.genitive}`);
    wordFormsField = parts.join(", ");
  }

  // Field 4 & 5: Sample and Sample translation
  // Combine example_usage, common_phrases, idioms, verb_preposition_case, verb_noun
  const allSamples: Array<{ sample: string; sample_translation: string }> = [];

  if (example_usage) allSamples.push(...example_usage);

  const sampleField = allSamples.map((s) => s.sample).join("; ");
  const sampleTranslationField = allSamples
    .map((s) => s.sample_translation)
    .join("; ");

  // Field 6: Comments (combine relevant metadata)
  const commentParts: string[] = [];
  if (
    details.alternative_translations &&
    details.alternative_translations.length > 0
  ) {
    commentParts.push(`Alt: ${details.alternative_translations.join(", ")}`);
  }
  if (details.usage_frequency) {
    commentParts.push(`Freq: ${details.usage_frequency}`);
  }
  if (details.stylistic_kind) {
    commentParts.push(`Style: ${details.stylistic_kind}`);
  }
  if (details.sentence_grammatical_analysis) {
    commentParts.push(details.sentence_grammatical_analysis);
  }
  if (details.comments) {
    commentParts.push(details.comments);
  }
  const commentsField = commentParts.join(" | ");

  // Field 7: Tags (type)
  const tagsField = type || "other";

  return {
    original: originalField,
    translation: translationField,
    wordForms: wordFormsField,
    sample: sampleField,
    sampleTranslation: sampleTranslationField,
    comments: commentsField,
    tags: tagsField,
    sourceTranslationId: translationHistoryId,
  };
}

/**
 * Converts a word_set_item to an AnkiNote for export
 * Used when generating the .apkg file
 */
export function mapWordSetItemToAnkiNote(
  item: {
    id: string;
    ankiNoteGuid: string;
    original: string;
    translation: string;
    wordForms: string;
    sample: string;
    sampleTranslation: string;
    comments: string;
    tags: string;
  },
  includeSourceId?: boolean,
): AnkiNote {
  return {
    original: item.original,
    translation: item.translation,
    wordForms: item.wordForms,
    sample: item.sample,
    sampleTranslation: item.sampleTranslation,
    comments: item.comments,
    tags: item.tags,
    sourceId: includeSourceId ? item.id : "",
    guid: item.ankiNoteGuid,
  };
}
