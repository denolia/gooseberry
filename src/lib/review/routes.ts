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
  activateReviewCard,
  ReviewWordSeenTodayError,
} from "@/db/reviewRepo";
import { previewRatings } from "@/lib/review/fsrs";
import { ReviewRatingSchema } from "@/lib/review/model";
import { getStudyDay, serializeStudyDay } from "@/db/studyDay";
import { recordDisplayedStudyCardExposure } from "@/db/studyExposureRepo";
import {
  assertOwnedStudyScope,
  getOwnedStudyCardSet,
  StudyScopeNotFoundError,
} from "@/db/studyScope";
import { parseStudyQuery, StudyScopeSchema } from "@/lib/review/scope";

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

export async function getStudyQueue(request: Request, wordSetId?: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const { scope, filter } = wordSetId
      ? parseStudyQuery(
          new URLSearchParams({
            scope: "sets",
            set: wordSetId,
            filter: url.searchParams.get("filter") ?? "all_available",
          }),
        )
      : parseStudyQuery(url.searchParams);
    const excludedStudyCardIds = ReviewQueueQuerySchema.parse(
      url.searchParams.getAll("exclude"),
    );
    await assertOwnedStudyScope(session.user.id, scope);
    const now = new Date();
    const studyDay = await getStudyDay(session.user.id, now);
    const cards = await getDueReviewCards({
      userId: session.user.id,
      scope,
      filter,
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
      scope,
      filter,
      now,
      studyDay,
    });

    return NextResponse.json({
      scope,
      filter,
      cards: responseCards,
      // Keep the original field during the client rollout.
      card: responseCards[0] ?? null,
      ...timing,
      studyDay: serializeStudyDay(studyDay, now),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid review queue request", details: error.message },
        { status: 400 },
      );
    }
    if (error instanceof StudyScopeNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("Error loading review card:", error);
    return NextResponse.json(
      { error: "Failed to load review card" },
      { status: 500 },
    );
  }
}

export async function submitStudyReview(request: Request, wordSetId?: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = SubmitReviewSchema.parse(
      await request.json().catch(() => null),
    );
    const id = wordSetId
      ? parseSingleSetId(wordSetId)
      : await getOwnedStudyCardSet(session.user.id, input.studyCardId);
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
        { error: "Invalid review", details: error.message },
        { status: 400 },
      );
    }
    if (
      error instanceof ReviewCardNotFoundError ||
      error instanceof StudyScopeNotFoundError
    ) {
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

const ActivateSchema = z.object({
  exposureId: z.string().uuid(),
  studyCardId: z.string().uuid(),
  displayed: z.boolean().default(false),
});

export async function activateStudyCard(request: Request, wordSetId?: string) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const input = ActivateSchema.parse(await request.json().catch(() => null));
    const id = wordSetId
      ? parseSingleSetId(wordSetId)
      : await getOwnedStudyCardSet(session.user.id, input.studyCardId);
    const now = new Date();
    const studyDay = await getStudyDay(session.user.id, now);
    try {
      const result = await activateReviewCard({
        ...input,
        userId: session.user.id,
        wordSetId: id,
        now,
        studyDay,
      });
      return NextResponse.json({
        card: {
          ...result.card,
          ratings: exposureAwareRatingPreviews(
            result.card.templateKey,
            previewRatings(result.card.state, now),
            now,
            studyDay,
          ),
        },
        exposure: {
          id: result.exposure.id,
          studyCardId: result.exposure.studyCardId,
          wordSetItemId: result.exposure.wordSetItemId,
          activatedAt: result.exposure.activatedAt,
          stateBefore: result.exposure.stateBefore,
          repsBefore: result.exposure.repsBefore,
        },
        exposedAt: now,
        studyDay: serializeStudyDay(studyDay, now),
      });
    } catch (error) {
      if (
        input.displayed &&
        (error instanceof ReviewCardNotDueError ||
          error instanceof ReviewCardNotFoundError ||
          error instanceof ReviewWriteConflictError)
      ) {
        await recordDisplayedStudyCardExposure({
          userId: session.user.id,
          wordSetId: id,
          studyCardId: input.studyCardId,
          now,
        });
      }
      if (error instanceof ReviewWordSeenTodayError) {
        return NextResponse.json(
          {
            error: error.message,
            code: "word_seen_today",
            studyDay: serializeStudyDay(studyDay, now),
          },
          { status: 409 },
        );
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json(
        { error: "Invalid exercise request" },
        { status: 400 },
      );
    if (
      error instanceof ReviewCardNotFoundError ||
      error instanceof StudyScopeNotFoundError
    )
      return NextResponse.json({ error: error.message }, { status: 404 });
    if (
      error instanceof ReviewCardNotDueError ||
      error instanceof ReviewWriteConflictError
    ) {
      return NextResponse.json(
        { error: error.message, code: "unavailable" },
        { status: 409 },
      );
    }
    console.error("Error opening study exercise:", error);
    return NextResponse.json(
      { error: "Could not open this exercise" },
      { status: 500 },
    );
  }
}

function parseSingleSetId(id: string) {
  const scope = StudyScopeSchema.parse({ kind: "sets", setIds: [id] });
  return scope.kind === "sets" ? scope.setIds[0] : id;
}
