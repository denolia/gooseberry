import { messageErrors } from "./i18n.mjs";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "@typescript/typescript6";

const require = createRequire(import.meta.url);

// Load production TypeScript with explicit boundary mocks. Local dependencies
// remain real, so moving a handler into a shared module preserves its coverage.
export function loadSourceModule(path, dependencies = {}, cache = new Map()) {
  if (cache.has(path)) return cache.get(path);
  const exports = {};
  cache.set(path, exports);
  const code = ts.transpileModule(
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  new Function("require", "exports", code)((name) => {
    if (name in dependencies) return dependencies[name];
    if (name === "@/i18n/errors") return messageErrors;
    if (name.startsWith("@/"))
      return loadSourceModule(`src/${name.slice(2)}.ts`, dependencies, cache);
    return require(name);
  }, exports);
  return exports;
}
