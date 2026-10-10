import { readFileSync } from "node:fs";
import ts from "@typescript/typescript6";
import * as fflate from "fflate";
import * as fzstd from "fzstd";
import initSqlJs from "sql.js";

function transpile(path, dependencies) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", code)((name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

const archive = transpile("../../src/lib/anki/import/archive.ts", { fflate, fzstd });
const protobuf = transpile("../../src/lib/anki/import/protobuf.ts", { "./archive": archive });
const reader = transpile("../../src/lib/anki/import/reader.ts", {
  "./archive": archive,
  "./protobuf": protobuf,
});

export const { readAnkiPackage, DEFAULT_ANKI_IMPORT_LIMITS, AnkiPackageError } = reader;
export const { inspectArchive, decompressDatabase } = archive;
export let SQL;
export async function initReaderSQL() {
  SQL = await initSqlJs();
  return SQL;
}

export function legacyDatabase(change) {
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE col (id INTEGER PRIMARY KEY,crt INTEGER,mod INTEGER,scm INTEGER,ver INTEGER,dty INTEGER,usn INTEGER,ls INTEGER,conf TEXT,models TEXT,decks TEXT,dconf TEXT,tags TEXT);
    CREATE TABLE notes (id INTEGER PRIMARY KEY,guid TEXT,mid INTEGER,mod INTEGER,usn INTEGER,tags TEXT,flds TEXT,sfld TEXT,csum INTEGER,flags INTEGER,data TEXT);
    CREATE TABLE cards (id INTEGER PRIMARY KEY,nid INTEGER,did INTEGER,ord INTEGER,mod INTEGER,usn INTEGER,type INTEGER,queue INTEGER,due INTEGER,ivl INTEGER,factor INTEGER,reps INTEGER,lapses INTEGER,left INTEGER,odue INTEGER,odid INTEGER,flags INTEGER,data TEXT);
    CREATE TABLE revlog (id INTEGER PRIMARY KEY,cid INTEGER,usn INTEGER,ease INTEGER,ivl INTEGER,lastIvl INTEGER,factor INTEGER,time INTEGER,type INTEGER);
  `);
  const model = { name: "Vocabulary", type: 0, css: ".card { color: red; }", flds: [{ name: "Front", ord: 0 }, { name: "Back", ord: 1 }], tmpls: [{ name: "Recognition", ord: 0, qfmt: "{{Front}}", afmt: "{{Back}}" }] };
  db.run("INSERT INTO col VALUES (1,1600000000,0,0,11,0,0,0,?,?,?,?,?)", [
    JSON.stringify({ schedVer: 2, sched2021: true, creationOffset: -120 }),
    JSON.stringify({ "9007199254740993": model }),
    JSON.stringify({ "1": { name: "Finnish::Lesson 1", conf: 1, dyn: 0 } }),
    JSON.stringify({ "1": { name: "Default", new: { perDay: 20, delays: [1, 10] }, rev: { perDay: 200 }, desiredRetention: 0.9 } }), "{}",
  ]);
  db.run("INSERT INTO notes VALUES (?, 'stable-note-guid', ?, 0,0,' lesson1 important ','hei!\u001fпривет!','hei!',0,0,'')", ["9007199254740995", "9007199254740993"]);
  db.run("INSERT INTO cards VALUES (?, ?,1,0,0,0,2,-1,610,37,1300,11,1,0,0,0,3,?)", ["9007199254740997", "9007199254740995", '{"pos":1,"lrt":1789505744}']);
  db.run("INSERT INTO revlog VALUES (?, ?,0,3,-600,2,2500,1234,0)", ["9007199254740999", "9007199254740997"]);
  change?.(db);
  const bytes = db.export();
  db.close();
  return bytes;
}

export function legacyPackage(change, extra = {}) {
  return fflate.zipSync({ "collection.anki2": legacyDatabase(change), ...extra });
}

export function centralEntries(bytes, visit) {
  const result = bytes.slice();
  const view = new DataView(result.buffer);
  const decoder = new TextDecoder();
  for (let at = 0; at < result.length - 46; at++) {
    if (view.getUint32(at, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(at + 28, true);
    const name = decoder.decode(result.subarray(at + 46, at + 46 + nameLength));
    visit(view, at, name);
    at += 45 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return result;
}

export function rawZstd(bytes) {
  const blockCount = Math.max(1, Math.ceil(bytes.length / 65536));
  const out = new Uint8Array(9 + blockCount * 3 + bytes.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0xfd2fb528, true);
  out[4] = 0xa0; // Single segment, four-byte content size.
  view.setUint32(5, bytes.length, true);
  let at = 9;
  for (let i = 0; i < blockCount; i++) {
    const chunk = bytes.subarray(i * 65536, (i + 1) * 65536);
    const header = (chunk.length << 3) | (i === blockCount - 1 ? 1 : 0);
    out[at++] = header & 255;
    out[at++] = (header >>> 8) & 255;
    out[at++] = (header >>> 16) & 255;
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
