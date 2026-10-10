import { default_w, S_MAX, S_MIN } from "ts-fsrs";
import {
  createInitialFsrsState,
  FSRS_SCHEDULER_VERSION,
  type FsrsStateProjection,
} from "@/lib/review/fsrs";
import type { AnkiCard, AnkiPackage } from "./readerTypes";

const DAY_MS = 86_400_000;
// Even a million reviews of one card is implausible; leave ample room for
// native counter increments in PostgreSQL's signed integer columns.
const MAX_IMPORTED_REVIEW_COUNT = 1_000_000;
export const ANKI_PROGRESS_CONVERSION_VERSION = "anki-to-gooseberry-v1";

export type AnkiProgressContext = {
  collection: AnkiPackage["collection"];
  timeZone: string;
  now: Date;
};
export type ConvertedAnkiProgress = {
  state: FsrsStateProjection;
  isSuspended: boolean;
  buriedUntil: Date | null;
  method: "new" | "anki-fsrs" | "anki-sm2";
};

function cardData(card: AnkiCard): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(card.data);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validDate(value: number): Date | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) &&
    date.getUTCFullYear() >= 1970 &&
    date.getUTCFullYear() <= 9999
    ? date
    : null;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function localParts(date: Date, timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

function zonedDate(wallTime: number, timeZone: string): Date {
  let instant = wallTime;
  for (let attempt = 0; attempt < 4; attempt++) {
    const adjusted =
      instant + wallTime - localParts(new Date(instant), timeZone);
    if (adjusted === instant) break;
    instant = adjusted;
  }
  // A nonexistent rollover hour at a DST jump resolves to the later instant.
  if (localParts(new Date(instant), timeZone) < wallTime) instant += 3_600_000;
  return new Date(instant);
}

function rolloverHour(context: AnkiProgressContext) {
  const value = context.collection.config.rollover;
  return finiteNumber(value) &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < 24
    ? value
    : 4;
}

export function ankiDayDueDate(
  day: number,
  context: AnkiProgressContext,
): Date | null {
  if (!Number.isInteger(day) || Math.abs(day) > 3_000_000) return null;
  const config = context.collection.config;
  const created = context.collection.creationTime * 1000;
  if (!validDate(created)) return null;
  if (config.schedVer !== 2) return validDate(created + day * DAY_MS);
  // Anki stores creationOffset in minutes WEST of UTC. Newer schedulers count
  // calendar days from that creation wall date, not elapsed 24-hour periods.
  const creationOffset = config.creationOffset;
  const currentOffsetMs =
    localParts(context.now, context.timeZone) -
    Math.floor(context.now.getTime() / 1000) * 1000;
  const creationWall = new Date(
    created +
      (finiteNumber(creationOffset)
        ? -creationOffset * 60_000
        : currentOffsetMs),
  );
  const origin = Date.UTC(
    creationWall.getUTCFullYear(),
    creationWall.getUTCMonth(),
    creationWall.getUTCDate(),
  );
  const wallTime = origin + day * DAY_MS + rolloverHour(context) * 3_600_000;
  if (!validDate(wallTime)) return null;
  return validDate(zonedDate(wallTime, context.timeZone).getTime());
}

function nextRollover(date: Date, context: AnkiProgressContext): Date {
  const wall = new Date(localParts(date, context.timeZone));
  const today = Date.UTC(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate(),
    rolloverHour(context),
  );
  const rollover = zonedDate(today, context.timeZone);
  return rollover.getTime() > date.getTime()
    ? rollover
    : zonedDate(today + DAY_MS, context.timeZone);
}

// Uses the same SM-2 → FSRS memory bridge as fsrs-rs: preserve the source
// interval at historical retention 0.9 and estimate difficulty from ease.
// https://github.com/open-spaced-repetition/fsrs-rs/blob/main/src/model_v6.rs
function sm2Memory(card: AnkiCard) {
  const stability = Math.min(S_MAX, Math.max(S_MIN, card.ivl || S_MIN));
  const ease = Math.max(1.3, Math.min(5, (card.factor || 2500) / 1000));
  const denominator =
    Math.exp(default_w[8]) *
    stability ** -default_w[9] *
    Math.expm1(0.1 * default_w[10]);
  const difficulty = Math.max(1, Math.min(10, 11 - (ease - 1) / denominator));
  return { stability, difficulty };
}

// Source log times are passed as evidence, never inserted as new native
// ratings. Due dates/counters remain authoritative even if history is partial.
export function convertAnkiProgress(
  card: AnkiCard,
  context: AnkiProgressContext,
  lastRatedReviewMs?: number | null,
): ConvertedAnkiProgress | null {
  if (
    ![0, 1, 2, 3].includes(card.type) ||
    ![-3, -2, -1, 0, 1, 2, 3, 4].includes(card.queue) ||
    ![card.ivl, card.reps, card.lapses, card.left].every(
      (value) =>
        Number.isInteger(value) && value >= 0 && value <= 2_147_483_647,
    ) ||
    card.reps > MAX_IMPORTED_REVIEW_COUNT ||
    card.lapses > MAX_IMPORTED_REVIEW_COUNT
  )
    return null;
  const data = cardData(card);
  const state = createInitialFsrsState(context.now);
  const filtered = card.odid !== "0";
  const sourceDue = filtered ? card.odue : card.due;
  if (card.type !== 0) {
    const epochDue = sourceDue > 1_000_000_000;
    const dueAt = epochDue
      ? validDate(sourceDue * 1000)
      : ankiDayDueDate(sourceDue, context);
    if (!dueAt) return null;
    const memory =
      finiteNumber(data.s) &&
      data.s >= S_MIN &&
      data.s <= S_MAX &&
      finiteNumber(data.d) &&
      data.d >= 1 &&
      data.d <= 10
        ? { stability: data.s, difficulty: data.d }
        : sm2Memory(card);
    const lastReview = finiteNumber(data.lrt)
      ? validDate(data.lrt * 1000)
      : null;
    const loggedReview = finiteNumber(lastRatedReviewMs)
      ? validDate(lastRatedReviewMs)
      : null;
    // Old exports may omit logs/lrt. A day-based review's interval anchors its
    // last exposure; learning falls back to card modification time.
    const inferred =
      card.type === 2
        ? validDate(dueAt.getTime() - card.ivl * DAY_MS)
        : validDate(card.mod * 1000);
    const lastReviewAt =
      [lastReview, loggedReview, inferred].find(
        (date) => date && date.getTime() <= context.now.getTime(),
      ) ?? context.now;
    Object.assign(state, memory, {
      dueAt,
      lastReviewAt,
      state: card.type,
      reps: card.reps,
      lapses: card.lapses,
      scheduledDays: card.type === 1 ? 0 : card.ivl,
      elapsedDays: 0,
      // Gooseberry uses its own two learning steps / one relearning step.
      learningSteps:
        card.type === 1 ? Math.max(0, 2 - Math.min(2, card.left % 1000)) : 0,
      schedulerVersion: FSRS_SCHEDULER_VERSION,
    });
  }
  const modified = validDate(card.mod * 1000);
  const buriedUntil =
    card.queue === -2 || card.queue === -3
      ? nextRollover(
          modified && modified < context.now ? modified : context.now,
          context,
        )
      : null;
  return {
    state,
    isSuspended: card.queue === -1,
    buriedUntil,
    method:
      card.type === 0
        ? "new"
        : finiteNumber(data.s) &&
            finiteNumber(data.d) &&
            state.stability === data.s &&
            state.difficulty === data.d
          ? "anki-fsrs"
          : "anki-sm2",
  };
}
