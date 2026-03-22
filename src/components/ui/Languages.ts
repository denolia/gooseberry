export const SourceLanguages = {
  German: "German",
  Norwegian: "Norwegian",
  English: "English",
} as const;

export const TargetLanguages = {
  Russian: "Russian",
  English: "English",
} as const;

export const TargetLanguageCodes = {
  [TargetLanguages.Russian]: "ru",
  [TargetLanguages.English]: "en",
} as const;

export type SourceLanguage =
  (typeof SourceLanguages)[keyof typeof SourceLanguages];
export type TargetLanguage =
  (typeof TargetLanguages)[keyof typeof TargetLanguages];

export const SourceLanguageOptions = Object.values(SourceLanguages);
export const TargetLanguageOptions = Object.values(TargetLanguages);
