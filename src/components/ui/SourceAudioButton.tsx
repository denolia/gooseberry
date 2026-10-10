"use client";

import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import styles from "./SourceAudioButton.module.css";

export function SourceAudioButton({
  text,
  sourceLanguage,
  shortcut,
  ref,
}: {
  text: string;
  sourceLanguage?: string;
  shortcut?: string;
  ref?: Ref<HTMLButtonElement>;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "playing">("idle");
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const releaseAudio = useCallback(({ keepUrl = false } = {}) => {
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
    }
    if (!keepUrl) {
      const url = audioUrlRef.current;
      audioUrlRef.current = null;
      if (url) URL.revokeObjectURL(url);
    }
  }, []);

  useEffect(
    () => () => {
      requestRef.current?.abort();
      releaseAudio();
    },
    [releaseAudio],
  );

  async function play() {
    if (status === "loading" || !sourceLanguage) return;
    setError("");
    const request = new AbortController();
    requestRef.current = request;
    let audio: HTMLAudioElement | null = null;

    try {
      let url = audioUrlRef.current;
      if (!url) {
        setStatus("loading");
        const response = await fetch("/api/speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, sourceLanguage }),
          signal: request.signal,
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error || "Could not load pronunciation");
        }

        const blob = await response.blob();
        if (request.signal.aborted) {
          if (requestRef.current === request) setStatus("idle");
          return;
        }
        url = URL.createObjectURL(blob);
        audioUrlRef.current = url;
      }

      audioRef.current?.pause();
      audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        if (audioRef.current === audio) setStatus("idle");
      };
      audio.onerror = () => {
        if (audioRef.current === audio) {
          releaseAudio();
          setStatus("idle");
          setError("Could not play pronunciation");
        }
      };

      setStatus("playing");
      await audio.play();
    } catch (reason) {
      if (requestRef.current !== request) return;
      if (request.signal.aborted) {
        setStatus("idle");
        return;
      }
      if (audio && audioRef.current !== audio) return;
      releaseAudio({ keepUrl: audio !== null && !audio.error });
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
        ref={ref}
        type="button"
        className={styles.audioButton}
        onClick={play}
        disabled={!sourceLanguage || status === "loading"}
        aria-keyshortcuts={shortcut}
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
        {shortcut && <kbd className={styles.shortcut}>{shortcut}</kbd>}
      </button>
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
