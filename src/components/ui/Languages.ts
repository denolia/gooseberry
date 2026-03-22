export const SourceLanguages = {
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
} as const;

export const TargetLanguages = {
  Russian: "Russian",
  English: "English",
} as const;

export const SourceLanguageCodes = {
  [SourceLanguages.German]: "de",
  [SourceLanguages.Norwegian]: "no",
  [SourceLanguages.English]: "en",
  [SourceLanguages.Spanish]: "es",
  [SourceLanguages.French]: "fr",
  [SourceLanguages.Italian]: "it",
  [SourceLanguages.Portuguese]: "pt",
  [SourceLanguages.Dutch]: "nl",
  [SourceLanguages.Swedish]: "sv",
  [SourceLanguages.Danish]: "da",
  [SourceLanguages.Polish]: "pl",
  [SourceLanguages.Turkish]: "tr",
  [SourceLanguages.Ukrainian]: "uk",
  [SourceLanguages.Japanese]: "ja",
  [SourceLanguages.Korean]: "ko",
  [SourceLanguages.Chinese]: "zh",
  [SourceLanguages.Arabic]: "ar",
  [SourceLanguages.Hindi]: "hi",
} as const;

export const TargetLanguageCodes = {
  [TargetLanguages.Russian]: "ru",
  [TargetLanguages.English]: "en",
} as const;

export type SourceLanguage =
  (typeof SourceLanguages)[keyof typeof SourceLanguages];
export type TargetLanguage =
  (typeof TargetLanguages)[keyof typeof TargetLanguages];
export type SourceLanguageCode =
  (typeof SourceLanguageCodes)[keyof typeof SourceLanguageCodes];
export type TargetLanguageCode =
  (typeof TargetLanguageCodes)[keyof typeof TargetLanguageCodes];

export const SourceLanguageOptions = Object.values(SourceLanguages);
export const TargetLanguageOptions = Object.values(TargetLanguages);
export const SourceLanguageCodeOptions = Object.values(SourceLanguageCodes);
export const TargetLanguageCodeOptions = Object.values(TargetLanguageCodes);

export const SourceLanguageSelectOptions = SourceLanguageOptions.map(
  (language) => ({
    label: language,
    value: SourceLanguageCodes[language],
  }),
);

export const TargetLanguageSelectOptions = TargetLanguageOptions.map(
  (language) => ({
    label: language,
    value: TargetLanguageCodes[language],
  }),
);

export function isSourceLanguage(value: unknown): value is SourceLanguage {
  return (
    typeof value === "string" &&
    SourceLanguageOptions.includes(value as SourceLanguage)
  );
}

export function isTargetLanguage(value: unknown): value is TargetLanguage {
  return (
    typeof value === "string" &&
    TargetLanguageOptions.includes(value as TargetLanguage)
  );
}

export function isSourceLanguageCode(value: unknown): value is SourceLanguageCode {
  return (
    typeof value === "string" &&
    SourceLanguageCodeOptions.includes(value as SourceLanguageCode)
  );
}

export function isTargetLanguageCode(value: unknown): value is TargetLanguageCode {
  return (
    typeof value === "string" &&
    TargetLanguageCodeOptions.includes(value as TargetLanguageCode)
  );
}
