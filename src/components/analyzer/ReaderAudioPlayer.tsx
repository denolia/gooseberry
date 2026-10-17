"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SourceLanguageSelectOptions } from "@/components/ui/Languages";
import {
  DEFAULT_READER_SPEED,
  DEFAULT_READER_VOICE,
  READER_SPEEDS,
  READER_VOICES,
  isReaderSpeed,
  isReaderVoice,
  type ReaderSpeed,
  type ReaderVoice,
  type ReaderVoiceStyle,
} from "@/lib/audio/readerConfig";
import { splitReaderText } from "@/lib/audio/readerText";
import styles from "./ReaderAudioPlayer.module.css";

const SETTINGS_KEY = "readerAudioSettings:v1";
const SENTENCE_PAUSE_MS = 700;

type VoiceOption = (typeof READER_VOICES)[number];
type Settings = {
  voice: ReaderVoice;
  speed: ReaderSpeed;
  style: ReaderVoiceStyle | "all";
};
type Status =
  "idle" | "loading" | "playing" | "paused" | "gap" | "complete" | "error";
type Playback = {
  generation: number;
  attempt: number;
  chunks: string[];
  urls: Map<number, string>;
  index: number;
  wantsPlay: boolean;
  status: Status;
  request: AbortController | null;
  gapTimer: ReturnType<typeof setTimeout> | null;
  gapDeadline: number;
  gapRemaining: number;
  voice: ReaderVoice;
  speed: ReaderSpeed;
  language: string;
};

const DEFAULT_SETTINGS: Settings = {
  voice: DEFAULT_READER_VOICE,
  speed: DEFAULT_READER_SPEED,
  style: "all",
};

function isVoiceStyle(value: unknown): value is Settings["style"] {
  return (
    value === "all" ||
    value === "feminine" ||
    value === "masculine" ||
    value === "neutral"
  );
}

function cancelGap(playback: Playback) {
  if (playback.gapTimer !== null) clearTimeout(playback.gapTimer);
  playback.gapTimer = null;
}

export function ReaderAudioPlayer({
  text,
  sourceLanguage,
  hasPremium,
}: {
  text: string;
  sourceLanguage: string;
  hasPremium: boolean;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [part, setPart] = useState(0);
  const [partCount, setPartCount] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [configStatus, setConfigStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [configError, setConfigError] = useState("");
  const [configRetry, setConfigRetry] = useState(0);
  const settingsRef = useRef(settings);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mountedRef = useRef(true);
  const previousInputRef = useRef({ text, sourceLanguage, hasPremium });
  const playbackRef = useRef<Playback>({
    generation: 0,
    attempt: 0,
    chunks: [],
    urls: new Map(),
    index: 0,
    wantsPlay: false,
    status: "idle",
    request: null,
    gapTimer: null,
    gapDeadline: 0,
    gapRemaining: 0,
    voice: DEFAULT_READER_VOICE,
    speed: DEFAULT_READER_SPEED,
    language: sourceLanguage,
  });

  const updateStatus = useCallback((next: Status) => {
    playbackRef.current.status = next;
    if (mountedRef.current) setStatus(next);
  }, []);

  // Keep one media element for every part and replay, including on mobile.
  const clearPlayback = useCallback(
    (discardCache: boolean, updateUi = true) => {
      const playback = playbackRef.current;
      playback.generation++;
      playback.attempt++;
      playback.wantsPlay = false;
      playback.request?.abort();
      playback.request = null;
      cancelGap(playback);
      playback.gapRemaining = 0;
      playback.index = 0;
      const audio = audioRef.current;
      if (audio) {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      if (discardCache) {
        for (const url of playback.urls.values()) URL.revokeObjectURL(url);
        playback.urls.clear();
        playback.chunks = [];
      }
      playback.status = "idle";
      if (updateUi && mountedRef.current) {
        setStatus("idle");
        setPart(0);
        if (discardCache) setPartCount(0);
        setError("");
      }
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    async function restoreSettings() {
      // Restore after hydration so server and first client render agree.
      await Promise.resolve();
      if (cancelled) return;
      try {
        const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
        if (stored?.version === 1) {
          const restored: Settings = {
            voice: isReaderVoice(stored.voice)
              ? stored.voice
              : DEFAULT_READER_VOICE,
            speed: isReaderSpeed(stored.speed)
              ? stored.speed
              : DEFAULT_READER_SPEED,
            style: isVoiceStyle(stored.style) ? stored.style : "all",
          };
          settingsRef.current = restored;
          setSettings(restored);
        }
      } catch {
        // Storage can be unavailable in private browsing; playback still works.
      }
      setSettingsLoaded(true);
    }
    void restoreSettings();
    return () => {
      cancelled = true;
      mountedRef.current = false;
      clearPlayback(true, false);
    };
  }, [clearPlayback]);

  useEffect(() => {
    if (!settingsLoaded) return;
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ version: 1, ...settings }),
      );
    } catch {
      // Save preferences only; never persist the text or generated audio.
    }
  }, [settings, settingsLoaded]);

  useEffect(() => {
    const previous = previousInputRef.current;
    previousInputRef.current = { text, sourceLanguage, hasPremium };
    if (
      previous.text === text &&
      previous.sourceLanguage === sourceLanguage &&
      previous.hasPremium === hasPremium
    )
      return;
    const hadPlayback = playbackRef.current.chunks.length > 0;
    clearPlayback(true);
    setNotice(
      hadPlayback
        ? "Playback reset after the text, language, or account changed."
        : "",
    );
  }, [text, sourceLanguage, hasPremium, clearPlayback]);

  useEffect(() => {
    if (!hasPremium) return;
    const request = new AbortController();
    async function loadVoices() {
      await Promise.resolve();
      if (request.signal.aborted) return;
      setConfigStatus("loading");
      setConfigError("");
      try {
        const response = await fetch("/api/speech/reader", {
          signal: request.signal,
        });
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error || "Could not load available voices.");
        const ids = new Set(
          Array.isArray(body.voices)
            ? body.voices.map((voice: { id?: unknown }) => voice?.id)
            : [],
        );
        const available = READER_VOICES.filter((voice) => ids.has(voice.id));
        if (!available.length)
          throw new Error("No reading voices are available. Please try again.");
        if (request.signal.aborted) return;
        setVoices(available);
        const current = settingsRef.current;
        let style = current.style;
        let matching = available.filter(
          (voice) => style === "all" || voice.style === style,
        );
        if (!matching.length) {
          style = "all";
          matching = available;
        }
        const voice =
          matching.find((voice) => voice.id === current.voice) ??
          matching.find((voice) => voice.id === body.defaultVoice) ??
          matching[0];
        const next = { ...current, voice: voice.id, style };
        settingsRef.current = next;
        setSettings(next);
        setConfigStatus("ready");
      } catch (reason) {
        if (request.signal.aborted) return;
        setConfigStatus("error");
        setConfigError(
          reason instanceof Error
            ? reason.message
            : "Could not load available voices.",
        );
      }
    }
    void loadVoices();
    return () => request.abort();
  }, [hasPremium, configRetry]);

  function getAudio() {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = "auto";
    }
    return audioRef.current;
  }

  function isCurrent(generation: number, index: number) {
    const playback = playbackRef.current;
    return (
      mountedRef.current &&
      playback.generation === generation &&
      playback.index === index
    );
  }

  function waitBetweenParts(generation: number) {
    const playback = playbackRef.current;
    cancelGap(playback);
    updateStatus("gap");
    playback.gapDeadline = Date.now() + playback.gapRemaining;
    playback.gapTimer = setTimeout(() => {
      playback.gapTimer = null;
      playback.gapRemaining = 0;
      if (playback.generation === generation && playback.wantsPlay)
        void playPart(generation);
    }, playback.gapRemaining);
  }

  async function startAudio(url: string, generation: number, index: number) {
    const playback = playbackRef.current;
    if (!isCurrent(generation, index) || !playback.wantsPlay) return;
    const audio = getAudio();
    const attempt = ++playback.attempt;
    if (audio.src !== url) audio.src = url;
    audio.onended = () => {
      if (!isCurrent(generation, index)) return;
      playback.index++;
      if (playback.index >= playback.chunks.length) {
        playback.wantsPlay = false;
        updateStatus("complete");
        return;
      }
      setPart(playback.index + 1);
      playback.gapRemaining =
        playback.speed === "normal-pauses" ? SENTENCE_PAUSE_MS : 0;
      if (!playback.wantsPlay) updateStatus("paused");
      else if (playback.gapRemaining) waitBetweenParts(generation);
      else void playPart(generation);
    };
    audio.onerror = () => {
      if (!isCurrent(generation, index)) return;
      playback.attempt++;
      playback.wantsPlay = false;
      audio.pause();
      audio.onended = null;
      audio.onerror = null;
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
      playback.urls.delete(index);
      setError("Could not play this part. Press Retry playback to try again.");
      updateStatus("error");
    };
    updateStatus("playing");
    try {
      await audio.play();
    } catch (reason) {
      if (
        !isCurrent(generation, index) ||
        playback.attempt !== attempt ||
        !playback.wantsPlay
      )
        return;
      playback.wantsPlay = false;
      audio.pause();
      if (reason instanceof DOMException && reason.name === "NotAllowedError") {
        setError("Playback needs a tap. Press Resume to continue.");
        updateStatus("paused");
      } else {
        setError(
          "Could not start playback. Press Retry playback to try again.",
        );
        updateStatus("error");
      }
    }
  }

  async function playPart(generation: number) {
    const playback = playbackRef.current;
    const index = playback.index;
    if (!isCurrent(generation, index) || !playback.wantsPlay) return;
    const cached = playback.urls.get(index);
    if (cached) {
      await startAudio(cached, generation, index);
      return;
    }
    if (playback.request) {
      updateStatus("loading");
      return;
    }
    const request = new AbortController();
    playback.request = request;
    updateStatus("loading");
    try {
      const response = await fetch("/api/speech/reader", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: playback.chunks[index],
          sourceLanguage: playback.language,
          voice: playback.voice,
          speed: playback.speed,
        }),
        signal: request.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          body.error || "Could not generate audio. Please try again.",
        );
      }
      const blob = await response.blob();
      if (request.signal.aborted || !isCurrent(generation, index)) return;
      const url = URL.createObjectURL(blob);
      playback.urls.set(index, url);
      if (playback.request === request) playback.request = null;
      if (playback.wantsPlay) await startAudio(url, generation, index);
      else updateStatus("paused");
    } catch (reason) {
      if (request.signal.aborted || !isCurrent(generation, index)) return;
      playback.wantsPlay = false;
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not generate audio. Please try again.",
      );
      updateStatus("error");
    } finally {
      if (playback.request === request) playback.request = null;
    }
  }

  function pause() {
    const playback = playbackRef.current;
    playback.wantsPlay = false;
    playback.attempt++;
    audioRef.current?.pause();
    if (playback.gapTimer !== null) {
      playback.gapRemaining = Math.max(0, playback.gapDeadline - Date.now());
      cancelGap(playback);
    }
    updateStatus("paused");
  }

  async function listen() {
    if (
      !hasPremium ||
      !settingsLoaded ||
      configStatus !== "ready" ||
      !text.trim() ||
      !sourceLanguage
    )
      return;
    const playback = playbackRef.current;
    if (playback.wantsPlay) {
      pause();
      return;
    }
    setError("");
    setNotice("");
    getAudio();
    if (playback.status === "complete") clearPlayback(false);
    if (!playback.chunks.length) {
      try {
        const language =
          SourceLanguageSelectOptions.find(
            (option) => option.label === sourceLanguage,
          )?.value ?? sourceLanguage;
        playback.chunks = splitReaderText(text, language, settings.speed);
        playback.voice = settings.voice;
        playback.speed = settings.speed;
        playback.language = sourceLanguage;
        setPartCount(playback.chunks.length);
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "This text cannot be read.",
        );
        updateStatus("error");
        return;
      }
    }
    if (!playback.chunks.length) return;
    playback.wantsPlay = true;
    setPart(playback.index + 1);
    if (playback.gapRemaining > 0) waitBetweenParts(playback.generation);
    else await playPart(playback.generation);
  }

  function changeSettings(next: Settings, message: string) {
    clearPlayback(true);
    settingsRef.current = next;
    setSettings(next);
    setNotice(`${message} Playback reset; press Listen to full text to start.`);
  }

  const languageName =
    SourceLanguageSelectOptions.find(
      (option) => option.value === sourceLanguage,
    )?.label ?? sourceLanguage;
  const filteredVoices = voices.filter(
    (voice) => settings.style === "all" || voice.style === settings.style,
  );
  const active =
    status === "loading" || status === "playing" || status === "gap";
  const mainLabel = active
    ? "Pause"
    : status === "paused"
      ? "Resume"
      : status === "complete"
        ? "Listen again"
        : status === "error"
          ? "Retry playback"
          : "Listen to full text";
  const progress =
    status === "complete"
      ? "Finished reading"
      : partCount > 0 && status !== "idle"
        ? `Part ${part} of ${partCount}${status === "loading" ? " · Generating audio…" : status === "gap" ? " · Sentence pause" : status === "paused" ? " · Paused" : ""}`
        : "";

  return (
    <section className={styles.player} aria-label="Read full text aloud">
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.listenButton}
          onClick={listen}
          disabled={
            !hasPremium ||
            !text.trim() ||
            !sourceLanguage ||
            !settingsLoaded ||
            configStatus !== "ready"
          }
          aria-label={active ? "Pause reading" : mainLabel}
        >
          <span aria-hidden="true">{active ? "Ⅱ" : "▶"}</span>
          {hasPremium ? mainLabel : "Listen to full text"}
        </button>
        {hasPremium && status !== "idle" && status !== "complete" && (
          <button
            type="button"
            className={styles.stopButton}
            onClick={() => {
              clearPlayback(false);
              setNotice(
                "Playback stopped. Press Listen to full text to restart.",
              );
            }}
          >
            Stop
          </button>
        )}
        <span className={styles.disclosure}>
          AI-generated voice · {languageName || "Source language"}
        </span>
      </div>

      {!hasPremium ? (
        <p className={styles.premiumNotice}>
          Full-text audio and voice settings are available with Premium.{" "}
          <Link href="/profile">View Premium</Link>
        </p>
      ) : (
        <>
          <p className={styles.progress} role="status" aria-live="polite">
            {notice ||
              progress ||
              (configStatus === "loading" ? "Loading available voices…" : "")}
          </p>
          {configError && (
            <p className={styles.error} role="alert">
              {configError}{" "}
              <button
                type="button"
                className={styles.retryButton}
                onClick={() => setConfigRetry((value) => value + 1)}
              >
                Retry voices
              </button>
            </p>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <details className={styles.settings}>
            <summary>Voice settings</summary>
            <div className={styles.settingsGrid}>
              <label>
                Reading speed
                <select
                  value={settings.speed}
                  onChange={(event) => {
                    const speed = event.target.value;
                    if (isReaderSpeed(speed))
                      changeSettings(
                        { ...settings, speed },
                        "Reading speed changed.",
                      );
                  }}
                >
                  {READER_SPEEDS.map((speed) => (
                    <option key={speed.id} value={speed.id}>
                      {speed.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Voice tone
                <select
                  value={settings.style}
                  disabled={configStatus !== "ready"}
                  onChange={(event) => {
                    const style = event.target.value;
                    if (!isVoiceStyle(style)) return;
                    const matching = voices.filter(
                      (voice) => style === "all" || voice.style === style,
                    );
                    const voice =
                      matching.find((voice) => voice.id === settings.voice) ??
                      matching[0];
                    if (voice)
                      changeSettings(
                        { ...settings, style, voice: voice.id },
                        "Voice tone changed.",
                      );
                  }}
                >
                  <option value="all">All tones</option>
                  <option
                    value="feminine"
                    disabled={
                      !voices.some((voice) => voice.style === "feminine")
                    }
                  >
                    Feminine
                  </option>
                  <option
                    value="masculine"
                    disabled={
                      !voices.some((voice) => voice.style === "masculine")
                    }
                  >
                    Masculine
                  </option>
                  <option
                    value="neutral"
                    disabled={
                      !voices.some((voice) => voice.style === "neutral")
                    }
                  >
                    Neutral
                  </option>
                </select>
              </label>
              <label>
                Voice name
                <select
                  value={settings.voice}
                  disabled={configStatus !== "ready"}
                  onChange={(event) => {
                    const voice = event.target.value;
                    if (
                      isReaderVoice(voice) &&
                      filteredVoices.some((option) => option.id === voice)
                    )
                      changeSettings({ ...settings, voice }, "Voice changed.");
                  }}
                >
                  {!filteredVoices.length && (
                    <option value={settings.voice}>Loading voices…</option>
                  )}
                  {filteredVoices.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className={styles.settingsHint}>
              Tone labels describe approximate perceived sound. Names are
              provided by the voice API. Changing a setting restarts playback.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
