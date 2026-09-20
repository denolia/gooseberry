import {
  FsrsCardState,
  ReviewMode,
  ReviewRating,
  type FsrsCardStateValue,
  type ReviewModeValue,
  type ReviewRatingValue,
} from "@/lib/review/model";

export type ReviewControl = {
  label: string;
  rating: ReviewRatingValue;
  shortcut: "1" | "2" | "3" | "4" | null;
};

export function isLearningState(state: FsrsCardStateValue): boolean {
  return (
    state === FsrsCardState.New ||
    state === FsrsCardState.Learning ||
    state === FsrsCardState.Relearning
  );
}

export function isNewState(state: FsrsCardStateValue): boolean {
  return state === FsrsCardState.New;
}

export function reviewPrompt(state: FsrsCardStateValue): string {
  return isLearningState(state)
    ? "Try to remember this:"
    : "Do you remember this?";
}

export function reviewControls(
  state: FsrsCardStateValue,
  mode: ReviewModeValue,
): ReviewControl[] {
  if (isNewState(state)) {
    return [{ label: "Ok", rating: ReviewRating.Good, shortcut: null }];
  }

  if (mode === ReviewMode.Full) {
    return [
      { label: "Hard", rating: ReviewRating.Hard, shortcut: "2" },
      { label: "Good", rating: ReviewRating.Good, shortcut: "3" },
      { label: "Easy", rating: ReviewRating.Easy, shortcut: "4" },
      { label: "Again", rating: ReviewRating.Again, shortcut: "1" },
    ];
  }

  return [
    { label: "No", rating: ReviewRating.Again, shortcut: "1" },
    { label: "Yes", rating: ReviewRating.Good, shortcut: "2" },
  ];
}
