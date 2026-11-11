import { auth } from "@/auth";
import {
  getLanguageCode,
  isSourceLanguage,
  isSourceLanguageCode,
  SourceLanguage,
  SourceLanguageCode,
  SourceLanguages,
} from "@/components/ui/Languages";
import { generateSpeechMp3, MAX_SPEECH_CHARACTERS } from "@/lib/audio/speech";
import { NextResponse } from "next/server";

export const maxDuration = 30;

const languageNamesByCode = Object.fromEntries(
  Object.values(SourceLanguages).map((language) => [
    getLanguageCode(language),
    language,
  ]),
) as Record<SourceLanguageCode, SourceLanguage>;

function normalizeSourceLanguage(value: unknown): SourceLanguage | null {
  if (isSourceLanguage(value)) return value;
  if (isSourceLanguageCode(value)) return languageNamesByCode[value];
  return null;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { errorCode: "errors.unauthorized" },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { errorCode: "errors.invalidRequest" },
      { status: 400 },
    );
  }

  const input =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const text = typeof input.text === "string" ? input.text.trim() : "";
  const sourceLanguage = normalizeSourceLanguage(input.sourceLanguage);

  if (!text || !sourceLanguage) {
    return NextResponse.json(
      { errorCode: "errors.textAndAValidSourceLanguageAreRequired" },
      { status: 400 },
    );
  }
  if (text.length > MAX_SPEECH_CHARACTERS) {
    return NextResponse.json(
      {
        errorCode: "errors.textMustBeValueCharactersOrFewer",
        errorValues: { value0: MAX_SPEECH_CHARACTERS },
      },
      { status: 400 },
    );
  }

  try {
    const audio = await generateSpeechMp3(text, sourceLanguage, request.signal);
    const responseBody = new ArrayBuffer(audio.length);
    new Uint8Array(responseBody).set(audio);

    return new Response(responseBody, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audio.length.toString(),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Speech generation failed:", error);
    return NextResponse.json(
      { errorCode: "errors.couldNotGeneratePronunciation" },
      { status: 502 },
    );
  }
}
