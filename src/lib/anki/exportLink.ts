import { createHmac, timingSafeEqual } from "node:crypto";

export const ANKI_EXPORT_LINK_TTL_SECONDS = 5 * 60;

function getSigningSecret(): string {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is required to create Anki export links");
  }
  return secret;
}

function signaturePayload(wordSetId: string, expires: number): string {
  return `${wordSetId}.${expires}`;
}

export function signAnkiExportLink(wordSetId: string, expires: number): string {
  return createHmac("sha256", getSigningSecret())
    .update(signaturePayload(wordSetId, expires))
    .digest("base64url");
}

export function verifyAnkiExportLink(
  wordSetId: string,
  expiresValue: string | null,
  signature: string | null,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!expiresValue || !signature || !/^\d+$/.test(expiresValue)) return false;

  const expires = Number(expiresValue);
  if (!Number.isSafeInteger(expires) || expires < nowSeconds) return false;

  const expected = Buffer.from(signAnkiExportLink(wordSetId, expires));
  const provided = Buffer.from(signature);

  return (
    expected.length === provided.length && timingSafeEqual(expected, provided)
  );
}
