import type { AnkiCard, AnkiNote, AnkiRevlog } from "./readerTypes";

export const MAX_IMPORT_REQUEST_BYTES = 3 * 1024 * 1024;

export type ImportBatch = {
  batchIndex: number;
  notes: AnkiNote[];
  cards: AnkiCard[];
  revlogs: AnkiRevlog[];
};

export type ImportJobStatus = {
  jobId: string;
  status: "receiving" | "completed" | "cancelled" | "removed";
  wordSetId: string | null;
  nextBatchIndex: number;
  stagedNoteCount: number;
  stagedCardCount: number;
  stagedReviewCount: number;
  addedCount: number;
  skippedCount: number;
  needsAttentionCount: number;
  importedProgressCount: number;
};

const encoder = new TextEncoder();

export function importJsonByteLength(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

// Size the UTF-8 JSON that will actually be sent, including punctuation and
// batch indices. Source media and the original archive never reach a function.
export function createImportBatches(
  content: Pick<ImportBatch, "notes" | "cards" | "revlogs">,
  maxBytes = MAX_IMPORT_REQUEST_BYTES,
): ImportBatch[] {
  const batches: ImportBatch[] = [];
  const limits = { notes: 100, cards: 1000, revlogs: 5000 };
  const emptyBatch = (): ImportBatch => ({
    batchIndex: batches.length,
    notes: [],
    cards: [],
    revlogs: [],
  });
  let batch = emptyBatch();
  let bytes = importJsonByteLength(batch);
  const flush = () => {
    if (!batch.notes.length && !batch.cards.length && !batch.revlogs.length) {
      return;
    }
    batches.push(batch);
    batch = emptyBatch();
    bytes = importJsonByteLength(batch);
  };

  const append = <K extends "notes" | "cards" | "revlogs">(
    kind: K,
    record: ImportBatch[K][number],
  ) => {
    const recordBytes = importJsonByteLength(record);
    let addedBytes = recordBytes + (batch[kind].length ? 1 : 0);
    if (batch[kind].length >= limits[kind] || bytes + addedBytes > maxBytes) {
      flush();
      addedBytes = recordBytes;
    }
    if (bytes + addedBytes > maxBytes) {
      throw new Error(
        "One item in this deck is too large to import. Shorten its text in Anki and try again.",
      );
    }
    (batch[kind] as ImportBatch[K][number][]).push(record);
    bytes += addedBytes;
  };

  content.notes.forEach((note) => append("notes", note));
  content.cards.forEach((card) => append("cards", card));
  content.revlogs.forEach((revlog) => append("revlogs", revlog));
  flush();
  return batches;
}

class ImportRequestError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

async function waitForRetry(delayMs: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Import paused", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function importRequest<T>(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  payload?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  if (body && encoder.encode(body).byteLength > MAX_IMPORT_REQUEST_BYTES) {
    throw new Error("This deck contains too much information to send at once.");
  }

  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      const response = await fetch(path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body,
        signal,
        cache: "no-store",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new ImportRequestError(
          typeof result.error === "string"
            ? result.error
            : "We could not save your import. Try again.",
          response.status === 429 || response.status >= 500,
        );
      }
      return result as T;
    } catch (error) {
      if (
        signal?.aborted ||
        attempt >= 3 ||
        (error instanceof ImportRequestError && !error.retryable)
      ) {
        throw error;
      }
      await waitForRetry([300, 900, 1800][attempt], signal);
    }
  }
}
