import type {
  ErrorMessageKey,
  MessageValues,
  UiMessage,
  Translate,
} from "./messages";

/** A user-facing error carries its identity and data, never translated copy. */
export class MessageError extends Error {
  readonly userMessage: UiMessage & { key: ErrorMessageKey };

  constructor(key: ErrorMessageKey, values?: MessageValues) {
    super(key);
    this.name = "MessageError";
    this.userMessage = { key, ...(values ? { values } : {}) };
  }
}

export function messageFromError(
  error: unknown,
  fallback: ErrorMessageKey,
): UiMessage & { key: ErrorMessageKey } {
  return error instanceof MessageError ? error.userMessage : { key: fallback };
}

/** Decode the shared API/worker error envelope; raw diagnostic text is ignored. */
export function errorFromResponse(
  body: unknown,
  fallback: ErrorMessageKey,
): MessageError {
  if (!body || typeof body !== "object") return new MessageError(fallback);
  const { errorCode, errorValues } = body as Record<string, unknown>;
  if (typeof errorCode !== "string" || !errorCode.startsWith("errors."))
    return new MessageError(fallback);
  const values =
    errorValues &&
    typeof errorValues === "object" &&
    !Array.isArray(errorValues)
      ? (Object.fromEntries(
          Object.entries(errorValues).filter(
            ([, value]) =>
              typeof value === "string" ||
              (typeof value === "number" && Number.isFinite(value)),
          ),
        ) as MessageValues)
      : undefined;
  return new MessageError(errorCode as ErrorMessageKey, values);
}

export function errorEnvelope(error: unknown, fallback: ErrorMessageKey) {
  const message = messageFromError(error, fallback);
  return {
    errorCode: message.key,
    ...(message.values ? { errorValues: message.values } : {}),
  };
}

export function formatError(
  t: Translate,
  error: unknown,
  fallback: ErrorMessageKey,
): string {
  const message = messageFromError(error, fallback);
  return t(message.key, message.values);
}
