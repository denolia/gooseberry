import type { StudyDay } from "./exposure";

export const COMPLETIONS_PER_LEAF = 20;
export type StudyActivityDay = {
  date: string;
  completions: number;
  leaves: number;
};
export type StudyActivity = {
  studyDay: StudyDay;
  today: StudyActivityDay & { progress: number };
  totalLeaves: number;
  currentStreak: number;
  longestStreak: number;
  days: StudyActivityDay[];
};

const DAY_MS = 86_400_000;
const dateNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const dateString = (day: number) =>
  new Date(day * DAY_MS).toISOString().slice(0, 10);

// Project a small client-side receipt ledger over the last authoritative total.
// Recompute from that baseline so overlapping saves, retries and rollbacks never
// apply another completion or leaf to an already optimistic value.
export function projectStudyActivity(
  baseline: StudyActivity,
  dates: Iterable<string>,
  studyDay = baseline.studyDay,
): StudyActivity {
  const daily = new Map(baseline.days.map((day) => [day.date, { ...day }]));
  if (!daily.has(baseline.today.date))
    daily.set(baseline.today.date, { ...baseline.today });
  let totalLeaves = baseline.totalLeaves;
  for (const date of dates) {
    const day = daily.get(date) ?? { date, completions: 0, leaves: 0 };
    const leaves = Math.floor((day.completions + 1) / COMPLETIONS_PER_LEAF);
    totalLeaves += leaves - day.leaves;
    daily.set(date, { date, completions: day.completions + 1, leaves });
  }
  const date = studyDay.creditedDate ?? baseline.today.date;
  const todayNumber = dateNumber(date);
  const days = Array.from(
    { length: baseline.days.length || 365 },
    (_, index) => {
      const date = dateString(
        todayNumber - (baseline.days.length || 365) + 1 + index,
      );
      return daily.get(date) ?? { date, completions: 0, leaves: 0 };
    },
  );
  const today = days.at(-1)!;
  const ranges = [...daily.values()]
    .filter((day) => day.completions > 0)
    .map((day) => ({ start: dateNumber(day.date), end: dateNumber(day.date) }));
  // The server's current streak can extend beyond the returned calendar range.
  if (baseline.currentStreak > 0) {
    const end =
      dateNumber(baseline.today.date) -
      (baseline.today.completions > 0 ? 0 : 1);
    ranges.push({ start: end - baseline.currentStreak + 1, end });
  }
  ranges.sort((a, b) => a.start - b.start);
  const merged: typeof ranges = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.start <= last.end + 1)
      last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return {
    ...baseline,
    studyDay,
    days,
    today: { ...today, progress: today.completions % COMPLETIONS_PER_LEAF },
    totalLeaves,
    currentStreak: Math.max(
      0,
      ...merged
        .filter(
          (range) => range.start <= todayNumber && range.end >= todayNumber - 1,
        )
        .map((range) => Math.min(range.end, todayNumber) - range.start + 1),
    ),
    longestStreak: Math.max(
      baseline.longestStreak,
      ...merged.map((range) => range.end - range.start + 1),
    ),
  };
}
