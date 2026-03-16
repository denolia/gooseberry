"use client";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./WordSetList.module.css";

interface WordSet {
  id: string;
  name: string;
  sourceLang: string;
  targetLang: string;
  createdAt: string;
  lastExportedAt: string | null;
}

export function WordSetList() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [wordSets, setWordSets] = useState<WordSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createSourceLang, setCreateSourceLang] = useState("de");
  const [createTargetLang, setCreateTargetLang] = useState("ru");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (status === "authenticated" && session?.user?.id) {
      loadWordSets();
    } else if (status === "authenticated") {
      setError("Your session could not be initialized. Please sign out and sign in again.");
      setLoading(false);
    } else if (status === "unauthenticated") {
      setLoading(false);
    }
  }, [session?.user?.id, status]);

  const loadWordSets = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/word-sets");
      if (!response.ok) throw new Error("Failed to load word sets");
      const data = await response.json();
      setWordSets(data.wordSets);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load word sets");
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim()) return;

    try {
      setCreating(true);
      const response = await fetch("/api/word-sets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createName,
          sourceLang: createSourceLang,
          targetLang: createTargetLang,
        }),
      });

      if (!response.ok) throw new Error("Failed to create word set");

      const data = await response.json();
      setShowCreateForm(false);
      setCreateName("");
      router.push(`/anki/${data.wordSet.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create word set");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

    try {
      const response = await fetch(`/api/word-sets/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to delete word set");

      loadWordSets();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete word set");
    }
  };

  if (status === "loading" || loading) {
    return <div className={styles.loading}>Loading...</div>;
  }

  if (status === "unauthenticated") {
    return (
      <div className={styles.unauthenticated}>
        Please sign in to manage word sets.
      </div>
    );
  }

  if (error) {
    return <div className={styles.error}>{error}</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button
          className={styles.createButton}
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          {showCreateForm ? "Cancel" : "+ Create New Set"}
        </button>
      </div>

      {showCreateForm && (
        <form onSubmit={handleCreate} className={styles.createForm}>
          <input
            type="text"
            placeholder="Set name (e.g., 'German Verbs')"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            className={styles.input}
            required
          />
          <div className={styles.languageRow}>
            <select
              value={createSourceLang}
              onChange={(e) => setCreateSourceLang(e.target.value)}
              className={styles.select}
            >
              <option value="de">German</option>
              <option value="no">Norwegian</option>
              <option value="en">English</option>
            </select>
            <span>→</span>
            <select
              value={createTargetLang}
              onChange={(e) => setCreateTargetLang(e.target.value)}
              className={styles.select}
            >
              <option value="ru">Russian</option>
            </select>
          </div>
          <button
            type="submit"
            className={styles.submitButton}
            disabled={creating}
          >
            {creating ? "Creating..." : "Create & Add Words"}
          </button>
        </form>
      )}

      {wordSets.length === 0 ? (
        <div className={styles.empty}>
          No word sets yet. Create your first one!
        </div>
      ) : (
        <div className={styles.list}>
          {wordSets.map((set) => (
            <div key={set.id} className={styles.card}>
              <div
                className={styles.cardContent}
                onClick={() => router.push(`/anki/${set.id}`)}
              >
                <h3 className={styles.setName}>{set.name}</h3>
                <div className={styles.setMeta}>
                  {set.sourceLang.toUpperCase()} → {set.targetLang.toUpperCase()}
                  {set.lastExportedAt && (
                    <span className={styles.exported}>
                      • Last exported:{" "}
                      {new Date(set.lastExportedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
              <button
                className={styles.deleteButton}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(set.id, set.name);
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
