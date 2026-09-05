"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
};

const HISTORY_LABEL_LIMIT = 100;

function getHistoryLabel(entry: TranslationEntry) {
  const label = `${entry.original} - ${entry.translation}`;

  return label.length > HISTORY_LABEL_LIMIT
    ? `${label.slice(0, HISTORY_LABEL_LIMIT).trimEnd()}...`
    : label;
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

  const queryClient = useQueryClient();
  const [word, setWord] = useState("");
  const [translation, setTranslation] = useState<TranslationEntry>();
  const [history, setHistory] = useState<TranslationEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [preview, setPreview] = useState<{
    original: string;
    translation: string;
  }>();
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => () => activeRequest.current?.abort(), []);
  const [error, setError] = useState("");
  const [showSpecialChars, setShowSpecialChars] = useState(false);

  const historyQueryKey = ["translationHistory"] as const;

  const inputRef = useRef<HTMLInputElement>(null);

  async function fetchHistoryFromDB(): Promise<TranslationEntry[]> {
    const response = await fetch("/api/history/list");
    if (!response.ok) {
      throw new Error("Failed to fetch history");
    }
    const data = await response.json();
    return data.history.map(
      (item: {
        responseJson: TranslationResponse;
        sourceLang: string;
        targetLang: string;
      }) => ({
        ...item.responseJson,
        sourceLang: isSourceLanguage(item.sourceLang)
          ? getLanguageCode(item.sourceLang)
          : item.sourceLang,
        targetLang: item.targetLang,
      }),
    );
  }

  const historyQuery = useQuery({
    queryKey: historyQueryKey,
    queryFn: fetchHistoryFromDB,
  });

  // todo restructure components to have this rerender less often
  // Load saved history from localStorage on initial load
  useEffect(() => {
    async function initializeHistory() {
      // 2. Load from localStorage immediately (fast)
      const savedHistory = localStorage.getItem("translationHistory");
      const localHistory = savedHistory ? JSON.parse(savedHistory) : [];
      setHistory(localHistory);
    }

    initializeHistory();
  }, []);

  useEffect(() => {
    if (!historyQuery.data) {
      return;
    }

    const savedHistory = localStorage.getItem("translationHistory");
    const localHistory = savedHistory ? JSON.parse(savedHistory) : [];

    let combinedHistory = [...historyQuery.data];

    if (combinedHistory.length < 50) {
      const dbOriginals = new Set(
        historyQuery.data.map((item) => item.original),
      );
      const uniqueLocalHistory = localHistory.filter(
        (item: TranslationResponse) => !dbOriginals.has(item.original),
      );

      const remainingSpace = 50 - combinedHistory.length;
      combinedHistory = [
        ...combinedHistory,
        ...uniqueLocalHistory.slice(0, remainingSpace),
      ];
    }

    setHistory(combinedHistory);
  }, [historyQuery.data]);

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
    const updatedHistory = [entry, ...history];
    if (updatedHistory.length > 50) {
      updatedHistory.pop();
    }
    setHistory(updatedHistory);
    localStorage.setItem("translationHistory", JSON.stringify(updatedHistory));
    queryClient.setQueryData(
      historyQueryKey,
      (current: TranslationResponse[] | undefined) => {
        const next = [entry, ...(current ?? [])];
        return next.slice(0, 50);
      },
    );
  };

  // Clear the browser history
  const clearHistory = () => {
    // TODO implement
    localStorage.removeItem("translationHistory");
    setHistory([]);
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
        <h3>Translation History (last 50)</h3>
        {history.length === 0 ? (
          <p>No history available.</p>
        ) : (
          <ul>
            {history.map((entry, index) => (
              <li key={index}>
                <button
                  className={styles.loadFromHistoryButton}
                  disabled={isLoading}
                  onClick={() => loadHistoryItem(entry)}
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
            ))}
          </ul>
        )}
      </div>
      {/*{history.length > 0 && (*/}
      {/*  <button onClick={clearHistory} className={styles.clearHistoryButton}>*/}
      {/*    Clear History*/}
      {/*  </button>*/}
      {/*)}*/}
    </div>
  );
}
