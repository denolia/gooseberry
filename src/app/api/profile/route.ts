import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserProfile, updateUserPreferences } from "@/db/profileRepo";
import { isReviewMode } from "@/lib/review/model";
import { isUiLocale, type UiLocale } from "@/i18n/locale";
import type { ReviewModeValue } from "@/lib/review/model";
import {
  NewWordsPerDaySchema,
  StudyTimeZoneSchema,
} from "@/lib/review/settings";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { errorCode: "errors.unauthorized" },
      { status: 401 },
    );
  }
  const profile = await getUserProfile(session.user.id);
  if (!profile) {
    return NextResponse.json(
      { errorCode: "errors.accountNotFound" },
      { status: 404 },
    );
  }
  return NextResponse.json({ profile });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { errorCode: "errors.unauthorized" },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const input =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (input.reviewMode !== undefined && !isReviewMode(input.reviewMode)) {
    return NextResponse.json(
      { errorCode: "errors.chooseAValidReviewPreference" },
      { status: 400 },
    );
  }

  if (input.uiLocale !== undefined && !isUiLocale(input.uiLocale)) {
    return NextResponse.json(
      { errorCode: "errors.chooseASupportedInterfaceLanguage" },
      { status: 400 },
    );
  }
  if (
    !["reviewMode", "uiLocale", "newWordsPerDay", "studyTimeZone"].some(
      (key) => input[key] !== undefined,
    )
  ) {
    return NextResponse.json(
      { errorCode: "errors.chooseSettingsToUpdate" },
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
      { errorCode: "errors.choose01000NewWordsPerDayAndAValidStudy" },
      { status: 400 },
    );
  }

  const preferences = await updateUserPreferences({
    userId: session.user.id,
    reviewMode: input.reviewMode as ReviewModeValue | undefined,
    ...(input.uiLocale !== undefined
      ? { uiLocale: input.uiLocale as UiLocale }
      : {}),
    newWordsPerDay: input.newWordsPerDay as number | undefined,
    studyTimeZone: input.studyTimeZone as string | undefined,
  });
  return NextResponse.json({ preferences });
}
