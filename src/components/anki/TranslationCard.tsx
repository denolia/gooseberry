"use client";
import { ReactNode, useId, useState } from "react";
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
  children,
}: {
  response: TranslationResponse;
  sourceLang?: string;
  targetLang?: string;
  children: ReactNode;
}) {
  const { data: session } = useSession();
  const client = useQueryClient();
  const editorId = useId();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
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
  const fingerprint = JSON.stringify(fieldsFromDraft(draft));
  const isSaved = saved[setId]?.fingerprint === fingerprint;

  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
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
            ? { itemId: existing.itemId, ...fieldsFromDraft(draft) }
            : { card: fieldsFromDraft(draft), sourceLang, targetLang },
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save card.");
      setSaved((old) => ({
        ...old,
        [destination]: { fingerprint, itemId: existing?.itemId ?? data.itemId },
      }));
      setEditing(false);
      try {
        localStorage.setItem(storageKey, destination);
      } catch {
        /* Saving works without storage. */
      }
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
    if (hasSavedCard || !setId || !sourceLang || !targetLang || sets.error) {
      setEditing(true);
    } else {
      void save();
    }
  }

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
          <button
            className={hasSavedCard ? styles.editAction : styles.primary}
            disabled={busy || sets.isPending}
            title={
              hasSavedCard
                ? `Edit card in ${destinationName}`
                : destinationName
                  ? `Save to ${destinationName}`
                  : "Choose or create an Anki set"
            }
            aria-expanded={editing}
            aria-controls={editorId}
            onClick={primaryAction}
          >
            {busy ? "Saving…" : hasSavedCard ? "Edit" : "Save card"}
          </button>
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
