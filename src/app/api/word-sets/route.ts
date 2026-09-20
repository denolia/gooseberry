import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createWordSet, listWordSets } from "@/db/wordSetRepo";
import { getWordSetReviewStats } from "@/db/reviewStatsRepo";
import { z } from "zod";
import {
  isSourceLanguageCode,
  isTargetLanguageCode,
} from "@/components/ui/Languages";

const CreateWordSetSchema = z.object({
  name: z.string().min(1).max(200),
  sourceLang: z.string().refine(isSourceLanguageCode, {
    message: "Invalid source language",
  }),
  targetLang: z.string().refine(isTargetLanguageCode, {
    message: "Invalid target language",
  }),
});

// GET /api/word-sets - List all word sets for current user
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [sets, reviewStats] = await Promise.all([
      listWordSets(session.user.id),
      getWordSetReviewStats({ userId: session.user.id, now: new Date() }),
    ]);
    const statsBySetId = new Map(
      reviewStats.map((stats) => [stats.wordSetId, stats]),
    );
    return NextResponse.json({
      wordSets: sets.map((set) => ({
        ...set,
        reviewStats: statsBySetId.get(set.id) ?? {
          wordSetId: set.id,
          itemCount: 0,
          enabledItemCount: 0,
          dueCount: 0,
        },
      })),
    });
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
        { error: "Invalid input", details: error.message },
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
