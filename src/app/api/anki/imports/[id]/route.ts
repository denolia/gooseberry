import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getAnkiImport,
  stageAnkiImport,
  removeAnkiImport,
} from "@/db/ankiImportRepo";
import { ImportBatchSchema } from "@/lib/anki/import/schemas";
import {
  importBody,
  importErrorResponse,
  importId,
} from "@/lib/anki/import/http";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(
      await getAnkiImport(importId((await params).id), session.user.id),
    );
  } catch (error) {
    return importErrorResponse(error);
  }
}
export async function PUT(request: Request, { params }: Context) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const id = importId((await params).id);
    const input = await importBody(request, ImportBatchSchema);
    return NextResponse.json(await stageAnkiImport(id, session.user.id, input));
  } catch (error) {
    return importErrorResponse(error);
  }
}
export async function DELETE(_request: Request, { params }: Context) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(
      await removeAnkiImport(importId((await params).id), session.user.id),
    );
  } catch (error) {
    return importErrorResponse(error);
  }
}
