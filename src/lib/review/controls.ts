import type { MessageKey } from "@/i18n/messages";
import {
  FsrsCardState,
  ReviewMode,
  ReviewRating,
  type FsrsCardStateValue,
  type ReviewModeValue,
  type ReviewRatingValue,
} from "@/lib/review/model";

export type ReviewControl = {
  labelKey: MessageKey;
  rating: ReviewRatingValue;
  shortcut: "1" | "2" | "3" | "4" | " " | null;
};

export function isNewState(state: FsrsCardStateValue): boolean {
  return state === FsrsCardState.New;
}

export function reviewControls(
  state: FsrsCardStateValue,
  mode: ReviewModeValue,
): ReviewControl[] {
  if (isNewState(state)) {
    return [
      { labelKey: "common.ok", rating: ReviewRating.Good, shortcut: " " },
    ];
  }

  if (mode === ReviewMode.Full) {
    return [
      { labelKey: "common.hard", rating: ReviewRating.Hard, shortcut: "2" },
      { labelKey: "common.good", rating: ReviewRating.Good, shortcut: "3" },
      { labelKey: "common.easy", rating: ReviewRating.Easy, shortcut: "4" },
      { labelKey: "common.again", rating: ReviewRating.Again, shortcut: "1" },
    ];
  }

  return [
    { labelKey: "common.no", rating: ReviewRating.Again, shortcut: "1" },
    { labelKey: "common.yes", rating: ReviewRating.Good, shortcut: "2" },
  ];
}
