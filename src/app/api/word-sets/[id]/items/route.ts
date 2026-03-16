import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  addItemsToWordSet,
  deleteWordSetItem,
  getExistingSourceTranslationIds,
  getWordSet,
  getWordSetItems,
  updateWordSetItem,
} from "@/db/wordSetRepo";
import { getTranslationsByIds } from "@/db/translationRepo";
import { mapTranslationToWordSetItem } from "@/app/utils/ankiMapper";
import { TranslationResponseSchema } from "@/app/utils/translationSchema";
import { generateAnkiGuid } from "@/lib/anki/guidGenerator";
import { z } from "zod";

const AddItemsSchema = z.object({
  translationHistoryIds: z.array(z.string().uuid()),
});

const UpdateItemSchema = z.object({
  original: z.string().optional(),
  translation: z.string().optional(),
  wordForms: z.string().optional(),
  sample: z.string().optional(),
  sampleTranslation: z.string().optional(),
  comments: z.string().optional(),
  tags: z.string().optional(),
  isEnabled: z.boolean().optional(),
  position: z.number().int().optional(),
});

const DeleteItemSchema = z.object({
  itemId: z.string().uuid(),
});

// GET /api/word-sets/[id]/items - List items in word set
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    // Verify ownership
    const wordSet = await getWordSet(id, session.user.id);
    if (!wordSet) {
      return NextResponse.json(
        { error: "Word set not found" },
        { status: 404 },
      );
    }

    const items = await getWordSetItems(id);
    return NextResponse.json({ items });
  } catch (error) {
    console.error("Error fetching word set items:", error);
    return NextResponse.json(
      { error: "Failed to fetch items" },
      { status: 500 },
    );
  }
}

// POST /api/word-sets/[id]/items - Add items to word set
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    // Verify ownership
    const wordSet = await getWordSet(id, session.user.id);
    if (!wordSet) {
      return NextResponse.json(
        { error: "Word set not found" },
        { status: 404 },
      );
    }

    const body = await request.json();
    const { translationHistoryIds } = AddItemsSchema.parse(body);

    // Get translations from history
    const translations = await getTranslationsByIds(
      translationHistoryIds,
      session.user.id,
    );

    if (translations.length === 0) {
      return NextResponse.json(
        { error: "No valid translations found" },
        { status: 400 },
      );
    }

    const existingSourceTranslationIds = new Set(
      await getExistingSourceTranslationIds(id, translations.map((t) => t.id)),
    );

    const newTranslations = translations.filter(
      (translation) => !existingSourceTranslationIds.has(translation.id),
    );

    const skippedCount = translations.length - newTranslations.length;

    if (newTranslations.length === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        skippedCount,
      });
    }

    // Get current max position
    const existingItems = await getWordSetItems(id);
    let nextPosition = existingItems.length;

    // Map translations to word set items
    const items = newTranslations.map((translation) => {
      const translationData = TranslationResponseSchema.parse(
        translation.responseJson,
      );

      const mappedFields = mapTranslationToWordSetItem(
        translationData,
        translation.id,
      );

      return {
        ankiNoteGuid: generateAnkiGuid(id, translation.id),
        ...mappedFields,
        position: nextPosition++,
      };
    });

    await addItemsToWordSet(id, items);

    return NextResponse.json({
      success: true,
      count: items.length,
      skippedCount,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.message },
        { status: 400 },
      );
    }
    console.error("Error adding items to word set:", error);
    return NextResponse.json({ error: "Failed to add items" }, { status: 500 });
  }
}

// PATCH /api/word-sets/[id]/items - Update item
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    // Verify ownership
    const wordSet = await getWordSet(id, session.user.id);
    if (!wordSet) {
      return NextResponse.json(
        { error: "Word set not found" },
        { status: 404 },
      );
    }

    const body = await request.json();
    const { itemId, ...updates } = body;

    if (!itemId) {
      return NextResponse.json(
        { error: "itemId is required" },
        { status: 400 },
      );
    }

    const validated = UpdateItemSchema.parse(updates);

    const updatedItem = await updateWordSetItem(id, itemId, validated);

    if (!updatedItem) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.message },
        { status: 400 },
      );
    }
    console.error("Error updating item:", error);
    return NextResponse.json(
      { error: "Failed to update item" },
      { status: 500 },
    );
  }
}

// DELETE /api/word-sets/[id]/items - Delete item
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    // Verify ownership
    const wordSet = await getWordSet(id, session.user.id);
    if (!wordSet) {
      return NextResponse.json(
        { error: "Word set not found" },
        { status: 404 },
      );
    }

    const body = await request.json();
    const { itemId } = DeleteItemSchema.parse(body);

    const deletedItem = await deleteWordSetItem(id, itemId);

    if (!deletedItem) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.message },
        { status: 400 },
      );
    }
    console.error("Error deleting item:", error);
    return NextResponse.json(
      { error: "Failed to delete item" },
      { status: 500 },
    );
  }
}
