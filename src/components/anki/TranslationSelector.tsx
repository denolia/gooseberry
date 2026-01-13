"use client";
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
  onItemsAdded: (count: number) => void;
}

export function TranslationSelector({
  wordSetId,
  onClose,
  onItemsAdded,
}: TranslationSelectorProps) {
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
      if (!response.ok) throw new Error("Failed to load translations");
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

      if (!response.ok) throw new Error("Failed to add items");

      const data = await response.json();
      onItemsAdded(data.count);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to add items");
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
          <h2 className={styles.title}>Select Translations to Add</h2>
          <button onClick={onClose} className={styles.closeButton}>
            ✕
          </button>
        </div>

        <div className={styles.controls}>
          <input
            type="text"
            placeholder="Search translations..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={styles.searchInput}
          />
          <button onClick={toggleAll} className={styles.selectAllButton}>
            {selectedIds.size === filteredTranslations.length
              ? "Deselect All"
              : "Select All"}
          </button>
        </div>

        <div className={styles.selectedCount}>
          {selectedIds.size} item{selectedIds.size !== 1 ? "s" : ""} selected
        </div>

        {loading ? (
          <div className={styles.loading}>Loading translations...</div>
        ) : (
          <div className={styles.list}>
            {filteredTranslations.length === 0 ? (
              <div className={styles.empty}>
                {searchTerm
                  ? "No translations match your search"
                  : "No translations yet. Translate some words first!"}
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
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={selectedIds.size === 0 || adding}
            className={styles.addButton}
          >
            {adding
              ? "Adding..."
              : `Add ${selectedIds.size} item${selectedIds.size !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
