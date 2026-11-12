import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { loadSourceModule } from "./helpers/sourceModule.mjs";

const activity = loadSourceModule("src/lib/review/activity.ts");
const { getStudyActivityTracker } = loadSourceModule(
  "src/lib/review/activityCache.ts",
  { "./activity": activity },
);
const day = {
  creditedDate: "2026-11-12",
  startAt: "2026-11-12T02:00:00Z",
  nextStartAt: "2026-11-13T02:00:00Z",
  timeZone: "UTC",
};
function baseline(completions = 19) {
  const leaves = Math.floor(completions / 20);
  return {
    studyDay: day,
    today: {
      date: day.creditedDate,
      completions,
      leaves,
      progress: completions % 20,
    },
    totalLeaves: leaves + 2,
    currentStreak: completions ? 2 : 1,
    longestStreak: 3,
    days: [
      { date: "2026-11-10", completions: 0, leaves: 0 },
      { date: "2026-11-11", completions: 1, leaves: 0 },
      { date: day.creditedDate, completions, leaves },
    ],
  };
}
function setup(t, data = baseline()) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  t.after(() => client.clear());
  const key = ["studyActivity", "one"];
  if (data) client.setQueryData(key, data);
  const tracker = getStudyActivityTracker(client, "one");
  tracker.setDay(day);
  const refreshes = [];
  t.mock.method(client, "invalidateQueries", (input) => {
    refreshes.push(input);
    return Promise.resolve();
  });
  return {
    client,
    tracker,
    refreshes,
    read: () => client.getQueryData(key),
    fetch: () =>
      client.fetchQuery({
        queryKey: key,
        queryFn: ({ signal }) => tracker.fetch(signal),
      }),
  };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("rating clicks immediately cross leaf thresholds; out-of-order saves and retries never count twice", (t) => {
  const state = setup(t);
  state.tracker.addReview("a");
  assert.equal(state.read().today.completions, 20);
  assert.equal(state.read().today.leaves, 1);
  assert.equal(state.read().today.progress, 0);
  assert.equal(state.read().totalLeaves, 3);
  state.tracker.addReview("a");
  state.tracker.startSave("a");
  assert.equal(state.read().today.completions, 20);
  state.tracker.addReview("b");
  assert.equal(state.read().today.progress, 1);
  state.tracker.completeSave("b", day.creditedDate);
  state.tracker.completeSave("a", day.creditedDate);
  assert.equal(state.read().today.completions, 21);
  assert.equal(state.read().totalLeaves, 3);
  assert.equal(state.read().days.at(-1).completions, 21);
});

test("activity refreshes coalesce after a burst; authoritative totals replace the optimistic ledger", async (t) => {
  const state = setup(t);
  for (const id of ["a", "b", "c"]) state.tracker.addReview(id);
  state.tracker.completeSave("a");
  state.tracker.completeSave("c");
  t.mock.timers.tick(2000);
  assert.equal(
    state.refreshes.length,
    0,
    "do not fetch a partial snapshot while writes remain",
  );
  state.tracker.completeSave("b");
  t.mock.timers.tick(999);
  assert.equal(state.refreshes.length, 0);
  t.mock.timers.tick(1);
  assert.equal(state.refreshes.length, 1);
  t.mock.method(globalThis, "fetch", async () => Response.json(baseline(22)));
  await state.fetch();
  assert.equal(state.read().today.completions, 22);
  state.tracker.addReview("d");
  assert.equal(state.read().today.completions, 23);
  state.tracker.completeSave("d");
});

test("a new rating cancels a stale in-flight activity response before it can overwrite progress", async (t) => {
  const state = setup(t);
  let resolve;
  t.mock.method(
    globalThis,
    "fetch",
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const loading = state.fetch();
  await tick();
  state.tracker.addReview("a");
  assert.equal(state.read().today.completions, 20);
  resolve(Response.json(baseline(19)));
  await loading;
  await tick();
  assert.equal(state.read().today.completions, 20);
  state.tracker.completeSave("a");
});

test("a focus/refill read waits for pending writes and does not schedule a second refresh after succeeding", async (t) => {
  const state = setup(t);
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return Response.json(baseline(20));
  });
  state.tracker.addReview("a");
  const loading = state.fetch();
  await tick();
  assert.equal(requests, 0);
  state.tracker.completeSave("a");
  await loading;
  assert.equal(requests, 1);
  assert.equal(state.read().today.completions, 20);
  t.mock.timers.tick(1000);
  assert.equal(state.refreshes.length, 0);
});

test("failed saves roll back their own credit without erasing other pending reviews or rewarding retries", async (t) => {
  const state = setup(t);
  state.tracker.addReview("a");
  state.tracker.addReview("b");
  state.tracker.failSave("a");
  assert.equal(state.read().today.completions, 20);
  assert.equal(state.read().today.leaves, 1);
  state.tracker.failSave("b");
  assert.deepEqual(state.read(), baseline());
  state.tracker.startSave("a"); // A retry is the same rating, not another click.
  assert.equal(state.read().today.completions, 19);
  state.tracker.completeSave("a");
  t.mock.method(globalThis, "fetch", async () => Response.json(baseline(20)));
  await state.fetch();
  assert.equal(state.read().today.completions, 20);
});

test("rollover and the server's immutable credited date reconcile a delayed save to the correct day", (t) => {
  const state = setup(t);
  state.tracker.addReview("old");
  const nextDay = {
    ...day,
    creditedDate: "2026-11-13",
    startAt: day.nextStartAt,
    nextStartAt: "2026-11-14T02:00:00Z",
  };
  state.tracker.setDay(nextDay);
  assert.equal(state.read().today.completions, 0);
  assert.equal(state.read().days.at(-2).completions, 20);
  state.tracker.addReview("new");
  assert.equal(state.read().today.completions, 1);
  state.tracker.completeSave("old", nextDay.creditedDate);
  state.tracker.completeSave("new", nextDay.creditedDate);
  assert.equal(state.read().today.completions, 2);
  assert.equal(state.read().days.at(-2).completions, 19);
  assert.equal(state.read().totalLeaves, 2);
  assert.equal(state.read().currentStreak, 3);
});

test("unknown initial totals remain unknown; the first confirmed snapshot does not double-count early clicks", async (t) => {
  const state = setup(t, null);
  state.tracker.addReview("a");
  assert.equal(state.read(), undefined);
  state.tracker.completeSave("a");
  t.mock.method(globalThis, "fetch", async () => Response.json(baseline(20)));
  await state.fetch();
  assert.equal(state.read().today.completions, 20);
  state.tracker.addReview("b");
  assert.equal(state.read().today.completions, 21);
  state.tracker.completeSave("b");
});

test("optimistic activity is scoped by account and QueryClient, and follows a library navigation", (t) => {
  const state = setup(t);
  const other = ["studyActivity", "other"];
  state.client.setQueryData(other, baseline(5));
  state.tracker.addReview("a");
  assert.equal(getStudyActivityTracker(state.client, "one"), state.tracker);
  assert.equal(state.client.getQueryData(other).today.completions, 5);
  const second = new QueryClient();
  t.after(() => second.clear());
  assert.notEqual(getStudyActivityTracker(second, "one"), state.tracker);
  state.tracker.completeSave("a");
});

test("optimistic leaves and streaks recompute from the server baseline, including streaks longer than the calendar", () => {
  const data = baseline(0);
  data.currentStreak = 400;
  data.longestStreak = 400;
  const optimistic = activity.projectStudyActivity(data, [day.creditedDate]);
  assert.equal(optimistic.currentStreak, 401);
  assert.equal(optimistic.longestStreak, 401);
  assert.equal(activity.projectStudyActivity(data, []).currentStreak, 400);
  assert.equal(data.today.completions, 0);
});
