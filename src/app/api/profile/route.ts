import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserProfile, updateUserPreferences } from "@/db/profileRepo";
import { isReviewMode } from "@/lib/review/model";

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

  const preferences = await updateUserPreferences({
    userId: session.user.id,
    reviewMode: input.reviewMode,
  });
  return NextResponse.json({ preferences });
}
