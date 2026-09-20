import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import {
  getNextDueReviewCard,
  recordReview,
  ReviewCardNotDueError,
  ReviewCardNotFoundError,
  ReviewWriteConflictError,
} from "@/db/reviewRepo";
import { previewRatings } from "@/lib/review/fsrs";
import { ReviewRatingSchema } from "@/lib/review/model";

const SubmitReviewSchema = z.object({
  studyCardId: z.string().uuid(),
  rating: ReviewRatingSchema,
  durationMs: z
    .number()
    .int()
    .min(0)
    .max(24 * 60 * 60 * 1000)
    .optional(),
});

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
    const card = await getNextDueReviewCard({
      userId: session.user.id,
      wordSetId: id,
      now,
    });

    return NextResponse.json({
      card: card
        ? {
            ...card,
            ratings: previewRatings(card.state, now),
          }
        : null,
    });
  } catch (error) {
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
      rating: input.rating,
      durationMs: input.durationMs,
      reviewedAt: new Date(),
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
