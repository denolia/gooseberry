import AnkiExport from "anki-apkg-export";
import { AnkiNote } from "@/app/utils/ankiSchema";

export async function createApkgPackage(
  deckName: string,
  notes: AnkiNote[],
): Promise<Buffer> {
  const apkg = new AnkiExport(deckName);

  for (const note of notes) {
    apkg.addCard(
      // Front (original)
      note.original,
      // Back (all other fields formatted)
      formatBackSide(note),
      {
        guid: note.guid,
        tags: note.tags.split(" ").filter((t) => t.length > 0),
      },
    );
  }

  const zip = await apkg.save();
  return Buffer.from(new Uint8Array(zip));
}

function formatBackSide(note: AnkiNote): string {
  const parts: string[] = [];

  // Translation (always show)
  parts.push(`<div><strong>Translation:</strong> ${note.translation}</div>`);

  // Word forms (if present)
  if (note.wordForms) {
    parts.push(`<div><strong>Forms:</strong> ${note.wordForms}</div>`);
  }

  // Examples (if present)
  if (note.sample) {
    const samples = note.sample.split("; ");
    parts.push(
      `<div><strong>Examples:</strong><br>${samples.join("<br>")}</div>`,
    );
  }

  // Example translations (if present)
  if (note.sampleTranslation) {
    const translations = note.sampleTranslation.split("; ");
    parts.push(
      `<div><strong>Translations:</strong><br>${translations.join("<br>")}</div>`,
    );
  }

  // Comments (if present)
  if (note.comments) {
    parts.push(`<div><strong>Notes:</strong> ${note.comments}</div>`);
  }

  // Hidden source ID for debugging
  parts.push(`<div style="display:none">SourceId: ${note.sourceId}</div>`);

  return parts.join("\n");
}
