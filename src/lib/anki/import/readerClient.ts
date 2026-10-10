import type { AnkiPackage, AnkiReadProgress } from "./readerTypes";

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const PARSE_TIMEOUT_MS = 120000;

/** Parse locally off the UI thread. Only selected text/configuration leaves it. */
export async function readPackageFile(
  file: File,
  onProgress?: (progress: AnkiReadProgress) => void,
  signal?: AbortSignal,
): Promise<AnkiPackage> {
  if (!/\.apkg$/i.test(file.name)) throw new Error("Choose an .apkg deck file.");
  if (file.size > MAX_FILE_BYTES) throw new Error("Choose an APKG smaller than 100 MiB.");
  if (signal?.aborted) throw new DOMException("Import inspection cancelled.", "AbortError");
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./reader.worker.ts", import.meta.url), { type: "module" });
    let finished = false;
    const timeout = setTimeout(() => fail(new Error("Deck inspection timed out. Try a smaller deck.")), PARSE_TIMEOUT_MS);
    const abort = () => fail(new DOMException("Import inspection cancelled.", "AbortError"));
    function cleanup() {
      finished = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
    }
    function fail(error: Error) {
      if (finished) return;
      cleanup();
      reject(error);
    }
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<
      | { type: "progress"; progress: AnkiReadProgress }
      | { type: "result"; result: AnkiPackage }
      | { type: "error"; error: string }
    >) => {
      if (finished) return;
      if (event.data.type === "progress") onProgress?.(event.data.progress);
      if (event.data.type === "error") fail(new Error(event.data.error));
      if (event.data.type === "result") {
        cleanup();
        resolve(event.data.result);
      }
    };
    worker.onerror = () => fail(new Error("Deck inspection could not start. Reload and try again."));
    void file.arrayBuffer().then((bytes) => {
      if (!finished) worker.postMessage({ bytes }, [bytes]);
    }).catch((error: unknown) => fail(error instanceof Error ? error : new Error("The file could not be read.")));
  });
}
