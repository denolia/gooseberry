"use client";

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
  const [error, setError] = useState("");
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
    if (set.id === sourceSet.id) return "Current set";
    if (
      set.sourceLang !== sourceSet.sourceLang ||
      set.targetLang !== sourceSet.targetLang
    ) {
      return `Different languages · ${set.sourceLang.toUpperCase()} → ${set.targetLang.toUpperCase()}`;
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
    setError("");
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
        throw new Error(body.error || "Could not move this word.");
      void client.invalidateQueries({ queryKey: ["wordSets"] });
      onMoved(destination);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not move this word. Please try again.",
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
          <h2 id={titleId}>Move to another set</h2>
        </header>
        <div className={styles.body}>
          <p className={styles.word} title={item.original || item.translation}>
            {item.original || item.translation || "Imported word"}
          </p>
          <p className={styles.hint}>
            Choose a {languagePair} set. Study progress moves with the word.
          </p>
          {sets.isPending ? (
            <p role="status">Loading sets…</p>
          ) : sets.error ? (
            <div className={styles.error} role="alert">
              <p>Could not load your sets.</p>
              <button type="button" onClick={() => void sets.refetch()}>
                Try again
              </button>
            </div>
          ) : (
            <WordSetPicker
              sets={sets.data ?? []}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id);
                setError("");
              }}
              search={search}
              onSearchChange={(query) => {
                setSearch(query);
                setSelectedId("");
                setError("");
              }}
              id={searchId}
              searchRef={searchRef}
              label="Destination sets"
              disabled={busy}
              unavailableReason={unavailableReason}
              showLanguages
            />
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className={styles.actions}>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={styles.move}
            disabled={busy || !canMove}
          >
            {busy ? "Moving…" : "Move"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
