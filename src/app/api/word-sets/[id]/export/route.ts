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
import { createHash } from "node:crypto";
import { generateSpeechMp3 } from "@/lib/audio/speech";

export const maxDuration = 300;

const AUDIO_GENERATION_CONCURRENCY = 4;
const MAX_DIRECT_EXPORT_BYTES = 4_300_000;

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapper(values[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  );
  return results;
}

function audioFilename(sourceLanguage: string, text: string): string {
  const digest = createHash("sha256")
    .update(`${sourceLanguage}\u0000${text.trim()}`)
    .digest("hex")
    .slice(0, 24);
  return `gooseberry-${digest}.mp3`;
}

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
    const includeAudio =
      format === "apkg" && url.searchParams.get("audio") === "1";

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

    let ankiNotes = enabledItems.map((item) =>
      mapWordSetItemToAnkiNote(item, true),
    );
    let media: Array<{ filename: string; data: Uint8Array }> = [];

    if (includeAudio) {
      const uniqueItemsByAudio = new Map(
        enabledItems.map((item) => [item.original.trim(), item]),
      );
      const uniqueAudioItems = [...uniqueItemsByAudio.values()];
      media = await mapWithConcurrency(
        uniqueAudioItems,
        AUDIO_GENERATION_CONCURRENCY,
        async (item) => {
          const filename = audioFilename(wordSet.sourceLang, item.original);
          return {
            filename,
            data: await generateSpeechMp3(
              item.original,
              wordSet.sourceLang.toUpperCase(),
              request.signal,
            ),
          };
        },
      );
      const audioFilenameByText = new Map(
        uniqueAudioItems.map((item, index) => [
          item.original.trim(),
          media[index].filename,
        ]),
      );
      ankiNotes = ankiNotes.map((note) => ({
        ...note,
        sourceAudio: audioFilenameByText.get(note.original.trim()),
      }));
    }

    // Keep the Anki deck stable across exports so re-imports update it.
    const dateStr = new Date().toISOString().split("T")[0];
    const deckSegment = wordSet.name.trim().replaceAll("::", " - ");
    const deckName = `Gooseberry::${wordSet.sourceLang}-${wordSet.targetLang}::${deckSegment}`;

    // Generate safe filename
    const safeFileName = wordSet.name.replace(/[^a-zA-Z0-9]/g, "_");

    if (format === "csv") {
      // Create CSV file
      const csvContent = createCsvContent(
        ankiNotes,
        wordSet.sourceLang.toUpperCase(),
        wordSet.targetLang.toUpperCase(),
      );

      const fileName = `${safeFileName}_${dateStr}.csv`;
      await updateLastExportedAt(id);

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
        media,
      );

      if (apkgBuffer.length > MAX_DIRECT_EXPORT_BYTES) {
        return NextResponse.json(
          {
            error:
              "This deck is too large to download with audio right now. Try exporting without AI pronunciation.",
          },
          { status: 413 },
        );
      }

      const fileName = `${safeFileName}_${dateStr}.apkg`;
      await updateLastExportedAt(id);

      // Return file (convert Buffer to Uint8Array for NextResponse)
      return new NextResponse(new Uint8Array(apkgBuffer), {
        status: 200,
        headers: {
          "Content-Type": "application/apkg",
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
