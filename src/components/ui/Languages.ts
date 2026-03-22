export const Languages = {
  German: "German",
  Norwegian: "Norwegian",
  English: "English",
} as const;

export const TargetLanguages = {
  Russian: "Russian",
  English: "English",
} as const;

export const LanguageCodes = {
  [Languages.German]: "DE",
  [Languages.Norwegian]: "NO",
  [Languages.English]: "EN",
} as const;

export const TargetLanguageCodes = {
  [TargetLanguages.Russian]: "ru",
  [TargetLanguages.English]: "en",
} as const;

export type Language = (typeof Languages)[keyof typeof Languages];
export type TargetLanguage =
  (typeof TargetLanguages)[keyof typeof TargetLanguages];

export const LanguageOptions = Object.values(Languages);
export const TargetLanguageOptions = Object.values(TargetLanguages);
