import type { StudyCardTemplateKey } from "@/lib/review/templates";

// Introduction order is independent of template identity and Anki ordinals.
export const STUDY_CARD_INTRODUCTION_ORDER = [
  "recognition",
  "production",
  "type_answer",
  "word_forms",
  "example",
] as const satisfies readonly StudyCardTemplateKey[];
