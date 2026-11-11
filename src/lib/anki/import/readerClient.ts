import { MessageError, errorFromResponse } from "@/i18n/errors";
import type { AnkiPackage, AnkiReadProgress } from "./readerTypes";

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const PARSE_TIMEOUT_MS = 120000;

/** Parse locally off the UI thread. Only selected text/configuration leaves it. */
export async function readPackageFile(
  file: File,
  onProgress?: (progress: AnkiReadProgress) => void,
  signal?: AbortSignal,
): Promise<AnkiPackage> {
  if (!/\.apkg$/i.test(file.name))
    throw new MessageError("errors.chooseAnApkgDeckFile");
  if (file.size > MAX_FILE_BYTES)
    throw new MessageError("errors.chooseAnApkgSmallerThan100Mib");
  if (signal?.aborted)
    throw new DOMException("Import inspection cancelled.", "AbortError");
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./reader.worker.ts", import.meta.url), {
      type: "module",
    });
    let finished = false;
    const timeout = setTimeout(
      () =>
        fail(new MessageError("errors.deckInspectionTimedOutTryASmallerDeck")),
      PARSE_TIMEOUT_MS,
    );
    const abort = () =>
      fail(new DOMException("Import inspection cancelled.", "AbortError"));
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
    worker.onmessage = (
      event: MessageEvent<
        | { type: "progress"; progress: AnkiReadProgress }
        | { type: "result"; result: AnkiPackage }
        | {
            type: "error";
            errorCode: string;
            errorValues?: Record<string, string | number>;
          }
      >,
    ) => {
      if (finished) return;
      if (event.data.type === "progress") onProgress?.(event.data.progress);
      if (event.data.type === "error")
        fail(
          errorFromResponse(event.data, "errors.theAnkiPackageCouldNotBeRead"),
        );
      if (event.data.type === "result") {
        cleanup();
        resolve(event.data.result);
      }
    };
    worker.onerror = () =>
      fail(
        new MessageError("errors.deckInspectionCouldNotStartReloadAndTryAgain"),
      );
    void file
      .arrayBuffer()
      .then((bytes) => {
        if (!finished) worker.postMessage({ bytes }, [bytes]);
      })
      .catch((error: unknown) =>
        fail(
          error instanceof Error
            ? error
            : new MessageError("errors.theFileCouldNotBeRead"),
        ),
      );
  });
}
