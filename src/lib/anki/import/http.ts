import { NextResponse } from "next/server";
import { z } from "zod";
import { AnkiImportError } from "@/db/ankiImportRepo";
import { BodyReadError, readBoundedJson } from "@/lib/http/readJson";
import { IMPORT_BODY_LIMIT } from "./schemas";

export function importId(value: string) {
  return z.string().uuid().parse(value);
}
export async function importBody<T>(request: Request, schema: z.ZodType<T>) {
  return schema.parse(await readBoundedJson(request, IMPORT_BODY_LIMIT));
}
export function importErrorResponse(error: unknown) {
  if (error instanceof AnkiImportError || error instanceof BodyReadError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: "Invalid import data",
        details: error.issues
          .map((issue) => ({ path: issue.path, message: issue.message }))
          .slice(0, 10),
      },
      { status: 400 },
    );
  }
  // Database exceptions may embed source-note parameters. Do not log private
  // deck contents when reporting an unexpected operational failure.
  console.error(
    "Anki import failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return NextResponse.json(
    {
      error:
        "Import failed. Your existing vocabulary and reviews have not been changed.",
    },
    { status: 500 },
  );
}
