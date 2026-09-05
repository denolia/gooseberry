"use client";
import { useState } from "react";
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
}: {
  response: TranslationResponse;
  sourceLang?: string;
  targetLang?: string;
}) {
  const { data: session } = useSession();
  const client = useQueryClient();
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
    ...mapTranslationToWordSetItem(response, ""),
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
  if (!session?.user?.id) return null;
  if (!sourceLang || !targetLang)
    return (
      <div className={styles.bar}>
        <span>
          Translate this word again to save it with its language pair.
        </span>
        <Link href="/anki">Your sets ↗</Link>
      </div>
    );
  return (
    <section className={styles.container} aria-label="Save translation to Anki">
      <div className={styles.bar}>
        <span className={styles.label}>Anki</span>
        {sets.isPending ? (
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
            {(creating || compatible.length === 0) && (
              <input
                aria-label="New set name"
                placeholder="Name your first set"
                maxLength={200}
                value={name}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
              />
            )}
            <button
              className={styles.primary}
              disabled={
                busy ||
                (isSaved && !creating) ||
                !draft.original.trim() ||
                !draft.translation.trim() ||
                ((creating || !setId) && !name.trim())
              }
              onClick={save}
            >
              {busy
                ? "Saving…"
                : isSaved && !creating
                  ? "✓ Saved"
                  : saved[setId] && !creating
                    ? "Save changes"
                    : "Save card"}
            </button>
            <button
              disabled={busy}
              aria-expanded={editing}
              onClick={() => setEditing(!editing)}
            >
              {editing ? "Close editor" : "Edit card"}
            </button>
          </>
        )}
        <Link href={isSaved ? `/anki/${setId}` : "/anki"}>
          {isSaved ? "View set ↗" : "Your sets ↗"}
        </Link>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {isSaved && (
        <p className={styles.success} role="status">
          Saved to {compatible.find((s) => s.id === setId)?.name}.
        </p>
      )}
      {editing && (
        <div className={styles.editor}>
          <CardEditor value={draft} onChange={setDraft} disabled={busy} />
          <p className={styles.hint}>
            These values will be saved to your card. Your translation stays as
            it is.
          </p>
        </div>
      )}
    </section>
  );
}
