import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getStudyActivity } from "@/db/studyActivityRepo";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json(
      { errorCode: "errors.unauthorized" },
      { status: 401 },
    );
  const search = new URL(request.url).searchParams;
  const raw = search.get("days") ?? "365";
  if (
    !/^\d+$/.test(raw) ||
    Number(raw) < 1 ||
    Number(raw) > 365 ||
    search.getAll("days").length > 1
  ) {
    return NextResponse.json(
      { errorCode: "errors.invalidActivityRange" },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(
      await getStudyActivity(session.user.id, new Date(), Number(raw)),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("Error loading study activity:", error);
    return NextResponse.json(
      { errorCode: "errors.failedToLoadActivity" },
      { status: 500 },
    );
  }
}
