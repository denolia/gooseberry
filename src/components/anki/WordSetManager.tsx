"use client";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CardEditor } from "./CardEditor";
import {
  CardDraft,
  draftFromFields,
  fieldsFromDraft,
} from "@/app/utils/cardDraft";
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
  const [editValues, setEditValues] = useState<CardDraft | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [exporting, setExporting] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (status === "authenticated" && session?.user?.id) {
      loadWordSet();
      loadItems();
    } else if (status === "authenticated") {
      setError(
        "Your session could not be initialized. Please sign out and sign in again.",
      );
      setLoading(false);
    }
  }, [session?.user?.id, status, wordSetId]);

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
      setStatusMessage(
        err instanceof Error ? err.message : "Failed to load items",
      );
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
    setEditValues(draftFromFields(item));
  };

  const cancelEditing = () => {
    setEditingItem(null);
    setEditValues(null);
  };

  const saveEdit = async (itemId: string) => {
    if (!editValues || saving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/word-sets/${wordSetId}/items`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, ...fieldsFromDraft(editValues) }),
      });

      if (!response.ok) throw new Error("Failed to update item");

      setEditingItem(null);
      setEditValues(null);
      loadItems();
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : "Failed to update item",
      );
    } finally {
      setSaving(false);
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

  if (status === "loading" || (status === "authenticated" && loading)) {
    return <div className={styles.loading}>Loading...</div>;
  }

  if (status === "unauthenticated") {
    router.push("/");
    return null;
  }

  if (error || !wordSet) {
    return <div className={styles.error}>{error || "Word set not found"}</div>;
  }

  const filteredItems = items.filter((item) =>
    `${item.original} ${item.translation} ${item.tags}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  async function rename() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/word-sets/${wordSetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) throw new Error("Could not rename set.");
      await loadWordSet();
      setRenaming(false);
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : "Could not rename set.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <button
            onClick={() => router.push("/anki")}
            className={styles.backButton}
          >
            ← Back to Sets
          </button>
          {renaming ? (
            <form
              className={styles.actions}
              onSubmit={(e) => {
                e.preventDefault();
                rename();
              }}
            >
              <input
                aria-label="Set name"
                className={styles.input}
                autoFocus
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button
                className={styles.saveButton}
                disabled={saving || !name.trim()}
              >
                Save name
              </button>
              <button
                type="button"
                className={styles.cancelButton}
                onClick={() => setRenaming(false)}
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className={styles.actions}>
              <h1 className={styles.title}>{wordSet.name}</h1>
              <button
                className={styles.editButton}
                onClick={() => {
                  setName(wordSet.name);
                  setRenaming(true);
                }}
              >
                Rename
              </button>
            </div>
          )}
          <p className={styles.meta}>
            {wordSet.sourceLang.toUpperCase()} →{" "}
            {wordSet.targetLang.toUpperCase()} • {items.length}{" "}
            {items.length === 1 ? "card" : "cards"} ·{" "}
            {items.filter((item) => item.isEnabled).length} included in export
          </p>
        </div>
        <div className={styles.actions}>
          <button
            onClick={() => setShowSelector(true)}
            className={styles.addButton}
          >
            Add from history
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
        <div role="status" className={styles.statusMessage}>
          {statusMessage}
        </div>
      )}

      <div className={styles.toolbar}>
        <input
          className={styles.input}
          aria-label="Search cards"
          placeholder="Search words, translations or tags…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Link href="/">Translate & add words ↗</Link>
      </div>

      {showSelector && (
        <TranslationSelector
          wordSetId={wordSetId}
          onClose={() => setShowSelector(false)}
          onItemsAdded={handleItemsAdded}
        />
      )}

      {items.length === 0 ? (
        <div className={styles.empty}>
          No cards yet. Save a word from a translation, or add words from your
          history.
        </div>
      ) : (
        <div className={styles.items}>
          {filteredItems.length === 0 && (
            <p className={styles.empty}>No cards match “{search}”.</p>
          )}
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className={`${styles.item} ${editingItem === item.id ? styles.editing : ""} ${!item.isEnabled ? styles.disabled : ""}`}
            >
              {editingItem === item.id && editValues ? (
                <form
                  className={styles.editForm}
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveEdit(item.id);
                  }}
                >
                  <CardEditor
                    value={editValues}
                    onChange={setEditValues}
                    disabled={saving}
                  />
                  <div className={styles.editActions}>
                    <button
                      disabled={
                        saving ||
                        !editValues.original.trim() ||
                        !editValues.translation.trim()
                      }
                      className={styles.saveButton}
                    >
                      {saving ? "Saving…" : "Save changes"}
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={cancelEditing}
                      className={styles.cancelButton}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className={styles.itemContent}>
                    <div className={styles.itemMain}>
                      <strong className={styles.original}>
                        {item.original}
                      </strong>
                      <span className={styles.arrow}>→</span>
                      <span className={styles.translation}>
                        {item.translation}
                      </span>
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
                      aria-pressed={item.isEnabled}
                      aria-label={`Include ${item.original} in export`}
                      onClick={() => toggleEnabled(item)}
                      className={styles.toggleButton}
                    >
                      {item.isEnabled ? "Included" : "Excluded"}
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
