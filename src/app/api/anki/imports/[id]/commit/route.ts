import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { commitAnkiImport } from "@/db/ankiImportRepo";
import { CommitImportSchema } from "@/lib/anki/import/schemas";
import {
  importBody,
  importErrorResponse,
  importId,
} from "@/lib/anki/import/http";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const id = importId((await params).id);
    const input = await importBody(request, CommitImportSchema);
    return NextResponse.json(
      await commitAnkiImport(id, session.user.id, input),
    );
  } catch (error) {
    return importErrorResponse(error);
  }
}
