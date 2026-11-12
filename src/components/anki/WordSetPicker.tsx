"use client";
import { useI18n } from "@/i18n/client";

import type { Ref } from "react";
import type { WordSetOption } from "./useWordSets";
import styles from "./WordSetPicker.module.css";

type WordSetPickerProps = {
  sets: WordSetOption[];
  search: string;
  onSearchChange: (search: string) => void;
  id: string;
  searchRef?: Ref<HTMLInputElement>;
  label?: string;
  disabled?: boolean;
  unavailableReason?: (set: WordSetOption) => string | undefined;
  showLanguages?: boolean;
} & (
  | {
      selectionMode?: "single";
      selectedId: string;
      onSelect: (id: string) => void;
    }
  | {
      selectionMode: "multiple";
      selectedIds: readonly string[];
      onToggle: (id: string) => void;
      maxSelected?: number;
    }
);

export function WordSetPicker(props: WordSetPickerProps) {
  const {
    sets,
    search,
    onSearchChange,
    id,
    searchRef,
    label,
    disabled = false,
    unavailableReason,
    showLanguages = false,
  } = props;
  const { t } = useI18n();
  const selectedId =
    props.selectionMode === "multiple" ? null : props.selectedId;
  const normalized = search.trim().toLocaleLowerCase();
  const options = [...sets]
    .sort((a, b) => {
      if (a.id === selectedId) return -1;
      if (b.id === selectedId) return 1;
      return a.name.localeCompare(b.name);
    })
    .filter((set) => set.name.toLocaleLowerCase().includes(normalized));

  return (
    <div className={styles.picker}>
      <label className={styles.srOnly} htmlFor={id}>
        {t("wordSetPicker.findASet")}
      </label>
      <input
        ref={searchRef}
        id={id}
        className={styles.search}
        type="search"
        placeholder={t("wordSetList.findASet")}
        value={search}
        disabled={disabled}
        onChange={(event) => onSearchChange(event.target.value)}
      />
      <div
        className={styles.list}
        role="group"
        aria-label={label ?? t("wordSetPicker.sets")}
      >
        {options.map((set) => {
          const reason = unavailableReason?.(set);
          const selected =
            props.selectionMode === "multiple"
              ? props.selectedIds.includes(set.id)
              : set.id === selectedId;
          const atCapacity =
            props.selectionMode === "multiple" &&
            !selected &&
            props.maxSelected !== undefined &&
            props.selectedIds.length >= props.maxSelected;
          const unavailable = disabled || !!reason || atCapacity;
          const copy = (
            <>
              <span className={styles.name}>{set.name}</span>
              {(showLanguages || reason) && (
                <small className={styles.meta}>
                  {reason ??
                    `${set.sourceLang.toUpperCase()} → ${set.targetLang.toUpperCase()}`}
                </small>
              )}
            </>
          );
          if (props.selectionMode === "multiple") {
            return (
              <label
                key={set.id}
                title={set.name}
                className={`${styles.option} ${styles.checkboxOption} ${selected ? styles.selected : ""} ${unavailable ? styles.disabled : ""}`}
              >
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={selected}
                  disabled={unavailable}
                  aria-label={t("studyScope.selectSet", { name: set.name })}
                  onChange={() => props.onToggle(set.id)}
                />
                {copy}
              </label>
            );
          }
          return (
            <button
              key={set.id}
              type="button"
              className={`${styles.option} ${selected ? styles.selected : ""}`}
              aria-pressed={selected}
              disabled={unavailable}
              onClick={() => props.onSelect(set.id)}
              title={set.name}
            >
              <span className={styles.mark} aria-hidden="true">
                {selected ? "✓" : ""}
              </span>
              {copy}
            </button>
          );
        })}
        {options.length === 0 && (
          <p className={styles.empty}>
            {search.trim()
              ? t("wordSetPicker.noSetsMatchValue", { value0: search })
              : t("wordSetPicker.noSetsAvailable")}
          </p>
        )}
      </div>
    </div>
  );
}
