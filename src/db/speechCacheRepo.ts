import { sql } from "drizzle-orm";
import { getDb } from "@/db/drizzle";

export async function getCachedSpeech(
  cacheKey: string,
): Promise<Uint8Array | null> {
  const result = await getDb().execute(sql`
    SELECT encode(audio_data, 'base64') AS audio_base64
    FROM speech_audio_cache
    WHERE cache_key = ${cacheKey}
  `);
  const encoded = result.rows[0]?.audio_base64;
  return typeof encoded === "string"
    ? new Uint8Array(Buffer.from(encoded, "base64"))
    : null;
}

export async function cacheSpeech(
  cacheKey: string,
  audio: Uint8Array,
): Promise<void> {
  const encoded = Buffer.from(audio).toString("base64");
  await getDb().execute(sql`
    INSERT INTO speech_audio_cache (cache_key, audio_data)
    VALUES (${cacheKey}, decode(${encoded}, 'base64'))
    ON CONFLICT (cache_key) DO NOTHING
  `);
}
