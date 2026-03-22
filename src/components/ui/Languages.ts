export const Languages = {
  German: "German",
  Norwegian: "Norwegian",
  English: "English",
  Spanish: "Spanish",
  French: "French",
  Italian: "Italian",
  Portuguese: "Portuguese",
  Dutch: "Dutch",
  Swedish: "Swedish",
  Danish: "Danish",
  Polish: "Polish",
  Turkish: "Turkish",
  Ukrainian: "Ukrainian",
  Japanese: "Japanese",
  Korean: "Korean",
  Chinese: "Chinese",
  Arabic: "Arabic",
  Hindi: "Hindi",
  Russian: "Russian",
} as const;

export const SourceLanguages = {
  German: Languages.German,
  Norwegian: Languages.Norwegian,
  English: Languages.English,
  Spanish: Languages.Spanish,
  French: Languages.French,
  Italian: Languages.Italian,
  Portuguese: Languages.Portuguese,
  Dutch: Languages.Dutch,
  Swedish: Languages.Swedish,
  Danish: Languages.Danish,
  Polish: Languages.Polish,
  Turkish: Languages.Turkish,
  Ukrainian: Languages.Ukrainian,
  Japanese: Languages.Japanese,
  Korean: Languages.Korean,
  Chinese: Languages.Chinese,
  Arabic: Languages.Arabic,
  Hindi: Languages.Hindi,
  Russian: Languages.Russian,
} as const;

export const TargetLanguages = {
  German: Languages.German,
  Norwegian: Languages.Norwegian,
  English: Languages.English,
  Spanish: Languages.Spanish,
  French: Languages.French,
  Italian: Languages.Italian,
  Portuguese: Languages.Portuguese,
  Dutch: Languages.Dutch,
  Swedish: Languages.Swedish,
  Danish: Languages.Danish,
  Polish: Languages.Polish,
  Turkish: Languages.Turkish,
  Ukrainian: Languages.Ukrainian,
  Japanese: Languages.Japanese,
  Korean: Languages.Korean,
  Chinese: Languages.Chinese,
  Arabic: Languages.Arabic,
  Hindi: Languages.Hindi,
  Russian: Languages.Russian,
} as const;

export const LanguageCodes = {
  [Languages.German]: "de",
  [Languages.Norwegian]: "no",
  [Languages.English]: "en",
  [Languages.Spanish]: "es",
  [Languages.French]: "fr",
  [Languages.Italian]: "it",
  [Languages.Portuguese]: "pt",
  [Languages.Dutch]: "nl",
  [Languages.Swedish]: "sv",
  [Languages.Danish]: "da",
  [Languages.Polish]: "pl",
  [Languages.Turkish]: "tr",
  [Languages.Ukrainian]: "uk",
  [Languages.Japanese]: "ja",
  [Languages.Korean]: "ko",
  [Languages.Chinese]: "zh",
  [Languages.Arabic]: "ar",
  [Languages.Hindi]: "hi",
  [Languages.Russian]: "ru",
} as const;

export type SourceLanguage =
  (typeof SourceLanguages)[keyof typeof SourceLanguages];
export type TargetLanguage =
  (typeof TargetLanguages)[keyof typeof TargetLanguages];
export type SourceLanguageCode = (typeof LanguageCodes)[SourceLanguage];
export type TargetLanguageCode = (typeof LanguageCodes)[TargetLanguage];

function sortLanguagesAlphabetically<T extends string>(languages: T[]) {
  return [...languages].sort((left, right) => left.localeCompare(right));
}

export const SourceLanguageOptions = sortLanguagesAlphabetically(
  Object.values(SourceLanguages),
);
export const TargetLanguageOptions = sortLanguagesAlphabetically(
  Object.values(TargetLanguages),
);
export const SourceLanguageCodeOptions = SourceLanguageOptions.map(
  (language) => LanguageCodes[language],
);
export const TargetLanguageCodeOptions = TargetLanguageOptions.map(
  (language) => LanguageCodes[language],
);

export const SourceLanguageSelectOptions = SourceLanguageOptions.map(
  (language) => ({
    label: language,
    value: LanguageCodes[language],
  }),
);

export const TargetLanguageSelectOptions = TargetLanguageOptions.map(
  (language) => ({
    label: language,
    value: LanguageCodes[language],
  }),
);

const sourceLanguageSet = new Set<SourceLanguage>(SourceLanguageOptions);
const targetLanguageSet = new Set<TargetLanguage>(TargetLanguageOptions);
const sourceLanguageCodeSet = new Set<SourceLanguageCode>(
  SourceLanguageCodeOptions,
);
const targetLanguageCodeSet = new Set<TargetLanguageCode>(
  TargetLanguageCodeOptions,
);

export function getLanguageCode(
  language: SourceLanguage | TargetLanguage,
): SourceLanguageCode | TargetLanguageCode {
  return LanguageCodes[language];
}

export function isSourceLanguage(value: unknown): value is SourceLanguage {
  return (
    typeof value === "string" && sourceLanguageSet.has(value as SourceLanguage)
  );
}

export function isTargetLanguage(value: unknown): value is TargetLanguage {
  return (
    typeof value === "string" && targetLanguageSet.has(value as TargetLanguage)
  );
}

export function isSourceLanguageCode(
  value: unknown,
): value is SourceLanguageCode {
  return (
    typeof value === "string" &&
    sourceLanguageCodeSet.has(value as SourceLanguageCode)
  );
}

export function isTargetLanguageCode(
  value: unknown,
): value is TargetLanguageCode {
  return (
    typeof value === "string" &&
    targetLanguageCodeSet.has(value as TargetLanguageCode)
  );
}
