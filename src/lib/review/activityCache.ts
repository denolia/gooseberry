import type { QueryClient } from "@tanstack/react-query";
import { projectStudyActivity, type StudyActivity } from "./activity";
import type { StudyDay } from "./exposure";

const REFRESH_DELAY_MS = 1000;
const trackers = new WeakMap<QueryClient, Map<string, StudyActivityTracker>>();

export function getStudyActivityTracker(client: QueryClient, userId: string) {
  let users = trackers.get(client);
  if (!users) {
    users = new Map();
    trackers.set(client, users);
  }
  let tracker = users.get(userId);
  if (!tracker) {
    tracker = new StudyActivityTracker(client, userId);
    users.set(userId, tracker);
  }
  return tracker;
}

// Only activity reads are coalesced. Review writes still run immediately so
// scheduling and saved introduction prerequisites never wait for a batch.
class StudyActivityTracker {
  private readonly key: readonly string[];
  private baseline?: StudyActivity;
  private day?: StudyDay;
  private additions = new Map<string, string | undefined>();
  private pending = new Set<string>();
  private waiters = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;

  constructor(
    private client: QueryClient,
    userId: string,
  ) {
    this.key = ["studyActivity", userId];
  }

  setDay = (day?: StudyDay) => {
    if (
      !day ||
      (this.day && Date.parse(day.startAt) < Date.parse(this.day.startAt)) ||
      (day.startAt === this.day?.startAt &&
        day.nextStartAt === this.day?.nextStartAt &&
        day.timeZone === this.day?.timeZone)
    )
      return;
    const changed = !!this.day;
    if (changed) {
      this.generation += 1;
      void this.client.cancelQueries({ queryKey: this.key, exact: true });
    }
    this.day = day;
    this.publish();
    if (changed) this.scheduleRefresh();
  };

  addReview = (reviewId: string) => {
    if (this.additions.has(reviewId)) return;
    this.startSave(reviewId);
    this.additions.set(
      reviewId,
      this.day?.creditedDate ?? this.baseline?.today.date,
    );
    this.publish();
  };

  startSave = (reviewId: string) => {
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    // React Query cancels/reverts synchronously; consume its abort signal in
    // fetch so an old history response cannot overwrite an optimistic click.
    void this.client.cancelQueries({ queryKey: this.key, exact: true });
    this.baseline ??= this.client.getQueryData<StudyActivity>(this.key);
    this.pending.add(reviewId);
  };

  completeSave = (reviewId: string, creditedDate?: string) => {
    if (creditedDate && this.additions.has(reviewId))
      this.additions.set(reviewId, creditedDate);
    this.pending.delete(reviewId);
    this.publish();
    this.scheduleRefresh();
  };

  failSave = (reviewId: string) => {
    this.additions.delete(reviewId);
    this.pending.delete(reviewId);
    this.publish();
    this.scheduleRefresh();
  };

  private publish() {
    if (!this.baseline) return; // Keep unknown totals unknown until first load.
    const dates = [...this.additions.values()].map(
      (date) => date ?? this.baseline!.today.date,
    );
    this.client.setQueryData(
      this.key,
      projectStudyActivity(this.baseline, dates, this.day),
    );
  }

  private scheduleRefresh() {
    if (this.pending.size > 0) return;
    for (const ready of this.waiters) ready();
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      void this.client.invalidateQueries({ queryKey: this.key, exact: true });
    }, REFRESH_DELAY_MS);
  }

  private waitForSaves(signal: AbortSignal) {
    if (signal.aborted) return Promise.reject(signal.reason);
    if (this.pending.size === 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const abort = () => {
        this.waiters.delete(ready);
        reject(signal.reason);
      };
      const ready = () => {
        this.waiters.delete(ready);
        signal.removeEventListener("abort", abort);
        resolve();
      };
      this.waiters.add(ready);
      signal.addEventListener("abort", abort, { once: true });
    });
  }

  fetch = async (signal: AbortSignal): Promise<StudyActivity> => {
    await this.waitForSaves(signal);
    const generation = this.generation;
    const response = await fetch("/api/study/activity", {
      cache: "no-store",
      signal,
    });
    if (!response.ok) throw new Error("Activity unavailable");
    const data = (await response.json()) as StudyActivity;
    if (
      signal.aborted ||
      generation !== this.generation ||
      this.pending.size > 0
    ) {
      throw new DOMException("Activity refresh superseded", "AbortError");
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.baseline = data;
    this.day = data.studyDay;
    this.additions.clear();
    return data;
  };
}
