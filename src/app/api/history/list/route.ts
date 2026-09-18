import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listTranslationHistoryPage } from "@/db/translationRepo";
import type { TranslationHistoryCursor } from "@/db/translationRepo";

const HISTORY_PAGE_SIZE = 50;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function encodeHistoryCursor(cursor: TranslationHistoryCursor) {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt,
      id: cursor.id,
    }),
  ).toString("base64url");
}

export function decodeHistoryCursor(value: string): TranslationHistoryCursor {
  const parsed = JSON.parse(
    Buffer.from(value, "base64url").toString("utf8"),
  ) as {
    createdAt?: unknown;
    id?: unknown;
  };
  const createdAt =
    typeof parsed.createdAt === "string" ? parsed.createdAt : null;

  if (
    !createdAt ||
    Number.isNaN(new Date(createdAt).getTime()) ||
    typeof parsed.id !== "string" ||
    !UUID_PATTERN.test(parsed.id)
  ) {
    throw new Error("Invalid history cursor");
  }

  return { createdAt, id: parsed.id };
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const cursorValue = new URL(request.url).searchParams.get("cursor");
    let cursor: TranslationHistoryCursor | undefined;
    if (cursorValue) {
      try {
        cursor = decodeHistoryCursor(cursorValue);
      } catch {
        return NextResponse.json(
          { error: "Invalid history cursor" },
          { status: 400 },
        );
      }
    }

    const page = await listTranslationHistoryPage(session.user.id, {
      limit: HISTORY_PAGE_SIZE,
      cursor,
    });

    const history = page.items.map((row) => ({
      id: row.id,
      sourceLang: row.sourceLang,
      targetLang: row.targetLang,
      inputText: row.inputText,
      responseJson: row.responseJson,
      model: row.model,
      createdAt: row.createdAt,
    }));

    return NextResponse.json({
      history,
      nextCursor: page.nextCursor ? encodeHistoryCursor(page.nextCursor) : null,
    });
  } catch (error) {
    console.error("Error fetching history:", error);
    return NextResponse.json(
      { error: "Failed to fetch history" },
      { status: 500 },
    );
  }
}
