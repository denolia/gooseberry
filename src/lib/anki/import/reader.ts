import type { Database, SqlJsStatic, SqlValue } from "sql.js";
import { AnkiPackageError, decompressDatabase, inspectArchive } from "./archive";
import { base64, protobufBytes, protobufFields, protobufInteger, protobufText } from "./protobuf";
import type {
  AnkiCard,
  AnkiDeck,
  AnkiDeckConfig,
  AnkiImportLimits,
  AnkiJsonValue,
  AnkiNoteType,
  AnkiPackage,
  AnkiRawRecord,
  AnkiReadProgress,
  AnkiRevlog,
} from "./readerTypes";

export { AnkiPackageError } from "./archive";

export const DEFAULT_ANKI_IMPORT_LIMITS: Readonly<AnkiImportLimits> = {
  maxArchiveBytes: 100 * 1024 * 1024,
  maxArchiveEntries: 20000,
  maxDatabaseBytes: 32 * 1024 * 1024,
  maxNotes: 20000,
  maxCards: 100000,
  maxRevlogs: 200000,
  maxModels: 200,
  maxDecks: 2000,
  maxFieldsPerNote: 128,
  maxFieldBytes: 200000,
  maxTotalTextBytes: 16 * 1024 * 1024,
};

type Row = Record<string, SqlValue>;
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const textEncoder = new TextEncoder();

function integer(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new AnkiPackageError(`The ${label} integer is invalid or exceeds safe precision.`);
  return value;
}

function stringValue(value: unknown, label: string) {
  if (typeof value !== "string")
    throw new AnkiPackageError(`The ${label} text is invalid.`);
  return value;
}

function identifier(value: unknown, label: string): string {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return value;
  throw new AnkiPackageError(`The ${label} identifier is invalid.`);
}

function object(value: unknown, label: string): AnkiRawRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AnkiPackageError(`The ${label} configuration must be an object.`);
  return value as AnkiRawRecord;
}

// Keep large JSON integer IDs exact on browsers without JSON.parse source
// context. Strings are matched as complete tokens, so their digits are untouched.
function parseJson(source: string, label: string): AnkiJsonValue {
  let depth = 0;
  const exact = source.replace(
    /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\]]/g,
    (token) => {
      if (token === "{" || token === "[") {
        if (++depth > 40) throw new AnkiPackageError("An Anki JSON record is nested too deeply.");
      } else if (token === "}" || token === "]") {
        depth--;
      } else if (/^-?\d+$/.test(token) && !Number.isSafeInteger(Number(token))) {
        return JSON.stringify(token);
      }
      return token;
    },
  );
  try {
    return JSON.parse(exact) as AnkiJsonValue;
  } catch {
    throw new AnkiPackageError(`The ${label} configuration is not valid JSON.`);
  }
}

function readRows(db: Database, query: string, maxRows: number): Row[] {
  const statement = db.prepare(query);
  const result: Row[] = [];
  try {
    while (statement.step()) {
      if (result.length >= maxRows)
        throw new AnkiPackageError("The collection exceeds the import row limit.");
      result.push(statement.getAsObject());
    }
  } finally {
    statement.free();
  }
  return result;
}

function textBudget(limits: AnkiImportLimits) {
  let total = 0;
  function charge(bytes: number) {
    total += bytes;
    if (total > limits.maxTotalTextBytes)
      throw new AnkiPackageError("The collection contains too much text/configuration data.");
  }
  return {
    text(value: unknown, label: string, combined = false) {
      if (typeof value !== "string" || value.includes("\0"))
        throw new AnkiPackageError(`The ${label} text is invalid.`);
      const length = textEncoder.encode(value).length;
      if (!combined && length > limits.maxFieldBytes)
        throw new AnkiPackageError(`The ${label} field exceeds the import size limit.`);
      charge(length);
      return value;
    },
    blob(value: unknown, label: string) {
      if (!(value instanceof Uint8Array) || value.length > limits.maxFieldBytes)
        throw new AnkiPackageError(`The ${label} configuration exceeds the import limit.`);
      charge(Math.ceil(value.length / 3) * 4);
      return value;
    },
    row(row: Row): AnkiRawRecord {
      const result: AnkiRawRecord = Object.create(null);
      for (const [key, value] of Object.entries(row)) {
        result[key] = value instanceof Uint8Array
          ? { protobufBase64: base64(this.blob(value, key)) }
          : typeof value === "string"
            ? this.text(value, key, key === "flds" || ["models", "decks", "dconf", "conf"].includes(key))
            : value;
      }
      return result;
    },
  };
}

type Budget = ReturnType<typeof textBudget>;

function legacyModels(source: string, budget: Budget, limits: AnkiImportLimits) {
  const records = Object.entries(object(parseJson(source, "note types"), "note types"));
  if (records.length > limits.maxModels)
    throw new AnkiPackageError("The package contains too many note types.");
  return records.map(([id, value]): AnkiNoteType => {
    const raw = object(value, "note type");
    identifier(id, "note type");
    if (!Array.isArray(raw.flds) || !Array.isArray(raw.tmpls) ||
        raw.flds.length > limits.maxFieldsPerNote || raw.tmpls.length > limits.maxFieldsPerNote)
      throw new AnkiPackageError("The note type has invalid fields or templates.");
    const fields = raw.flds.map((field, index) => {
      const definition = object(field, "note field");
      return {
        name: budget.text(definition.name, "field name"),
        ord: integer(definition.ord ?? index, "field ordinal"),
        raw: definition,
      };
    }).sort((a, b) => a.ord - b.ord);
    if (fields.some((field, index) => field.ord !== index))
      throw new AnkiPackageError("The note type field ordinals are invalid.");
    return {
      id,
      name: budget.text(raw.name, "note type name"),
      type: integer(raw.type ?? 0, "note type kind"),
      css: budget.text(raw.css ?? "", "note type CSS"),
      fields,
      templates: raw.tmpls.map((template, index) => {
        const definition = object(template, "template");
        return {
          name: budget.text(definition.name, "template name"),
          ord: integer(definition.ord ?? index, "template ordinal"),
          questionFormat: budget.text(definition.qfmt ?? "", "question template"),
          answerFormat: budget.text(definition.afmt ?? "", "answer template"),
          raw: definition,
        };
      }),
      raw,
    };
  });
}

function modernModels(db: Database, budget: Budget, limits: AnkiImportLimits) {
  const models = readRows(db, "SELECT CAST(id AS TEXT) AS id, name, mtime_secs, usn, config FROM notetypes NOT INDEXED", limits.maxModels);
  const fields = readRows(db, "SELECT CAST(ntid AS TEXT) AS ntid, ord, name, config FROM fields NOT INDEXED", limits.maxModels * limits.maxFieldsPerNote);
  const templates = readRows(db, "SELECT CAST(ntid AS TEXT) AS ntid, ord, name, mtime_secs, usn, config FROM templates NOT INDEXED", limits.maxModels * limits.maxFieldsPerNote);
  return models.map((row): AnkiNoteType => {
    const id = identifier(row.id, "note type");
    const raw = budget.row(row);
    const config = protobufFields(row.config as Uint8Array);
    const noteFields = fields.filter((field) => field.ntid === id).map((field) => ({
      name: stringValue(field.name, "field name"),
      ord: integer(field.ord, "field ordinal"),
      raw: budget.row(field),
    })).sort((a, b) => a.ord - b.ord);
    if (noteFields.length > limits.maxFieldsPerNote || noteFields.some((field, index) => field.ord !== index))
      throw new AnkiPackageError("The note type field ordinals are invalid.");
    const noteTemplates = templates.filter((template) => template.ntid === id);
    if (noteTemplates.length > limits.maxFieldsPerNote)
      throw new AnkiPackageError("The note type has too many templates.");
    return {
      id,
      name: stringValue(row.name, "note type name"),
      type: integer(Number(protobufInteger(config, 1)), "note type kind"),
      css: budget.text(protobufText(config, 3), "note type CSS"),
      fields: noteFields,
      templates: noteTemplates.map((template) => {
        const rawTemplate = budget.row(template);
        const config = protobufFields(template.config as Uint8Array);
        return {
          name: stringValue(template.name, "template name"),
          ord: integer(template.ord, "template ordinal"),
          questionFormat: budget.text(protobufText(config, 1), "question template"),
          answerFormat: budget.text(protobufText(config, 2), "answer template"),
          raw: rawTemplate,
        };
      }),
      raw,
    };
  });
}

function legacyDecks(source: string, budget: Budget, limits: AnkiImportLimits): AnkiDeck[] {
  const records = Object.entries(object(parseJson(source, "decks"), "decks"));
  if (records.length > limits.maxDecks)
    throw new AnkiPackageError("The package contains too many decks.");
  return records.map(([id, value]) => {
    const raw = object(value, "deck");
    return {
      id: identifier(id, "deck"),
      name: budget.text(raw.name, "deck name"),
      configId: raw.dyn ? null : raw.conf === undefined ? null : identifier(raw.conf, "preset"),
      raw,
    };
  });
}

function modernDecks(db: Database, budget: Budget, limits: AnkiImportLimits): AnkiDeck[] {
  return readRows(db, "SELECT CAST(id AS TEXT) AS id, name, mtime_secs, usn, common, kind FROM decks NOT INDEXED", limits.maxDecks).map((row) => {
    const raw = budget.row(row);
    const kind = protobufFields(row.kind as Uint8Array);
    const normal = protobufBytes(kind, 1);
    return {
      id: identifier(row.id, "deck"),
      name: stringValue(row.name, "deck name").replace(/\x1f/g, "::"),
      configId: kind.has(1) ? protobufInteger(protobufFields(normal), 1) : null,
      raw,
    };
  });
}

function legacyConfigs(source: string, budget: Budget, limits: AnkiImportLimits): AnkiDeckConfig[] {
  const records = Object.entries(object(parseJson(source, "presets"), "presets"));
  if (records.length > limits.maxDecks)
    throw new AnkiPackageError("The package contains too many review presets.");
  return records.map(([id, value]) => {
    const raw = object(value, "preset");
    return { id: identifier(id, "preset"), name: budget.text(raw.name ?? "", "preset name"), raw };
  });
}

function checkTables(db: Database, modern: boolean) {
  const required = ["col", "notes", "cards", "revlog", ...(modern ? ["notetypes", "fields", "templates", "decks", "deck_config", "config"] : [])];
  const tables = readRows(db, "SELECT name, type, sql FROM sqlite_master WHERE name IN ('col','notes','cards','revlog','notetypes','fields','templates','decks','deck_config','config')", 20);
  for (const name of required) {
    const definition = tables.find((table) => table.name === name);
    if (!definition || definition.type !== "table" || /\bvirtual\s+table\b/i.test(String(definition.sql)))
      throw new AnkiPackageError(`The collection has no ordinary ${name} table.`);
  }
}

// sql.js converts TEXT via C strings. Reject NUL bytes before that conversion
// can silently truncate fields, JSON metadata, names or retained source data.
function checkTextColumns(db: Database, modern: boolean) {
  const columns = modern ? [
    ["notetypes", "name"], ["fields", "name"], ["templates", "name"],
    ["decks", "name"], ["deck_config", "name"], ["config", "key"],
  ] : [
    ["col", "conf", "models", "decks", "dconf", "tags"],
    ["notes", "guid", "tags", "flds", "sfld", "data"], ["cards", "data"],
  ];
  for (const [table, ...names] of columns) {
    const conditions = names.map((name) => `instr(CAST(${name} AS BLOB), x'00') > 0`).join(" OR ");
    if (readRows(db, `SELECT 1 FROM ${table} NOT INDEXED WHERE ${conditions} LIMIT 1`, 1).length)
      throw new AnkiPackageError("An Anki text value contains an embedded NUL character.");
  }
}

/** Browser-worker-compatible, selective reader. Caller owns the local SQL WASM. */
export function readAnkiPackage(
  bytes: Uint8Array,
  SQL: SqlJsStatic,
  overrides: Partial<AnkiImportLimits> = {},
  onProgress?: (progress: AnkiReadProgress) => void,
): AnkiPackage {
  const limits = { ...DEFAULT_ANKI_IMPORT_LIMITS, ...overrides };
  if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value <= 0))
    throw new AnkiPackageError("Import limits must be positive safe integers.");
  if (bytes.length > limits.maxArchiveBytes)
    throw new AnkiPackageError("The APKG file exceeds the upload size limit.");
  onProgress?.({ phase: "archive" });
  let db: Database | undefined;
  try {
    const archive = inspectArchive(bytes, limits.maxArchiveEntries);
    const meta = archive.entries.has("meta") ? archive.extract("meta", 65536) : undefined;
    const version = meta
      ? Number(protobufInteger(protobufFields(meta), 1))
      : archive.entries.has("collection.anki21") ? 2 : 1;
    if (version !== 1 && version !== 2 && version !== 3)
      throw new AnkiPackageError("This Anki package version is not supported. Re-export using a compatible format.");
    const filename = { 1: "collection.anki2", 2: "collection.anki21", 3: "collection.anki21b" }[version];
    const stored = archive.extract(filename, limits.maxDatabaseBytes + (version === 3 ? 1024 * 1024 : 0));
    const database = version === 3 ? decompressDatabase(stored, limits.maxDatabaseBytes) : stored;
    const sqliteHeader = textEncoder.encode("SQLite format 3\0");
    if (database.length < 100 || !database.subarray(0, 16).every((byte, i) => byte === sqliteHeader[i]))
      throw new AnkiPackageError("The selected Anki collection is not a SQLite database.");
    onProgress?.({ phase: "database" });
    db = new SQL.Database(database);
    db.run("PRAGMA trusted_schema = OFF; PRAGMA query_only = ON; PRAGMA cell_size_check = ON; PRAGMA temp_store = MEMORY; PRAGMA cache_size = -4096;");
    checkTables(db, false);
    checkTextColumns(db, false);
    const budget = textBudget(limits);
    const col = readRows(db, "SELECT CAST(id AS TEXT) AS id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags FROM col NOT INDEXED", 1)[0];
    if (!col) throw new AnkiPackageError("The Anki collection metadata is missing.");
    const raw = budget.row(col);
    const schemaVersion = integer(col.ver, "schema version");
    if (schemaVersion !== 11 && schemaVersion !== 18)
      throw new AnkiPackageError(`Anki schema ${schemaVersion} is not supported; supported schemas are 11 and 18.`);
    const modern = schemaVersion === 18;
    checkTables(db, modern);
    if (modern) checkTextColumns(db, true);
    const models = modern ? modernModels(db, budget, limits) : legacyModels(col.models as string, budget, limits);
    const decks = modern ? modernDecks(db, budget, limits) : legacyDecks(col.decks as string, budget, limits);
    const configs: AnkiDeckConfig[] = modern
      ? readRows(db, "SELECT CAST(id AS TEXT) AS id, name, mtime_secs, usn, config FROM deck_config NOT INDEXED", limits.maxDecks).map((row) => ({
          id: identifier(row.id, "preset"), name: stringValue(row.name, "preset name"), raw: budget.row(row),
        }))
      : legacyConfigs(col.dconf as string, budget, limits);
    const config: AnkiRawRecord = modern ? Object.create(null) : object(parseJson(col.conf as string || "{}", "collection"), "collection");
    if (modern) {
      const sourceConfig: AnkiRawRecord = Object.create(null);
      for (const row of readRows(db, "SELECT key, usn, mtime_secs, val FROM config NOT INDEXED", 10000)) {
        const key = budget.text(row.key, "configuration key");
        sourceConfig[key] = budget.row(row);
        try {
          config[key] = parseJson(textDecoder.decode(row.val as Uint8Array), key);
        } catch {
          // Config values are opaque by Anki's contract. Keep bytes exactly even
          // when a future key does not contain JSON.
        }
      }
      raw.configRows = sourceConfig;
    }
    onProgress?.({ phase: "notes" });
    const modelsById = new Map(models.map((model) => [model.id, model]));
    const notes = readRows(db, "SELECT CAST(id AS TEXT) AS id, guid, CAST(mid AS TEXT) AS mid, mod, usn, tags, flds, sfld, csum, flags, data FROM notes NOT INDEXED", limits.maxNotes).map((row) => {
      const raw = budget.row(row);
      const fields = (row.flds as string).split("\x1f");
      const modelId = identifier(row.mid, "note type");
      if (fields.length > limits.maxFieldsPerNote || fields.some((field) => textEncoder.encode(field).length > limits.maxFieldBytes))
        throw new AnkiPackageError("An Anki note field exceeds the import limit.");
      if (fields.length !== modelsById.get(modelId)?.fields.length)
        throw new AnkiPackageError("An Anki note does not match its declared note-type fields.");
      return {
        id: identifier(row.id, "note"), guid: stringValue(row.guid, "note GUID"), modelId, fields,
        tags: (row.tags as string).trim().split(/\s+/u).filter(Boolean), raw,
      };
    });
    const cards = readRows(db, "SELECT CAST(id AS TEXT) AS id, CAST(nid AS TEXT) AS nid, CAST(did AS TEXT) AS did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, CAST(odid AS TEXT) AS odid, flags, data FROM cards NOT INDEXED", limits.maxCards).map((row): AnkiCard => {
      const result: Record<string, string | number> = {};
      for (const [key, value] of Object.entries(row))
        result[key] = ["id", "nid", "did", "odid"].includes(key)
          ? identifier(value, key)
          : key === "data" ? budget.text(value, "card data") : integer(value, key);
      return result as AnkiCard;
    });
    const revlogs = readRows(db, "SELECT CAST(id AS TEXT) AS id, CAST(cid AS TEXT) AS cid, usn, ease, ivl, lastIvl, factor, time, type FROM revlog NOT INDEXED", limits.maxRevlogs).map((row): AnkiRevlog => {
      const result: Record<string, string | number> = {};
      for (const [key, value] of Object.entries(row))
        result[key] = key === "id" || key === "cid" ? identifier(value, key) : integer(value, key);
      return result as AnkiRevlog;
    });
    const noteIds = new Set(notes.map((note) => note.id));
    const cardIds = new Set(cards.map((card) => card.id));
    const deckIds = new Set(decks.map((deck) => deck.id));
    if (cards.some((card) => !noteIds.has(card.nid) || !deckIds.has(card.did)) || revlogs.some((row) => !cardIds.has(row.cid)))
      throw new AnkiPackageError("The collection contains orphaned cards or review history.");
    const warnings = ["Anki schedules and review presets are preserved as source metadata; Gooseberry starts with fresh exercise schedules."];
    if (archive.omittedMediaCount)
      warnings.push(`${archive.omittedMediaCount} media entries were omitted without decompression.`);
    onProgress?.({ phase: "complete" });
    return {
      packageVersion: version, databaseFormat: modern ? "modern" : "legacy", schemaVersion,
      models, decks, configs, notes, cards, revlogs,
      collection: { creationTime: integer(col.crt, "collection creation time"), config, raw },
      diagnostics: { sourceBytes: bytes.length, databaseBytes: database.length, omittedMediaCount: archive.omittedMediaCount, warnings },
    };
  } catch (error) {
    if (error instanceof AnkiPackageError) throw error;
    throw new AnkiPackageError(`The Anki package could not be read: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    db?.close();
  }
}
