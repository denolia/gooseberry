import { NextResponse } from "next/server";
import {
  getWordSetById,
  getWordSetItems,
  updateLastExportedAt,
} from "@/db/wordSetRepo";
import { mapWordSetItemToAnkiNote } from "@/app/utils/ankiMapper";
import { createApkgPackage } from "@/lib/anki/apkgExporter";
import { verifyAnkiExportLink } from "@/lib/anki/exportLink";

// GET /api/word-sets/[id]/export/deck.apkg - Download via a signed link
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    if (
      !verifyAnkiExportLink(
        id,
        url.searchParams.get("expires"),
        url.searchParams.get("signature"),
      )
    ) {
      return NextResponse.json(
        { errorCode: "errors.thisExportLinkIsInvalidOrHasExpired" },
        { status: 403 },
      );
    }

    const wordSet = await getWordSetById(id);
    if (!wordSet) {
      return NextResponse.json(
        { errorCode: "wordSetManager.wordSetNotFound" },
        { status: 404 },
      );
    }

    const items = await getWordSetItems(id);
    if (items.length === 0) {
      return NextResponse.json(
        { errorCode: "errors.wordSetIsEmpty" },
        { status: 400 },
      );
    }

    const ankiNotes = items.map((item) => mapWordSetItemToAnkiNote(item, true));
    const deckSegment = wordSet.name.trim().replaceAll("::", " - ");
    const deckName = `Gooseberry::${wordSet.sourceLang}-${wordSet.targetLang}::${deckSegment}`;
    const apkgBuffer = await createApkgPackage(
      deckName,
      ankiNotes,
      wordSet.sourceLang.toUpperCase(),
      wordSet.targetLang.toUpperCase(),
    );

    await updateLastExportedAt(id);

    const safeFileName = wordSet.name.replace(/[^a-zA-Z0-9]/g, "_");
    const dateStr = new Date().toISOString().split("T")[0];
    const fileName = `${safeFileName}_${dateStr}.apkg`;

    return new NextResponse(new Uint8Array(apkgBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/apkg",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": apkgBuffer.length.toString(),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Error downloading signed Anki export:", error);
    return NextResponse.json(
      { errorCode: "errors.failedToExportWordSet" },
      { status: 500 },
    );
  }
}
