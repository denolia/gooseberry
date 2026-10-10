import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { beginAnkiImport, listAnkiImports } from "@/db/ankiImportRepo";
import { BeginImportSchema } from "@/lib/anki/import/schemas";
import { importBody, importErrorResponse } from "@/lib/anki/import/http";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({
      imports: await listAnkiImports(session.user.id),
    });
  } catch (error) {
    return importErrorResponse(error);
  }
}
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const input = await importBody(request, BeginImportSchema);
    return NextResponse.json(await beginAnkiImport(session.user.id, input), {
      status: 201,
    });
  } catch (error) {
    return importErrorResponse(error);
  }
}
