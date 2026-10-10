import type { FieldMapping, NoteTypeMapping } from "./mapping";
import type { AnkiNoteType, AnkiPackage } from "./readerTypes";

export const MAX_IMPORT_EXAMPLE_PAIRS = 20;

const normalizedName = (value: string) =>
  value
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

export function suggestNoteTypeMappings(
  models: AnkiNoteType[],
): NoteTypeMapping[] {
  return models.map((model) => {
    const find = (aliases: string[]) => {
      for (const alias of aliases) {
        const field = model.fields.find(
          ({ name }) => normalizedName(name) === normalizedName(alias),
        );
        if (field) return field.ord;
      }
      return undefined;
    };
    const mapping = (
      field: number | undefined,
      separator = " ",
    ): FieldMapping => ({
      fields: field === undefined ? [] : [field],
      separator,
    });
    const examples: NonNullable<NoteTypeMapping["examples"]> = [];
    const sample = find(["Sample", "Example", "Example sentence", "Sentence"]);
    const translatedSample = find([
      "Sample Translation",
      "Example Translation",
      "Sentence Translation",
    ]);
    if (sample !== undefined || translatedSample !== undefined) {
      examples.push({
        sample: mapping(sample),
        translation: mapping(translatedSample),
      });
    }
    for (const field of model.fields) {
      if (examples.length >= MAX_IMPORT_EXAMPLE_PAIRS) break;
      const match = normalizedName(field.name).match(
        /^(?:example|sample)(\d+)(?:fin|fi|finnish|source)$/u,
      );
      if (!match) continue;
      const target = find([
        `example_${match[1]}_rus`,
        `example_${match[1]}_ru`,
        `example_${match[1]}_translation`,
        `sample_${match[1]}_translation`,
        `sample_${match[1]}_rus`,
      ]);
      examples.push({
        sample: mapping(field.ord),
        translation: mapping(target),
      });
    }
    return {
      modelId: model.id,
      skip: model.type !== 0,
      original: mapping(
        find([
          "Original",
          "Nominatiivi",
          "Finnish",
          "Suomi",
          "Word",
          "Term",
          "Front",
          "Expression",
        ]),
      ),
      translation: mapping(
        find([
          "Translation",
          "Back",
          "Meaning",
          "Russian",
          "Русский",
          "Перевод",
          "Definition",
        ]),
      ),
      wordForms: mapping(
        find(["Word Forms", "Forms", "Inflections", "Conjugation"]),
        " · ",
      ),
      comments: mapping(
        find(["Comments", "Comment", "Notes", "Explanation"]),
        "\n",
      ),
      examples,
    };
  });
}

export function selectImportContent(
  pkg: AnkiPackage,
  selectedDeckIds: readonly string[],
) {
  const deckIds = new Set(selectedDeckIds);
  const cards = pkg.cards.filter((card) => deckIds.has(card.did));
  const noteIds = new Set(cards.map((card) => card.nid));
  const cardIds = new Set(cards.map((card) => card.id));
  // Notes without cards have no deck assignment. Retain them when importing
  // the entire package, so incomplete source notes are not silently discarded.
  const allDecksSelected = pkg.decks.every((deck) => deckIds.has(deck.id));
  return {
    notes: pkg.notes.filter((note) => allDecksSelected || noteIds.has(note.id)),
    cards,
    revlogs: pkg.revlogs.filter((revlog) => cardIds.has(revlog.cid)),
  };
}

export function deckWithDescendants(
  pkg: AnkiPackage,
  deckId: string,
): string[] {
  const deck = pkg.decks.find(({ id }) => id === deckId);
  if (!deck) return [];
  return pkg.decks
    .filter(
      (candidate) =>
        candidate.id === deck.id || candidate.name.startsWith(`${deck.name}::`),
    )
    .map(({ id }) => id);
}

export function importDisplayName(fileName: string, pkg: AnkiPackage): string {
  const decksWithCards = pkg.decks.filter((deck) =>
    pkg.cards.some((card) => card.did === deck.id),
  );
  const roots = new Set(decksWithCards.map((deck) => deck.name.split("::")[0]));
  return roots.size === 1
    ? [...roots][0]
    : fileName.replace(/\.apkg$/iu, "").replaceAll("_", " ");
}

export function suggestedImportLanguages(pkg: AnkiPackage): {
  sourceLang?: string;
  targetLang?: string;
} {
  for (const model of pkg.models) {
    const note = pkg.notes.find((candidate) => candidate.modelId === model.id);
    if (!note) continue;
    const source = model.fields.find(
      ({ name }) => normalizedName(name) === "sourcelanguage",
    );
    const target = model.fields.find(
      ({ name }) => normalizedName(name) === "targetlanguage",
    );
    const sourceLang = source && note.fields[source.ord]?.trim().toLowerCase();
    const targetLang = target && note.fields[target.ord]?.trim().toLowerCase();
    if (sourceLang && targetLang) return { sourceLang, targetLang };
    if (
      model.fields.some(({ name }) => normalizedName(name) === "nominatiivi") &&
      model.fields.some(({ name }) =>
        /^(?:example|sample)\d+rus$/u.test(normalizedName(name)),
      )
    ) {
      return { sourceLang: "fi", targetLang: "ru" };
    }
  }
  return {};
}
