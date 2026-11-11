"use client";
import { formatError, MessageError } from "@/i18n/errors";

import { useI18n } from "@/i18n/client";

import { useEffect, useState } from "react";
import styles from "./TranslationSelector.module.css";

interface Translation {
  id: string;
  inputText: string;
  sourceLang: string;
  targetLang: string;
  responseJson: {
    original: string;
    translation: string;
    type: string | null;
  };
  createdAt: string;
}

interface TranslationSelectorProps {
  wordSetId: string;
  onClose: () => void;
  onItemsAdded: (result: { count: number; skippedCount: number }) => void;
}

export function TranslationSelector({
  wordSetId,
  onClose,
  onItemsAdded,
}: TranslationSelectorProps) {
  const { t } = useI18n();
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    loadTranslations();
  }, []);

  const loadTranslations = async () => {
    try {
      const response = await fetch("/api/history/list");
      if (!response.ok)
        throw new MessageError("errors.failedToLoadTranslations");
      const data = await response.json();
      setTranslations(data.history);
    } catch (err) {
      console.error("Failed to load translations:", err);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const toggleAll = () => {
    if (selectedIds.size === filteredTranslations.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredTranslations.map((t) => t.id)));
    }
  };

  const handleAdd = async () => {
    if (selectedIds.size === 0) return;

    try {
      setAdding(true);
      const response = await fetch(`/api/word-sets/${wordSetId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          translationHistoryIds: Array.from(selectedIds),
        }),
      });

      if (!response.ok) throw new MessageError("errors.failedToAddItems");

      const data = await response.json();
      onItemsAdded({
        count: data.count ?? 0,
        skippedCount: data.skippedCount ?? 0,
      });
    } catch (err) {
      alert(formatError(t, err, "errors.failedToAddItems"));
    } finally {
      setAdding(false);
    }
  };

  const filteredTranslations = translations.filter((t) => {
    const searchLower = searchTerm.toLowerCase();
    const original = t.responseJson?.original?.toLowerCase() || "";
    const translation = t.responseJson?.translation?.toLowerCase() || "";
    const inputText = t.inputText.toLowerCase();
    return (
      original.includes(searchLower) ||
      translation.includes(searchLower) ||
      inputText.includes(searchLower)
    );
  });

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>
            {t("translationSelector.selectTranslationsToAdd")}
          </h2>
          <button onClick={onClose} className={styles.closeButton}>
            ✕
          </button>
        </div>

        <div className={styles.controls}>
          <input
            type="text"
            placeholder={t("translationSelector.searchTranslations")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={styles.searchInput}
          />
          <button onClick={toggleAll} className={styles.selectAllButton}>
            {selectedIds.size === filteredTranslations.length
              ? t("translationSelector.deselectAll")
              : t("translationSelector.selectAll")}
          </button>
        </div>

        <div className={styles.selectedCount}>
          {t("translationSelector.selectedItems", { count: selectedIds.size })}
        </div>

        {loading ? (
          <div className={styles.loading}>
            {t("translationSelector.loadingTranslations")}
          </div>
        ) : (
          <div className={styles.list}>
            {filteredTranslations.length === 0 ? (
              <div className={styles.empty}>
                {searchTerm
                  ? t("translationSelector.noTranslationsMatchYourSearch")
                  : t(
                      "translationSelector.noTranslationsYetTranslateSomeWordsFirst",
                    )}
              </div>
            ) : (
              filteredTranslations.map((translation) => (
                <div
                  key={translation.id}
                  className={`${styles.item} ${
                    selectedIds.has(translation.id) ? styles.selected : ""
                  }`}
                  onClick={() => toggleSelection(translation.id)}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(translation.id)}
                    onChange={() => {}}
                    className={styles.checkbox}
                  />
                  <div className={styles.itemContent}>
                    <div className={styles.itemMain}>
                      <strong>{translation.responseJson?.original}</strong>
                      <span className={styles.arrow}>→</span>
                      <span>{translation.responseJson?.translation}</span>
                    </div>
                    <div className={styles.itemMeta}>
                      {translation.responseJson?.type && (
                        <span className={styles.type}>
                          {translation.responseJson.type}
                        </span>
                      )}
                      <span className={styles.date}>
                        {new Date(translation.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        <div className={styles.footer}>
          <button onClick={onClose} className={styles.cancelButton}>
            {t("moveWordDialog.cancel")}
          </button>
          <button
            onClick={handleAdd}
            disabled={selectedIds.size === 0 || adding}
            className={styles.addButton}
          >
            {adding
              ? t("translationSelector.adding")
              : t("translationSelector.addItems", { count: selectedIds.size })}
          </button>
        </div>
      </div>
    </div>
  );
}
