"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./WordSetList.module.css";
import {
  getLanguageCode,
  isSourceLanguageCode,
  isTargetLanguageCode,
  SourceLanguageCode,
  SourceLanguageCodeOptions,
  SourceLanguages,
  SourceLanguageSelectOptions,
  TargetLanguageCode,
  TargetLanguageCodeOptions,
  TargetLanguages,
  TargetLanguageSelectOptions,
} from "@/components/ui/Languages";
import {
  updateLanguagePairForSourceChange,
  updateLanguagePairForTargetChange,
} from "@/lib/languages/languagePair";

interface WordSet {
  id: string;
  name: string;
  sourceLang: string;
  targetLang: string;
  createdAt: string;
  lastExportedAt: string | null;
}

type CreateLanguageState = {
  currentSourceLang: SourceLanguageCode;
  currentTargetLang: TargetLanguageCode;
  previousSourceLang: SourceLanguageCode;
  previousTargetLang: TargetLanguageCode;
};

const defaultCreateSourceLanguage = getLanguageCode(
  SourceLanguages.German,
) as SourceLanguageCode;
const defaultCreateTargetLanguage = getLanguageCode(
  TargetLanguages.English,
) as TargetLanguageCode;

const defaultCreateLanguageState: CreateLanguageState = {
  currentSourceLang: defaultCreateSourceLanguage,
  currentTargetLang: defaultCreateTargetLanguage,
  previousSourceLang: defaultCreateSourceLanguage,
  previousTargetLang: defaultCreateTargetLanguage,
};

const createLanguagePairConfig = {
  defaultSource: defaultCreateSourceLanguage,
  defaultTarget: defaultCreateTargetLanguage,
  sourceOptions: SourceLanguageCodeOptions,
  targetOptions: TargetLanguageCodeOptions,
  isSource: isSourceLanguageCode,
  isTarget: isTargetLanguageCode,
} as const;

export function WordSetList() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createLanguages, setCreateLanguages] = useState<CreateLanguageState>(
    defaultCreateLanguageState,
  );
  const wordSetsQueryKey = ["wordSets", session?.user?.id] as const;
  const createSourceLang = createLanguages.currentSourceLang;
  const createTargetLang = createLanguages.currentTargetLang;

  const { data: wordSets = [], isPending, error } = useQuery({
    queryKey: wordSetsQueryKey,
    enabled: status === "authenticated" && Boolean(session?.user?.id),
    queryFn: async (): Promise<WordSet[]> => {
      const response = await fetch("/api/word-sets");
      if (!response.ok) throw new Error("Failed to load word sets");
      const data = await response.json();
      return data.wordSets;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
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
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: wordSetsQueryKey });
      setShowCreateForm(false);
      setCreateName("");
      setCreateLanguages(defaultCreateLanguageState);
      router.push(`/anki/${data.wordSet.id}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const response = await fetch(`/api/word-sets/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to delete word set");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wordSetsQueryKey });
    },
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim()) return;

    try {
      await createMutation.mutateAsync();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create word set");
    }
  };

  const handleCreateSourceLanguageChange = (nextSource: SourceLanguageCode) => {
    setCreateLanguages((current) => {
      const next = updateLanguagePairForSourceChange(
        {
          currentSource: current.currentSourceLang,
          currentTarget: current.currentTargetLang,
          previousSource: current.previousSourceLang,
          previousTarget: current.previousTargetLang,
        },
        nextSource,
        createLanguagePairConfig,
      );

      return {
        currentSourceLang: next.currentSource,
        currentTargetLang: next.currentTarget,
        previousSourceLang: next.previousSource,
        previousTargetLang: next.previousTarget,
      };
    });
  };

  const handleCreateTargetLanguageChange = (nextTarget: TargetLanguageCode) => {
    setCreateLanguages((current) => {
      const next = updateLanguagePairForTargetChange(
        {
          currentSource: current.currentSourceLang,
          currentTarget: current.currentTargetLang,
          previousSource: current.previousSourceLang,
          previousTarget: current.previousTargetLang,
        },
        nextTarget,
        createLanguagePairConfig,
      );

      return {
        currentSourceLang: next.currentSource,
        currentTargetLang: next.currentTarget,
        previousSourceLang: next.previousSource,
        previousTargetLang: next.previousTarget,
      };
    });
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

    try {
      await deleteMutation.mutateAsync({ id });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete word set");
    }
  };

  if (status === "loading" || isPending) {
    return <div className={styles.loading}>Loading...</div>;
  }

  if (status === "unauthenticated") {
    return (
      <div className={styles.unauthenticated}>
        Please sign in to manage word sets.
      </div>
    );
  }

  if (!session?.user?.id) {
    return (
      <div className={styles.error}>
        Your session could not be initialized. Please sign out and sign in
        again.
      </div>
    );
  }

  if (error) {
    return <div className={styles.error}>{error.message}</div>;
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
              onChange={(e) =>
                handleCreateSourceLanguageChange(
                  e.target.value as SourceLanguageCode,
                )
              }
              className={styles.select}
            >
              {SourceLanguageSelectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span>→</span>
            <select
              value={createTargetLang}
              onChange={(e) =>
                handleCreateTargetLanguageChange(
                  e.target.value as TargetLanguageCode,
                )
              }
              className={styles.select}
            >
              {TargetLanguageSelectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className={styles.submitButton}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? "Creating..." : "Create & Add Words"}
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
