import type { StudyCardTemplateKey } from "@/lib/review/templates";
import { FsrsCardState } from "@/lib/review/model";

// Introduction order is independent of template identity and Anki ordinals.
export const STUDY_CARD_INTRODUCTION_ORDER = [
  "recognition",
  "production",
  "type_answer",
  "word_forms",
  "example",
] as const satisfies readonly StudyCardTemplateKey[];

export const EXPOSURE_SENSITIVE_TEMPLATES = [
  "recognition",
  "production",
  "type_answer",
] as const;

export function isExposureSensitive(
  templateKey: string,
  state: number,
): boolean {
  return (
    (state === FsrsCardState.Review || state === FsrsCardState.Relearning) &&
    EXPOSURE_SENSITIVE_TEMPLATES.some((key) => key === templateKey)
  );
}
