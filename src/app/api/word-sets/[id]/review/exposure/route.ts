import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import {
  activateReviewCard,
  exposureAwareRatingPreviews,
  ReviewCardNotDueError,
  ReviewCardNotFoundError,
  ReviewWriteConflictError,
  ReviewWordSeenTodayError,
} from "@/db/reviewRepo";
import { getStudyDay, serializeStudyDay } from "@/db/studyDay";
import { previewRatings } from "@/lib/review/fsrs";

const ActivateSchema = z.object({
  exposureId: z.string().uuid(),
  studyCardId: z.string().uuid(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;
    const input = ActivateSchema.parse(await request.json());
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
    if (error instanceof ReviewCardNotFoundError)
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
