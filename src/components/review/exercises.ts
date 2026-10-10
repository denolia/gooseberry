import type { StudyCardContentField } from "@/lib/review/templates";

export function exerciseFieldLanguage(
  field: StudyCardContentField,
  sourceLang: string,
  targetLang: string,
): string {
  return field === "translation" || field === "sampleTranslation"
    ? targetLang
    : sourceLang;
}

// This comparison is a reading aid. Learners still choose the review rating,
// including when their answer uses a valid alternative or a different form.
export function typedAnswerMatches(
  answer: string,
  expected: string,
  language: string,
): boolean {
  const normalize = (value: string) => {
    const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
    try {
      return normalized.toLocaleLowerCase(language);
    } catch {
      return normalized.toLowerCase();
    }
  };

  return answer.trim().length > 0 && normalize(answer) === normalize(expected);
}
