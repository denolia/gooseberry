import { MessageError } from "@/i18n/errors";
import type { ErrorMessageKey, MessageValues } from "@/i18n/messages";
export class BodyReadError extends MessageError {
  status: number;
  constructor(key: ErrorMessageKey, status: number, values?: MessageValues) {
    super(key, values);
    this.status = status;
  }
}

export async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes))
    throw new BodyReadError("errors.theRequestIsTooLarge", 413);
  const reader = request.body?.getReader();
  if (!reader)
    throw new BodyReadError("errors.aJsonRequestBodyIsRequired", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new BodyReadError("errors.theRequestIsTooLarge", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new BodyReadError("errors.theRequestMustContainValidJson", 400);
  }
}
