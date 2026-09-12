import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createPremiumRequest } from "@/db/profileRepo";
import { sendPremiumRequestEmail } from "@/lib/premium/email";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const message =
    body &&
    typeof body === "object" &&
    typeof (body as Record<string, unknown>).message === "string"
      ? ((body as Record<string, unknown>).message as string).trim()
      : "";
  if (message.length > 500) {
    return NextResponse.json(
      { error: "Your message must be 500 characters or fewer." },
      { status: 400 },
    );
  }

  const result = await createPremiumRequest({
    userId: session.user.id,
    message: message || null,
  });
  if (result.kind === "missing-user") {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  if (result.kind === "already-premium") {
    return NextResponse.json(
      { error: "This account already has Premium access." },
      { status: 409 },
    );
  }
  if (result.kind === "already-pending") {
    return NextResponse.json(
      { error: "Your Premium request is already pending." },
      { status: 409 },
    );
  }

  const adminUrl = new URL("/admin", request.url).toString();
  const notificationSent = await sendPremiumRequestEmail({
    name: result.user.name,
    email: result.user.email,
    message: message || null,
    adminUrl,
  });

  return NextResponse.json(
    { request: result.request, notificationSent },
    { status: 201 },
  );
}
