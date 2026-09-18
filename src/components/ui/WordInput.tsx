"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./WordInput.module.css";
import { StructuredResponseDisplay } from "@/components/ui/StructuredResponseDisplay";
import {
  getLanguageCode,
  isSourceLanguage,
  SourceLanguage,
  SourceLanguages,
} from "@/components/ui/Languages";
import {
  TranslationResponse,
  TranslationResponseSchema,
} from "@/app/utils/translationSchema";
import { readJsonLines } from "@/app/utils/readJsonLines";
import { useLanguages } from "@/lib/languages/useLanguages";

type TranslationEntry = TranslationResponse & {
  sourceLang?: string;
  targetLang?: string;
  historyId?: string;
  localId?: string;
  createdAt?: string;
  isCurrentSession?: boolean;
};

const HISTORY_LABEL_LIMIT = 100;
const HISTORY_QUERY_KEY = ["translationHistory"] as const;

type HistoryPage = {
  history: TranslationEntry[];
  nextCursor: string | null;
};

type HistoryApiItem = {
  id: string;
  responseJson: TranslationResponse;
  sourceLang: string;
  targetLang: string;
  createdAt: string;
};

function createLocalHistoryId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `local-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function readLocalHistory(): TranslationEntry[] {
  try {
    const savedHistory = localStorage.getItem("translationHistory");
    const parsed: unknown = savedHistory ? JSON.parse(savedHistory) : [];
    if (!Array.isArray(parsed)) return [];

    return parsed.map((entry) => ({
      ...(entry as TranslationEntry),
      isCurrentSession: false,
      localId:
        typeof (entry as TranslationEntry).localId === "string"
          ? (entry as TranslationEntry).localId
          : createLocalHistoryId(),
    }));
  } catch {
    return [];
  }
}

function writeLocalHistory(history: TranslationEntry[]) {
  try {
    localStorage.setItem("translationHistory", JSON.stringify(history));
  } catch {
    /* Storage is optional. */
  }
}

function historySignature(entry: TranslationEntry) {
  return JSON.stringify([
    entry.original,
    entry.translation,
    entry.sourceLang ?? "",
    entry.targetLang ?? "",
  ]);
}

function mergeHistory(
  databaseHistory: TranslationEntry[],
  localHistory: TranslationEntry[],
) {
  const databaseCounts = new Map<string, number>();
  for (const entry of databaseHistory) {
    const signature = historySignature(entry);
    databaseCounts.set(signature, (databaseCounts.get(signature) ?? 0) + 1);
  }

  const localOnly = localHistory.filter((entry) => {
    if (entry.isCurrentSession) return true;
    const signature = historySignature(entry);
    const remainingMatches = databaseCounts.get(signature) ?? 0;
    if (remainingMatches === 0) return true;
    databaseCounts.set(signature, remainingMatches - 1);
    return false;
  });

  return [...localOnly, ...databaseHistory];
}

async function fetchHistoryPage({
  pageParam,
}: {
  pageParam: string | null;
}): Promise<HistoryPage> {
  const search = pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : "";
  const response = await fetch(`/api/history/list${search}`);
  if (!response.ok) {
    throw new Error("Failed to fetch history");
  }

  const data = (await response.json()) as {
    history?: HistoryApiItem[];
    nextCursor?: string | null;
  };
  if (!Array.isArray(data.history)) {
    throw new Error("Invalid history response");
  }

  return {
    history: data.history.map((item) => ({
      ...item.responseJson,
      historyId: item.id,
      sourceLang: isSourceLanguage(item.sourceLang)
        ? getLanguageCode(item.sourceLang)
        : item.sourceLang,
      targetLang: item.targetLang,
      createdAt: item.createdAt,
    })),
    nextCursor: typeof data.nextCursor === "string" ? data.nextCursor : null,
  };
}

function getHistoryLabel(entry: TranslationEntry) {
  const label = `${entry.original} - ${entry.translation}`;

  return label.length > HISTORY_LABEL_LIMIT
    ? `${label.slice(0, HISTORY_LABEL_LIMIT).trimEnd()}...`
    : label;
}

function HistoryList({
  entries,
  disabled,
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  reachedEnd,
  onLoadMore,
  onRetry,
  onSelect,
}: {
  entries: TranslationEntry[];
  disabled: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  reachedEnd: boolean;
  onLoadMore: () => Promise<unknown>;
  onRetry: () => Promise<unknown>;
  onSelect: (entry: TranslationEntry) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  const updateScrollMargin = useCallback(() => {
    if (!listRef.current) return;
    const nextMargin =
      listRef.current.getBoundingClientRect().top + window.scrollY;
    setScrollMargin((current) =>
      current === nextMargin ? current : nextMargin,
    );
  }, []);

  useLayoutEffect(() => {
    updateScrollMargin();
  });

  useEffect(() => {
    window.addEventListener("resize", updateScrollMargin);
    return () => window.removeEventListener("resize", updateScrollMargin);
  }, [updateScrollMargin]);

  const rowVirtualizer = useWindowVirtualizer<HTMLLIElement>({
    count: entries.length,
    estimateSize: () => 38,
    getItemKey: (index) =>
      entries[index]?.historyId ??
      entries[index]?.localId ??
      `history-${index}`,
    overscan: 10,
    scrollMargin,
  });

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || !hasNextPage) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isFetchingNextPage) {
          void onLoadMore();
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, onLoadMore]);

  return (
    <>
      <ul
        ref={listRef}
        className={styles.historyList}
        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const entry = entries[virtualRow.index];
          return (
            <li
              key={virtualRow.key}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
              className={styles.historyRow}
              style={{
                transform: `translateY(${virtualRow.start - scrollMargin}px)`,
              }}
            >
              <button
                className={styles.loadFromHistoryButton}
                disabled={disabled}
                onClick={() => onSelect(entry)}
                aria-label={`Open translation: ${entry.original}`}
                title="Open translation"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <circle cx="10.75" cy="10.75" r="6.25" />
                  <path d="m15.4 15.4 4.1 4.1" />
                </svg>
              </button>
              <span title={`${entry.original} - ${entry.translation}`}>
                {getHistoryLabel(entry)}
              </span>
            </li>
          );
        })}
      </ul>
      <div ref={loadMoreRef} className={styles.historyStatus}>
        {isFetchingNextPage ? (
          <span role="status">Loading more history…</span>
        ) : isFetchNextPageError ? (
          <>
            <span role="alert">Couldn’t load more history.</span>
            <button type="button" onClick={() => void onRetry()}>
              Retry
            </button>
          </>
        ) : reachedEnd ? (
          <span>End of history</span>
        ) : null}
      </div>
    </>
  );
}

const SPECIAL_CHARACTERS_BY_LANGUAGE: Partial<
  Record<SourceLanguage, readonly string[]>
> = {
  [SourceLanguages.German]: ["ß", "ä", "ü", "ö", "Ä", "Ü", "Ö"],
  [SourceLanguages.Norwegian]: ["æ", "ø", "å", "Æ", "Ø", "Å"],
  [SourceLanguages.Finnish]: ["ä", "ö", "å", "Ä", "Ö", "Å"],
  [SourceLanguages.Hungarian]: [
    "á",
    "é",
    "í",
    "ó",
    "ö",
    "ő",
    "ú",
    "ü",
    "ű",
    "Á",
    "É",
    "Í",
    "Ó",
    "Ö",
    "Ő",
    "Ú",
    "Ü",
    "Ű",
  ],
  [SourceLanguages.Spanish]: ["á", "é", "í", "ñ", "ó", "ú", "ü", "¿", "¡"],
  [SourceLanguages.French]: [
    "à",
    "â",
    "ç",
    "é",
    "è",
    "ê",
    "ë",
    "î",
    "ï",
    "ô",
    "ù",
    "û",
    "ü",
    "ÿ",
    "œ",
  ],
  [SourceLanguages.Italian]: ["à", "è", "é", "ì", "ò", "ù"],
  [SourceLanguages.Portuguese]: [
    "á",
    "â",
    "ã",
    "à",
    "ç",
    "é",
    "ê",
    "í",
    "ó",
    "ô",
    "õ",
    "ú",
  ],
  [SourceLanguages.Dutch]: ["á", "é", "ë", "ï", "í", "ó", "ú"],
  [SourceLanguages.Swedish]: ["å", "ä", "ö", "Å", "Ä", "Ö"],
  [SourceLanguages.Danish]: ["æ", "ø", "å", "Æ", "Ø", "Å"],
  [SourceLanguages.Polish]: ["ą", "ć", "ę", "ł", "ń", "ó", "ś", "ź", "ż"],
  [SourceLanguages.Turkish]: ["ç", "ğ", "ı", "İ", "ö", "ş", "ü"],
} as const;

export function WordInput() {
  const { currentSourceLanguage, currentTargetLanguage } = useLanguages();
  const specialCharacters =
    SPECIAL_CHARACTERS_BY_LANGUAGE[currentSourceLanguage] ?? [];
  const showSpecialCharacterControls = specialCharacters.length > 0;

  const [word, setWord] = useState("");
  const [translation, setTranslation] = useState<TranslationEntry>();
  const [localHistory, setLocalHistory] = useState<TranslationEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [preview, setPreview] = useState<{
    original: string;
    translation: string;
  }>();
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => () => activeRequest.current?.abort(), []);
  useEffect(() => {
    const loadDraft = (event?: Event) => {
      const eventText =
        event instanceof CustomEvent && typeof event.detail === "string"
          ? event.detail
          : "";
      let storedText = "";
      try {
        storedText = localStorage.getItem("translationDraft") ?? "";
        if (storedText) localStorage.removeItem("translationDraft");
      } catch {
        /* Storage is optional. */
      }
      const nextText = eventText || storedText;
      if (nextText) {
        setWord(nextText);
        setTranslation(undefined);
        setPreview(undefined);
        setError("");
      }
    };

    loadDraft();
    window.addEventListener("gooseberry:translation-draft", loadDraft);
    return () =>
      window.removeEventListener("gooseberry:translation-draft", loadDraft);
  }, []);
  const [error, setError] = useState("");
  const [showSpecialChars, setShowSpecialChars] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  const historyQuery = useInfiniteQuery({
    queryKey: HISTORY_QUERY_KEY,
    queryFn: fetchHistoryPage,
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  useEffect(() => {
    const savedHistory = readLocalHistory();
    setLocalHistory(savedHistory);
    writeLocalHistory(savedHistory);
  }, []);

  const databaseHistory = useMemo(
    () => historyQuery.data?.pages.flatMap((page) => page.history) ?? [],
    [historyQuery.data],
  );
  const history = useMemo(
    () => mergeHistory(databaseHistory, localHistory),
    [databaseHistory, localHistory],
  );

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      // Move cursor to the end of the text:
      // defer cursor placement to the next event loop cycle.
      // This helps prevent React from interfering with cursor placement.
      setTimeout(() => {
        inputRef.current?.setSelectionRange(word.length, word.length);
      }, 0);
    }
  }, [translation]);

  useEffect(() => {
    setShowSpecialChars(false);
  }, [currentSourceLanguage]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setWord(e.target.value);
  };

  const clearInput = () => {
    setWord("");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const insertSpecialChar = (char: string) => {
    setWord((prevWord) => prevWord + char);
    // Focus the input field after inserting the character
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  async function translate() {
    if (activeRequest.current || !word.trim()) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setError("");
    setTranslation(undefined);
    setPreview({ original: word, translation: "" });
    setIsLoading(true);
    let receivedResult = false;
    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          text: word,
          sourceLanguage: currentSourceLanguage,
          targetLanguage: currentTargetLanguage,
        }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || "Translation failed. Please try again.");
      }
      if (!response.body)
        throw new Error("Streaming is unavailable. Please try again.");
      for await (const value of readJsonLines(response.body)) {
        if (!value || typeof value !== "object")
          throw new Error("Invalid translation response.");
        const event = value as Record<string, unknown>;
        if (event.type === "preview" && !receivedResult) {
          setPreview({
            original:
              typeof event.original === "string" && event.original
                ? event.original
                : word,
            translation:
              typeof event.translation === "string" ? event.translation : "",
          });
        } else if (event.type === "result" && !receivedResult) {
          const entry = {
            ...TranslationResponseSchema.parse(event.response),
            sourceLang: getLanguageCode(currentSourceLanguage),
            targetLang: getLanguageCode(currentTargetLanguage),
          };
          receivedResult = true;
          setTranslation(entry);
          setPreview(undefined);
          saveToHistory(entry);
        } else if (event.type === "error") {
          throw new Error(
            typeof event.error === "string"
              ? event.error
              : "Translation failed.",
          );
        }
      }
      if (!receivedResult)
        throw new Error(
          "Connection interrupted. The translation is incomplete. Please try again.",
        );
    } catch (error) {
      if (!controller.signal.aborted && !receivedResult) {
        setError(
          error instanceof Error
            ? error.message
            : "Translation failed. Please try again.",
        );
      }
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setIsLoading(false);
      }
    }
  }

  const handleKeyUp = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && word.trim()) {
      await translate();
    }
  };

  // Save translation to localStorage and update state
  const saveToHistory = (entry: TranslationEntry) => {
    setLocalHistory((current) => {
      const updatedHistory = [
        {
          ...entry,
          localId: createLocalHistoryId(),
          isCurrentSession: true,
        },
        ...current,
      ].slice(0, 50);
      writeLocalHistory(updatedHistory);
      return updatedHistory;
    });
  };

  function loadHistoryItem(entry: TranslationEntry) {
    if (activeRequest.current) return;
    setPreview(undefined);
    setError("");
    try {
      // Validate if the entry matches the TranslationResponse schema
      const validEntry = TranslationResponseSchema.parse(entry);

      // If valid, set it as the translation
      setTranslation({
        ...validEntry,
        sourceLang: entry.sourceLang,
        targetLang: entry.targetLang,
      });
    } catch (error) {
      console.error("Invalid entry format:", error);
      alert(
        "The selected history item is not in the correct format and cannot be loaded.",
      );
    }
  }

  return (
    <div className={styles.container}>
      {showSpecialCharacterControls && (
        <div className={styles.specialCharsContainer}>
          <div
            className={styles.specialCharToggle}
            onClick={() => setShowSpecialChars(!showSpecialChars)}
          >
            {specialCharacters[0]}
          </div>
          <div
            className={`${styles.specialCharsWrapper} ${showSpecialChars ? styles.visible : ""}`}
          >
            {specialCharacters.map((char) => (
              <button
                key={char}
                className={styles.specialCharButton}
                onClick={() => insertSpecialChar(char)}
              >
                {char}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className={styles.searchBar}>
        <div className={styles.inputWrapper}>
          <input
            className={styles.input}
            ref={inputRef}
            type="text"
            value={word}
            onChange={handleInputChange}
            onKeyUp={handleKeyUp}
            placeholder={`Enter ${currentSourceLanguage} text...`}
            disabled={isLoading}
          />
          {word && !isLoading ? (
            <button
              type="button"
              className={styles.clearButton}
              onClick={clearInput}
              aria-label="Clear input"
              title="Clear input"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 7l10 10M17 7 7 17" />
              </svg>
            </button>
          ) : null}
        </div>
        <button
          className={styles.translateButton}
          onClick={translate}
          disabled={isLoading || !word.trim()}
        >
          {isLoading ? "Translating…" : "Translate"}
        </button>
      </div>
      <div className={styles.translation}>
        {preview && (
          <section
            className={styles.streamingCard}
            aria-label="Translation in progress"
            aria-busy={isLoading}
          >
            <div className={styles.streamStatus} role="status">
              {isLoading && (
                <span className={styles.statusDot} aria-hidden="true" />
              )}
              {error
                ? "Incomplete translation"
                : preview.translation
                  ? "Adding details & examples"
                  : "Preparing your translation"}
            </div>
            <h2 className={styles.streamOriginal}>{preview.original}</h2>
            <div className={styles.streamTranslation}>
              {preview.translation ||
                (isLoading && (
                  <span className={styles.skeleton} aria-hidden="true" />
                ))}
            </div>
            {isLoading && (
              <div className={styles.streamDetails} aria-hidden="true">
                <span className={styles.streamLabel}>
                  Language notes & examples
                </span>
                <span className={styles.skeleton} />
                <span
                  className={`${styles.skeleton} ${styles.shortSkeleton}`}
                />
              </div>
            )}
          </section>
        )}
        {error && (
          <div className={styles.streamError} role="alert">
            {error}
          </div>
        )}
        {translation && (
          <section
            className={`${styles.streamingCard} ${styles.completedCard}`}
            aria-label="Translation"
          >
            <StructuredResponseDisplay
              response={translation}
              sourceLang={translation.sourceLang}
              targetLang={translation.targetLang}
            />
          </section>
        )}
      </div>

      <div className={styles.history}>
        <h3>History</h3>
        {historyQuery.isPending && history.length === 0 ? (
          <p role="status">Loading history…</p>
        ) : historyQuery.isError && history.length === 0 ? (
          <div className={styles.historyError} role="alert">
            <span>Couldn’t load history.</span>
            <button type="button" onClick={() => void historyQuery.refetch()}>
              Retry
            </button>
          </div>
        ) : history.length === 0 ? (
          <p>No history available.</p>
        ) : (
          <>
            <HistoryList
              entries={history}
              disabled={isLoading}
              hasNextPage={historyQuery.hasNextPage}
              isFetchingNextPage={historyQuery.isFetchingNextPage}
              isFetchNextPageError={historyQuery.isFetchNextPageError}
              reachedEnd={
                historyQuery.isSuccess &&
                !historyQuery.hasNextPage &&
                !historyQuery.isFetchNextPageError
              }
              onLoadMore={historyQuery.fetchNextPage}
              onRetry={historyQuery.fetchNextPage}
              onSelect={loadHistoryItem}
            />
            {historyQuery.isError && !historyQuery.isFetchNextPageError && (
              <div className={styles.historyError} role="alert">
                <span>Couldn’t refresh all history.</span>
                <button
                  type="button"
                  onClick={() => void historyQuery.refetch()}
                >
                  Retry
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
