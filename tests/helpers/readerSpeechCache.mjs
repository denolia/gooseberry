import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "@typescript/typescript6";

export function loadReaderSpeechCache({
  entries = new Map(),
  read,
  write,
} = {}) {
  const reads = [];
  const writes = [];
  const warnings = [];
  const code = ts.transpileModule(
    readFileSync(
      new URL("../../src/lib/audio/readerSpeechCache.ts", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const exports = {};
  new Function("require", "exports", "console", code)(
    (name) => {
      if (name === "node:crypto") return { createHash };
      if (name !== "@/db/speechCacheRepo")
        throw new Error(`Unexpected dependency ${name}`);
      return {
        getCachedSpeech: async (key) => {
          reads.push(key);
          return read ? read(key) : (entries.get(key) ?? null);
        },
        cacheSpeech: async (key, audio) => {
          writes.push({ key, audio });
          if (write) return write(key, audio);
          entries.set(key, audio);
        },
      };
    },
    exports,
    { warn: (...args) => warnings.push(args) },
  );
  return { cache: exports, entries, reads, writes, warnings };
}
