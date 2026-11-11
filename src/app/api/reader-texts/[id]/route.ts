import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  deleteReaderText,
  getReaderText,
  updateReaderText,
} from "@/db/readerTextRepo";
import { readBoundedJson } from "@/lib/http/readJson";
import {
  ReaderIdSchema,
  UpdateReaderTextSchema,
  readerRouteError,
} from "@/lib/reader/server";

type Context = { params: Promise<{ id: string }> };
const notFound = () =>
  NextResponse.json(
    { errorCode: "errors.readerTextNotFound" },
    { status: 404 },
  );

export async function GET(_request: Request, { params }: Context) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json(
      { errorCode: "errors.unauthorized" },
      { status: 401 },
    );
  try {
    const id = ReaderIdSchema.parse((await params).id);
    const text = await getReaderText(session.user.id, id);
    return text
      ? NextResponse.json(
          { text },
          { headers: { "Cache-Control": "private, no-store" } },
        )
      : notFound();
  } catch (error) {
    return readerRouteError(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json(
      { errorCode: "errors.unauthorized" },
      { status: 401 },
    );
  try {
    const id = ReaderIdSchema.parse((await params).id);
    const input = UpdateReaderTextSchema.parse(
      await readBoundedJson(request, 128_000),
    );
    const text = await updateReaderText(session.user.id, id, input);
    return text ? NextResponse.json({ text }) : notFound();
  } catch (error) {
    return readerRouteError(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json(
      { errorCode: "errors.unauthorized" },
      { status: 401 },
    );
  try {
    const id = ReaderIdSchema.parse((await params).id);
    const text = await deleteReaderText(session.user.id, id);
    return text ? NextResponse.json({ success: true }) : notFound();
  } catch (error) {
    return readerRouteError(error);
  }
}
