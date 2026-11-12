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
