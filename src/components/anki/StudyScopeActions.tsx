"use client";

import Link from "next/link";
import { EllipsisVertical } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { useEffect, useRef, useState } from "react";
import { studyHref } from "@/lib/review/scope";
import { CustomStudyDialog } from "./CustomStudyDialog";
import type { WordSetOption } from "./useWordSets";
import styles from "./WordSetList.module.css";

export function StudyScopeActions({ sets }: { sets: WordSetOption[] }) {
  const { t } = useI18n();
  const [showCustomStudy, setShowCustomStudy] = useState(false);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const triggerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const menu = menuRef.current;
      if (menu?.open && !menu.contains(event.target as Node)) menu.open = false;
    };
    const breakpoint = window.matchMedia("(max-width: 840px)");
    const closeOnResize = () => {
      if (menuRef.current) menuRef.current.open = false;
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    breakpoint.addEventListener("change", closeOnResize);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      breakpoint.removeEventListener("change", closeOnResize);
    };
  }, []);

  return (
    <section className={styles.studyActions} aria-label={t("common.studySets")}>
      <div className={styles.headerActions}>
        {sets.length > 0 && (
          <>
            <Link
              className={styles.studyButton}
              href={studyHref({ kind: "all" })}
            >
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
              className={`${styles.importButton} ${styles.expandedAction}`}
              onClick={() => setShowCustomStudy(true)}
            >
              {t("studyScope.customStudy")}
            </button>
          </>
        )}
        <details
          ref={menuRef}
          className={styles.toolbarMenu}
          onKeyDown={(event) => {
            if (event.key === "Escape" && menuRef.current?.open) {
              event.preventDefault();
              menuRef.current.open = false;
              triggerRef.current?.focus();
            }
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              event.currentTarget.open = false;
            }
          }}
        >
          <summary
            ref={triggerRef}
            aria-label={t("wordSetList.moreActions")}
            title={t("wordSetList.moreActions")}
          >
            <EllipsisVertical size={18} aria-hidden="true" focusable="false" />
          </summary>
          <div className={styles.toolbarMenuContent}>
            {sets.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (menuRef.current) menuRef.current.open = false;
                  triggerRef.current?.focus();
                  setShowCustomStudy(true);
                }}
              >
                {t("studyScope.customStudy")}
              </button>
            )}
            <Link
              href="/anki/import"
              onClick={() => {
                if (menuRef.current) menuRef.current.open = false;
              }}
            >
              {t("wordSetList.importAnkiDeck")}
            </Link>
          </div>
        </details>
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
