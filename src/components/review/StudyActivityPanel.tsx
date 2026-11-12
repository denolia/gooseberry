"use client";

import { Flame, Leaf } from "lucide-react";
import { useEffect, useRef } from "react";
import { useI18n } from "@/i18n/client";
import {
  COMPLETIONS_PER_LEAF,
  type StudyActivity,
} from "@/lib/review/activity";
import { useStudyActivity } from "./useStudyActivity";
import styles from "./StudyActivityPanel.module.css";

export function StudyActivitySummary({
  activity,
}: {
  activity?: StudyActivity;
}) {
  const { t } = useI18n();
  const counterRef = useRef<HTMLSpanElement>(null);
  const date = activity?.today.date;
  const leaves = activity?.today.leaves;
  const previous = useRef({ date, leaves });
  useEffect(() => {
    const last = previous.current;
    previous.current = { date, leaves };
    if (
      !date ||
      date !== last.date ||
      leaves === undefined ||
      last.leaves === undefined ||
      leaves <= last.leaves
    )
      return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const animation = counterRef.current?.animate?.(
      reducedMotion
        ? [{ opacity: 1 }, { opacity: 0.7 }, { opacity: 1 }]
        : [
            { transform: "scale(1) rotate(0deg)" },
            { transform: "scale(1.12) rotate(-4deg)", offset: 0.35 },
            { transform: "scale(1) rotate(0deg)" },
          ],
      { duration: reducedMotion ? 240 : 480, easing: "ease-out" },
    );
    return () => animation?.cancel();
  }, [date, leaves]);
  const leafLabel = activity
    ? t("studyActivity.leavesToday", { count: activity.today.leaves })
    : t("studyActivity.loading");
  const streakLabel = activity
    ? t("studyActivity.streak", { count: activity.currentStreak })
    : t("studyActivity.loading");
  const progress = activity?.today.progress ?? 0;
  // Remount only the fill on a new leaf/day, avoiding a backwards drain.
  const progressCycle = activity ? `${date}:${leaves}` : "loading";
  return (
    <section
      className={styles.summary}
      aria-label={t("studyActivity.today")}
      aria-busy={!activity}
    >
      <div className={styles.leafProgress}>
        <span className={styles.fraction} aria-hidden="true">
          <strong>{activity ? progress : "—"}</strong>
          <span>/ {COMPLETIONS_PER_LEAF}</span>
        </span>
        <div
          className={styles.progressTrack}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={COMPLETIONS_PER_LEAF}
          aria-valuenow={activity ? progress : undefined}
          aria-label={t("studyActivity.nextLeaf")}
          aria-valuetext={
            activity
              ? t("studyActivity.progress", {
                  count: activity.today.completions,
                  progress,
                })
              : t("studyActivity.loading")
          }
        >
          <span
            key={progressCycle}
            className={styles.progressFill}
            style={{ transform: `scaleX(${progress / COMPLETIONS_PER_LEAF})` }}
          />
        </div>
      </div>
      <span
        ref={counterRef}
        className={styles.leafCounter}
        role="img"
        aria-label={leafLabel}
        title={leafLabel}
      >
        <Leaf size={28} aria-hidden="true" />
        <strong aria-hidden="true">{leaves ?? "—"}</strong>
      </span>
      <span
        className={styles.streakCounter}
        role="img"
        aria-label={streakLabel}
        title={streakLabel}
      >
        <Flame size={28} aria-hidden="true" />
        <strong aria-hidden="true">{activity?.currentStreak ?? "—"}</strong>
      </span>
    </section>
  );
}

export function StudyActivityPanel() {
  const { t } = useI18n();
  const query = useStudyActivity();
  if (!query.data)
    return (
      <section className={styles.panel} aria-label={t("studyActivity.history")}>
        <p role="status">
          {t(
            query.isError
              ? "studyActivity.unavailable"
              : "studyActivity.loading",
          )}
        </p>
        {query.isError && (
          <button type="button" onClick={() => void query.refetch()}>
            {t("reviewSession.retry")}
          </button>
        )}
      </section>
    );
  const activity = query.data;
  return (
    <section className={styles.panel}>
      <div className={styles.panelSummary}>
        <StudyActivitySummary activity={activity} />
      </div>
      {query.isError && <p role="status">{t("studyActivity.stale")}</p>}
      <details>
        <summary>{t("studyActivity.history")}</summary>
        <p>
          {t("studyActivity.lifetime", {
            leaves: activity.totalLeaves,
            days: activity.longestStreak,
          })}
        </p>
        <p className={styles.help}>
          {t("studyActivity.dayPolicy", { zone: activity.studyDay.timeZone })}
        </p>
        <div className={styles.calendar} aria-hidden="true">
          {activity.days.map((day) => (
            <span
              key={day.date}
              title={t("studyActivity.dayCount", {
                date: day.date,
                count: day.completions,
              })}
              data-level={
                day.completions === 0
                  ? 0
                  : day.completions < 10
                    ? 1
                    : day.completions < 20
                      ? 2
                      : day.completions < 40
                        ? 3
                        : 4
              }
            />
          ))}
        </div>
        <details className={styles.dayList}>
          <summary>{t("studyActivity.dailyList")}</summary>
          <div className={styles.tableScroll} tabIndex={0}>
            <table>
              <caption>{t("studyActivity.history")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("studyActivity.date")}</th>
                  <th scope="col">{t("studyActivity.completions")}</th>
                  <th scope="col">{t("studyActivity.leaves")}</th>
                </tr>
              </thead>
              <tbody>
                {[...activity.days].reverse().map((day) => (
                  <tr key={day.date}>
                    <th scope="row">
                      <time dateTime={day.date}>{day.date}</time>
                    </th>
                    <td>{day.completions}</td>
                    <td>{day.leaves}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </details>
    </section>
  );
}
