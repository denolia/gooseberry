import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import {
  getDueReviewCards,
  recordReview,
  ReviewCardNotDueError,
  ReviewCardNotFoundError,
  ReviewWriteConflictError,
} from "@/db/reviewRepo";
import { previewRatings } from "@/lib/review/fsrs";
import { ReviewRatingSchema } from "@/lib/review/model";

const SubmitReviewSchema = z.object({
  reviewId: z.string().uuid().optional(),
  studyCardId: z.string().uuid(),
  rating: ReviewRatingSchema,
  reviewedAt: z.string().datetime().optional(),
  durationMs: z
    .number()
    .int()
    .min(0)
    .max(24 * 60 * 60 * 1000)
    .optional(),
});

const ReviewQueueQuerySchema = z
  .array(z.string().uuid())
  .max(100, "Too many excluded cards");

const REVIEW_QUEUE_SIZE = 20;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const now = new Date();
    const url = new URL(request.url);
    const excludedStudyCardIds = ReviewQueueQuerySchema.parse(
      url.searchParams.getAll("exclude"),
    );
    const cards = await getDueReviewCards({
      userId: session.user.id,
      wordSetId: id,
      now,
      limit: REVIEW_QUEUE_SIZE,
      excludedStudyCardIds,
    });
    const responseCards = cards.map((card) => ({
      ...card,
      ratings: previewRatings(card.state, now),
    }));

    return NextResponse.json({
      cards: responseCards,
      // Keep the original field during the client rollout.
      card: responseCards[0] ?? null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid review queue request", details: error.message },
        { status: 400 },
      );
    }
    console.error("Error loading review card:", error);
    return NextResponse.json(
      { error: "Failed to load review card" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const input = SubmitReviewSchema.parse(await request.json());
    const state = await recordReview({
      userId: session.user.id,
      wordSetId: id,
      studyCardId: input.studyCardId,
      reviewEventId: input.reviewId ?? crypto.randomUUID(),
      rating: input.rating,
      durationMs: input.durationMs,
      reviewedAt: input.reviewedAt ? new Date(input.reviewedAt) : new Date(),
    });

    return NextResponse.json({ success: true, state });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid review", details: error.message },
        { status: 400 },
      );
    }
    if (error instanceof ReviewCardNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof ReviewCardNotDueError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof ReviewWriteConflictError) {
      return NextResponse.json(
        { error: "The card changed. Please try again." },
        { status: 409 },
      );
    }

    console.error("Error recording review:", error);
    return NextResponse.json(
      { error: "Failed to record review" },
      { status: 500 },
    );
  }
}
