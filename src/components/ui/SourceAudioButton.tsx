"use client";
import type { UiMessage } from "@/i18n/messages";
import { messageFromError, errorFromResponse } from "@/i18n/errors";

import { useI18n } from "@/i18n/client";

import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import styles from "./SourceAudioButton.module.css";

export function SourceAudioButton({
  text,
  sourceLanguage,
  shortcut,
  className,
  ref,
}: {
  text: string;
  sourceLanguage?: string;
  shortcut?: string;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<"idle" | "loading" | "playing">("idle");
  const [error, setError] = useState<UiMessage | null>(null);
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
    setError(null);
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
            errorCode?: string;
          };
          throw errorFromResponse(body, "errors.couldNotLoadPronunciation");
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
          setError({ key: "errors.couldNotPlayPronunciation" });
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
      setError(messageFromError(reason, "errors.couldNotPlayPronunciation"));
    }
  }

  return (
    <div className={`${styles.audioControl} ${className ?? ""}`}>
      <button
        ref={ref}
        type="button"
        className={styles.audioButton}
        onClick={play}
        disabled={!sourceLanguage || status === "loading"}
        aria-keyshortcuts={shortcut}
        aria-label={
          status === "loading"
            ? t("sourceAudioButton.generatingAiPronunciation")
            : status === "playing"
              ? t("sourceAudioButton.listenToAiPronunciationAgain")
              : t("sourceAudioButton.listenToAiPronunciation")
        }
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 9v6h4l5 4V5L9 9H5Z" />
          <path
            d="M17 9.5a4 4 0 0 1 0 5M19.5 7a7.5 7.5 0 0 1 0 10"
            fill="none"
          />
        </svg>
        <span>
          {status === "loading"
            ? t("enrichmentDialog.generating")
            : t("textAnalyzer.listen")}
        </span>
        {shortcut && <kbd className={styles.shortcut}>{shortcut}</kbd>}
      </button>
      {error && (
        <span className={styles.error} role="alert">
          {t(error.key, error.values)}
        </span>
      )}
    </div>
  );
}
