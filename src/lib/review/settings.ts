import { z } from "zod";

export const DEFAULT_NEW_WORDS_PER_DAY = 20;

export function isStudyTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const NewWordsPerDaySchema = z.number().int().min(0).max(1000);
export const StudyTimeZoneSchema = z.custom<string>(isStudyTimeZone);
