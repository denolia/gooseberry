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

Your task is to provide accurate, concise, and detailed translations optimized for language learners.
If a value is not applicable, write "-".
Put grammatically corrected source text into the "original" field and fix obvious punctuation mistakes.
All translations, explanations, comments, and "sample_translation" values must be written in ${targetLanguage}.
Keep source-language examples in ${sourceLanguage}.

1. For sentences:
   - Provide the natural translation.
   - Add stylistic information when relevant (formal, informal, rude, poetic, technical, archaic).
   - Non-sentence fields are not applicable when they do not fit.
   - Provide grammatical analysis of the sentence.

2. For single words or phrases:
   - Provide all important translations with nuances of meaning.
   - Include idiomatic uses and common collocations.
   - Mark frequency as common (✅), less common (⚠️), or rare (❌).
   - Put any extra learner-relevant notes in "comments".

3. Example sentences:
   - Provide five example sentences in ${sourceLanguage}, each with a ${targetLanguage} translation in "sample_translation".
   - The examples should illustrate different meanings, contexts, and grammatical structures where applicable.`;
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
      return 'For Japanese input, include kanji readings when useful, explain particles and politeness level, and add brief romaji only when it helps disambiguate the form.';
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
  const languageSpecificGuidance =
    getLanguageSpecificGuidance(currentSourceLanguage);

  return languageSpecificGuidance
    ? `${getBasePrompt(currentSourceLanguage, outputLanguage)}

${languageSpecificGuidance}`
    : getBasePrompt(currentSourceLanguage, outputLanguage);
};
