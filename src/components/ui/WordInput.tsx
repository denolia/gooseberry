"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./WordInput.module.css";
import { StructuredResponseDisplay } from "@/components/ui/StructuredResponseDisplay";
import { TranslationResponse } from "@/app/utils/translationSchema";

export function WordInput() {
  const [word, setWord] = useState("");
  const [translation, setTranslation] = useState();
  const [history, setHistory] = useState<TranslationResponse[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // todo restructure components to have this rerender less often
  // Load saved history from localStorage on initial load
  useEffect(() => {
    const savedHistory = localStorage.getItem("translationHistory");
    if (savedHistory) {
      setHistory(JSON.parse(savedHistory));
    }
  }, []);

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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setWord(e.target.value);
  };

  async function translate() {
    setIsLoading(true);
    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: word }),
      });

      const translation = await response.json();
      if (translation) {
        setTranslation(translation);
        saveToHistory(translation);
      }
    } catch (error) {
      console.error("Translation error:", error);
    } finally {
      setIsLoading(false);
    }
  }

  const handleKeyUp = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && word.trim()) {
      await translate();
    }
  };

  // Save translation to localStorage and update state
  const saveToHistory = (entry: TranslationResponse) => {
    const updatedHistory = [entry, ...history];
    if (updatedHistory.length > 50) {
      updatedHistory.pop();
    }
    setHistory(updatedHistory);
    localStorage.setItem("translationHistory", JSON.stringify(updatedHistory));
  };

  // Clear the browser history
  const clearHistory = () => {
    localStorage.removeItem("translationHistory");
    setHistory([]);
  };

  return (
    <div className={styles.container}>
      <div className={styles.searchBar}>
        <input
          className={styles.input}
          ref={inputRef}
          type="text"
          value={word}
          onChange={handleInputChange}
          onKeyUp={handleKeyUp}
          placeholder="Enter a German word..."
          disabled={isLoading}
        />
        <button
          className={styles.translateButton}
          onClick={translate}
          disabled={isLoading}
        >
          Translate
        </button>
      </div>
      <div className={styles.translation}>
        {isLoading && <div>Translating...</div>}
        {translation && <StructuredResponseDisplay response={translation} />}
      </div>
      <div className={styles.history}>
        <h3>Translation History (last 50)</h3>
        {history.length === 0 ? (
          <p>No history available.</p>
        ) : (
          <ul>
            {history.map((entry, index) => (
              <li key={index}>
                <div>
                  {entry.original} - {entry.translation}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {history.length > 0 && (
        <button onClick={clearHistory} className={styles.clearHistoryButton}>
          Clear History
        </button>
      )}
    </div>
  );
}
