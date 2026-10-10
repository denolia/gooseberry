import initSqlJs from "sql.js";
import { readAnkiPackage } from "./reader";

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<{ bytes: ArrayBuffer }>) => void) | null;
  postMessage: (message: unknown) => void;
};

workerScope.onmessage = async (event) => {
  try {
    workerScope.postMessage({ type: "progress", progress: { phase: "archive" } });
    const SQL = await initSqlJs({ locateFile: () => "/sql-wasm.wasm" });
    const result = readAnkiPackage(new Uint8Array(event.data.bytes), SQL, {}, (progress) => {
      workerScope.postMessage({ type: "progress", progress });
    });
    workerScope.postMessage({ type: "result", result });
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : "The Anki package could not be read.",
    });
  }
};
