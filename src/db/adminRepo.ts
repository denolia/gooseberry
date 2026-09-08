import { sql } from "drizzle-orm";
import { getDb } from "@/db/drizzle";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export type AdminUserStats = {
  id: string;
  name: string | null;
  email: string | null;
  created_at: string;
  last_login_at: string | null;
  translations: number;
  unique_entries: number;
  last_translation: string | null;
  sets: number;
  exported_sets: number;
  cards: number;
  enabled_cards: number;
  translate_calls: number;
  analyze_calls: number;
  successful_calls: number;
  month_calls: number;
  input_words: number;
  failed_calls: number;
  pending_calls: number;
  unknown_usage: number;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  first_tracked: string | null;
};

export async function getAdminUsers(query: string, page: number) {
  // Protect at the data boundary as well as the page; never cache across sessions.
  await requireAdmin();
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const filter = sql`(${query} = '' OR u.email ILIKE ${pattern} OR u.name ILIKE ${pattern} OR u.id::text ILIKE ${pattern})`;
  const counts = await getDb().execute(
    sql`SELECT count(*)::int AS total FROM app_user u WHERE ${filter}`,
  );
  const total = Number(counts.rows[0]?.total ?? 0);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(total / 25)));
  const result = await getDb().execute(sql`
    SELECT u.id, u.name, u.email, u.created_at, u.last_login_at,
      t.translations, t.unique_entries, t.last_translation,
      s.sets, s.exported_sets, c.cards, c.enabled_cards,
      a.*
    FROM app_user u
    LEFT JOIN LATERAL (
      SELECT count(*)::int translations,
        count(DISTINCT (lower(trim(input_text)), source_lang, target_lang))::int unique_entries,
        max(created_at) last_translation
      FROM translation_history WHERE user_id = u.id
    ) t ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int sets, count(last_exported_at)::int exported_sets
      FROM word_set WHERE user_id = u.id
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int cards, count(*) FILTER (WHERE i.is_enabled)::int enabled_cards
      FROM word_set_item i JOIN word_set w ON i.word_set_id = w.id WHERE w.user_id = u.id
    ) c ON true
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE operation = 'translate')::int translate_calls,
        count(*) FILTER (WHERE operation = 'analyze')::int analyze_calls,
        count(*) FILTER (WHERE status = 'succeeded')::int successful_calls,
        count(*) FILTER (WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int month_calls,
        coalesce(sum(input_words), 0)::float8 input_words,
        count(*) FILTER (WHERE status = 'failed')::int failed_calls,
        count(*) FILTER (WHERE status = 'pending')::int pending_calls,
        count(*) FILTER (WHERE input_tokens IS NULL OR output_tokens IS NULL)::int unknown_usage,
        coalesce(sum(input_tokens), 0)::float8 input_tokens,
        coalesce(sum(cached_input_tokens), 0)::float8 cached_tokens,
        coalesce(sum(output_tokens), 0)::float8 output_tokens,
        min(created_at) first_tracked
      FROM ai_usage WHERE user_id = u.id
    ) a ON true
    WHERE ${filter}
    ORDER BY u.created_at DESC, u.id
    LIMIT 25 OFFSET ${(currentPage - 1) * 25}
  `);
  return { users: result.rows as AdminUserStats[], total, page: currentPage };
}
