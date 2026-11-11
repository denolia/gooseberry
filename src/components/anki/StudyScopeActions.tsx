"use client";

import Link from "next/link";
import { useI18n } from "@/i18n/client";
import { MessageError } from "@/i18n/errors";
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
  const { t } = useI18n();
  const router = useRouter();
  const { data: dailyLimit } = useQuery({
    queryKey: ["studyNewWordLimit", userId],
    staleTime: 0,
    queryFn: async (): Promise<number> => {
      const response = await fetch("/api/profile");
      if (!response.ok) throw new MessageError("errors.couldNotLoadStudyLimit");
      const body = await response.json();
      return body.profile.preferences.newWordsPerDay;
    },
  });
  const count = selectedIds.length || setCount;
  return (
    <section className={styles.studyActions} aria-label={t("common.studySets")}>
      <div className={styles.headerActions}>
        <Link className={styles.studyButton} href={studyHref({ kind: "all" })}>
          {t("studyScope.studyAllAvailable")}
        </Link>
        <Link
          className={styles.importButton}
          href={studyHref({ kind: "all" }, "due_only")}
        >
          {t("studyScope.repeatDueOnly")}
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
          {t("studyScope.studySelected", { count: selectedIds.length })}
        </button>
        <label className={styles.selectionLabel}>
          <input
            type="checkbox"
            checked={dueOnly}
            onChange={(event) => onDueOnlyChange(event.target.checked)}
          />
          {t("studyScope.dueOnlyForSelected")}
        </label>
        {selectedIds.length > 0 && (
          <button
            type="button"
            className={styles.clearSelection}
            onClick={onClear}
          >
            {t("studyScope.clearSelection")}
          </button>
        )}
      </div>
      <p className={styles.setMeta}>
        {dailyLimit === undefined
          ? t("studyScope.perSetLimit")
          : t(
              selectedIds.length
                ? "studyScope.selectedAllowance"
                : "studyScope.allAllowance",
              { count, total: count * dailyLimit, limit: dailyLimit },
            )}{" "}
        <Link href="/profile">{t("studyScope.settings")}</Link>
      </p>
    </section>
  );
}
