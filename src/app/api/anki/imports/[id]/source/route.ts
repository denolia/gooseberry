import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { getAnkiImportSource } from "@/db/ankiImportRepo";
import { IMPORT_NOTE_LIMIT } from "@/lib/anki/import/schemas";
import { importErrorResponse, importId } from "@/lib/anki/import/http";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const id = importId((await params).id);
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(IMPORT_NOTE_LIMIT)
      .parse(new URL(request.url).searchParams.get("offset") ?? 0);
    return NextResponse.json(
      await getAnkiImportSource(id, session.user.id, offset),
    );
  } catch (error) {
    return importErrorResponse(error);
  }
}
