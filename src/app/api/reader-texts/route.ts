import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listReaderTexts, saveNewReaderText } from "@/db/readerTextRepo";
import { readBoundedJson, BodyReadError } from "@/lib/http/readJson";
import {
  CreateReaderTextSchema,
  decodeReaderCursor,
  encodeReaderCursor,
  readerRouteError,
} from "@/lib/reader/server";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json(
      { errorCode: "errors.unauthorized" },
      { status: 401 },
    );
  try {
    const params = new URL(request.url).searchParams;
    const search = (params.get("q") ?? "").trim();
    if (search.length > 200)
      throw new BodyReadError("errors.readerSearchTooLong", 400);
    const cursor = params.get("cursor");
    const page = await listReaderTexts(session.user.id, {
      search,
      cursor: cursor ? decodeReaderCursor(cursor) : undefined,
    });
    return NextResponse.json(
      {
        texts: page.texts,
        nextCursor: page.nextCursor
          ? encodeReaderCursor(page.nextCursor)
          : null,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return readerRouteError(error);
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json(
      { errorCode: "errors.unauthorized" },
      { status: 401 },
    );
  try {
    const input = CreateReaderTextSchema.parse(
      await readBoundedJson(request, 128_000),
    );
    const text = await saveNewReaderText({ ...input, userId: session.user.id });
    if (!text)
      return NextResponse.json(
        { errorCode: "errors.readerSaveConflict" },
        { status: 409 },
      );
    return NextResponse.json({ text }, { status: 201 });
  } catch (error) {
    return readerRouteError(error);
  }
}
