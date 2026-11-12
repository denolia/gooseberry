import { sql } from "drizzle-orm";
import { getDb } from "@/db/drizzle";
import type { StudyDay } from "@/lib/review/exposure";

export type StudyDayContext = {
  startAt: Date;
  nextStartAt: Date;
  timeZone: string;
  creditedDate: string;
};

// Resolve actual local 02:00 instants. PostgreSQL moves nonexistent times past
// a spring gap and chooses the later occurrence during a fall overlap.
export function studyDayQuery(userId: string, now: Date) {
  return sql`
    WITH settings AS (
      SELECT CASE WHEN ${now}::timestamptz < preference.study_time_zone_effective_at
          THEN preference.previous_study_time_zone
          ELSE coalesce(preference.study_time_zone, 'UTC') END AS time_zone,
        CASE WHEN ${now}::timestamptz < preference.study_time_zone_effective_at
          THEN preference.previous_study_day_start_at
          ELSE preference.study_time_zone_effective_at END AS transition_at,
        ${now}::timestamptz AS instant
      FROM (SELECT 1) singleton
      LEFT JOIN user_preference preference ON preference.user_id = ${userId}
    ), local_day AS (
      SELECT *, (instant AT TIME ZONE time_zone)::date AS calendar_day FROM settings
    ), resolved AS (
      SELECT *, (calendar_day + time '02:00') AT TIME ZONE time_zone AS boundary FROM local_day
    ) SELECT time_zone,
      greatest(transition_at, CASE WHEN instant >= boundary THEN boundary
        ELSE ((calendar_day - 1) + time '02:00') AT TIME ZONE time_zone END) AS start_at,
      CASE WHEN instant >= boundary THEN ((calendar_day + 1) + time '02:00') AT TIME ZONE time_zone
        ELSE boundary END AS next_start_at,
      (CASE WHEN instant >= boundary THEN calendar_day ELSE calendar_day - 1 END)::text AS credited_date
    FROM resolved
  `;
}

export async function getStudyDay(
  userId: string,
  now: Date,
): Promise<StudyDayContext> {
  const result = await getDb().execute(studyDayQuery(userId, now));
  const row = result.rows[0] as {
    time_zone: string;
    start_at: string;
    next_start_at: string;
    credited_date: string;
  };
  return {
    timeZone: row.time_zone,
    startAt: new Date(row.start_at),
    nextStartAt: new Date(row.next_start_at),
    creditedDate: row.credited_date,
  };
}

export function serializeStudyDay(day: StudyDayContext, now?: Date): StudyDay {
  return {
    startAt: day.startAt.toISOString(),
    nextStartAt: day.nextStartAt.toISOString(),
    timeZone: day.timeZone,
    creditedDate: day.creditedDate,
    ...(now ? { serverNow: now.toISOString() } : {}),
  };
}
