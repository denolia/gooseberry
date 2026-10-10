import assert from "node:assert/strict";
import test, { before } from "node:test";
import { constants, zstdCompressSync } from "node:zlib";
import { unzipSync, zipSync } from "fflate";
import { Collection, Deck, Note, Notetype, Package } from "ankipack";
import {
  SQL,
  centralEntries,
  decompressDatabase,
  legacyDatabase,
  legacyPackage,
  initReaderSQL,
  rawZstd,
  readAnkiPackage,
} from "./helpers/ankiReader.mjs";

before(initReaderSQL);

test("legacy text import preserves exact IDs, personal schedules, negative queues and review history", () => {
  const progress = [];
  const result = readAnkiPackage(legacyPackage(), SQL, {}, (value) => progress.push(value.phase));
  assert.equal(result.packageVersion, 1);
  assert.equal(result.schemaVersion, 11);
  assert.equal(result.notes[0].id, "9007199254740995");
  assert.equal(result.notes[0].modelId, "9007199254740993");
  assert.deepEqual(result.notes[0].fields, ["hei!", "привет!"]);
  assert.deepEqual(result.notes[0].tags, ["lesson1", "important"]);
  assert.equal(result.cards[0].id, "9007199254740997");
  assert.equal(result.cards[0].queue, -1);
  assert.equal(result.cards[0].factor, 1300, "reading must not upgrade/repair legacy ease");
  assert.equal(result.cards[0].data, '{"pos":1,"lrt":1789505744}');
  assert.equal(result.revlogs[0].id, "9007199254740999");
  assert.equal(result.revlogs[0].ivl, -600);
  assert.equal(result.revlogs[0].time, 1234);
  assert.equal(result.configs[0].raw.new.perDay, 20);
  assert.equal(result.collection.config.schedVer, 2);
  assert.deepEqual(progress, ["archive", "database", "notes", "complete"]);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("legacy2 selects collection.anki21 instead of the dummy collection.anki2", () => {
  const bytes = zipSync({
    "collection.anki2": new TextEncoder().encode("dummy warning database"),
    "collection.anki21": legacyDatabase(),
  });
  const result = readAnkiPackage(bytes, SQL);
  assert.equal(result.packageVersion, 2);
  assert.equal(result.notes[0].fields[0], "hei!");
});

test("ignored media is never inflated, even with unsupported compression and huge advertised expansion", () => {
  const bytes = centralEntries(legacyPackage(undefined, { "0": new Uint8Array(1024), media: new Uint8Array([255]) }), (view, at, name) => {
    if (name === "0") {
      view.setUint16(at + 10, 99, true);
      view.setUint32(at + 24, 0x70000000, true);
    }
  });
  const result = readAnkiPackage(bytes, SQL);
  assert.equal(result.notes.length, 1);
  assert.equal(result.diagnostics.omittedMediaCount, 1);
  assert.equal("media" in result, false);
});

test("modern package reads note-type/deck protobufs and retains raw presets/history", async () => {
  const notetype = Notetype.basicAndReversed({ name: "Finnish vocabulary" });
  const deck = new Deck({ name: "Finnish::Lesson 2" });
  deck.addNote(new Note({ notetype, fields: ["kiitos", "спасибо"], guid: "modern-guid" }));
  const pkg = new Package();
  pkg.addDeck(deck);
  pkg.addMedia("ignored.mp3", new Uint8Array([1, 2, 3]));
  const data = await pkg.toCollection();
  Object.assign(data.cards[0], { type: 2, queue: -3, due: 610, ivl: 13, reps: 7, flags: 4 });
  data.revlog.push({ id: 1791393713238, cid: data.cards[0].id, usn: 0, ease: 4, ivl: 13, lastIvl: 7, factor: 2500, time: 1200, type: 1 });
  const bytes = await Collection.fromData(data).toUint8Array(SQL);
  const entries = unzipSync(bytes);
  // The fixture writer uses raw Zstd blocks. Exercise actual compressed blocks
  // as well, using Node's independent encoder and the browser's fzstd decoder.
  const database = decompressDatabase(entries["collection.anki21b"], 32 * 1024 * 1024);
  entries["collection.anki21b"] = zstdCompressSync(database);
  assert.ok(entries["collection.anki21b"].length < database.length / 2);
  const result = readAnkiPackage(zipSync(entries), SQL);
  assert.equal(result.packageVersion, 3);
  assert.equal(result.databaseFormat, "modern");
  assert.equal(result.schemaVersion, 18);
  assert.equal(result.models[0].name, "Finnish vocabulary");
  assert.deepEqual(result.models[0].fields.map((field) => field.name), ["Front", "Back"]);
  assert.match(result.models[0].templates[0].questionFormat, /\{\{Front\}\}/);
  assert.equal(result.decks.find((value) => value.name === "Finnish::Lesson 2").configId, result.configs.find((value) => value.name === "Finnish::Lesson 2 Config").id);
  assert.equal(typeof result.configs[0].raw.config.protobufBase64, "string");
  assert.equal(result.cards[0].queue, -3);
  assert.equal(result.cards[0].flags, 4);
  assert.equal(result.revlogs[0].cid, result.cards[0].id);
  assert.equal(result.diagnostics.omittedMediaCount, 1);
});

test("future package metadata never falls back to a legacy dummy database", () => {
  assert.throws(() => readAnkiPackage(legacyPackage(undefined, { meta: new Uint8Array([8, 99]) }), SQL), /version is not supported/);
});

test("limits cover archive bytes/entries, database expansion, rows and field text", () => {
  const bytes = legacyPackage();
  assert.throws(() => readAnkiPackage(bytes, SQL, { maxArchiveBytes: 20 }), /size limit/);
  assert.throws(() => readAnkiPackage(legacyPackage(undefined, { "0": new Uint8Array(), "1": new Uint8Array() }), SQL, { maxArchiveEntries: 2 }), /too many archive entries/);
  assert.throws(() => readAnkiPackage(bytes, SQL, { maxDatabaseBytes: 100 }), /database exceeds/);
  const forged = centralEntries(bytes, (view, at) => view.setUint32(at + 24, 1, true));
  assert.throws(() => readAnkiPackage(forged, SQL, { maxDatabaseBytes: 100 }), /expanded database exceeds/);
  assert.throws(() => readAnkiPackage(legacyPackage((db) => db.run("INSERT INTO notes SELECT 2,guid,mid,mod,usn,tags,flds,sfld,csum,flags,data FROM notes")), SQL, { maxNotes: 1 }), /row limit/);
  assert.throws(() => readAnkiPackage(bytes, SQL, { maxFieldBytes: 4 }), /field exceeds/);
  assert.throws(() => readAnkiPackage(bytes, SQL, { maxTotalTextBytes: 20 }), /too much text/);
});

test("unsafe ZIP paths, damaged checksums, malformed SQLite and schema views are rejected", () => {
  assert.throws(() => readAnkiPackage(legacyPackage(undefined, { "../media": new Uint8Array() }), SQL), /unsafe/);
  const damaged = centralEntries(legacyPackage(), (view, at) => view.setUint32(at + 16, 0, true));
  assert.throws(() => readAnkiPackage(damaged, SQL), /integrity check/);
  assert.throws(() => readAnkiPackage(zipSync({ "collection.anki2": new Uint8Array(100) }), SQL), /not a SQLite/);
  assert.throws(() => readAnkiPackage(legacyPackage((db) => db.run("DROP TABLE notes; CREATE VIEW notes AS SELECT load_extension('evil') AS id")), SQL), /ordinary notes table/);
  assert.throws(() => readAnkiPackage(legacyPackage((db) => db.run("UPDATE col SET ver=999")), SQL), /schema 999 is not supported/);
});

test("field counts, embedded NUL and oversized numeric JSON IDs are handled without losing data", () => {
  assert.throws(() => readAnkiPackage(legacyPackage((db) => db.run("UPDATE notes SET flds='only one field'")), SQL), /declared note-type fields/);
  assert.throws(() => readAnkiPackage(legacyPackage((db) => db.run("UPDATE notes SET flds=CAST(x'6869001f627965' AS TEXT)")), SQL), /NUL character/);
  assert.throws(() => readAnkiPackage(legacyPackage((db) => db.run("UPDATE cards SET data=CAST(x'7b7d006869' AS TEXT)")), SQL), /NUL character/);
  assert.throws(() => readAnkiPackage(legacyPackage((db) => db.run("UPDATE notes SET guid=NULL")), SQL), /note GUID text is invalid/);
  const result = readAnkiPackage(legacyPackage((db) => {
    db.run("UPDATE col SET decks=?", ['{"1":{"name":"Exact","conf":9007199254740993,"dyn":0}}']);
  }), SQL);
  assert.equal(result.decks[0].configId, "9007199254740993");
});

test("Zstandard output and frame windows are bounded before allocation", () => {
  const bytes = new TextEncoder().encode("a bounded frame");
  assert.deepEqual(decompressDatabase(rawZstd(bytes), 100), bytes);
  assert.throws(() => decompressDatabase(rawZstd(bytes), 5), /memory limit/);
  const hugeWindow = rawZstd(bytes);
  hugeWindow[4] = 0x80; // Four-byte size, explicit window descriptor.
  const padded = new Uint8Array(hugeWindow.length + 1);
  padded.set(hugeWindow.subarray(0, 5));
  padded[5] = 0x78; // 32 MiB window.
  padded.set(hugeWindow.subarray(5), 6);
  assert.throws(() => decompressDatabase(padded, 100), /memory limit/);
  assert.throws(() => decompressDatabase(rawZstd(bytes).subarray(0, 10), 100), /truncated/);
});

test("compressed Zstandard frames without declared content size have an independent output cap", () => {
  const bytes = new TextEncoder().encode("Many repeated note fields. ".repeat(10000));
  const compressed = zstdCompressSync(bytes, {
    params: { [constants.ZSTD_c_contentSizeFlag]: 0, [constants.ZSTD_c_windowLog]: 10 },
  });
  assert.ok(compressed.length < 10000);
  assert.deepEqual(decompressDatabase(compressed, bytes.length), bytes);
  assert.throws(() => decompressDatabase(compressed, 10000), /expanded database exceeds/);
  const both = new Uint8Array(compressed.length * 2);
  both.set(compressed);
  both.set(compressed, compressed.length);
  assert.throws(() => decompressDatabase(both, bytes.length), /expanded database exceeds/);
});
