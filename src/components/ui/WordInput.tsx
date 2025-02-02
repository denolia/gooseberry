"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./WordInput.module.css";
import ReactMarkdown from "react-markdown";
import { signIn, signOut, useSession } from "next-auth/react";

export function WordInput() {
  const { data: session } = useSession();

  const [word, setWord] = useState("");
  const [translation, setTranslation] = useState();
  const [isLoading, setIsLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

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

      const data = await response.json();

      const translation = data["translation"];
      if (translation) {
        setTranslation(translation);
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

  if (!session)
    return (
      <div>
        <h1>Please sign in</h1>
        <button onClick={() => signIn("google")}>Sign in with Google</button>
      </div>
    );

  return (
    <div className={styles.container}>
      <div className={styles.searchBar}>
        <div>
          <h1>Welcome, {session.user?.name}</h1>
          <button onClick={() => signOut()}>Sign out</button>
        </div>

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
        <button onClick={translate} disabled={isLoading}>
          Translate
        </button>
      </div>
      <div className={styles.translation}>
        {isLoading && <div>Translating...</div>}

        {translation && <ReactMarkdown>{translation}</ReactMarkdown>}
      </div>
    </div>
  );
}
