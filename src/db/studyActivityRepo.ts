import { sql } from "drizzle-orm";
import { getDb } from "@/db/drizzle";
import { getStudyDay, serializeStudyDay } from "@/db/studyDay";
import {
  COMPLETIONS_PER_LEAF,
  type StudyActivity,
} from "@/lib/review/activity";

export async function getStudyActivityCredit(userId: string, reviewId: string) {
  const result = await getDb()
    .execute(sql`SELECT credited_date::text AS "creditedDate",
    study_time_zone AS "timeZone", completed_at AS "completedAt"
    FROM study_activity WHERE user_id = ${userId} AND review_id = ${reviewId}`);
  return result.rows[0] ?? null;
}

export async function getStudyActivity(
  userId: string,
  now = new Date(),
  range = 365,
): Promise<StudyActivity> {
  const size = Math.max(1, Math.min(365, Math.trunc(range) || 365));
  const day = await getStudyDay(userId, now);
  const result = await getDb().execute(sql`
    WITH daily AS (
      SELECT credited_date, count(*)::integer AS completions,
        (count(*) / ${COMPLETIONS_PER_LEAF})::integer AS leaves
      FROM study_activity WHERE user_id = ${userId} GROUP BY credited_date
    ), islands AS (
      SELECT credited_date, credited_date - row_number() OVER (ORDER BY credited_date)::integer AS island
      FROM daily
    ), streaks AS (
      SELECT count(*)::integer AS length, min(credited_date) AS first_day, max(credited_date) AS last_day FROM islands GROUP BY island
    ), summary AS (
      SELECT coalesce((SELECT sum(leaves) FROM daily), 0)::integer AS total_leaves,
        coalesce(max(length), 0)::integer AS longest_streak,
        coalesce(max(least(last_day, ${day.creditedDate}::date) - first_day + 1)
          FILTER (WHERE first_day <= ${day.creditedDate}::date AND last_day >= ${day.creditedDate}::date - 1), 0)::integer AS current_streak
      FROM streaks
    )
    SELECT calendar.date::date::text AS date, coalesce(daily.completions, 0) AS completions,
      coalesce(daily.leaves, 0) AS leaves, summary.*
    FROM generate_series(${day.creditedDate}::date - (${size}::integer - 1), ${day.creditedDate}::date, interval '1 day') calendar(date)
    LEFT JOIN daily ON daily.credited_date = calendar.date::date CROSS JOIN summary
    ORDER BY calendar.date
  `);
  const rows = result.rows as {
    date: string;
    completions: number;
    leaves: number;
    total_leaves: number;
    longest_streak: number;
    current_streak: number;
  }[];
  const days = rows.map((row) => ({
    date: row.date,
    completions: Number(row.completions),
    leaves: Number(row.leaves),
  }));
  const today = days.at(-1)!;
  return {
    studyDay: serializeStudyDay(day, now),
    today: { ...today, progress: today.completions % COMPLETIONS_PER_LEAF },
    totalLeaves: Number(rows[0].total_leaves),
    longestStreak: Number(rows[0].longest_streak),
    currentStreak: Number(rows[0].current_streak),
    days,
  };
}
