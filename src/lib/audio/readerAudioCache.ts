import { SourceLanguageSelectOptions } from "@/components/ui/Languages";

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 256;

export function getReaderAudioCacheKey(
  text: string,
  sourceLanguage: string,
  voice: string,
): string {
  const language = sourceLanguage.trim().toLowerCase();
  const source =
    SourceLanguageSelectOptions.find(
      (option) =>
        option.value === language || option.label.toLowerCase() === language,
    )?.value ?? language;
  return JSON.stringify([text.trim(), source, voice]);
}

// Keep audio bytes separate from playback-specific, revocable object URLs.
export class ReaderAudioCache {
  private readonly entries = new Map<string, Blob>();
  private bytes = 0;

  constructor(
    private readonly maxBytes = DEFAULT_MAX_BYTES,
    private readonly maxEntries = DEFAULT_MAX_ENTRIES,
  ) {
    if (
      !Number.isFinite(maxBytes) ||
      maxBytes < 0 ||
      !Number.isFinite(maxEntries) ||
      maxEntries < 0
    ) {
      throw new RangeError(
        "Audio cache limits must be finite and non-negative",
      );
    }
  }

  get size() {
    return this.entries.size;
  }

  get byteLength() {
    return this.bytes;
  }

  get(key: string): Blob | undefined {
    const blob = this.entries.get(key);
    if (blob) {
      this.entries.delete(key);
      this.entries.set(key, blob);
    }
    return blob;
  }

  set(key: string, blob: Blob) {
    this.delete(key);
    if (!blob.size || blob.size > this.maxBytes || this.maxEntries < 1) return;
    this.entries.set(key, blob);
    this.bytes += blob.size;
    while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
  }

  delete(key: string) {
    const blob = this.entries.get(key);
    if (!blob) return;
    this.bytes -= blob.size;
    this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
    this.bytes = 0;
  }
}
