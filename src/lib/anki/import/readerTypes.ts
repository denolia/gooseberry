// JSON-safe source records. Protobuf blobs are retained as base64 in `raw`;
// source schedules/configuration are never converted into Gooseberry state here.
export type AnkiJsonValue =
  | string
  | number
  | boolean
  | null
  | AnkiJsonValue[]
  | { [key: string]: AnkiJsonValue };
export type AnkiRawRecord = Record<string, AnkiJsonValue>;

export type AnkiNoteType = {
  id: string;
  name: string;
  type: number;
  fields: { name: string; ord: number; raw: AnkiRawRecord }[];
  templates: {
    name: string;
    ord: number;
    questionFormat: string;
    answerFormat: string;
    raw: AnkiRawRecord;
  }[];
  css: string;
  raw: AnkiRawRecord;
};

export type AnkiDeck = {
  id: string;
  name: string;
  configId: string | null;
  raw: AnkiRawRecord;
};

export type AnkiDeckConfig = {
  id: string;
  name: string;
  raw: AnkiRawRecord;
};

export type AnkiNote = {
  id: string;
  guid: string;
  modelId: string;
  fields: string[];
  tags: string[];
  raw: AnkiRawRecord;
};

export type AnkiCard = {
  id: string;
  nid: string;
  did: string;
  ord: number;
  mod: number;
  usn: number;
  type: number;
  queue: number;
  due: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
  left: number;
  odue: number;
  odid: string;
  flags: number;
  data: string;
};

export type AnkiRevlog = {
  id: string;
  cid: string;
  usn: number;
  ease: number;
  ivl: number;
  lastIvl: number;
  factor: number;
  time: number;
  type: number;
};

export type AnkiPackage = {
  packageVersion: 1 | 2 | 3;
  databaseFormat: "legacy" | "modern";
  schemaVersion: number;
  models: AnkiNoteType[];
  decks: AnkiDeck[];
  configs: AnkiDeckConfig[];
  notes: AnkiNote[];
  cards: AnkiCard[];
  revlogs: AnkiRevlog[];
  collection: {
    creationTime: number;
    config: AnkiRawRecord;
    raw: AnkiRawRecord;
  };
  diagnostics: {
    sourceBytes: number;
    databaseBytes: number;
    omittedMediaCount: number;
    warnings: string[];
  };
};

export type AnkiImportLimits = {
  maxArchiveBytes: number;
  maxArchiveEntries: number;
  maxDatabaseBytes: number;
  maxNotes: number;
  maxCards: number;
  maxRevlogs: number;
  maxModels: number;
  maxDecks: number;
  maxFieldsPerNote: number;
  maxFieldBytes: number;
  maxTotalTextBytes: number;
};

export type AnkiReadProgress = {
  phase: "archive" | "database" | "notes" | "complete";
};
