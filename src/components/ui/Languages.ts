export const Languages = {
  German: "German",
  Norwegian: "Norwegian",
  English: "English",
} as const;

export type Language = (typeof Languages)[keyof typeof Languages];

export const LanguageOptions = Object.values(Languages);
