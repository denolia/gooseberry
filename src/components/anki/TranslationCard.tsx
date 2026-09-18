"use client";
import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { TranslationResponse } from "@/app/utils/translationSchema";
import { mapTranslationToWordSetItem } from "@/app/utils/ankiMapper";
import { CardDraft, fieldsFromDraft } from "@/app/utils/cardDraft";
import { CardEditor } from "./CardEditor";
import styles from "./TranslationCard.module.css";

type WordSet = {
  id: string;
  name: string;
  sourceLang: string;
  targetLang: string;
};
export function TranslationCard({
  response,
  sourceLang,
  targetLang,
  prepareCard,
  children,
}: {
  response: TranslationResponse;
  sourceLang?: string;
  targetLang?: string;
  prepareCard?: () => Promise<CardDraft>;
  children: ReactNode;
}) {
  const { data: session } = useSession();
  const client = useQueryClient();
  const editorId = useId();
  const pickerId = useId();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [setSearch, setSetSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const preparedCard = useRef(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const mainActionRef = useRef<HTMLButtonElement>(null);
  const pickerTriggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const newSetNameRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<
    Record<string, { fingerprint: string; itemId: string }>
  >({});
  const [draft, setDraft] = useState<CardDraft>(() => ({
    ...mapTranslationToWordSetItem(response, "", sourceLang),
    examples: (response.example_usage ?? []).map((e) => ({
      sample: e.sample,
      translation: e.sample_translation,
    })),
  }));
  const storageKey = `anki:last-set:${session?.user?.id}:${sourceLang}:${targetLang}`;
  const sets = useQuery({
    queryKey: ["wordSets", session?.user?.id],
    enabled: !!session?.user?.id,
    queryFn: async (): Promise<WordSet[]> => {
      const res = await fetch("/api/word-sets");
      if (!res.ok) throw new Error("Could not load sets.");
      return (await res.json()).wordSets;
    },
  });
  const compatible = (sets.data ?? []).filter(
    (s) => s.sourceLang === sourceLang && s.targetLang === targetLang,
  );
  let remembered = "";
  try {
    remembered = window.localStorage.getItem(storageKey) ?? "";
  } catch {
    /* Storage is optional. */
  }
  const setId =
    compatible.find((s) => s.id === selected)?.id ??
    compatible.find((s) => s.id === remembered)?.id ??
    compatible[0]?.id ??
    "";
  const normalizedSearch = setSearch.trim().toLocaleLowerCase();
  const pickerSets = [...compatible]
    .sort((a, b) => {
      if (a.id === setId) return -1;
      if (b.id === setId) return 1;
      return a.name.localeCompare(b.name);
    })
    .filter((set) => set.name.toLocaleLowerCase().includes(normalizedSearch));
  const fingerprint = JSON.stringify(fieldsFromDraft(draft));
  const isSaved = saved[setId]?.fingerprint === fingerprint;

  function closePicker({ restoreFocus = false } = {}) {
    setPickerOpen(false);
    setSetSearch("");
    setCreating(false);
    setName("");
    if (restoreFocus) {
      window.requestAnimationFrame(() => pickerTriggerRef.current?.focus());
    }
  }

  function openPicker(startCreating = compatible.length === 0) {
    if (!sourceLang || !targetLang) {
      setEditing(true);
      return;
    }
    setError("");
    setCreating(startCreating);
    setSetSearch("");
    setPickerOpen(true);
  }

  useEffect(() => {
    if (!pickerOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!busy && !pickerRef.current?.contains(event.target as Node)) {
        closePicker();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        closePicker({ restoreFocus: true });
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [busy, pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    window.requestAnimationFrame(() => {
      if (creating || compatible.length === 0) {
        newSetNameRef.current?.focus();
      } else {
        searchRef.current?.focus();
      }
    });
  }, [compatible.length, creating, pickerOpen]);

  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      let nextDraft = draft;
      if (prepareCard && !preparedCard.current) {
        nextDraft = await prepareCard();
        preparedCard.current = true;
        setDraft(nextDraft);
      }
      const nextFingerprint = JSON.stringify(fieldsFromDraft(nextDraft));
      let destination = setId;
      if (creating || !destination) {
        const res = await fetch("/api/word-sets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), sourceLang, targetLang }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not create set.");
        destination = data.wordSet.id;
        client.setQueryData<WordSet[]>(
          ["wordSets", session?.user?.id],
          (old) => [data.wordSet, ...(old ?? [])],
        );
        setSelected(destination);
        setCreating(false);
        setName("");
      }
      const existing = saved[destination];
      const res = await fetch(`/api/word-sets/${destination}/items`, {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          existing
            ? { itemId: existing.itemId, ...fieldsFromDraft(nextDraft) }
            : { card: fieldsFromDraft(nextDraft), sourceLang, targetLang },
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save card.");
      setSaved((old) => ({
        ...old,
        [destination]: {
          fingerprint: nextFingerprint,
          itemId: existing?.itemId ?? data.itemId,
        },
      }));
      setEditing(false);
      try {
        localStorage.setItem(storageKey, destination);
      } catch {
        /* Saving works without storage. */
      }
      setPickerOpen(false);
      setSetSearch("");
      window.requestAnimationFrame(() => mainActionRef.current?.focus());
      client.invalidateQueries({ queryKey: ["wordSets", session?.user?.id] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save card.");
    } finally {
      setBusy(false);
    }
  }
  const hasSavedCard = !!saved[setId];
  const destinationName = compatible.find((s) => s.id === setId)?.name;
  const canSave =
    !!sourceLang &&
    !!targetLang &&
    !sets.isPending &&
    !sets.error &&
    !busy &&
    !!draft.original.trim() &&
    !!draft.translation.trim() &&
    (!(creating || !setId) || !!name.trim());

  function primaryAction() {
    if (pickerOpen) closePicker();
    if (!sourceLang || !targetLang) {
      setEditing(true);
    } else if (sets.error) {
      void sets.refetch();
    } else if (!setId) {
      openPicker(true);
    } else if (hasSavedCard) {
      setEditing(true);
    } else {
      void save();
    }
  }

  const primaryLabel = busy
    ? "Saving…"
    : sets.isPending
      ? "Loading sets…"
      : sets.error
        ? "Retry loading sets"
        : !sourceLang || !targetLang
          ? "Edit card"
          : !destinationName
            ? "Choose a set to save"
            : hasSavedCard
              ? `Edit card in “${destinationName}”`
              : `Save card to “${destinationName}”`;

  if (!session?.user?.id) return <>{children}</>;
  return (
    <section
      className={styles.container}
      aria-label="Translation and Anki card"
    >
      {editing && (
        <div className={styles.editor} id={editorId}>
          <div className={styles.bar}>
            <span className={styles.label}>Anki card</span>
            {!sourceLang || !targetLang ? (
              <span>
                Translate this word again to save it with its language pair.
              </span>
            ) : sets.isPending ? (
              <span>Loading sets…</span>
            ) : sets.error ? (
              <button onClick={() => sets.refetch()}>Retry loading sets</button>
            ) : (
              <>
                {compatible.length > 0 && (
                  <select
                    aria-label="Anki set"
                    value={creating ? "new" : setId}
                    disabled={busy}
                    onChange={(e) => {
                      setCreating(e.target.value === "new");
                      setSelected(e.target.value);
                      setError("");
                    }}
                  >
                    {compatible.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                    <option value="new">+ New set</option>
                  </select>
                )}
                {(creating || !compatible.length) && (
                  <input
                    aria-label="New set name"
                    placeholder="Set name"
                    maxLength={200}
                    value={name}
                    disabled={busy}
                    onChange={(e) => setName(e.target.value)}
                  />
                )}
                <button
                  className={styles.primary}
                  disabled={!canSave || (isSaved && !creating)}
                  onClick={save}
                >
                  {busy
                    ? "Saving…"
                    : hasSavedCard && !creating
                      ? "Save changes"
                      : "Save card"}
                </button>
              </>
            )}
            <button disabled={busy} onClick={() => setEditing(false)}>
              Close editor
            </button>
            <Link href={hasSavedCard ? `/anki/${setId}` : "/anki"}>
              {hasSavedCard ? "View set ↗" : "Your sets ↗"}
            </Link>
          </div>
          {sourceLang && targetLang && (
            <CardEditor value={draft} onChange={setDraft} disabled={busy} />
          )}
        </div>
      )}
      <div className={styles.resultRow}>
        <div className={styles.meaning}>{children}</div>
        {!editing && (
          <div className={styles.actionArea} ref={pickerRef}>
            <div className={styles.splitButton}>
              <button
                ref={mainActionRef}
                type="button"
                className={`${styles.mainAction} ${hasSavedCard ? styles.editAction : styles.primary}`}
                disabled={busy || sets.isPending}
                title={primaryLabel}
                aria-expanded={hasSavedCard ? editing : undefined}
                aria-controls={hasSavedCard ? editorId : undefined}
                onClick={primaryAction}
              >
                <span>{primaryLabel}</span>
              </button>
              {sourceLang && targetLang && (
                <button
                  ref={pickerTriggerRef}
                  type="button"
                  className={`${styles.pickerTrigger} ${hasSavedCard ? styles.editAction : styles.primary}`}
                  disabled={busy || sets.isPending}
                  aria-label={
                    destinationName
                      ? `Choose Anki set. Current set: ${destinationName}`
                      : "Choose an Anki set"
                  }
                  aria-expanded={pickerOpen}
                  aria-controls={pickerId}
                  onClick={() => {
                    if (pickerOpen) closePicker();
                    else openPicker();
                  }}
                >
                  <span className={styles.chevron} aria-hidden="true" />
                </button>
              )}
            </div>

            {pickerOpen && (
              <div
                id={pickerId}
                className={styles.setPicker}
                role="dialog"
                aria-label="Choose an Anki set"
              >
                <div className={styles.pickerHeader}>
                  <strong>Save card to</strong>
                  <span className={styles.languagePair}>
                    {sourceLang?.toUpperCase()} → {targetLang?.toUpperCase()}
                  </span>
                </div>

                {sets.error ? (
                  <div className={styles.pickerMessage}>
                    <span>Could not load your sets.</span>
                    <button type="button" onClick={() => sets.refetch()}>
                      Try again
                    </button>
                  </div>
                ) : creating || compatible.length === 0 ? (
                  <form
                    className={styles.createSetForm}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void save();
                    }}
                  >
                    {compatible.length > 0 && (
                      <button
                        type="button"
                        className={styles.backButton}
                        disabled={busy}
                        onClick={() => {
                          setCreating(false);
                          setName("");
                        }}
                      >
                        ← Back to sets
                      </button>
                    )}
                    <label htmlFor={`${pickerId}-new-set`}>New set name</label>
                    <input
                      ref={newSetNameRef}
                      id={`${pickerId}-new-set`}
                      maxLength={200}
                      placeholder="For example, My words"
                      value={name}
                      disabled={busy}
                      onChange={(event) => setName(event.target.value)}
                    />
                    <button
                      type="submit"
                      className={styles.createAndSave}
                      disabled={!canSave}
                    >
                      {busy ? "Creating and saving…" : "Create and save card"}
                    </button>
                  </form>
                ) : (
                  <>
                    <label
                      className={styles.srOnly}
                      htmlFor={`${pickerId}-search`}
                    >
                      Find a set
                    </label>
                    <input
                      ref={searchRef}
                      id={`${pickerId}-search`}
                      className={styles.setSearch}
                      type="search"
                      placeholder="Find a set…"
                      value={setSearch}
                      onChange={(event) => setSetSearch(event.target.value)}
                    />
                    <div
                      className={styles.setList}
                      role="group"
                      aria-label="Compatible sets"
                    >
                      {pickerSets.length > 0 ? (
                        pickerSets.map((set) => (
                          <button
                            key={set.id}
                            type="button"
                            className={`${styles.setOption} ${set.id === setId ? styles.selectedSet : ""}`}
                            aria-pressed={set.id === setId}
                            onClick={() => {
                              setSelected(set.id);
                              setError("");
                              closePicker({ restoreFocus: true });
                            }}
                          >
                            <span
                              className={styles.optionMark}
                              aria-hidden="true"
                            >
                              {set.id === setId ? "✓" : ""}
                            </span>
                            <span>{set.name}</span>
                          </button>
                        ))
                      ) : (
                        <p className={styles.noSets}>
                          No sets match “{setSearch}”.
                        </p>
                      )}
                    </div>
                    <div className={styles.pickerFooter}>
                      <button
                        type="button"
                        className={styles.newSetAction}
                        onClick={() => {
                          setCreating(true);
                          setName("");
                        }}
                      >
                        + Create new set
                      </button>
                      <Link href="/anki" onClick={() => closePicker()}>
                        Manage sets ↗
                      </Link>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <span className={styles.srOnly} role="status">
        {isSaved ? `Saved to ${destinationName}.` : ""}
      </span>
    </section>
  );
}
