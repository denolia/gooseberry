import type { AnkiNote, AnkiNoteType } from "./readerTypes";

export type FieldMapping = { fields: number[]; separator: string };
export type NoteTypeMapping = {
  modelId: string;
  skip?: boolean;
  original: FieldMapping;
  translation: FieldMapping;
  wordForms?: FieldMapping;
  comments?: FieldMapping;
  examples?: { sample: FieldMapping; translation: FieldMapping }[];
};
export type ImportMappedContent = {
  original: string;
  translation: string;
  wordForms: string;
  sample: string;
  sampleTranslation: string;
  comments: string;
  tags: string;
  examplePairs: { sample: string; translation: string }[];
  fieldOrigins: Record<string, unknown>;
  needsAttention: string[];
  skipped: boolean;
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  auml: "ä",
  Auml: "Ä",
  ouml: "ö",
  Ouml: "Ö",
  uuml: "ü",
  Uuml: "Ü",
  aring: "å",
  Aring: "Å",
  szlig: "ß",
  eacute: "é",
  Eacute: "É",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
};

// This produces plain text, never HTML. Source markup is retained privately in
// the source archive, while imported content is rendered through React text.
export function sanitizeAnkiText(value: string): string {
  return value
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(
      /<(script|style|audio|video|iframe|object)\b[^<>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,
      "",
    )
    .replace(/\[sound:[^\]]*(?:\]|$)/gi, "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:div|p|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^<>]*>/g, "")
    .replace(
      /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi,
      (entity, name: string) => {
        if (!name.startsWith("#")) return ENTITIES[name] ?? entity;
        const point =
          name[1].toLowerCase() === "x"
            ? Number.parseInt(name.slice(2), 16)
            : Number.parseInt(name.slice(1), 10);
        return point > 0 &&
          point <= 0x10ffff &&
          !(point >= 0xd800 && point <= 0xdfff)
          ? String.fromCodePoint(point)
          : "";
      },
    )
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function unsupportedNoteTypeReason(model: AnkiNoteType): string | null {
  if (model.type !== 0)
    return "Cloze and other nonstandard note types are not supported yet.";
  if (
    /image[\s_-]*occlusion/i.test(model.name) ||
    model.templates.some((template) =>
      /\{\{\s*(?:cloze|type:cloze)\s*:|image[\s_-]*occlusion/i.test(
        template.questionFormat + template.answerFormat,
      ),
    )
  ) {
    return "Cloze and image occlusion templates are not supported yet.";
  }
  return null;
}

export function mapAnkiNote(
  note: AnkiNote,
  mapping: NoteTypeMapping | undefined,
  model: AnkiNoteType,
): ImportMappedContent {
  const extract = (selection?: FieldMapping) =>
    (selection?.fields ?? [])
      .map((ordinal) => sanitizeAnkiText(note.fields[ordinal] ?? ""))
      .filter(Boolean)
      .join(selection?.separator ?? "\n");
  const examplePairs = (mapping?.examples ?? []).map((pair) => ({
    sample: extract(pair.sample),
    translation: extract(pair.translation),
  }));
  const completeExample = examplePairs.find(
    (pair) => pair.sample && pair.translation,
  );
  const result: ImportMappedContent = {
    original: extract(mapping?.original),
    translation: extract(mapping?.translation),
    wordForms: extract(mapping?.wordForms),
    sample: completeExample?.sample ?? "",
    sampleTranslation: completeExample?.translation ?? "",
    comments: extract(mapping?.comments),
    tags: note.tags.map(sanitizeAnkiText).filter(Boolean).join(" "),
    examplePairs,
    fieldOrigins: {},
    needsAttention: [],
    skipped: !mapping || !!mapping.skip || !!unsupportedNoteTypeReason(model),
  };
  for (const field of [
    "original",
    "translation",
    "wordForms",
    "comments",
  ] as const) {
    if (result[field])
      result.fieldOrigins[field] = {
        origin: "imported",
        fields: mapping?.[field]?.fields ?? [],
      };
  }
  if (examplePairs.length)
    result.fieldOrigins.examplePairs = {
      origin: "imported",
      pairs: mapping?.examples,
    };
  if (result.sample) {
    result.fieldOrigins.sample = { origin: "imported" };
    result.fieldOrigins.sampleTranslation = { origin: "imported" };
  }
  if (!result.original) result.needsAttention.push("original");
  if (!result.translation) result.needsAttention.push("translation");
  return result;
}
