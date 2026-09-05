import {
  SourceLanguage,
  SourceLanguages,
  TargetLanguage,
  TargetLanguages,
} from "@/components/ui/Languages";

function getBasePrompt(
  sourceLanguage: SourceLanguage,
  targetLanguage: TargetLanguage,
) {
  return `You are a professional translator and language assistant specializing in ${sourceLanguage}-to-${targetLanguage} translation.

Return concise learner-focused JSON that matches the provided schema.
Use null for optional fields that are not relevant.
Put grammatically corrected source text into the "original" field and fix obvious punctuation mistakes.
All translations, explanations, comments, and "sample_translation" values must be written in ${targetLanguage}.
Keep source-language examples in ${sourceLanguage}.

1. For sentences:
   - Provide the natural translation.
   - Add stylistic information only when it changes the meaning or expected usage.
   - Provide one short grammatical note only when useful.
   - Leave word-specific fields null when they do not fit.

2. For single words or phrases:
   - Provide the most important translation and at most two alternatives with nuances.
   - Include idiomatic uses and common collocations only when central to the term.
   - Mark frequency if it is rare word (❌).
   - Keep comments to one short learner-relevant note.

3. Example sentences:
   - Provide at most three example_usage items.
   - Provide nested examples in details only when they add information not covered by example_usage.`;
}

function getLanguageSpecificGuidance(sourceLanguage: SourceLanguage) {
  switch (sourceLanguage) {
    case SourceLanguages.English:
      return "For English input, pay extra attention to tense, register, phrasal verbs, and common ambiguity.";
    case SourceLanguages.German:
      return "For German input, include fixed Verb-Noun combinations and Verb-Preposition-Case patterns when they are relevant.";
    case SourceLanguages.Norwegian:
    case SourceLanguages.Swedish:
    case SourceLanguages.Danish:
      return `For ${sourceLanguage} input, explain grammatical constructions clearly and call out particle verbs, word order, and common false friends with English or German when helpful.`;
    case SourceLanguages.Dutch:
      return "For Dutch input, highlight separable verbs, word order shifts, diminutives, and false friends with English or German when useful.";
    case SourceLanguages.Finnish:
      return 'For Finnish input, analyze Finnish on its own terms. Preserve the register of the source in "original": correct actual errors, but never normalize valid colloquial Finnish into standard Finnish. Set "details.language_variant" to "standard", "colloquial", or "register-neutral". For an inflected word, give its lemma and segment only learner-relevant endings, identifying case, number, possessive suffixes, and clitics; explain consonant gradation and vowel harmony when they are visible in the form. For verbs, identify person and number, tense, mood, voice, and any infinitive or participle form that applies, including the negative verb when relevant. Explain partitive versus total-object marking and local cases when they affect meaning. For standard input, put its common colloquial Finnish counterpart in "details.colloquial_form"; for colloquial input, put its standard Finnish counterpart in "details.standard_form". Store only the counterpart form in those fields, or null when there is no meaningful difference. When standard and common colloquial Finnish genuinely differ, include one matched pair in "example_usage" that expresses the same meaning: label one item "standard" and the other "colloquial" with "language_variant", and use the same natural target-language translation for both. Otherwise provide one "register-neutral" example and do not duplicate it.';
    case SourceLanguages.Hungarian:
      return "For Hungarian input, analyze Hungarian on its own terms. For an inflected word, give its lemma and segment only learner-relevant suffixes, identifying case, number, possessive or person markers, and clitics; explain vowel harmony and linking vowels when they are visible in the form. For verbs, identify person and number, tense, mood, definite versus indefinite conjugation, and verbal prefixes, noting prefix position and its aspectual or directional effect when relevant. Explain object marking, postpositions, focus-sensitive word order, and formal versus informal usage when they affect meaning. Avoid unnecessary comparisons to German or other languages.";
    case SourceLanguages.Spanish:
    case SourceLanguages.French:
    case SourceLanguages.Italian:
    case SourceLanguages.Portuguese:
      return `For ${sourceLanguage} input, pay close attention to gender, clitic pronouns, contractions, and verb tense or mood contrasts.`;
    case SourceLanguages.Polish:
    case SourceLanguages.Ukrainian:
      return `For ${sourceLanguage} input, explain aspect, case, declension patterns, and any stem changes that matter for learners.`;
    case SourceLanguages.Turkish:
      return "For Turkish input, explain agglutinative suffix chains, vowel harmony, evidential or modality nuances, and idiomatic postposition usage.";
    case SourceLanguages.Japanese:
      return "For Japanese input, include kanji readings when useful, explain particles and politeness level, and add brief romaji only when it helps disambiguate the form.";
    case SourceLanguages.Korean:
      return "For Korean input, explain speech level, verb ending nuances, particles, and any sound changes that affect pronunciation or recognition.";
    case SourceLanguages.Chinese:
      return "For Chinese input, include pinyin when useful, explain measure words and aspect particles, and note when a form is formal, colloquial, or regionally marked.";
    case SourceLanguages.Arabic:
      return "For Arabic input, note whether the phrasing appears Modern Standard Arabic or dialectal when that is inferable, and explain root-pattern structure or transliteration when helpful.";
    case SourceLanguages.Hindi:
      return "For Hindi input, explain gender agreement, postpositions, aspect or auxiliary usage, and add transliteration only when it clarifies the form.";
    default:
      return "";
  }
}

export const getTranslationPrompt = (
  sourceLanguage: SourceLanguage | undefined,
  targetLanguage: TargetLanguage | undefined,
) => {
  const currentSourceLanguage = sourceLanguage ?? SourceLanguages.German;
  const outputLanguage = targetLanguage ?? TargetLanguages.English;
  const languageSpecificGuidance = getLanguageSpecificGuidance(
    currentSourceLanguage,
  );

  return languageSpecificGuidance
    ? `${getBasePrompt(currentSourceLanguage, outputLanguage)}

${languageSpecificGuidance}`
    : getBasePrompt(currentSourceLanguage, outputLanguage);
};
