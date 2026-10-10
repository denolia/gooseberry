import { AnkiPackageError } from "./archive";

type WireValue = bigint | Uint8Array;
type WireFields = Map<number, WireValue[]>;

// Decode only the wire types used by current Anki configuration messages.
// Unknown fields remain in the separately retained original protobuf bytes.
export function protobufFields(bytes: Uint8Array): WireFields {
  const fields: WireFields = new Map();
  let at = 0;
  let count = 0;
  function varint() {
    let value = BigInt(0);
    for (let i = 0; i < 10 && at < bytes.length; i++) {
      const byte = bytes[at++];
      if (i === 9 && byte > 1)
        throw new AnkiPackageError("An Anki configuration varint is invalid.");
      value |= BigInt(byte & 127) << BigInt(i * 7);
      if (!(byte & 128)) return value;
    }
    throw new AnkiPackageError("An Anki configuration record is truncated.");
  }
  while (at < bytes.length) {
    if (++count > 10000)
      throw new AnkiPackageError("An Anki configuration has too many protobuf fields.");
    const tag = Number(varint());
    const number = Math.floor(tag / 8);
    const wire = tag & 7;
    if (!Number.isSafeInteger(tag) || number < 1 || number > 536870911)
      throw new AnkiPackageError("An Anki configuration field is invalid.");
    let value: WireValue;
    if (wire === 0) {
      value = varint();
    } else {
      const length = wire === 2 ? Number(varint()) : wire === 1 ? 8 : wire === 5 ? 4 : -1;
      if (length < 0 || !Number.isSafeInteger(length) || at + length > bytes.length)
        throw new AnkiPackageError("An Anki configuration record is invalid.");
      value = bytes.subarray(at, at + length);
      at += length;
    }
    const values = fields.get(number) ?? [];
    values.push(value);
    fields.set(number, values);
  }
  return fields;
}

export function protobufInteger(fields: WireFields, number: number, fallback = "0") {
  const values = fields.get(number);
  const value = values?.[values.length - 1];
  if (value === undefined) return fallback;
  if (typeof value !== "bigint")
    throw new AnkiPackageError("An Anki integer configuration field is malformed.");
  return value.toString();
}

export function protobufBytes(fields: WireFields, number: number) {
  const values = fields.get(number);
  const value = values?.[values.length - 1];
  if (value === undefined) return new Uint8Array();
  if (!(value instanceof Uint8Array))
    throw new AnkiPackageError("An Anki text configuration field is malformed.");
  return value;
}

export function protobufText(fields: WireFields, number: number) {
  return new TextDecoder("utf-8", { fatal: true }).decode(protobufBytes(fields, number));
}

export function base64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
