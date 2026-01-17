import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getWordSet,
  getWordSetItems,
  updateLastExportedAt,
} from "@/db/wordSetRepo";
import { mapWordSetItemToAnkiNote } from "@/app/utils/ankiMapper";
import { createApkgPackage } from "@/lib/anki/apkgExporter";
import { createCsvContent } from "@/lib/anki/csvExporter";

// POST /api/word-sets/[id]/export - Export word set as .apkg or .csv
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    // Get format from query parameter (default to apkg)
    const url = new URL(request.url);
    const format = url.searchParams.get("format") || "apkg";

    if (format !== "apkg" && format !== "csv") {
      return NextResponse.json(
        { error: "Invalid format. Use 'apkg' or 'csv'" },
        { status: 400 },
      );
    }

    // Verify ownership
    const wordSet = await getWordSet(id, session.user.id);
    if (!wordSet) {
      return NextResponse.json(
        { error: "Word set not found" },
        { status: 404 },
      );
    }

    // Get items
    const items = await getWordSetItems(id);

    if (items.length === 0) {
      return NextResponse.json({ error: "Word set is empty" }, { status: 400 });
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

    // Generate safe filename
    const safeFileName = wordSet.name.replace(/[^a-zA-Z0-9]/g, "_");

    // Update last exported timestamp
    await updateLastExportedAt(id);

    if (format === "csv") {
      // Create CSV file
      const csvContent = createCsvContent(
        ankiNotes,
        wordSet.sourceLang.toUpperCase(),
        wordSet.targetLang.toUpperCase(),
      );

      const fileName = `${safeFileName}_${dateStr}.csv`;

      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${fileName}"`,
        },
      });
    } else {
      // Create .apkg file with source and target languages
      const apkgBuffer = await createApkgPackage(
        deckName,
        ankiNotes,
        wordSet.sourceLang.toUpperCase(),
        wordSet.targetLang.toUpperCase(),
      );

      const fileName = `${safeFileName}_${dateStr}.apkg`;

      // Return file (convert Buffer to Uint8Array for NextResponse)
      return new NextResponse(new Uint8Array(apkgBuffer), {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Content-Length": apkgBuffer.length.toString(),
        },
      });
    }
  } catch (error) {
    console.error("Error exporting word set:", error);
    return NextResponse.json(
      { error: "Failed to export word set" },
      { status: 500 },
    );
  }
}
