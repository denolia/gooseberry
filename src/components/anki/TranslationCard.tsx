"use client";
import {
  ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { EllipsisVertical } from "lucide-react";
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
  onOpenTranslation,
  children,
}: {
  response: TranslationResponse;
  sourceLang?: string;
  targetLang?: string;
  prepareCard?: () => Promise<CardDraft>;
  onOpenTranslation?: () => void;
  children: ReactNode;
}) {
  const { data: session } = useSession();
  const client = useQueryClient();
  const editorId = useId();
  const pickerId = useId();
  const actionsMenuId = useId();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [setSearch, setSetSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const preparedCard = useRef(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const mainActionRef = useRef<HTMLButtonElement>(null);
  const pickerTriggerRef = useRef<HTMLButtonElement>(null);
  const actionsTriggerRef = useRef<HTMLButtonElement>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const translationActionRef = useRef<HTMLButtonElement>(null);
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
    setActionsOpen(false);
    if (!sourceLang || !targetLang) {
      setEditing(true);
      return;
    }
    setError("");
    setCreating(startCreating);
    setSetSearch("");
    setPickerOpen(true);
  }

  function closeActions({ restoreFocus = false } = {}) {
    setActionsOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() =>
        actionsTriggerRef.current?.focus({ preventScroll: true }),
      );
    }
  }

  function openActions() {
    closePicker();
    setActionsOpen(true);
  }

  useLayoutEffect(() => {
    if (!actionsOpen) return;
    const menu = actionsMenuRef.current;
    const trigger = actionsTriggerRef.current;
    if (!menu || !trigger) return;

    // The top layer escapes the translation popup's scrolling viewport while
    // keeping the menu inside the card for outside-click and keyboard handling.
    menu.showPopover?.();
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const edge = 8;
    const gap = 6;
    menu.style.maxWidth = `${Math.max(0, viewportWidth - edge * 2)}px`;
    menu.style.maxHeight = `${Math.max(0, viewportHeight - edge * 2)}px`;
    const anchor = trigger.getBoundingClientRect();
    const size = menu.getBoundingClientRect();
    const roomBelow = viewportTop + viewportHeight - edge - anchor.bottom - gap;
    const roomAbove = anchor.top - gap - viewportTop - edge;
    const preferredTop =
      roomBelow >= size.height || roomBelow >= roomAbove
        ? anchor.bottom + gap
        : anchor.top - gap - size.height;
    menu.style.left = `${Math.max(
      viewportLeft + edge,
      Math.min(
        anchor.right - size.width,
        viewportLeft + viewportWidth - edge - size.width,
      ),
    )}px`;
    menu.style.top = `${Math.max(
      viewportTop + edge,
      Math.min(preferredTop, viewportTop + viewportHeight - edge - size.height),
    )}px`;
    translationActionRef.current?.focus({ preventScroll: true });

    const onPointerDown = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) closeActions();
    };
    const onScroll = (event: Event) => {
      if (event.target === window || !menu.contains(event.target as Node)) {
        closeActions({ restoreFocus: true });
      }
    };
    const onResize = () => closeActions({ restoreFocus: true });
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    viewport?.addEventListener("resize", onResize);
    viewport?.addEventListener("scroll", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      viewport?.removeEventListener("resize", onResize);
      viewport?.removeEventListener("scroll", onResize);
      if (
        menu.isConnected &&
        typeof menu.showPopover === "function" &&
        menu.matches(":popover-open")
      ) {
        menu.hidePopover();
      }
    };
  }, [actionsOpen]);

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
    closeActions();
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
          <div
            className={styles.actionArea}
            ref={pickerRef}
            onKeyDown={(event) => {
              if (!actionsOpen) return;
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeActions({ restoreFocus: true });
              } else if (event.key === "Tab") {
                closeActions();
                actionsTriggerRef.current?.focus({ preventScroll: true });
              } else if (
                ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault();
                translationActionRef.current?.focus({ preventScroll: true });
              }
            }}
          >
            <div className={styles.actionButtons}>
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
              {onOpenTranslation && (
                <button
                  ref={actionsTriggerRef}
                  type="button"
                  className={styles.actionsTrigger}
                  aria-label="More translation actions"
                  title="More translation actions"
                  aria-haspopup="menu"
                  aria-expanded={actionsOpen}
                  aria-controls={actionsMenuId}
                  disabled={busy}
                  onClick={() => (actionsOpen ? closeActions() : openActions())}
                  onKeyDown={(event) => {
                    if (
                      !actionsOpen &&
                      (event.key === "ArrowDown" || event.key === "ArrowUp")
                    ) {
                      event.preventDefault();
                      openActions();
                    }
                  }}
                >
                  <EllipsisVertical
                    size={18}
                    aria-hidden="true"
                    focusable="false"
                  />
                </button>
              )}
            </div>
            {onOpenTranslation && actionsOpen && (
              <div
                ref={actionsMenuRef}
                id={actionsMenuId}
                role="menu"
                aria-label="Translation actions"
                className={styles.actionsMenu}
                popover="manual"
              >
                <button
                  ref={translationActionRef}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => {
                    closeActions({ restoreFocus: true });
                    onOpenTranslation();
                  }}
                >
                  Open in Translation
                </button>
              </div>
            )}

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
