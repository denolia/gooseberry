import { auth } from "@/auth";
import {
  getLanguageCode,
  isSourceLanguage,
  isSourceLanguageCode,
  SourceLanguage,
  SourceLanguageCode,
  SourceLanguages,
} from "@/components/ui/Languages";
import {
  isReaderSpeed,
  isReaderVoice,
  READER_CHUNK_CHARACTERS,
} from "@/lib/audio/readerConfig";
import {
  generateReaderSpeechMp3,
  getReaderSpeechConfig,
} from "@/lib/audio/speech";
import { BodyReadError, readBoundedJson } from "@/lib/http/readJson";
import { hasPremiumAccess } from "@/lib/premium/entitlements";
import { NextResponse } from "next/server";

export const maxDuration = 60;

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

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(getReaderSpeechConfig(), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Check the current database tier for every chunk, including short text.
    if (!(await hasPremiumAccess(session.user.id))) {
      return NextResponse.json(
        {
          error:
            "Full-text reading is a Premium feature. Request access from your profile.",
          code: "premium_required",
        },
        { status: 403 },
      );
    }
  } catch (error) {
    console.error("Could not check reader access:", error);
    return NextResponse.json(
      { error: "Could not verify Premium access. Please try again." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    request.signal.throwIfAborted();
    body = await readBoundedJson(request, 12 * 1024);
    request.signal.throwIfAborted();
  } catch (error) {
    if (request.signal.aborted) {
      return new Response(null, { status: 499 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof BodyReadError ? error.message : "Invalid request",
      },
      { status: error instanceof BodyReadError ? error.status : 400 },
    );
  }

  const input =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const text = typeof input.text === "string" ? input.text.trim() : "";
  const sourceLanguage = normalizeSourceLanguage(input.sourceLanguage);

  if (!text || !sourceLanguage) {
    return NextResponse.json(
      { error: "Text and a valid source language are required" },
      { status: 400 },
    );
  }
  if (text.length > READER_CHUNK_CHARACTERS) {
    return NextResponse.json(
      {
        error: `Each text chunk must be ${READER_CHUNK_CHARACTERS} characters or fewer`,
      },
      { status: 400 },
    );
  }
  const voice = input.voice;
  const speed = input.speed;
  if (
    !isReaderVoice(voice) ||
    !getReaderSpeechConfig().voices.some((value) => value.id === voice) ||
    !isReaderSpeed(speed)
  ) {
    return NextResponse.json(
      { error: "A supported reader voice and speed are required" },
      { status: 400 },
    );
  }

  try {
    const audio = await generateReaderSpeechMp3(
      text,
      sourceLanguage,
      { voice, speed },
      request.signal,
    );
    request.signal.throwIfAborted();
    const responseBody = new ArrayBuffer(audio.length);
    new Uint8Array(responseBody).set(audio);
    return new Response(responseBody, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audio.length.toString(),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (request.signal.aborted) {
      return new Response(null, { status: 499 });
    }
    console.error("Reader speech generation failed:", error);
    return NextResponse.json(
      { error: "Could not read the text aloud. Please try again." },
      { status: 502 },
    );
  }
}
