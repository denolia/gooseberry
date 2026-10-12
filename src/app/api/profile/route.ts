import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserProfile, updateUserPreferences } from "@/db/profileRepo";
import { isReviewMode } from "@/lib/review/model";
import {
  NewWordsPerDaySchema,
  StudyTimeZoneSchema,
} from "@/lib/review/settings";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const profile = await getUserProfile(session.user.id);
  if (!profile) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  return NextResponse.json({ profile });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const input =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (!isReviewMode(input.reviewMode)) {
    return NextResponse.json(
      { error: "Choose a valid review preference." },
      { status: 400 },
    );
  }

  if (
    (input.newWordsPerDay !== undefined &&
      !NewWordsPerDaySchema.safeParse(input.newWordsPerDay).success) ||
    (input.studyTimeZone !== undefined &&
      !StudyTimeZoneSchema.safeParse(input.studyTimeZone).success)
  ) {
    return NextResponse.json(
      { error: "Choose 0–1000 new words per day and a valid study time zone." },
      { status: 400 },
    );
  }

  const preferences = await updateUserPreferences({
    userId: session.user.id,
    reviewMode: input.reviewMode,
    newWordsPerDay: input.newWordsPerDay as number | undefined,
    studyTimeZone: input.studyTimeZone as string | undefined,
  });
  return NextResponse.json({ preferences });
}
