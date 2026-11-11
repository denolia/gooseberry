import { errorEnvelope } from "@/i18n/errors";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import {
  getDueReviewCards,
  getReviewQueueTiming,
  exposureAwareRatingPreviews,
  getRecordedCardAvailableAt,
  recordReview,
  ReviewCardNotDueError,
  ReviewCardNotFoundError,
  ReviewWriteConflictError,
} from "@/db/reviewRepo";
import { previewRatings } from "@/lib/review/fsrs";
import { ReviewRatingSchema } from "@/lib/review/model";
import { getStudyDay, serializeStudyDay } from "@/db/studyDay";

const SubmitReviewSchema = z.object({
  reviewId: z.string().uuid().optional(),
  studyCardId: z.string().uuid(),
  exposureId: z.string().uuid(),
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
    return NextResponse.json(
      { errorCode: "errors.unauthorized" },
      { status: 401 },
    );
  }

  try {
    const { id } = await params;
    const now = new Date();
    const studyDay = await getStudyDay(session.user.id, now);
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
      studyDay,
    });
    const responseCards = cards.map((card) => ({
      ...card,
      ratings: exposureAwareRatingPreviews(
        card.templateKey,
        previewRatings(card.state, now),
        now,
        studyDay,
      ),
    }));
    const timing = await getReviewQueueTiming({
      userId: session.user.id,
      wordSetId: id,
      now,
      studyDay,
    });

    return NextResponse.json({
      cards: responseCards,
      // Keep the original field during the client rollout.
      card: responseCards[0] ?? null,
      ...timing,
      studyDay: serializeStudyDay(studyDay, now),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          errorCode: "errors.invalidReviewQueueRequest",
          details: error.message,
        },
        { status: 400 },
      );
    }
    console.error("Error loading review card:", error);
    return NextResponse.json(
      { errorCode: "errors.failedToLoadReviewCard" },
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
    return NextResponse.json(
      { errorCode: "errors.unauthorized" },
      { status: 401 },
    );
  }

  try {
    const { id } = await params;
    const input = SubmitReviewSchema.parse(await request.json());
    const now = new Date();
    const state = await recordReview({
      userId: session.user.id,
      wordSetId: id,
      studyCardId: input.studyCardId,
      exposureId: input.exposureId,
      now,
      reviewEventId: input.reviewId ?? crypto.randomUUID(),
      rating: input.rating,
      durationMs: input.durationMs,
      reviewedAt: input.reviewedAt ? new Date(input.reviewedAt) : new Date(),
    });

    const day = await getStudyDay(session.user.id, now);
    const nextAvailableAt = await getRecordedCardAvailableAt({
      userId: session.user.id,
      wordSetId: id,
      studyCardId: input.studyCardId,
      state,
      studyDay: day,
    });
    return NextResponse.json({ success: true, state, nextAvailableAt });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { errorCode: "errors.invalidReview", details: error.message },
        { status: 400 },
      );
    }
    if (error instanceof ReviewCardNotFoundError) {
      return NextResponse.json(
        { ...errorEnvelope(error, "errors.failedToRecordReview") },
        { status: 404 },
      );
    }
    if (error instanceof ReviewCardNotDueError) {
      return NextResponse.json(
        { ...errorEnvelope(error, "errors.failedToRecordReview") },
        { status: 409 },
      );
    }
    if (error instanceof ReviewWriteConflictError) {
      return NextResponse.json(
        { errorCode: "errors.theCardChangedPleaseTryAgain" },
        { status: 409 },
      );
    }

    console.error("Error recording review:", error);
    return NextResponse.json(
      { errorCode: "errors.failedToRecordReview" },
      { status: 500 },
    );
  }
}
