import { errorEnvelope } from "@/i18n/errors";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { moveWordSetItem, MoveWordSetItemError } from "@/db/wordSetRepo";

const ParamsSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
});
const MoveSchema = z.object({ destinationWordSetId: z.string().uuid() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json(
      { errorCode: "errors.unauthorized" },
      { status: 401 },
    );
  try {
    const { id, itemId } = ParamsSchema.parse(await params);
    const { destinationWordSetId } = MoveSchema.parse(await request.json());
    const item = await moveWordSetItem({
      userId: session.user.id,
      sourceWordSetId: id,
      destinationWordSetId,
      itemId,
    });
    return NextResponse.json({ success: true, item });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json(
        { errorCode: "errors.invalidMoveRequest" },
        { status: 400 },
      );
    }
    if (error instanceof MoveWordSetItemError)
      return NextResponse.json(
        {
          ...errorEnvelope(error, "errors.couldNotMoveThisWordPleaseTryAgain"),
        },
        { status: error.status },
      );
    console.error("Error moving word:", error);
    return NextResponse.json(
      { errorCode: "errors.couldNotMoveThisWordPleaseTryAgain" },
      { status: 500 },
    );
  }
}
