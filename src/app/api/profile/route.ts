import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserProfile, updateUserPreferences } from "@/db/profileRepo";
import { isSourceLanguage, isTargetLanguage } from "@/components/ui/Languages";

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
  if (
    !isSourceLanguage(input.defaultSourceLang) ||
    !isTargetLanguage(input.defaultTargetLang)
  ) {
    return NextResponse.json(
      { error: "Choose valid source and translation languages." },
      { status: 400 },
    );
  }

  const preferences = await updateUserPreferences({
    userId: session.user.id,
    defaultSourceLang: input.defaultSourceLang,
    defaultTargetLang: input.defaultTargetLang,
  });
  return NextResponse.json({ preferences });
}
