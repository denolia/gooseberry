"use client";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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

type DeckExportStage = "idle" | "working" | "ready" | "error";
type ExportFormat = "apkg" | "csv";

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
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showDeckExportDialog, setShowDeckExportDialog] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("apkg");
  const [includeExportAudio, setIncludeExportAudio] = useState(false);
  const [deckExportStage, setDeckExportStage] =
    useState<DeckExportStage>("idle");
  const [deckExportError, setDeckExportError] = useState<string | null>(null);
  const exportAbortController = useRef<AbortController | null>(null);

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
    if (!showDeckExportDialog) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && deckExportStage !== "working") {
        setShowDeckExportDialog(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [deckExportStage, showDeckExportDialog]);

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

  const openDeckExportDialog = () => {
    setDeckExportStage("idle");
    setDeckExportError(null);
    setShowDeckExportDialog(true);
  };

  const runDeckExport = async () => {
    if (!wordSet || deckExportStage === "working") return;

    const controller = new AbortController();
    exportAbortController.current = controller;
    setDeckExportStage("working");
    setDeckExportError(null);
    setExporting(true);

    try {
      const query = new URLSearchParams({ format: exportFormat });
      if (exportFormat === "apkg" && includeExportAudio) {
        query.set("audio", "1");
      }
      const response = await fetch(
        `/api/word-sets/${wordSetId}/export?${query}`,
        { method: "POST", signal: controller.signal },
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to export word set");
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const dateStr = new Date().toISOString().split("T")[0];
      anchor.href = downloadUrl;
      anchor.download = `${wordSet.name.replace(/[^a-zA-Z0-9]/g, "_")}_${dateStr}.${exportFormat}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(downloadUrl), 1_000);

      setDeckExportStage("ready");
      void loadWordSet();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setDeckExportStage("idle");
      } else {
        setDeckExportError(
          err instanceof Error ? err.message : "Failed to export word set",
        );
        setDeckExportStage("error");
      }
    } finally {
      exportAbortController.current = null;
      setExporting(false);
    }
  };

  const closeDeckExportDialog = () => {
    if (deckExportStage === "working") return;
    setShowDeckExportDialog(false);
  };

  const cancelDeckExport = () => {
    exportAbortController.current?.abort();
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
  const enabledItemCount = items.filter((item) => item.isEnabled).length;
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
          <button
            onClick={openDeckExportDialog}
            disabled={enabledItemCount === 0 || exporting}
            className={styles.exportButton}
          >
            {exporting ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>

      {showDeckExportDialog && (
        <div
          className={styles.dialogBackdrop}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDeckExportDialog();
          }}
        >
          <section
            className={styles.exportDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="deck-export-title"
            aria-describedby="deck-export-description"
          >
            {deckExportStage === "idle" && (
              <>
                <div className={styles.dialogHeader}>
                  <div>
                    <p className={styles.dialogEyebrow}>Export settings</p>
                    <h2 id="deck-export-title">Export word set</h2>
                  </div>
                  <button
                    type="button"
                    className={styles.dialogClose}
                    onClick={closeDeckExportDialog}
                    aria-label="Close export settings"
                    autoFocus
                  >
                    ×
                  </button>
                </div>
                <p
                  id="deck-export-description"
                  className={styles.dialogDescription}
                >
                  {enabledItemCount} {enabledItemCount === 1 ? "card" : "cards"}{" "}
                  will be included.
                </p>

                <fieldset className={styles.formatOptions}>
                  <legend>File format</legend>
                  <label>
                    <input
                      type="radio"
                      name="export-format"
                      value="apkg"
                      checked={exportFormat === "apkg"}
                      onChange={() => setExportFormat("apkg")}
                    />
                    <span>
                      <strong>Anki deck</strong>
                      <small>.apkg · ready to import into Anki</small>
                    </span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="export-format"
                      value="csv"
                      checked={exportFormat === "csv"}
                      onChange={() => {
                        setExportFormat("csv");
                        setIncludeExportAudio(false);
                      }}
                    />
                    <span>
                      <strong>Spreadsheet</strong>
                      <small>.csv · text fields for other apps</small>
                    </span>
                  </label>
                </fieldset>

                <label
                  className={`${styles.audioOption} ${exportFormat === "csv" ? styles.optionDisabled : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={includeExportAudio}
                    disabled={exportFormat === "csv"}
                    onChange={(event) =>
                      setIncludeExportAudio(event.target.checked)
                    }
                  />
                  <span>
                    <strong>Include AI pronunciation</strong>
                    <small>
                      Generate a source-language MP3 for every included card.
                      Audio is placed inside the deck and is not stored by
                      Gooseberry.
                    </small>
                  </span>
                  <span className={styles.optionBadge}>AI voice</span>
                </label>
                <p className={styles.optionHint}>
                  {exportFormat === "csv"
                    ? "Audio can only be embedded in an Anki deck. Choose Anki deck to enable this option."
                    : includeExportAudio
                      ? "This takes longer because each pronunciation is generated before the download starts."
                      : "Text-only export is quick and creates the smallest file."}
                </p>
                <div className={styles.dialogActions}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={closeDeckExportDialog}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.addButton}
                    onClick={runDeckExport}
                    disabled={enabledItemCount === 0}
                  >
                    {exportFormat === "csv"
                      ? "Download CSV"
                      : includeExportAudio
                        ? "Generate & download"
                        : "Download deck"}
                  </button>
                </div>
              </>
            )}

            {deckExportStage === "working" && (
              <div className={styles.exportProgress} aria-live="polite">
                <div className={styles.progressIcon} aria-hidden="true">
                  {exportFormat === "apkg" && includeExportAudio ? "♫" : "↓"}
                </div>
                <h2 id="deck-export-title">
                  {exportFormat === "apkg" && includeExportAudio
                    ? "Creating pronunciations…"
                    : exportFormat === "csv"
                      ? "Preparing your spreadsheet…"
                      : "Building your deck…"}
                </h2>
                <p id="deck-export-description">
                  {exportFormat === "apkg" && includeExportAudio
                    ? `Generating AI audio for ${enabledItemCount} cards, then packaging it into Anki. Keep this window open.`
                    : `Preparing your ${exportFormat.toUpperCase()} file. Your download will begin automatically.`}
                </p>
                <div
                  className={styles.progressTrack}
                  role="progressbar"
                  aria-label="Preparing export"
                >
                  <span />
                </div>
                <button
                  type="button"
                  className={styles.dismissButton}
                  onClick={cancelDeckExport}
                >
                  Cancel
                </button>
              </div>
            )}

            {deckExportStage === "ready" && (
              <div className={styles.exportProgress} aria-live="polite">
                <div
                  className={`${styles.progressIcon} ${styles.progressSuccess}`}
                  aria-hidden="true"
                >
                  ✓
                </div>
                <h2 id="deck-export-title">Your export is ready</h2>
                <p id="deck-export-description">
                  The download has started.
                  {exportFormat === "apkg"
                    ? " Open the file to import it into Anki."
                    : " You can open the file in a spreadsheet app."}
                </p>
                <button
                  type="button"
                  className={styles.addButton}
                  onClick={closeDeckExportDialog}
                >
                  Done
                </button>
              </div>
            )}

            {deckExportStage === "error" && (
              <div className={styles.exportProgress} aria-live="assertive">
                <div
                  className={`${styles.progressIcon} ${styles.progressError}`}
                  aria-hidden="true"
                >
                  !
                </div>
                <h2 id="deck-export-title">Couldn’t create the export</h2>
                <p id="deck-export-description">
                  {deckExportError || "Please try again."}
                </p>
                <div className={styles.dialogActions}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={closeDeckExportDialog}
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    className={styles.addButton}
                    onClick={runDeckExport}
                  >
                    Try again
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

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
