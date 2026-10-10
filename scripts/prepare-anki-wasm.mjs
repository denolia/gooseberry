import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const destination = new URL("../public/", import.meta.url);
mkdirSync(destination, { recursive: true });
copyFileSync(
  require.resolve("sql.js/dist/sql-wasm.wasm"),
  new URL("sql-wasm.wasm", destination),
);
