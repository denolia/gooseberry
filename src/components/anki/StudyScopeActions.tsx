"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { studyHref } from "@/lib/review/scope";
import styles from "./WordSetList.module.css";

export function StudyScopeActions({
  userId,
  setCount,
  selectedIds,
  dueOnly,
  onDueOnlyChange,
  onClear,
}: {
  userId: string;
  setCount: number;
  selectedIds: string[];
  dueOnly: boolean;
  onDueOnlyChange: (value: boolean) => void;
  onClear: () => void;
}) {
  const router = useRouter();
  const { data: dailyLimit } = useQuery({
    queryKey: ["studyNewWordLimit", userId],
    staleTime: 0,
    queryFn: async (): Promise<number> => {
      const response = await fetch("/api/profile");
      if (!response.ok) throw new Error("Could not load your study limit");
      const body = await response.json();
      return body.profile.preferences.newWordsPerDay;
    },
  });
  const count = selectedIds.length || setCount;
  return (
    <section className={styles.studyActions} aria-label="Study sets">
      <div className={styles.headerActions}>
        <Link className={styles.studyButton} href={studyHref({ kind: "all" })}>
          Study all available
        </Link>
        <Link
          className={styles.importButton}
          href={studyHref({ kind: "all" }, "due_only")}
        >
          Repeat due only
        </Link>
      </div>
      <div className={styles.selectionActions}>
        <button
          type="button"
          className={styles.studyButton}
          disabled={selectedIds.length === 0}
          onClick={() =>
            router.push(
              studyHref(
                { kind: "sets", setIds: selectedIds },
                dueOnly ? "due_only" : "all_available",
              ),
            )
          }
        >
          Study selected ({selectedIds.length})
        </button>
        <label className={styles.selectionLabel}>
          <input
            type="checkbox"
            checked={dueOnly}
            onChange={(event) => onDueOnlyChange(event.target.checked)}
          />
          Due only for selected sets
        </label>
        {selectedIds.length > 0 && (
          <button
            type="button"
            className={styles.clearSelection}
            onClick={onClear}
          >
            Clear selection
          </button>
        )}
      </div>
      <p className={styles.setMeta}>
        {dailyLimit === undefined
          ? "The daily new-word limit applies to each set separately."
          : `${selectedIds.length ? "Selected" : "All"} sets allow up to ${count * dailyLimit} new words per day (${dailyLimit} per set).`}{" "}
        <Link href="/profile">Study settings</Link>
      </p>
    </section>
  );
}
