"use client";

import type { Ref } from "react";
import type { WordSetOption } from "./useWordSets";
import styles from "./WordSetPicker.module.css";

export function WordSetPicker({
  sets,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  id,
  searchRef,
  label = "Sets",
  disabled = false,
  unavailableReason,
  showLanguages = false,
}: {
  sets: WordSetOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  search: string;
  onSearchChange: (search: string) => void;
  id: string;
  searchRef?: Ref<HTMLInputElement>;
  label?: string;
  disabled?: boolean;
  unavailableReason?: (set: WordSetOption) => string | undefined;
  showLanguages?: boolean;
}) {
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
        Find a set
      </label>
      <input
        ref={searchRef}
        id={id}
        className={styles.search}
        type="search"
        placeholder="Find a set…"
        value={search}
        disabled={disabled}
        onChange={(event) => onSearchChange(event.target.value)}
      />
      <div className={styles.list} role="group" aria-label={label}>
        {options.map((set) => {
          const reason = unavailableReason?.(set);
          return (
            <button
              key={set.id}
              type="button"
              className={`${styles.option} ${set.id === selectedId ? styles.selected : ""}`}
              aria-pressed={set.id === selectedId}
              disabled={disabled || !!reason}
              onClick={() => onSelect(set.id)}
              title={set.name}
            >
              <span className={styles.mark} aria-hidden="true">
                {set.id === selectedId ? "✓" : ""}
              </span>
              <span className={styles.name}>{set.name}</span>
              {(showLanguages || reason) && (
                <small className={styles.meta}>
                  {reason ??
                    `${set.sourceLang.toUpperCase()} → ${set.targetLang.toUpperCase()}`}
                </small>
              )}
            </button>
          );
        })}
        {options.length === 0 && (
          <p className={styles.empty}>
            {search.trim()
              ? `No sets match “${search}”.`
              : "No sets available."}
          </p>
        )}
      </div>
    </div>
  );
}
