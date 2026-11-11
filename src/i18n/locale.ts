export const UI_LOCALES = ["en", "ru"] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

export function isUiLocale(value: unknown): value is UiLocale {
  return value === "en" || value === "ru";
}

/** Match the highest-priority supported browser language, ignoring q=0. */
export function detectUiLocale(acceptLanguage: string | null): UiLocale {
  const languages = (acceptLanguage ?? "")
    .split(",")
    .map((entry, index) => {
      const [tag, ...parameters] = entry.trim().split(";");
      const quality = parameters.find((part) => part.trim().startsWith("q="));
      const weight = quality ? Number(quality.trim().slice(2)) : 1;
      return {
        language: tag.trim().toLowerCase().split("-")[0],
        weight,
        index,
      };
    })
    .filter(
      ({ weight }) => Number.isFinite(weight) && weight > 0 && weight <= 1,
    )
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const { language } of languages) {
    if (isUiLocale(language)) return language;
  }
  return "en";
}
