import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createPremiumRequest } from "@/db/profileRepo";
import { sendPremiumRequestEmail } from "@/lib/premium/email";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { errorCode: "errors.unauthorized" },
      { status: 401 },
    );
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
      { errorCode: "errors.yourMessageMustBe500CharactersOrFewer" },
      { status: 400 },
    );
  }

  const result = await createPremiumRequest({
    userId: session.user.id,
    message: message || null,
  });
  if (result.kind === "missing-user") {
    return NextResponse.json(
      { errorCode: "errors.accountNotFound" },
      { status: 404 },
    );
  }
  if (result.kind === "already-premium") {
    return NextResponse.json(
      { errorCode: "errors.thisAccountAlreadyHasPremiumAccess" },
      { status: 409 },
    );
  }
  if (result.kind === "already-pending") {
    return NextResponse.json(
      { errorCode: "errors.yourPremiumRequestIsAlreadyPending" },
      { status: 409 },
    );
  }

  let adminUrl = new URL("/admin", request.url).toString();
  if (process.env.APP_URL) {
    try {
      adminUrl = new URL("/admin", process.env.APP_URL).toString();
    } catch {
      console.error("APP_URL is invalid; using the request origin in email.");
    }
  }
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
