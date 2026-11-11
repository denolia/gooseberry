"use client";
import {
  formatError,
  messageFromError,
  MessageError,
  errorFromResponse,
} from "@/i18n/errors";
import type { UiMessage, MessageKey } from "@/i18n/messages";

import { useI18n } from "@/i18n/client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CardEditor } from "./CardEditor";
import {
  CardDraft,
  draftFromFields,
  studyFieldsFromDraft,
} from "@/app/utils/cardDraft";
import { TranslationSelector } from "./TranslationSelector";
import { EnrichmentDialog } from "./EnrichmentDialog";
import { MoveWordDialog } from "./MoveWordDialog";
import { missingEnrichmentFields } from "@/lib/anki/enrichment";
import type { FsrsCardStateValue } from "@/lib/review/model";
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
  position: number;
  sourceNoteKey: string | null;
  contentRevision: number;
  examplePairs: { sample: string; translation: string }[];
  fieldOrigins: Record<string, { origin?: string }>;
  review: {
    cardCount: number;
    dueCount: number;
    state: FsrsCardStateValue;
    dueAt: string | null;
    reps: number;
    lapses: number;
    lastReviewAt: string | null;
  };
}

interface WordSetManagerProps {
  wordSetId: string;
}

const REVIEW_STATE_MESSAGES: Record<FsrsCardStateValue, MessageKey> = {
  0: "wordSetManager.new",
  1: "reviewSession.learning",
  2: "wordSetManager.review",
  3: "wordSetManager.relearning",
};

type DeckExportStage = "idle" | "working" | "ready" | "error";
type ExportFormat = "apkg" | "csv";

function nextReviewLabel(
  item: WordSetItem,
  t: import("@/i18n/messages").Translate,
): string {
  if (item.review.cardCount === 0) return t("wordSetManager.addContentToStudy");
  if (item.review.dueCount > 0) {
    return t("wordSetManager.readyOfTotal", {
      ready: item.review.dueCount,
      total: item.review.cardCount,
    });
  }
  if (!item.review.dueAt) return t("wordSetManager.notScheduled");
  return t("wordSetManager.nextReview", {
    date: new Date(item.review.dueAt).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }),
  });
}

export function WordSetManager({ wordSetId }: WordSetManagerProps) {
  const { t } = useI18n();
  const { data: session, status } = useSession();
  const router = useRouter();
  const [wordSet, setWordSet] = useState<WordSet | null>(null);
  const [items, setItems] = useState<WordSetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<UiMessage | null>(null);
  const [showSelector, setShowSelector] = useState(false);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [enrichingItem, setEnrichingItem] = useState<WordSetItem | null>(null);
  const [movingItem, setMovingItem] = useState<WordSetItem | null>(null);
  const [editValues, setEditValues] = useState<CardDraft | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [exporting, setExporting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<UiMessage | null>(null);
  const [showDeckExportDialog, setShowDeckExportDialog] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("apkg");
  const [includeExportAudio, setIncludeExportAudio] = useState(false);
  const [deckExportStage, setDeckExportStage] =
    useState<DeckExportStage>("idle");
  const [deckExportError, setDeckExportError] = useState<UiMessage | null>(
    null,
  );
  const exportAbortController = useRef<AbortController | null>(null);

  const loadWordSet = useCallback(async () => {
    try {
      const response = await fetch(`/api/word-sets/${wordSetId}`);
      if (!response.ok) {
        if (response.status === 404) {
          router.push("/anki");
          return;
        }
        throw new MessageError("errors.failedToLoadWordSet");
      }
      const data = await response.json();
      setWordSet(data.wordSet);
    } catch (err) {
      setError(messageFromError(err, "errors.failedToLoadWordSet"));
    } finally {
      setLoading(false);
    }
  }, [router, wordSetId]);

  const loadItems = useCallback(async () => {
    try {
      const response = await fetch(`/api/word-sets/${wordSetId}/items`);
      if (!response.ok) throw new MessageError("errors.failedToLoadItems");
      const data = await response.json();
      setItems(data.items);
    } catch (err) {
      setStatusMessage(messageFromError(err, "errors.failedToLoadItems"));
    }
  }, [wordSetId]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      if (status === "authenticated" && session?.user?.id) {
        void loadWordSet();
        void loadItems();
      } else if (status === "authenticated") {
        setError({
          key: "wordSetList.yourSessionCouldNotBeInitializedPleaseSignOutAnd",
        });
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [session?.user?.id, status, loadWordSet, loadItems]);

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
      setStatusMessage({
        key: "wordSetManager.addedAndSkipped",
        values: { count, skippedCount },
      });
    } else if (count > 0) {
      setStatusMessage({ key: "wordSetManager.addedItems", values: { count } });
    } else if (skippedCount > 0) {
      setStatusMessage({
        key: "wordSetManager.alreadyInSet",
        values: { count: skippedCount },
      });
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
        throw errorFromResponse(data, "errors.failedToExportWordSet");
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
          messageFromError(err, "errors.failedToExportWordSet"),
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
        body: JSON.stringify({
          itemId,
          ...studyFieldsFromDraft(editValues),
          contentRevision: items.find((item) => item.id === itemId)
            ?.contentRevision,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw errorFromResponse(body, "errors.failedToUpdateItem");
      }

      setEditingItem(null);
      setEditValues(null);
      loadItems();
    } catch (err) {
      setStatusMessage(messageFromError(err, "errors.failedToUpdateItem"));
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = async (itemId: string) => {
    if (!confirm(t("wordSetManager.removeConfirmation"))) return;

    try {
      const response = await fetch(`/api/word-sets/${wordSetId}/items`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });

      if (!response.ok) throw new MessageError("errors.failedToDeleteItem");

      loadItems();
      if (wordSet && wordSet.itemCount) {
        setWordSet({ ...wordSet, itemCount: wordSet.itemCount - 1 });
      }
    } catch (err) {
      alert(formatError(t, err, "errors.failedToDeleteItem"));
    }
  };

  if (status === "loading" || (status === "authenticated" && loading)) {
    return <div className={styles.loading}>{t("wordSetList.loading")}</div>;
  }

  if (status === "unauthenticated") {
    router.push("/");
    return null;
  }

  if (error || !wordSet) {
    return (
      <div className={styles.error}>
        {error
          ? t(error.key, error.values)
          : t("wordSetManager.wordSetNotFound")}
      </div>
    );
  }

  const filteredItems = items.filter((item) =>
    `${item.original} ${item.translation} ${item.tags}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const itemCount = items.length;
  const hasPremium = session?.user?.tier === "premium";
  async function rename() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/word-sets/${wordSetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) throw new MessageError("errors.couldNotRenameSet");
      await loadWordSet();
      setRenaming(false);
    } catch (err) {
      setStatusMessage(messageFromError(err, "errors.couldNotRenameSet"));
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
            {t("wordSetManager.backToSets")}
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
                aria-label={t("importDeck.setName")}
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
                {t("wordSetManager.saveName")}
              </button>
              <button
                type="button"
                className={styles.cancelButton}
                onClick={() => setRenaming(false)}
              >
                {t("moveWordDialog.cancel")}
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
                {t("wordSetManager.rename")}
              </button>
            </div>
          )}
          <p className={styles.meta}>
            {wordSet.sourceLang.toUpperCase()} →{" "}
            {wordSet.targetLang.toUpperCase()} •{" "}
            {t("common.wordCount", { count: items.length })}
          </p>
        </div>
        <div className={styles.actions}>
          <button
            onClick={() => router.push(`/anki/${wordSetId}/review`)}
            disabled={itemCount === 0}
            className={styles.studyButton}
          >
            {t("importDeck.studyNow")}
          </button>
          <button
            onClick={() => setShowSelector(true)}
            className={styles.addButton}
          >
            {t("wordSetManager.addFromHistory")}
          </button>
          <button
            onClick={openDeckExportDialog}
            disabled={itemCount === 0 || exporting}
            className={styles.exportButton}
          >
            {exporting
              ? t("wordSetManager.exporting")
              : t("wordSetManager.export")}
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
                    <p className={styles.dialogEyebrow}>
                      {t("wordSetManager.exportSettings")}
                    </p>
                    <h2 id="deck-export-title">
                      {t("wordSetManager.exportWordSet")}
                    </h2>
                  </div>
                  <button
                    type="button"
                    className={styles.dialogClose}
                    onClick={closeDeckExportDialog}
                    aria-label={t("wordSetManager.closeExportSettings")}
                    autoFocus
                  >
                    ×
                  </button>
                </div>
                <p
                  id="deck-export-description"
                  className={styles.dialogDescription}
                >
                  {t("wordSetManager.exportSummary", { count: itemCount })}
                </p>

                <fieldset className={styles.formatOptions}>
                  <legend>{t("wordSetManager.fileFormat")}</legend>
                  <label>
                    <input
                      type="radio"
                      name="export-format"
                      value="apkg"
                      checked={exportFormat === "apkg"}
                      onChange={() => setExportFormat("apkg")}
                    />
                    <span>
                      <strong>{t("wordSetManager.ankiDeck")}</strong>
                      <small>
                        {t("wordSetManager.apkgReadyToImportIntoAnki")}
                      </small>
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
                      <strong>{t("wordSetManager.spreadsheet")}</strong>
                      <small>
                        {t("wordSetManager.csvTextFieldsForOtherApps")}
                      </small>
                    </span>
                  </label>
                </fieldset>

                <label
                  className={`${styles.audioOption} ${exportFormat === "csv" || !hasPremium ? styles.optionDisabled : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={includeExportAudio}
                    disabled={exportFormat === "csv" || !hasPremium}
                    onChange={(event) =>
                      setIncludeExportAudio(event.target.checked)
                    }
                  />
                  <span>
                    <strong>
                      {t("wordSetManager.includeAiPronunciation")}
                    </strong>
                    <small>
                      {t(
                        "wordSetManager.generateASourceLanguageMp3ForEveryIncludedCardAudio",
                      )}
                    </small>
                  </span>
                  <span className={styles.optionBadge}>
                    {t("premiumTierControl.premium")}
                  </span>
                </label>
                <p className={styles.optionHint}>
                  {!hasPremium ? (
                    <>
                      {t(
                        "wordSetManager.audioEnabledDecksAreAvailableWithPremium",
                      )}{" "}
                      <Link href="/profile">
                        {t("wordSetManager.requestAccessFromYourProfile")}
                      </Link>
                    </>
                  ) : exportFormat === "csv" ? (
                    t("wordSetManager.audioCanOnlyBeEmbeddedInAnAnkiDeckChoose")
                  ) : includeExportAudio ? (
                    t(
                      "wordSetManager.thisTakesLongerBecauseEachPronunciationIsGeneratedBeforeThe",
                    )
                  ) : (
                    t(
                      "wordSetManager.textOnlyExportIsQuickAndCreatesTheSmallestFile",
                    )
                  )}
                </p>
                <div className={styles.dialogActions}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={closeDeckExportDialog}
                  >
                    {t("moveWordDialog.cancel")}
                  </button>
                  <button
                    type="button"
                    className={styles.addButton}
                    onClick={runDeckExport}
                    disabled={itemCount === 0}
                  >
                    {exportFormat === "csv"
                      ? t("wordSetManager.downloadCsv")
                      : includeExportAudio
                        ? t("wordSetManager.generateDownload")
                        : t("wordSetManager.downloadDeck")}
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
                    ? t("wordSetManager.creatingPronunciations")
                    : exportFormat === "csv"
                      ? t("wordSetManager.preparingYourSpreadsheet")
                      : t("wordSetManager.buildingYourDeck")}
                </h2>
                <p id="deck-export-description">
                  {exportFormat === "apkg" && includeExportAudio
                    ? t(
                        "wordSetManager.generatingAiAudioForValueCardsThenPackagingItInto",
                        { value0: itemCount },
                      )
                    : t(
                        "wordSetManager.preparingYourValueFileYourDownloadWillBeginAutomatically",
                        { value0: exportFormat.toUpperCase() },
                      )}
                </p>
                <div
                  className={styles.progressTrack}
                  role="progressbar"
                  aria-label={t("wordSetManager.preparingExport")}
                >
                  <span />
                </div>
                <button
                  type="button"
                  className={styles.dismissButton}
                  onClick={cancelDeckExport}
                >
                  {t("moveWordDialog.cancel")}
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
                <h2 id="deck-export-title">
                  {t("wordSetManager.yourExportIsReady")}
                </h2>
                <p id="deck-export-description">
                  {t("wordSetManager.theDownloadHasStarted")}
                  {exportFormat === "apkg"
                    ? t("wordSetManager.openTheFileToImportItIntoAnki")
                    : t("wordSetManager.youCanOpenTheFileInASpreadsheetApp")}
                </p>
                <button
                  type="button"
                  className={styles.addButton}
                  onClick={closeDeckExportDialog}
                >
                  {t("wordSetManager.done")}
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
                <h2 id="deck-export-title">
                  {t("wordSetManager.couldnTCreateTheExport")}
                </h2>
                <p id="deck-export-description">
                  {deckExportError
                    ? t(deckExportError.key, deckExportError.values)
                    : t("wordSetManager.pleaseTryAgain")}
                </p>
                <div className={styles.dialogActions}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={closeDeckExportDialog}
                  >
                    {t("cardEditor.close")}
                  </button>
                  <button
                    type="button"
                    className={styles.addButton}
                    onClick={runDeckExport}
                  >
                    {t("moveWordDialog.tryAgain")}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {statusMessage && (
        <div role="status" className={styles.statusMessage}>
          {t(statusMessage.key, statusMessage.values)}
        </div>
      )}

      <div className={styles.toolbar}>
        <input
          className={styles.input}
          aria-label={t("wordSetManager.searchCards")}
          placeholder={t("wordSetManager.searchWordsTranslationsOrTags")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Link href="/">{t("wordSetManager.translateAddWords")}</Link>
      </div>

      {showSelector && (
        <TranslationSelector
          wordSetId={wordSetId}
          onClose={() => setShowSelector(false)}
          onItemsAdded={handleItemsAdded}
        />
      )}

      {enrichingItem && (
        <EnrichmentDialog
          item={enrichingItem}
          wordSetId={wordSetId}
          onClose={() => setEnrichingItem(null)}
          onSaved={() => {
            void loadItems();
            setStatusMessage({ key: "wordSetManager.contentSaved" });
          }}
        />
      )}

      {movingItem && (
        <MoveWordDialog
          item={movingItem}
          sourceSet={wordSet}
          onClose={() => setMovingItem(null)}
          onMoved={(destination) => {
            setItems((current) =>
              current.filter((item) => item.id !== movingItem.id),
            );
            setMovingItem(null);
            setStatusMessage({
              key: "wordSetManager.movedWord",
              values: {
                word:
                  movingItem.original ||
                  movingItem.translation ||
                  t("enrichmentDialog.importedWord"),
                set: destination.name,
              },
            });
            void loadWordSet();
          }}
        />
      )}

      {items.length === 0 ? (
        <div className={styles.empty}>
          {t("wordSetManager.noCardsYetSaveAWordFromATranslationOr")}
        </div>
      ) : (
        <div className={styles.items}>
          {filteredItems.length === 0 && (
            <p className={styles.empty}>
              {t("wordSetManager.noMatches", { search })}
            </p>
          )}
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className={`${styles.item} ${editingItem === item.id ? styles.editing : ""}`}
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
                    allowIncomplete={!!item.sourceNoteKey}
                  />
                  <div className={styles.editActions}>
                    <button
                      disabled={
                        saving ||
                        (!item.sourceNoteKey &&
                          (!editValues.original.trim() ||
                            !editValues.translation.trim()))
                      }
                      className={styles.saveButton}
                    >
                      {saving
                        ? t("premiumTierControl.saving")
                        : t("translationCard.saveChanges")}
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={cancelEditing}
                      className={styles.cancelButton}
                    >
                      {t("moveWordDialog.cancel")}
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className={styles.itemContent}>
                    <div className={styles.itemMain}>
                      <strong className={styles.original}>
                        {item.original || t("wordSetManager.missingSourceWord")}
                      </strong>
                      <span className={styles.arrow}>→</span>
                      <span className={styles.translation}>
                        {item.translation ||
                          t("wordSetManager.missingTranslation")}
                      </span>
                    </div>
                    {(!item.original.trim() || !item.translation.trim()) && (
                      <p className={styles.itemDetail}>
                        {t(
                          "wordSetManager.completeThisWordToUnlockItsExercisesEditItOr",
                        )}
                      </p>
                    )}
                    {Object.values(item.fieldOrigins ?? {}).some(
                      (value) => value.origin === "ai",
                    ) && (
                      <p className={styles.itemDetail}>
                        {t("wordSetManager.includesAiGeneratedContent")}
                      </p>
                    )}
                    {item.wordForms && (
                      <div className={styles.itemDetail}>
                        <em>{t("wordSetManager.forms")}</em> {item.wordForms}
                      </div>
                    )}
                    {item.sample && (
                      <div className={styles.itemDetail}>
                        <em>{t("wordSetManager.examples")}</em>{" "}
                        {item.sample.substring(0, 100)}
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
                  <div className={styles.itemAside}>
                    <div className={styles.reviewStats}>
                      <span
                        className={styles.reviewState}
                        data-state={item.review.state}
                      >
                        {t(REVIEW_STATE_MESSAGES[item.review.state])}
                      </span>
                      <span
                        className={`${styles.reviewTiming} ${
                          item.review.dueCount > 0 ? styles.readyNow : ""
                        }`}
                      >
                        {nextReviewLabel(item, t)}
                      </span>
                      <span className={styles.reviewCount}>
                        {t("wordSetManager.reviewCount", {
                          count: item.review.reps,
                        })}
                      </span>
                    </div>
                    <details className={styles.moreMenu}>
                      <summary
                        aria-label={t("wordSetList.moreActionsForValue", {
                          value0: item.original,
                        })}
                      >
                        ⋯
                      </summary>
                      <div className={styles.moreMenuContent}>
                        <button
                          type="button"
                          onClick={() => startEditing(item)}
                        >
                          {t("wordSetManager.editCard")}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            const menu = event.currentTarget.closest("details");
                            if (menu) menu.open = false;
                            // Keep the visible trigger as the modal's return-focus target.
                            menu?.querySelector("summary")?.focus();
                            setMovingItem(item);
                          }}
                        >
                          {t("moveWordDialog.moveToAnotherSet")}
                        </button>
                        {missingEnrichmentFields(item).length > 0 && (
                          <button
                            type="button"
                            onClick={() => setEnrichingItem(item)}
                          >
                            {t("enrichmentDialog.generateMissingContent")}
                          </button>
                        )}
                        <button
                          type="button"
                          className={styles.menuDanger}
                          onClick={() => void deleteItem(item.id)}
                        >
                          {t("wordSetManager.removeFromSet")}
                        </button>
                      </div>
                    </details>
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
