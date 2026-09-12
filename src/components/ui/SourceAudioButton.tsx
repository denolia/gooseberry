"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./SourceAudioButton.module.css";

export function SourceAudioButton({
  text,
  sourceLanguage,
}: {
  text: string;
  sourceLanguage?: string;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "playing">(
    "idle",
  );
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    },
    [],
  );

  async function play() {
    if (status === "loading" || !sourceLanguage) return;
    setError("");

    try {
      let audio = audioRef.current;
      if (!audio) {
        setStatus("loading");
        const response = await fetch("/api/speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, sourceLanguage }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error || "Could not load pronunciation");
        }

        const url = URL.createObjectURL(await response.blob());
        audioUrlRef.current = url;
        audio = new Audio(url);
        audio.onended = () => setStatus("idle");
        audio.onerror = () => {
          setStatus("idle");
          setError("Could not play pronunciation");
        };
        audioRef.current = audio;
      }

      audio.currentTime = 0;
      await audio.play();
      setStatus("playing");
    } catch (reason) {
      setStatus("idle");
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not play pronunciation",
      );
    }
  }

  return (
    <div className={styles.audioControl}>
      <button
        type="button"
        className={styles.audioButton}
        onClick={play}
        disabled={!sourceLanguage || status === "loading"}
        aria-label={
          status === "loading"
            ? "Generating AI pronunciation"
            : status === "playing"
              ? "Replay AI pronunciation"
              : "Play AI pronunciation"
        }
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 9v6h4l5 4V5L9 9H5Z" />
          <path
            d="M17 9.5a4 4 0 0 1 0 5M19.5 7a7.5 7.5 0 0 1 0 10"
            fill="none"
          />
        </svg>
        <span>{status === "loading" ? "Generating…" : "AI voice"}</span>
      </button>
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
