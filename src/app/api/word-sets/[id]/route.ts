import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getWordSet,
  deleteWordSet,
  updateWordSet,
  getWordSetItemCount,
} from "@/db/wordSetRepo";
import { z } from "zod";

const UpdateWordSetSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  sourceLang: z.string().min(2).max(10).optional(),
  targetLang: z.string().min(2).max(10).optional(),
});

// GET /api/word-sets/[id] - Get word set details
export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const wordSet = await getWordSet(params.id, session.user.id);

    if (!wordSet) {
      return NextResponse.json({ error: "Word set not found" }, { status: 404 });
    }

    // Get item count
    const itemCount = await getWordSetItemCount(params.id);

    return NextResponse.json({ wordSet: { ...wordSet, itemCount } });
  } catch (error) {
    console.error("Error fetching word set:", error);
    return NextResponse.json(
      { error: "Failed to fetch word set" },
      { status: 500 },
    );
  }
}

// PATCH /api/word-sets/[id] - Update word set
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const validated = UpdateWordSetSchema.parse(body);

    const wordSet = await updateWordSet(params.id, session.user.id, validated);

    if (!wordSet) {
      return NextResponse.json({ error: "Word set not found" }, { status: 404 });
    }

    return NextResponse.json({ wordSet });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.errors },
        { status: 400 },
      );
    }
    console.error("Error updating word set:", error);
    return NextResponse.json(
      { error: "Failed to update word set" },
      { status: 500 },
    );
  }
}

// DELETE /api/word-sets/[id] - Delete word set
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await deleteWordSet(params.id, session.user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting word set:", error);
    return NextResponse.json(
      { error: "Failed to delete word set" },
      { status: 500 },
    );
  }
}
