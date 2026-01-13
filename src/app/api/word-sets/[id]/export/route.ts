import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getWordSet, getWordSetItems, updateLastExportedAt } from "@/db/wordSetRepo";
import { mapWordSetItemToAnkiNote } from "@/app/utils/ankiMapper";
import { createApkgPackage } from "@/lib/anki/apkgExporter";

// POST /api/word-sets/[id]/export - Export word set as .apkg
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Verify ownership
    const wordSet = await getWordSet(params.id, session.user.id);
    if (!wordSet) {
      return NextResponse.json({ error: "Word set not found" }, { status: 404 });
    }

    // Get items
    const items = await getWordSetItems(params.id);

    if (items.length === 0) {
      return NextResponse.json(
        { error: "Word set is empty" },
        { status: 400 },
      );
    }

    // Filter enabled items and convert to Anki notes
    const enabledItems = items.filter((item) => item.isEnabled);

    if (enabledItems.length === 0) {
      return NextResponse.json(
        { error: "No enabled items in word set" },
        { status: 400 },
      );
    }

    const ankiNotes = enabledItems.map((item) =>
      mapWordSetItemToAnkiNote(item, true),
    );

    // Generate deck name: Gooseberry::de-ru::2026-01-13
    const dateStr = new Date().toISOString().split("T")[0];
    const deckName = `Gooseberry::${wordSet.sourceLang}-${wordSet.targetLang}::${dateStr}`;

    // Create .apkg file
    const apkgBuffer = await createApkgPackage(deckName, ankiNotes);

    // Update last exported timestamp
    await updateLastExportedAt(params.id);

    // Generate safe filename
    const safeFileName = wordSet.name.replace(/[^a-zA-Z0-9]/g, "_");
    const fileName = `${safeFileName}_${dateStr}.apkg`;

    // Return file
    return new NextResponse(apkgBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": apkgBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("Error exporting word set:", error);
    return NextResponse.json(
      { error: "Failed to export word set" },
      { status: 500 },
    );
  }
}
