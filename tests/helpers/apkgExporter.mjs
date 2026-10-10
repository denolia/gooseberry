import { readFileSync } from "node:fs";
import * as ankipack from "ankipack";
import initSqlJs from "sql.js";
import ts from "@typescript/typescript6";
import * as templates from "../../src/lib/review/templates.ts";

// Resolve the application alias while exercising the real exporter, registry,
// SQLite runtime and package library in Node's test runner.
const code = ts.transpileModule(
  readFileSync(
    new URL("../../src/lib/anki/apkgExporter.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const exporter = {};
new Function("require", "exports", code)((name) => {
  const dependencies = {
    ankipack,
    "sql.js": { __esModule: true, default: initSqlJs },
    "@/lib/review/templates": templates,
  };
  if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
  return dependencies[name];
}, exporter);

export const {
  buildAnkiPackage,
  createApkgPackage,
  createGooseberryNotetype,
  GOOSEBERRY_FIELD_NAMES,
  GOOSEBERRY_NOTE_TYPE_ID,
  GOOSEBERRY_NOTE_TYPE_NAME,
  GOOSEBERRY_TEMPLATE_KEYS_BY_ORD,
} = exporter;
