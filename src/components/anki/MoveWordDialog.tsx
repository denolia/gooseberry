"use client";
import type { UiMessage } from "@/i18n/messages";
import { messageFromError, errorFromResponse } from "@/i18n/errors";

import { useI18n } from "@/i18n/client";

import { useEffect, useId, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useQueryClient } from "@tanstack/react-query";
import { useWordSets, type WordSetOption } from "./useWordSets";
import { WordSetPicker } from "./WordSetPicker";
import styles from "./MoveWordDialog.module.css";

export function MoveWordDialog({
  item,
  sourceSet,
  onClose,
  onMoved,
}: {
  item: { id: string; original: string; translation: string };
  sourceSet: WordSetOption;
  onClose: () => void;
  onMoved: (destination: WordSetOption) => void;
}) {
  const { t } = useI18n();
  const { data: session } = useSession();
  const sets = useWordSets(session?.user?.id);
  const client = useQueryClient();
  const titleId = useId();
  const searchId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiMessage | null>(null);
  const languagePair = `${sourceSet.sourceLang.toUpperCase()} → ${sourceSet.targetLang.toUpperCase()}`;

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    if (!sets.isPending && !sets.error) searchRef.current?.focus();
  }, [sets.isPending, sets.error]);

  function unavailableReason(set: WordSetOption) {
    if (set.id === sourceSet.id) return t("moveWordDialog.currentSet");
    if (
      set.sourceLang !== sourceSet.sourceLang ||
      set.targetLang !== sourceSet.targetLang
    ) {
      return t("moveWordDialog.differentLanguages", {
        source: set.sourceLang.toUpperCase(),
        target: set.targetLang.toUpperCase(),
      });
    }
  }

  const destination = sets.data?.find((set) => set.id === selectedId);
  const canMove =
    !!destination &&
    !unavailableReason(destination) &&
    !sets.isPending &&
    !sets.error;

  async function move() {
    if (!destination || !canMove || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/word-sets/${sourceSet.id}/items/${item.id}/move`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ destinationWordSetId: destination.id }),
        },
      );
      const body = await response.json();
      if (!response.ok)
        throw errorFromResponse(body, "errors.couldNotMoveThisWord");
      void client.invalidateQueries({ queryKey: ["wordSets"] });
      onMoved(destination);
    } catch (cause) {
      setError(
        messageFromError(cause, "errors.couldNotMoveThisWordPleaseTryAgain"),
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void move();
        }}
      >
        <header className={styles.header}>
          <h2 id={titleId}>{t("moveWordDialog.moveToAnotherSet")}</h2>
        </header>
        <div className={styles.body}>
          <p className={styles.word} title={item.original || item.translation}>
            {item.original ||
              item.translation ||
              t("enrichmentDialog.importedWord")}
          </p>
          <p className={styles.hint}>
            {t("moveWordDialog.help", { languages: languagePair })}
          </p>
          {sets.isPending ? (
            <p role="status">{t("moveWordDialog.loadingSets")}</p>
          ) : sets.error ? (
            <div className={styles.error} role="alert">
              <p>{t("moveWordDialog.couldNotLoadYourSets")}</p>
              <button type="button" onClick={() => void sets.refetch()}>
                {t("moveWordDialog.tryAgain")}
              </button>
            </div>
          ) : (
            <WordSetPicker
              sets={sets.data ?? []}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id);
                setError(null);
              }}
              search={search}
              onSearchChange={(query) => {
                setSearch(query);
                setSelectedId("");
                setError(null);
              }}
              id={searchId}
              searchRef={searchRef}
              label={t("moveWordDialog.destinationSets")}
              disabled={busy}
              unavailableReason={unavailableReason}
              showLanguages
            />
          )}
          {error && (
            <p className={styles.error} role="alert">
              {t(error.key, error.values)}
            </p>
          )}
        </div>
        <footer className={styles.actions}>
          <button type="button" disabled={busy} onClick={onClose}>
            {t("moveWordDialog.cancel")}
          </button>
          <button
            type="submit"
            className={styles.move}
            disabled={busy || !canMove}
          >
            {busy ? t("moveWordDialog.moving") : t("moveWordDialog.move")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
