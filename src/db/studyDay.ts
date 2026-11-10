import { sql } from "drizzle-orm";
import { getDb } from "@/db/drizzle";
import type { StudyDay } from "@/lib/review/exposure";

export type StudyDayContext = {
  startAt: Date;
  nextStartAt: Date;
  timeZone: string;
};

// Resolve actual local 02:00 instants. PostgreSQL moves nonexistent times past
// a spring gap and chooses the later occurrence during a fall overlap.
export async function getStudyDay(
  userId: string,
  now: Date,
): Promise<StudyDayContext> {
  const result = await getDb().execute(sql`
    WITH settings AS (
      SELECT coalesce(preference.study_time_zone, 'UTC') AS time_zone,
        ${now}::timestamptz AS instant
      FROM (SELECT 1) singleton
      LEFT JOIN user_preference preference ON preference.user_id = ${userId}
    ), local_day AS (
      SELECT *, (instant AT TIME ZONE time_zone)::date AS calendar_day FROM settings
    ), resolved AS (
      SELECT *, (calendar_day + time '02:00') AT TIME ZONE time_zone AS boundary FROM local_day
    ) SELECT time_zone,
      CASE WHEN instant >= boundary THEN boundary
        ELSE ((calendar_day - 1) + time '02:00') AT TIME ZONE time_zone END AS start_at,
      CASE WHEN instant >= boundary THEN ((calendar_day + 1) + time '02:00') AT TIME ZONE time_zone
        ELSE boundary END AS next_start_at
    FROM resolved
  `);
  const row = result.rows[0] as {
    time_zone: string;
    start_at: string;
    next_start_at: string;
  };
  return {
    timeZone: row.time_zone,
    startAt: new Date(row.start_at),
    nextStartAt: new Date(row.next_start_at),
  };
}

export function serializeStudyDay(day: StudyDayContext, now?: Date): StudyDay {
  return {
    startAt: day.startAt.toISOString(),
    nextStartAt: day.nextStartAt.toISOString(),
    timeZone: day.timeZone,
    ...(now ? { serverNow: now.toISOString() } : {}),
  };
}
