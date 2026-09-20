import { z } from "zod";

// The native reviewer starts with one simple source-to-translation prompt per
// item. More template keys can be added without changing review-history IDs.
export const NATIVE_STUDY_CARD_TEMPLATE = "recognition" as const;

export const ReviewRating = {
  Again: 1,
  Hard: 2,
  Good: 3,
  Easy: 4,
} as const;

export const ReviewRatingSchema = z.union([
  z.literal(ReviewRating.Again),
  z.literal(ReviewRating.Hard),
  z.literal(ReviewRating.Good),
  z.literal(ReviewRating.Easy),
]);

export type ReviewRatingValue = z.infer<typeof ReviewRatingSchema>;

// These values intentionally match ts-fsrs's State enum. Keeping the mapping
// here makes persistence independent from the scheduling package.
export const FsrsCardState = {
  New: 0,
  Learning: 1,
  Review: 2,
  Relearning: 3,
} as const;

export type FsrsCardStateValue =
  (typeof FsrsCardState)[keyof typeof FsrsCardState];
