import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getWordSet, getWordSetItems } from "@/db/wordSetRepo";
import {
  ANKI_EXPORT_LINK_TTL_SECONDS,
  signAnkiExportLink,
} from "@/lib/anki/exportLink";

// POST /api/word-sets/[id]/export/link - Create a short-lived AnkiDroid URL
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const wordSet = await getWordSet(id, session.user.id);
    if (!wordSet) {
      return NextResponse.json(
        { error: "Word set not found" },
        { status: 404 },
      );
    }

    const items = await getWordSetItems(id);
    const cardCount = items.filter((item) => item.isEnabled).length;
    if (cardCount === 0) {
      return NextResponse.json(
        { error: "No enabled items in word set" },
        { status: 400 },
      );
    }

    const expires =
      Math.floor(Date.now() / 1000) + ANKI_EXPORT_LINK_TTL_SECONDS;
    const signature = signAnkiExportLink(id, expires);
    const query = new URLSearchParams({
      expires: expires.toString(),
      signature,
    });

    return NextResponse.json({
      url: `/api/word-sets/${encodeURIComponent(id)}/export/deck.apkg?${query}`,
      expiresAt: new Date(expires * 1000).toISOString(),
      cardCount,
    });
  } catch (error) {
    console.error("Error creating Anki export link:", error);
    return NextResponse.json(
      { error: "Failed to prepare AnkiDroid export" },
      { status: 500 },
    );
  }
}
