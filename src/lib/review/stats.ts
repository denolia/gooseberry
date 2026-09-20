import { FsrsCardState, type FsrsCardStateValue } from "@/lib/review/model";

export type PlantReadinessStage = "seed" | "sprout" | "growing" | "ripe";

export function reviewStateLabel(state: FsrsCardStateValue): string {
  switch (state) {
    case FsrsCardState.Learning:
      return "Learning";
    case FsrsCardState.Review:
      return "Repeat";
    case FsrsCardState.Relearning:
      return "Relearning";
    default:
      return "New";
  }
}

export function reviewCountLabel(reps: number): string {
  if (reps <= 0) return "Fresh";
  return `${reps} ${reps === 1 ? "review" : "reviews"}`;
}

export function isReadyForReview(
  state: FsrsCardStateValue,
  dueAt: string | Date | null,
  now: Date,
): boolean {
  if (state === FsrsCardState.New || !dueAt) return true;
  return new Date(dueAt).getTime() <= now.getTime();
}

export function plantReadinessStage(dueCount: number): PlantReadinessStage {
  if (dueCount <= 0) return "seed";
  if (dueCount <= 5) return "sprout";
  if (dueCount < 15) return "growing";
  return "ripe";
}
