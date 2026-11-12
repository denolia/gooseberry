"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/client";
import {
  MAX_STUDY_SETS,
  studyHref,
  type StudyFilter,
} from "@/lib/review/scope";
import { WordSetPicker } from "./WordSetPicker";
import type { WordSetOption } from "./useWordSets";
import dialogStyles from "./MoveWordDialog.module.css";
import styles from "./CustomStudyDialog.module.css";

export function CustomStudyDialog({
  sets,
  onClose,
}: {
  sets: WordSetOption[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const titleId = useId();
  const searchId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selection = selectedIds.filter((id) =>
    sets.some((set) => set.id === id),
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    searchRef.current?.focus();
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, []);

  function study(filter: StudyFilter) {
    if (selection.length === 0) return;
    router.push(studyHref({ kind: "sets", setIds: selection }, filter));
  }

  return (
    <dialog
      ref={dialogRef}
      className={dialogStyles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          study("all_available");
        }}
      >
        <header className={dialogStyles.header}>
          <h2 id={titleId}>{t("studyScope.customStudy")}</h2>
        </header>
        <div className={dialogStyles.body}>
          <WordSetPicker
            sets={sets}
            selectionMode="multiple"
            selectedIds={selection}
            maxSelected={MAX_STUDY_SETS}
            onToggle={(id) =>
              setSelectedIds(
                selection.includes(id)
                  ? selection.filter((selected) => selected !== id)
                  : selection.length < MAX_STUDY_SETS
                    ? [...selection, id]
                    : selection,
              )
            }
            search={search}
            onSearchChange={setSearch}
            id={searchId}
            searchRef={searchRef}
            showLanguages
          />
          <p className={styles.selectionCount} role="status">
            {selection.length === MAX_STUDY_SETS
              ? t("studyScope.selectionLimit", { limit: MAX_STUDY_SETS })
              : t("studyScope.selectedCount", { count: selection.length })}
          </p>
        </div>
        <footer className={`${dialogStyles.actions} ${styles.actions}`}>
          <button type="button" onClick={onClose}>
            {t("moveWordDialog.cancel")}
          </button>
          <button
            type="button"
            disabled={selection.length === 0}
            onClick={() => study("due_only")}
          >
            {t("studyScope.repeatDueOnly")}
          </button>
          <button
            type="submit"
            className={dialogStyles.move}
            disabled={selection.length === 0}
          >
            {t("studyScope.study")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
