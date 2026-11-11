"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Search, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { errorFromResponse, messageFromError } from "@/i18n/errors";
import type { UiMessage } from "@/i18n/messages";
import type {
  ReaderHistoryPage,
  ReaderTextSummary,
} from "@/lib/reader/library";
import dialogStyles from "@/components/anki/MoveWordDialog.module.css";
import styles from "./ReaderHistoryDialog.module.css";

export function ReaderHistoryDialog({
  accountId,
  activeId,
  onOpen,
  onNew,
  onDeleted,
  onClose,
}: {
  accountId: string;
  activeId?: string;
  onOpen: (id: string) => Promise<void>;
  onNew: () => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const titleId = useId();
  const searchId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const keepTextRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const requestRef = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(activeId ?? "");
  const [deleting, setDeleting] = useState<ReaderTextSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiMessage | null>(null);
  const client = useQueryClient();
  const history = useInfiniteQuery({
    queryKey: ["readerTexts", accountId, query],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<ReaderHistoryPage> => {
      const params = new URLSearchParams({ q: query });
      if (pageParam) params.set("cursor", pageParam);
      const response = await fetch(`/api/reader-texts?${params}`, { signal });
      const body = await response.json();
      if (!response.ok)
        throw errorFromResponse(body, "errors.readerLoadFailed");
      return body;
    },
    getNextPageParam: (page) => page.nextCursor,
  });
  const searching = search.trim() !== query;
  const texts = history.data?.pages.flatMap((page) => page.texts) ?? [];
  const tabStopId = texts.some((item) => item.id === selectedId)
    ? selectedId
    : texts[0]?.id;

  useEffect(() => {
    mounted.current = true;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    searchRef.current?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      mounted.current = false;
      requestRef.current?.abort();
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (deleting) keepTextRef.current?.focus();
  }, [deleting]);

  async function open() {
    if (!selectedId || submitting.current || searching) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await onOpen(selectedId);
    } catch (cause) {
      setError(messageFromError(cause, "errors.readerOpenFailed"));
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function remove() {
    if (!deleting || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await fetch(`/api/reader-texts/${deleting.id}`, {
        method: "DELETE",
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok)
        throw errorFromResponse(body, "errors.readerDeleteFailed");
      if (controller.signal.aborted) return;
      onDeleted(deleting.id);
      if (selectedId === deleting.id) setSelectedId("");
      setDeleting(null);
      void client.invalidateQueries({ queryKey: ["readerTexts", accountId] });
      searchRef.current?.focus();
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(messageFromError(cause, "errors.readerDeleteFailed"));
    } finally {
      submitting.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={`${dialogStyles.dialog} ${styles.dialog}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void open();
        }}
      >
        <header className={dialogStyles.header}>
          <h2 id={titleId}>{t("readerHistory.textHistory")}</h2>
        </header>
        <div className={dialogStyles.body}>
          <label htmlFor={searchId} className={styles.searchLabel}>
            {t("readerHistory.searchTexts")}
          </label>
          <div className={styles.searchField}>
            <Search size={17} aria-hidden="true" />
            <input
              ref={searchRef}
              id={searchId}
              type="search"
              value={search}
              maxLength={200}
              onChange={(event) => {
                setSearch(event.target.value);
                setSelectedId("");
                setDeleting(null);
                setError(null);
              }}
              placeholder={t("readerHistory.findText")}
              disabled={busy}
            />
          </div>
          {history.isPending || searching ? (
            <p className={styles.message} role="status">
              {query || searching
                ? t("readerHistory.searchingTexts")
                : t("readerHistory.loadingTexts")}
            </p>
          ) : history.isError && !history.data ? (
            <div className={dialogStyles.error} role="alert">
              <p>{t("readerHistory.loadFailed")}</p>
              <button type="button" onClick={() => void history.refetch()}>
                {t("readerHistory.tryAgain")}
              </button>
            </div>
          ) : texts.length ? (
            <>
              <div
                className={styles.list}
                role="radiogroup"
                aria-label={t("readerHistory.savedTexts")}
                aria-busy={history.isFetching}
              >
                {texts.map((item) => (
                  <div
                    key={item.id}
                    className={`${styles.row} ${selectedId === item.id ? styles.selected : ""}`}
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selectedId === item.id}
                      tabIndex={tabStopId === item.id ? 0 : -1}
                      className={styles.option}
                      disabled={busy || !!deleting}
                      onClick={() => {
                        setSelectedId(item.id);
                        setError(null);
                      }}
                      onKeyDown={(event) => {
                        if (
                          !["ArrowDown", "ArrowUp", "Home", "End"].includes(
                            event.key,
                          )
                        )
                          return;
                        event.preventDefault();
                        const index = texts.findIndex(
                          (text) => text.id === item.id,
                        );
                        const next =
                          event.key === "Home"
                            ? 0
                            : event.key === "End"
                              ? texts.length - 1
                              : (index +
                                  (event.key === "ArrowDown" ? 1 : -1) +
                                  texts.length) %
                                texts.length;
                        setSelectedId(texts[next].id);
                        const group = event.currentTarget.closest(
                          '[role="radiogroup"]',
                        );
                        group
                          ?.querySelectorAll<HTMLButtonElement>(
                            '[role="radio"]',
                          )
                          [next]?.focus();
                      }}
                    >
                      <span className={styles.mark}>
                        {selectedId === item.id && (
                          <Check size={16} aria-hidden="true" />
                        )}
                      </span>
                      <span className={styles.name} title={item.title}>
                        {item.title}
                      </span>
                      <span className={styles.meta}>
                        {item.sourceLang.toUpperCase()} →{" "}
                        {item.targetLang.toUpperCase()}
                        {" · "}
                        <time dateTime={item.createdAt}>
                          {new Date(item.createdAt).toLocaleDateString(locale)}
                        </time>
                        {activeId === item.id && (
                          <> · {t("readerHistory.currentText")}</>
                        )}
                      </span>
                      <span className={styles.preview}>{item.preview}</span>
                    </button>
                    <button
                      type="button"
                      className={styles.deleteButton}
                      aria-label={t("readerHistory.deleteNamedText", {
                        title: item.title,
                      })}
                      title={t("readerHistory.deleteText")}
                      disabled={busy || !!deleting}
                      onClick={() => {
                        setDeleting(item);
                        setError(null);
                      }}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
              {history.hasNextPage && (
                <button
                  className={styles.loadMore}
                  type="button"
                  disabled={busy || history.isFetchingNextPage}
                  onClick={() => void history.fetchNextPage()}
                >
                  {history.isFetchingNextPage
                    ? t("readerHistory.loading")
                    : t("readerHistory.loadMore")}
                </button>
              )}
              {history.isError && (
                <p className={dialogStyles.error} role="alert">
                  {t(
                    history.hasNextPage
                      ? "readerHistory.refreshFailedMore"
                      : "readerHistory.refreshFailedHistory",
                  )}
                </p>
              )}
            </>
          ) : (
            <p className={styles.message}>
              {query ? t("readerHistory.noMatches") : t("readerHistory.empty")}
            </p>
          )}
          {deleting && (
            <section
              className={styles.confirmation}
              aria-label={t("readerHistory.confirmDeletion")}
            >
              <p>
                {t("readerHistory.deleteConfirmation", {
                  title: deleting.title,
                })}
              </p>
              {deleting.id === activeId && (
                <p>{t("readerHistory.discardEditsOnDelete")}</p>
              )}
              <div>
                <button
                  type="button"
                  ref={keepTextRef}
                  disabled={busy}
                  onClick={() => {
                    setDeleting(null);
                    setError(null);
                    searchRef.current?.focus();
                  }}
                >
                  {t("readerHistory.keepText")}
                </button>
                <button
                  type="button"
                  className={styles.danger}
                  disabled={busy}
                  onClick={() => void remove()}
                >
                  {busy
                    ? t("readerHistory.deleting")
                    : t("readerHistory.deleteText")}
                </button>
              </div>
            </section>
          )}
          {error && (
            <p className={dialogStyles.error} role="alert">
              {t(error.key, error.values)}
            </p>
          )}
        </div>
        <footer className={dialogStyles.actions}>
          <button
            type="button"
            className={styles.newText}
            disabled={busy || !!deleting}
            onClick={onNew}
          >
            <Plus size={17} aria-hidden="true" /> {t("readerHistory.newText")}
          </button>
          <button type="button" disabled={busy} onClick={onClose}>
            {t("readerHistory.close")}
          </button>
          <button
            type="submit"
            className={dialogStyles.move}
            disabled={
              busy ||
              searching ||
              !selectedId ||
              !!deleting ||
              !texts.some((item) => item.id === selectedId)
            }
          >
            {busy && !deleting
              ? t("readerHistory.opening")
              : t("readerHistory.open")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
