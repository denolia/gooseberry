import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { insertTranslation, translationExists } from "@/db/translationRepo";
import { TranslationResponseSchema } from "@/app/utils/translationSchema";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { translations, sourceLang } = await request.json();

    if (!Array.isArray(translations)) {
      return NextResponse.json(
        { error: "Invalid request format" },
        { status: 400 },
      );
    }

    // Use provided lang or default to German
    const sourceLanguage = sourceLang || "de";

    const results = { success: 0, failed: 0, errors: [] as string[] };

    for (const translation of translations) {
      try {
        TranslationResponseSchema.parse(translation);

        // Check for duplicates
        const exists = await translationExists(
          session.user.id,
          translation.original,
        );

        if (!exists) {
          await insertTranslation({
            userId: session.user.id,
            sourceLang: sourceLanguage,
            targetLang: "ru",
            inputText: translation.original,
            responseJson: translation,
            model: "gpt-4o",
            promptVersion: undefined,
          });
          results.success++;
        } else {
          results.success++;
        }
      } catch (error) {
        results.failed++;
        results.errors.push(`Failed to sync: ${translation.original}`);
        console.error("Sync error:", error);
      }
    }

    return NextResponse.json(results);
  } catch (error) {
    console.error("Error syncing history:", error);
    return NextResponse.json(
      { error: "Failed to sync history" },
      { status: 500 },
    );
  }
}
