"use client";
import { StudyActivityCounters } from "@/components/review/StudyActivityPanel";
import { formatError, MessageError } from "@/i18n/errors";
import {
  languageLabelKey,
  getLanguageCode,
  SourceLanguageCode,
  SourceLanguageSelectOptions,
  TargetLanguageCode,
  TargetLanguageSelectOptions,
} from "@/components/ui/Languages";

import { useI18n } from "@/i18n/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { EllipsisVertical, Plus, X } from "lucide-react";
import styles from "./WordSetList.module.css";
import { useLanguages } from "@/lib/languages/useLanguages";
import { StudyPlant } from "@/components/review/StudyPlant";
import { plantReadinessStage } from "@/lib/review/stats";
import { StudyScopeActions } from "./StudyScopeActions";

interface WordSet {
  id: string;
  name: string;
  sourceLang: string;
  targetLang: string;
  createdAt: string;
  lastExportedAt: string | null;
  reviewStats?: {
    itemCount: number;
    cardCount: number;
    dueCount: number;
  };
}

export function WordSetList() {
  const { t } = useI18n();
  const { data: session, status } = useSession();
  const { currentSourceLanguage, currentTargetLanguage } = useLanguages();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createSourceLang, setCreateSourceLang] = useState<SourceLanguageCode>(
    getLanguageCode(currentSourceLanguage) as SourceLanguageCode,
  );
  const [createTargetLang, setCreateTargetLang] = useState<TargetLanguageCode>(
    getLanguageCode(currentTargetLanguage) as TargetLanguageCode,
  );
  const wordSetsQueryKey = ["wordSets", session?.user?.id] as const;

  const {
    data: wordSets = [],
    isPending,
    error,
  } = useQuery({
    queryKey: wordSetsQueryKey,
    enabled: status === "authenticated" && Boolean(session?.user?.id),
    queryFn: async (): Promise<WordSet[]> => {
      const response = await fetch("/api/word-sets");
      if (!response.ok) throw new MessageError("errors.failedToLoadWordSets");
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

      if (!response.ok) throw new MessageError("errors.failedToCreateWordSet");
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: wordSetsQueryKey });
      setShowCreateForm(false);
      setCreateName("");
      router.push(`/anki/${data.wordSet.id}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const response = await fetch(`/api/word-sets/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new MessageError("errors.failedToDeleteWordSet");
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
      alert(formatError(t, err, "errors.failedToCreateWordSet"));
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(t("wordSetList.deleteConfirmation", { name }))) return;

    try {
      await deleteMutation.mutateAsync({ id });
    } catch (err) {
      alert(formatError(t, err, "errors.failedToDeleteWordSet"));
    }
  };

  if (
    status === "loading" ||
    (status === "authenticated" && !!session?.user?.id && isPending)
  ) {
    return <div className={styles.loading}>{t("wordSetList.loading")}</div>;
  }

  if (status === "unauthenticated") {
    return (
      <div className={styles.unauthenticated}>
        {t("wordSetList.pleaseSignInToManageWordSets")}
      </div>
    );
  }

  if (!session?.user?.id) {
    return (
      <div className={styles.error}>
        {t("wordSetList.yourSessionCouldNotBeInitializedPleaseSignOutAnd")}
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.error}>
        {formatError(t, error, "errors.failedToLoadWordSets")}
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.activitySummary}>
        <StudyActivityCounters />
      </div>
      <div className={styles.toolbar}>
        <StudyScopeActions sets={wordSets} />
        <div className={`${styles.headerActions} ${styles.managementActions}`}>
          <Link
            className={`${styles.importButton} ${styles.expandedAction}`}
            href="/anki/import"
          >
            {t("wordSetList.importAnkiDeck")}
          </Link>
          <button
            className={styles.createButton}
            aria-label={
              showCreateForm
                ? t("moveWordDialog.cancel")
                : t("translationCard.newSet")
            }
            title={
              showCreateForm
                ? t("moveWordDialog.cancel")
                : t("translationCard.newSet")
            }
            onClick={() => {
              if (!showCreateForm) {
                setCreateSourceLang(
                  getLanguageCode(currentSourceLanguage) as SourceLanguageCode,
                );
                setCreateTargetLang(
                  getLanguageCode(currentTargetLanguage) as TargetLanguageCode,
                );
              }
              setShowCreateForm(!showCreateForm);
            }}
          >
            <span className={styles.createButtonLabel}>
              {showCreateForm
                ? t("moveWordDialog.cancel")
                : t("translationCard.newSet")}
            </span>
            {showCreateForm ? (
              <X
                className={styles.createButtonIcon}
                size={18}
                aria-hidden="true"
              />
            ) : (
              <Plus
                className={styles.createButtonIcon}
                size={18}
                aria-hidden="true"
              />
            )}
          </button>
        </div>
      </div>

      {showCreateForm && (
        <form onSubmit={handleCreate} className={styles.createForm}>
          <input
            type="text"
            aria-label={t("importDeck.setName")}
            maxLength={200}
            placeholder={t("wordSetList.setNameEGGermanVerbs")}
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            className={styles.input}
            required
          />
          <div className={styles.languageRow}>
            <select
              aria-label={t("wordSetList.sourceLanguage")}
              value={createSourceLang}
              onChange={(e) =>
                setCreateSourceLang(e.target.value as SourceLanguageCode)
              }
              className={styles.select}
            >
              {SourceLanguageSelectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(languageLabelKey(option.value))}
                </option>
              ))}
            </select>
            <span>→</span>
            <select
              aria-label={t("importDeck.translationLanguage")}
              value={createTargetLang}
              onChange={(e) =>
                setCreateTargetLang(e.target.value as TargetLanguageCode)
              }
              className={styles.select}
            >
              {TargetLanguageSelectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(languageLabelKey(option.value))}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className={styles.submitButton}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending
              ? t("wordSetList.creating")
              : t("wordSetList.createSet")}
          </button>
        </form>
      )}

      {wordSets.length > 0 && (
        <input
          className={styles.search}
          aria-label={t("wordSetList.searchSets")}
          placeholder={t("wordSetList.findASet")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}
      {wordSets.length === 0 ? (
        <div className={styles.empty}>
          {t("wordSetList.yourNextTranslationCanBeYourFirstCardCreateA")}
        </div>
      ) : (
        <div className={styles.list}>
          {!wordSets.some((set) =>
            set.name.toLowerCase().includes(search.toLowerCase()),
          ) && (
            <p className={styles.empty}>
              {t("wordSetList.noMatches", { search })}
            </p>
          )}
          {wordSets
            .filter((set) =>
              set.name.toLowerCase().includes(search.toLowerCase()),
            )
            .map((set) => {
              const reviewStats = set.reviewStats ?? {
                itemCount: 0,
                cardCount: 0,
                dueCount: 0,
              };
              return (
                <div key={set.id} className={styles.card}>
                  <Link
                    className={styles.cardContent}
                    href={`/anki/${set.id}/review`}
                    aria-label={t("wordSetList.studyValue", {
                      value0: set.name,
                    })}
                    aria-disabled={reviewStats.dueCount === 0}
                    onClick={(event) => {
                      if (reviewStats.dueCount === 0) event.preventDefault();
                    }}
                  >
                    <StudyPlant
                      stage={plantReadinessStage(
                        reviewStats.dueCount,
                        reviewStats.cardCount,
                      )}
                      dueCount={reviewStats.dueCount}
                    />
                    <div className={styles.setCopy}>
                      <h3 className={styles.setName}>{set.name}</h3>
                      <div className={styles.setMeta}>
                        {set.sourceLang.toUpperCase()} →{" "}
                        {set.targetLang.toUpperCase()} ·{" "}
                        {t("common.wordCount", {
                          count: reviewStats.itemCount,
                        })}
                        {" · "}
                        {t("common.exerciseCount", {
                          count: reviewStats.cardCount,
                        })}
                        {set.lastExportedAt && (
                          <span className={styles.exported}>
                            {t("wordSetList.exported")}{" "}
                            {new Date(set.lastExportedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <p
                        className={`${styles.readiness} ${reviewStats.dueCount > 0 ? styles.hasReviews : ""}`}
                      >
                        {reviewStats.dueCount === 0
                          ? t("wordSetList.allCaughtUp")
                          : t("wordSetList.readyExercises", {
                              count: reviewStats.dueCount,
                            })}
                      </p>
                    </div>
                  </Link>
                  <div className={styles.cardActions}>
                    <Link
                      className={styles.openButton}
                      href={`/anki/${set.id}`}
                    >
                      {t("wordSetList.open")}
                    </Link>
                    <details className={styles.moreMenu}>
                      <summary
                        aria-label={t("wordSetList.moreActionsForValue", {
                          value0: set.name,
                        })}
                      >
                        <EllipsisVertical
                          size={18}
                          aria-hidden="true"
                          focusable="false"
                        />
                      </summary>
                      <div className={styles.moreMenuContent}>
                        <Link href={`/anki/${set.id}`}>
                          {t("importDeck.openSet")}
                        </Link>
                        <button
                          disabled={deleteMutation.isPending}
                          onClick={() => void handleDelete(set.id, set.name)}
                        >
                          {t("wordSetList.deleteSet")}
                        </button>
                      </div>
                    </details>
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
