import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listLast50 } from "@/db/translationRepo";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const translations = await listLast50(session.user.id);

    const history = translations.map((row) => ({
      id: row.id,
      sourceLang: row.sourceLang,
      targetLang: row.targetLang,
      inputText: row.inputText,
      translation: row.responseJson,
      model: row.model,
      createdAt: row.createdAt,
    }));

    return NextResponse.json({ history });
  } catch (error) {
    console.error("Error fetching history:", error);
    return NextResponse.json(
      { error: "Failed to fetch history" },
      { status: 500 }
    );
  }
}
