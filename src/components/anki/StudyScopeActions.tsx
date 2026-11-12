"use client";

import Link from "next/link";
import { useI18n } from "@/i18n/client";
import { useState } from "react";
import { studyHref } from "@/lib/review/scope";
import { CustomStudyDialog } from "./CustomStudyDialog";
import type { WordSetOption } from "./useWordSets";
import styles from "./WordSetList.module.css";

export function StudyScopeActions({ sets }: { sets: WordSetOption[] }) {
  const { t } = useI18n();
  const [showCustomStudy, setShowCustomStudy] = useState(false);
  return (
    <section className={styles.studyActions} aria-label={t("common.studySets")}>
      <div className={styles.headerActions}>
        <Link className={styles.studyButton} href={studyHref({ kind: "all" })}>
          {t("studyScope.studyAll")}
        </Link>
        <Link
          className={styles.importButton}
          href={studyHref({ kind: "all" }, "due_only")}
        >
          {t("studyScope.repeatAll")}
        </Link>
        <button
          type="button"
          className={styles.importButton}
          onClick={() => setShowCustomStudy(true)}
        >
          {t("studyScope.customStudy")}
        </button>
      </div>
      {showCustomStudy && (
        <CustomStudyDialog
          sets={sets}
          onClose={() => setShowCustomStudy(false)}
        />
      )}
    </section>
  );
}
