import assert from "node:assert/strict";
import test from "node:test";
import { createCsvContent } from "../src/lib/anki/csvExporter.ts";
import { sanitizeAnkiText } from "../src/lib/anki/import/mapping.ts";

// Independent CSV reader: exercise the exported record boundaries as well as
// its values, including quoted fields that contain tabs and multiple lines.
function readTsv(source) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let at = 0; at < source.length; at++) {
    const character = source[at];
    if (quoted) {
      if (character === '"' && source[at + 1] === '"') {
        field += '"';
        at++;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && !field) {
      quoted = true;
    } else if (character === "\t" || character === "\n") {
      row.push(field);
      field = "";
      if (character === "\n") {
        rows.push(row);
        row = [];
      }
    } else {
      field += character;
    }
  }
  assert.equal(quoted, false, "every quoted field must be closed");
  row.push(field);
  rows.push(row);
  return rows;
}

const note = (values = {}) => ({
  original: "sana",
  translation: "слово",
  wordForms: "",
  sample: "",
  sampleTranslation: "",
  comments: "",
  guid: "source-guid",
  tags: "shared finnish",
  ...values,
});

test("CSV import keeps encoded shared-deck scripts and media markup as literal plain text", () => {
  const original = sanitizeAnkiText(
    '&lt;script&gt;alert("shared; deck")&lt;/script&gt;',
  );
  const comments = sanitizeAnkiText(
    '&lt;img src="https://example.invalid/pixel" onerror="alert(1)"&gt;',
  );
  const csv = createCsvContent([note({ original, comments })], "fi", "ru");
  assert.ok(csv.startsWith("#separator:tab\n#html:false\n"));
  assert.equal(csv.includes("#html:true"), false);
  const records = readTsv(csv.split("\n").slice(4).join("\n"));
  assert.deepEqual(records[0], [
    '<script>alert("shared; deck")</script>',
    "слово",
    "",
    "",
    "",
    '<img src="https://example.invalid/pixel" onerror="alert(1)">',
    "source-guid",
    "shared finnish",
  ]);
});

test("plain CSV round-trips quotes, tabs, newlines, semicolons and Unicode across multiple notes", () => {
  const notes = [
    note({
      original: '"hei"; näkemiin',
      translation: "привет; пока",
      wordForms: "yksi\tkaksi",
      sample: 'Ensimmäinen "lause";\ntoinen lause.',
      sampleTranslation: "Первая строка.\r\nВторая строка.",
      comments: "A & B < C > D;\rnext line",
    }),
    note({ original: "toinen", guid: "second-guid", tags: "" }),
  ];
  const csv = createCsvContent(notes, "fi", "ru");
  const records = readTsv(csv.split("\n").slice(4).join("\n"));
  assert.deepEqual(
    records,
    notes.map((entry) => [
      entry.original,
      entry.translation,
      entry.wordForms,
      entry.sample,
      entry.sampleTranslation,
      entry.comments,
      entry.guid,
      entry.tags,
    ]),
  );
});
