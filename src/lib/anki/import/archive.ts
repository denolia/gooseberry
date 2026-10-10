import { Inflate } from "fflate";
import { Decompress } from "fzstd";

export class AnkiPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnkiPackageError";
  }
}

type Entry = {
  name: string;
  method: number;
  flags: number;
  compressed: number;
  expanded: number;
  crc: number;
  offset: number;
};

function requireRange(data: Uint8Array, at: number, length: number) {
  if (at < 0 || length < 0 || at + length > data.length)
    throw new AnkiPackageError("The APKG archive is truncated or damaged.");
}

const decoder = new TextDecoder("utf-8", { fatal: true });

// Read the central directory before expanding anything. In particular, media
// entries never reach an inflater, even when their advertised size is enormous.
export function inspectArchive(bytes: Uint8Array, maxEntries: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (
      view.getUint32(at, true) === 0x06054b50 &&
      at + 22 + view.getUint16(at + 20, true) === bytes.length
    ) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new AnkiPackageError("Choose a valid Anki APKG ZIP file.");
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const start = view.getUint32(end + 16, true);
  if (
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0 ||
    view.getUint16(end + 8, true) !== count ||
    count === 0xffff ||
    size === 0xffffffff ||
    start === 0xffffffff
  )
    throw new AnkiPackageError("Split-volume and ZIP64 packages are not supported.");
  if (count > maxEntries)
    throw new AnkiPackageError("The package contains too many archive entries.");
  requireRange(bytes, start, size);
  if (start + size > end)
    throw new AnkiPackageError("The APKG central directory is damaged.");
  const entries = new Map<string, Entry>();
  let at = start;
  for (let i = 0; i < count; i++) {
    requireRange(bytes, at, 46);
    if (view.getUint32(at, true) !== 0x02014b50)
      throw new AnkiPackageError("The APKG central directory is damaged.");
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    if (nameLength > 4096)
      throw new AnkiPackageError("An archive filename exceeds the import limit.");
    requireRange(bytes, at + 46, nameLength + extraLength + commentLength);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (
      name.startsWith("/") ||
      name.includes("\\") ||
      name.includes("\0") ||
      name.split("/").includes("..") ||
      entries.has(name)
    )
      throw new AnkiPackageError("The package contains unsafe or duplicate filenames.");
    const entry: Entry = {
      name,
      flags: view.getUint16(at + 8, true),
      method: view.getUint16(at + 10, true),
      crc: view.getUint32(at + 16, true),
      compressed: view.getUint32(at + 20, true),
      expanded: view.getUint32(at + 24, true),
      offset: view.getUint32(at + 42, true),
    };
    if (
      entry.compressed === 0xffffffff ||
      entry.expanded === 0xffffffff ||
      entry.offset === 0xffffffff
    )
      throw new AnkiPackageError("ZIP64 packages are not supported.");
    entries.set(name, entry);
    at += 46 + nameLength + extraLength + commentLength;
  }
  if (at !== start + size)
    throw new AnkiPackageError("The APKG central directory size is invalid.");

  return {
    entries,
    omittedMediaCount: [...entries.keys()].filter((name) => /^\d+$/.test(name)).length,
    extract(name: string, limit: number) {
      const entry = entries.get(name);
      if (!entry) throw new AnkiPackageError(`The package is missing ${name}.`);
      if (entry.flags & 1)
        throw new AnkiPackageError("Encrypted Anki databases are not supported.");
      if (entry.expanded > limit)
        throw new AnkiPackageError("The selected database exceeds the import limit.");
      requireRange(bytes, entry.offset, 30);
      if (
        view.getUint32(entry.offset, true) !== 0x04034b50 ||
        view.getUint16(entry.offset + 8, true) !== entry.method
      )
        throw new AnkiPackageError("The APKG file header is damaged.");
      const nameLength = view.getUint16(entry.offset + 26, true);
      const extraLength = view.getUint16(entry.offset + 28, true);
      const dataStart = entry.offset + 30 + nameLength + extraLength;
      requireRange(bytes, entry.offset + 30, nameLength + extraLength);
      if (
        decoder.decode(bytes.subarray(entry.offset + 30, entry.offset + 30 + nameLength)) !== name ||
        dataStart + entry.compressed > start
      )
        throw new AnkiPackageError("The APKG file boundaries are damaged.");
      const compressed = bytes.subarray(dataStart, dataStart + entry.compressed);
      let result: Uint8Array;
      if (entry.method === 0) {
        result = compressed;
      } else if (entry.method === 8) {
        const output = boundedOutput(limit);
        const inflater = new Inflate((chunk) => output.push(chunk));
        // Small compressed chunks bound transient inflater output as well as
        // retained bytes; don't trust the ZIP's declared expanded length.
        for (let i = 0; i < compressed.length; i += 1024)
          inflater.push(compressed.subarray(i, i + 1024), i + 1024 >= compressed.length);
        if (!compressed.length) inflater.push(compressed, true);
        result = output.finish();
      } else {
        throw new AnkiPackageError("The database uses unsupported ZIP compression.");
      }
      if (result.length !== entry.expanded || crc32(result) !== entry.crc)
        throw new AnkiPackageError("The selected database failed its archive integrity check.");
      return result;
    },
  };
}

function boundedOutput(limit: number) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  return {
    push(chunk: Uint8Array) {
      size += chunk.length;
      if (size > limit)
        throw new AnkiPackageError("The expanded database exceeds the import limit.");
      if (chunk.length) chunks.push(chunk.slice());
    },
    finish() {
      const result = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) {
        result.set(chunk, at);
        at += chunk.length;
      }
      return result;
    },
  };
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++)
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Validate every frame's memory window before fzstd allocates it. Content-size
// declarations are optional, so streaming output has an independent hard cap.
export function decompressDatabase(bytes: Uint8Array, limit: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  let knownSize = 0;
  let allSizesKnown = true;
  while (at < bytes.length) {
    requireRange(bytes, at, 8);
    const magic = view.getUint32(at, true);
    if ((magic & 0xfffffff0) >>> 0 === 0x184d2a50) {
      const size = view.getUint32(at + 4, true);
      requireRange(bytes, at + 8, size);
      at += 8 + size;
      continue;
    }
    if (magic !== 0xfd2fb528)
      throw new AnkiPackageError("The modern Anki database is not valid Zstandard data.");
    const descriptor = bytes[at + 4];
    if (descriptor & 0x18)
      throw new AnkiPackageError("The Zstandard frame header is invalid.");
    const single = Boolean(descriptor & 0x20);
    const sizeFlag = descriptor >>> 6;
    const dictionarySize = [0, 1, 2, 4][descriptor & 3];
    let cursor = at + 5;
    let windowSize = 0;
    if (!single) {
      const window = bytes[cursor++];
      const base = 2 ** (10 + (window >>> 3));
      windowSize = base + (base / 8) * (window & 7);
    }
    requireRange(bytes, cursor, dictionarySize);
    if (bytes.subarray(cursor, cursor + dictionarySize).some((byte) => byte !== 0))
      throw new AnkiPackageError("Zstandard dictionaries are not supported.");
    cursor += dictionarySize;
    const sizeBytes = sizeFlag ? 2 ** sizeFlag : single ? 1 : 0;
    requireRange(bytes, cursor, sizeBytes);
    let contentSize = 0;
    for (let i = sizeBytes - 1; i >= 0; i--)
      contentSize = contentSize * 256 + bytes[cursor + i];
    if (sizeBytes === 2) contentSize += 256;
    cursor += sizeBytes;
    if (!sizeBytes) allSizesKnown = false;
    if (single) windowSize = contentSize;
    knownSize += contentSize;
    if (windowSize > limit || contentSize > limit || knownSize > limit)
      throw new AnkiPackageError("The Zstandard database exceeds the import memory limit.");
    let last = false;
    while (!last) {
      requireRange(bytes, cursor, 3);
      const header = bytes[cursor] | (bytes[cursor + 1] << 8) | (bytes[cursor + 2] << 16);
      cursor += 3;
      last = Boolean(header & 1);
      const kind = (header >>> 1) & 3;
      const blockSize = header >>> 3;
      if (kind === 3 || blockSize > 131072)
        throw new AnkiPackageError("The Zstandard block header is invalid.");
      const storedSize = kind === 1 ? 1 : blockSize;
      requireRange(bytes, cursor, storedSize);
      cursor += storedSize;
    }
    if (descriptor & 4) {
      requireRange(bytes, cursor, 4);
      cursor += 4;
    }
    at = cursor;
  }
  const output = boundedOutput(limit);
  const decompressor = new Decompress((chunk) => output.push(chunk));
  decompressor.push(bytes, true);
  const result = output.finish();
  if (allSizesKnown && result.length !== knownSize)
    throw new AnkiPackageError("The Zstandard database length is invalid.");
  return result;
}
