import { AnkiNote } from "@/app/utils/ankiSchema";

/**
 * Creates a CSV file compatible with Anki import
 * Format: Tab-separated values with one row per word
 * Fields: original, translation, wordForms, sample, sampleTranslation, comments, tags
 */
export function createCsvContent(
  notes: AnkiNote[],
  sourceLang: string = "DE",
  targetLang: string = "RU",
): string {
  const rows: string[] = [];

  // Add Anki directives and header
  rows.push("#separator:tab");
  rows.push("#html:true");
  rows.push("#tags column:8");
  rows.push(
    "# Original\tTranslation\tWord Forms\tSample\tSample Translation\tComments\tGUID\tTags",
  );

  for (const note of notes) {
    rows.push(
      formatCsvRow([
        note.original,
        note.translation,
        note.wordForms || "",
        note.sample || "",
        note.sampleTranslation || "",
        note.comments || "",
        note.guid || "",
        note.tags || "",
      ]),
    );
  }

  return rows.join("\n");
}

/**
 * Formats a row for CSV export
 * Uses tab separator and escapes special characters
 */
function formatCsvRow(fields: string[]): string {
  return fields
    .map((field) => {
      // Escape quotes by doubling them, and wrap in quotes if contains tab, newline, or quote
      const needsQuotes =
        field.includes("\t") || field.includes("\n") || field.includes('"');
      const escaped = field.replace(/"/g, '""');
      return needsQuotes ? `"${escaped}"` : escaped;
    })
    .join("\t");
}
