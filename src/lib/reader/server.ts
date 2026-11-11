import { NextResponse } from "next/server";
import { z } from "zod";
import {
  isSourceLanguageCode,
  isTargetLanguageCode,
} from "@/components/ui/Languages";
import { BodyReadError } from "@/lib/http/readJson";
import { READER_TEXT_LIMIT, READER_TITLE_LIMIT } from "./library";
import { errorEnvelope } from "@/i18n/errors";

export const ReaderIdSchema = z.uuid();
const fields = {
  text: z.string().trim().min(1).max(READER_TEXT_LIMIT),
  sourceLang: z.string().refine(isSourceLanguageCode),
  targetLang: z.string().refine(isTargetLanguageCode),
};

export const CreateReaderTextSchema = z.object({
  id: ReaderIdSchema,
  ...fields,
});

export const UpdateReaderTextSchema = z
  .object({
    ...fields,
    title: z.string().trim().min(1).max(READER_TITLE_LIMIT),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide a title or text to update.",
  });

export type ReaderHistoryCursor = { createdAt: string; id: string };

const CursorSchema = z.object({
  createdAt: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/,
    )
    .refine((value) => !Number.isNaN(Date.parse(value))),
  id: ReaderIdSchema,
});

export function decodeReaderCursor(value: string): ReaderHistoryCursor {
  if (value.length > 512)
    throw new BodyReadError("errors.invalidHistoryCursor", 400);
  try {
    return CursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
  } catch {
    throw new BodyReadError("errors.invalidHistoryCursor", 400);
  }
}

export function encodeReaderCursor(cursor: ReaderHistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function readerRouteError(error: unknown) {
  if (error instanceof BodyReadError)
    return NextResponse.json(
      errorEnvelope(error, "errors.readerInvalidInput"),
      { status: error.status },
    );
  if (error instanceof z.ZodError)
    return NextResponse.json(
      { errorCode: "errors.readerInvalidInput" },
      { status: 400 },
    );
  console.error("Reader history request failed:", error);
  return NextResponse.json(
    { errorCode: "errors.readerStorageFailed" },
    { status: 500 },
  );
}
