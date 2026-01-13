import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createWordSet, listWordSets } from "@/db/wordSetRepo";
import { z } from "zod";

const CreateWordSetSchema = z.object({
  name: z.string().min(1).max(200),
  sourceLang: z.string().min(2).max(10),
  targetLang: z.string().min(2).max(10),
});

// GET /api/word-sets - List all word sets for current user
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sets = await listWordSets(session.user.id);
    return NextResponse.json({ wordSets: sets });
  } catch (error) {
    console.error("Error listing word sets:", error);
    return NextResponse.json(
      { error: "Failed to list word sets" },
      { status: 500 },
    );
  }
}

// POST /api/word-sets - Create new word set
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const validated = CreateWordSetSchema.parse(body);

    const wordSet = await createWordSet({
      userId: session.user.id,
      ...validated,
    });

    return NextResponse.json({ wordSet }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.errors },
        { status: 400 },
      );
    }
    console.error("Error creating word set:", error);
    return NextResponse.json(
      { error: "Failed to create word set" },
      { status: 500 },
    );
  }
}
