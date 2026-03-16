"use client";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TranslationSelector } from "./TranslationSelector";
import styles from "./WordSetManager.module.css";

interface WordSet {
  id: string;
  name: string;
  sourceLang: string;
  targetLang: string;
  itemCount?: number;
}

interface WordSetItem {
  id: string;
  original: string;
  translation: string;
  wordForms: string;
  sample: string;
  sampleTranslation: string;
  comments: string;
  tags: string;
  isEnabled: boolean;
  position: number;
}

interface WordSetManagerProps {
  wordSetId: string;
}

export function WordSetManager({ wordSetId }: WordSetManagerProps) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [wordSet, setWordSet] = useState<WordSet | null>(null);
  const [items, setItems] = useState<WordSetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSelector, setShowSelector] = useState(false);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<WordSetItem>>({});
  const [exporting, setExporting] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (status === "authenticated") {
      loadWordSet();
      loadItems();
    }
  }, [status, wordSetId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (showExportMenu && !target.closest(`.${styles.exportContainer}`)) {
        setShowExportMenu(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showExportMenu]);

  const loadWordSet = async () => {
    try {
      const response = await fetch(`/api/word-sets/${wordSetId}`);
      if (!response.ok) {
        if (response.status === 404) {
          router.push("/anki");
          return;
        }
        throw new Error("Failed to load word set");
      }
      const data = await response.json();
      setWordSet(data.wordSet);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load word set");
    } finally {
      setLoading(false);
    }
  };

  const loadItems = async () => {
    try {
      const response = await fetch(`/api/word-sets/${wordSetId}/items`);
      if (!response.ok) throw new Error("Failed to load items");
      const data = await response.json();
      setItems(data.items);
    } catch (err) {
      console.error("Failed to load items:", err);
    }
  };

  const handleItemsAdded = ({
    count,
    skippedCount,
  }: {
    count: number;
    skippedCount: number;
  }) => {
    setShowSelector(false);
    loadItems();
    if (wordSet) {
      setWordSet({ ...wordSet, itemCount: (wordSet.itemCount || 0) + count });
    }

    if (count > 0 && skippedCount > 0) {
      setStatusMessage(
        `Added ${count} item${count === 1 ? "" : "s"}. ${skippedCount} ${skippedCount === 1 ? "was" : "were"} already in this set.`,
      );
    } else if (count > 0) {
      setStatusMessage(`Added ${count} item${count === 1 ? "" : "s"}.`);
    } else if (skippedCount > 0) {
      setStatusMessage(
        `Nothing added. ${skippedCount} ${skippedCount === 1 ? "item was" : "items were"} already in this set.`,
      );
    } else {
      setStatusMessage(null);
    }
  };

  const handleExport = async (format: "apkg" | "csv") => {
    if (!wordSet) return;

    try {
      setExporting(true);
      setShowExportMenu(false);
      const response = await fetch(
        `/api/word-sets/${wordSetId}/export?format=${format}`,
        {
          method: "POST",
        },
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to export");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const dateStr = new Date().toISOString().split("T")[0];
      const extension = format === "csv" ? "csv" : "apkg";
      a.download = `${wordSet.name.replace(/[^a-zA-Z0-9]/g, "_")}_${dateStr}.${extension}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      loadWordSet(); // Refresh to update lastExportedAt
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to export");
    } finally {
      setExporting(false);
    }
  };

  const startEditing = (item: WordSetItem) => {
    setEditingItem(item.id);
    setEditValues(item);
  };

  const cancelEditing = () => {
    setEditingItem(null);
    setEditValues({});
  };

  const saveEdit = async (itemId: string) => {
    try {
      const response = await fetch(`/api/word-sets/${wordSetId}/items`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, ...editValues }),
      });

      if (!response.ok) throw new Error("Failed to update item");

      setEditingItem(null);
      setEditValues({});
      loadItems();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update item");
    }
  };

  const deleteItem = async (itemId: string) => {
    if (!confirm("Remove this item from the set?")) return;

    try {
      const response = await fetch(`/api/word-sets/${wordSetId}/items`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });

      if (!response.ok) throw new Error("Failed to delete item");

      loadItems();
      if (wordSet && wordSet.itemCount) {
        setWordSet({ ...wordSet, itemCount: wordSet.itemCount - 1 });
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete item");
    }
  };

  const toggleEnabled = async (item: WordSetItem) => {
    try {
      const response = await fetch(`/api/word-sets/${wordSetId}/items`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          isEnabled: !item.isEnabled,
        }),
      });

      if (!response.ok) throw new Error("Failed to toggle item");

      loadItems();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to toggle item");
    }
  };

  if (status === "loading" || loading) {
    return <div className={styles.loading}>Loading...</div>;
  }

  if (status === "unauthenticated") {
    router.push("/");
    return null;
  }

  if (error || !wordSet) {
    return <div className={styles.error}>{error || "Word set not found"}</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <button onClick={() => router.push("/anki")} className={styles.backButton}>
            ← Back to Sets
          </button>
          <h1 className={styles.title}>{wordSet.name}</h1>
          <p className={styles.meta}>
            {wordSet.sourceLang.toUpperCase()} → {wordSet.targetLang.toUpperCase()} •{" "}
            {items.length} items
          </p>
        </div>
        <div className={styles.actions}>
          <button
            onClick={() => setShowSelector(true)}
            className={styles.addButton}
          >
            + Add Words
          </button>
          <div className={styles.exportContainer}>
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              disabled={items.length === 0 || exporting}
              className={styles.exportButton}
            >
              {exporting ? "Exporting..." : "Export ▼"}
            </button>
            {showExportMenu && !exporting && (
              <div className={styles.exportMenu}>
                <button
                  onClick={() => handleExport("apkg")}
                  className={styles.exportMenuItem}
                >
                  Export as .apkg
                </button>
                <button
                  onClick={() => handleExport("csv")}
                  className={styles.exportMenuItem}
                >
                  Export as .csv
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {statusMessage && (
        <div className={styles.statusMessage}>{statusMessage}</div>
      )}

      {showSelector && (
        <TranslationSelector
          wordSetId={wordSetId}
          onClose={() => setShowSelector(false)}
          onItemsAdded={handleItemsAdded}
        />
      )}

      {items.length === 0 ? (
        <div className={styles.empty}>
          No words in this set yet. Click "Add Words" to get started!
        </div>
      ) : (
        <div className={styles.items}>
          {items.map((item) => (
            <div
              key={item.id}
              className={`${styles.item} ${!item.isEnabled ? styles.disabled : ""}`}
            >
              {editingItem === item.id ? (
                <div className={styles.editForm}>
                  <input
                    value={editValues.original || ""}
                    onChange={(e) =>
                      setEditValues({ ...editValues, original: e.target.value })
                    }
                    placeholder="Original"
                    className={styles.input}
                  />
                  <input
                    value={editValues.translation || ""}
                    onChange={(e) =>
                      setEditValues({ ...editValues, translation: e.target.value })
                    }
                    placeholder="Translation"
                    className={styles.input}
                  />
                  <input
                    value={editValues.wordForms || ""}
                    onChange={(e) =>
                      setEditValues({ ...editValues, wordForms: e.target.value })
                    }
                    placeholder="Word forms"
                    className={styles.input}
                  />
                  <textarea
                    value={editValues.sample || ""}
                    onChange={(e) =>
                      setEditValues({ ...editValues, sample: e.target.value })
                    }
                    placeholder="Examples (semicolon-separated)"
                    className={styles.textarea}
                    rows={2}
                  />
                  <textarea
                    value={editValues.sampleTranslation || ""}
                    onChange={(e) =>
                      setEditValues({
                        ...editValues,
                        sampleTranslation: e.target.value,
                      })
                    }
                    placeholder="Example translations (semicolon-separated)"
                    className={styles.textarea}
                    rows={2}
                  />
                  <input
                    value={editValues.comments || ""}
                    onChange={(e) =>
                      setEditValues({ ...editValues, comments: e.target.value })
                    }
                    placeholder="Comments"
                    className={styles.input}
                  />
                  <input
                    value={editValues.tags || ""}
                    onChange={(e) =>
                      setEditValues({ ...editValues, tags: e.target.value })
                    }
                    placeholder="Tags (space-separated)"
                    className={styles.input}
                  />
                  <div className={styles.editActions}>
                    <button
                      onClick={() => saveEdit(item.id)}
                      className={styles.saveButton}
                    >
                      Save
                    </button>
                    <button onClick={cancelEditing} className={styles.cancelButton}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className={styles.itemContent}>
                    <div className={styles.itemMain}>
                      <strong className={styles.original}>{item.original}</strong>
                      <span className={styles.arrow}>→</span>
                      <span className={styles.translation}>{item.translation}</span>
                    </div>
                    {item.wordForms && (
                      <div className={styles.itemDetail}>
                        <em>Forms:</em> {item.wordForms}
                      </div>
                    )}
                    {item.sample && (
                      <div className={styles.itemDetail}>
                        <em>Examples:</em> {item.sample.substring(0, 100)}
                        {item.sample.length > 100 && "..."}
                      </div>
                    )}
                    {item.tags && (
                      <div className={styles.tags}>
                        {item.tags.split(" ").map((tag, i) => (
                          <span key={i} className={styles.tag}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className={styles.itemActions}>
                    <button
                      onClick={() => toggleEnabled(item)}
                      className={styles.toggleButton}
                    >
                      {item.isEnabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      onClick={() => startEditing(item)}
                      className={styles.editButton}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteItem(item.id)}
                      className={styles.deleteButton}
                    >
                      Remove
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
