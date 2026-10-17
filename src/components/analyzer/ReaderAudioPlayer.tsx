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
import {
  getReaderSpeechChunks,
  type ReaderSpeechChunk,
  type ReaderTextRange,
} from "@/lib/audio/readerText";
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
type AudioRequest = {
  controller: AbortController;
  promise: Promise<string>;
};
type Playback = {
  generation: number;
  attempt: number;
  foregroundAttempt: number;
  chunks: ReaderSpeechChunk[];
  urls: Map<number, string>;
  index: number;
  wantsPlay: boolean;
  status: Status;
  requests: Map<number, AudioRequest>;
  requestErrors: Map<number, Error>;
  prefetchIndex: number | null;
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
  onReadingRangeChange,
  onPlaybackActiveChange,
}: {
  text: string;
  sourceLanguage: string;
  hasPremium: boolean;
  onReadingRangeChange?: (range: ReaderTextRange | null) => void;
  onPlaybackActiveChange?: (active: boolean) => void;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [part, setPart] = useState(0);
  const [partCount, setPartCount] = useState(0);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [configStatus, setConfigStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [configError, setConfigError] = useState("");
  const [configRetry, setConfigRetry] = useState(0);
  const [controlsAboveViewport, setControlsAboveViewport] = useState(false);
  const settingsRef = useRef(settings);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);
  const readingCallbackRef = useRef(onReadingRangeChange);
  const readingRangeRef = useRef<ReaderTextRange | null>(null);
  const activeCallbackRef = useRef(onPlaybackActiveChange);
  const playbackActiveRef = useRef(false);
  const previousInputRef = useRef({ text, sourceLanguage, hasPremium });
  const playbackRef = useRef<Playback>({
    generation: 0,
    attempt: 0,
    foregroundAttempt: 0,
    chunks: [],
    urls: new Map(),
    index: 0,
    wantsPlay: false,
    status: "idle",
    requests: new Map(),
    requestErrors: new Map(),
    prefetchIndex: null,
    gapTimer: null,
    gapDeadline: 0,
    gapRemaining: 0,
    voice: DEFAULT_READER_VOICE,
    speed: DEFAULT_READER_SPEED,
    language: sourceLanguage,
  });

  const updatePlaybackActive = useCallback((active: boolean) => {
    if (playbackActiveRef.current === active) return;
    playbackActiveRef.current = active;
    activeCallbackRef.current?.(active);
  }, []);

  const updateStatus = useCallback(
    (next: Status) => {
      playbackRef.current.status = next;
      if (next !== "playing") updatePlaybackActive(false);
      if (mountedRef.current) setStatus(next);
    },
    [updatePlaybackActive],
  );

  useEffect(() => {
    readingCallbackRef.current = onReadingRangeChange;
  }, [onReadingRangeChange]);

  useEffect(() => {
    activeCallbackRef.current = onPlaybackActiveChange;
  }, [onPlaybackActiveChange]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!hasPremium || !controls || typeof window === "undefined") return;
    let frame: number | null = null;
    let disposed = false;
    const viewport = window.visualViewport;
    const measure = () => {
      frame = null;
      if (disposed) return;
      setControlsAboveViewport(
        controls.getBoundingClientRect().bottom <=
          (viewport?.offsetTop ?? 0) + 8,
      );
    };
    const scheduleMeasure = () => {
      if (frame === null) frame = window.requestAnimationFrame(measure);
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(scheduleMeasure, {
            threshold: [0, 1],
            rootMargin: "-8px 0px 0px 0px",
          });
    observer?.observe(controls);
    window.addEventListener("scroll", scheduleMeasure, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", scheduleMeasure);
    viewport?.addEventListener("scroll", scheduleMeasure, { passive: true });
    viewport?.addEventListener("resize", scheduleMeasure);
    scheduleMeasure();
    return () => {
      disposed = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("scroll", scheduleMeasure, true);
      window.removeEventListener("resize", scheduleMeasure);
      viewport?.removeEventListener("scroll", scheduleMeasure);
      viewport?.removeEventListener("resize", scheduleMeasure);
    };
  }, [hasPremium]);

  const updateReadingRange = useCallback((range: ReaderTextRange | null) => {
    const previous = readingRangeRef.current;
    if (previous?.start === range?.start && previous?.end === range?.end)
      return;
    readingRangeRef.current = range;
    readingCallbackRef.current?.(range);
  }, []);

  // Keep one media element for every part and replay, including on mobile.
  const clearPlayback = useCallback(
    (discardCache: boolean, updateUi = true) => {
      const playback = playbackRef.current;
      playback.generation++;
      playback.attempt++;
      playback.foregroundAttempt++;
      playback.wantsPlay = false;
      for (const request of playback.requests.values())
        request.controller.abort();
      playback.requests.clear();
      playback.requestErrors.clear();
      playback.prefetchIndex = null;
      cancelGap(playback);
      playback.gapRemaining = 0;
      playback.index = 0;
      updatePlaybackActive(false);
      updateReadingRange(null);
      const audio = audioRef.current;
      if (audio) {
        audio.onended = null;
        audio.onerror = null;
        audio.onplaying = null;
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
    [updateReadingRange, updatePlaybackActive],
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
    clearPlayback(true);
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
    const reportPlaying = () => {
      if (
        !isCurrent(generation, index) ||
        playback.attempt !== attempt ||
        !playback.wantsPlay
      )
        return;
      const chunk = playback.chunks[index];
      updatePlaybackActive(true);
      updateReadingRange({
        start: chunk.sentenceStart,
        end: chunk.sentenceEnd,
      });
      prefetchNextPart(generation, index);
    };
    audio.onplaying = reportPlaying;
    audio.onended = () => {
      if (!isCurrent(generation, index)) return;
      updatePlaybackActive(false);
      updateReadingRange(null);
      playback.index++;
      if (playback.index >= playback.chunks.length) {
        playback.wantsPlay = false;
        updateStatus("complete");
        return;
      }
      setPart(playback.index + 1);
      playback.gapRemaining =
        playback.speed === "normal-pauses" &&
        playback.chunks[playback.index].sentenceIndex !==
          playback.chunks[index].sentenceIndex
          ? SENTENCE_PAUSE_MS
          : 0;
      if (!playback.wantsPlay) updateStatus("paused");
      else if (playback.gapRemaining) waitBetweenParts(generation);
      else void playPart(generation);
    };
    audio.onerror = () => {
      if (!isCurrent(generation, index)) return;
      playback.attempt++;
      playback.wantsPlay = false;
      abortPrefetch();
      updateReadingRange(null);
      audio.pause();
      audio.onended = null;
      audio.onerror = null;
      audio.onplaying = null;
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
      playback.urls.delete(index);
      setError("Could not play this part. Press Retry to try again.");
      updateStatus("error");
    };
    updateStatus("playing");
    try {
      await audio.play();
      // The play promise resolves after media starts, even if an event was missed.
      reportPlaying();
    } catch (reason) {
      if (
        !isCurrent(generation, index) ||
        playback.attempt !== attempt ||
        !playback.wantsPlay
      )
        return;
      playback.wantsPlay = false;
      abortPrefetch();
      updateReadingRange(null);
      audio.pause();
      if (reason instanceof DOMException && reason.name === "NotAllowedError") {
        setError("Playback needs a tap. Press Resume to continue.");
        updateStatus("paused");
      } else {
        setError("Could not start playback. Press Retry to try again.");
        updateStatus("error");
      }
    }
  }

  function requestPart(index: number, generation: number): Promise<string> {
    const playback = playbackRef.current;
    const cached = playback.urls.get(index);
    if (cached) return Promise.resolve(cached);
    const previousError = playback.requestErrors.get(index);
    if (previousError) return Promise.reject(previousError);
    const existing = playback.requests.get(index);
    if (existing) return existing.promise;
    const controller = new AbortController();
    const request: AudioRequest = { controller, promise: Promise.resolve("") };
    playback.requests.set(index, request);
    request.promise = (async () => {
      try {
        const response = await fetch("/api/speech/reader", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: playback.chunks[index].text,
            sourceLanguage: playback.language,
            voice: playback.voice,
            speed: playback.speed,
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(
            body.error || "Could not generate audio. Please try again.",
          );
        }
        const blob = await response.blob();
        if (
          controller.signal.aborted ||
          !mountedRef.current ||
          playback.generation !== generation
        ) {
          throw new DOMException("Audio request cancelled", "AbortError");
        }
        const url = URL.createObjectURL(blob);
        playback.urls.set(index, url);
        return url;
      } catch (reason) {
        if (
          !controller.signal.aborted &&
          mountedRef.current &&
          playback.generation === generation
        ) {
          playback.requestErrors.set(
            index,
            reason instanceof Error
              ? reason
              : new Error("Could not generate audio. Please try again."),
          );
        }
        throw reason;
      } finally {
        if (playback.requests.get(index) === request)
          playback.requests.delete(index);
      }
    })();
    return request.promise;
  }

  function prefetchNextPart(generation: number, index: number) {
    const playback = playbackRef.current;
    if (!isCurrent(generation, index) || !playback.wantsPlay) return;
    const nextIndex = index + 1;
    if (
      nextIndex >= playback.chunks.length ||
      playback.urls.has(nextIndex) ||
      playback.requestErrors.has(nextIndex)
    )
      return;
    playback.prefetchIndex = nextIndex;
    // A failed lookahead is reported only if playback reaches that part.
    void requestPart(nextIndex, generation).catch(() => {});
  }

  function abortPrefetch() {
    const playback = playbackRef.current;
    const index = playback.prefetchIndex;
    if (index === null) return;
    playback.prefetchIndex = null;
    playback.requests.get(index)?.controller.abort();
    playback.requests.delete(index);
    playback.requestErrors.delete(index);
  }

  async function playPart(generation: number) {
    const playback = playbackRef.current;
    const index = playback.index;
    if (!isCurrent(generation, index) || !playback.wantsPlay) return;
    const foregroundAttempt = ++playback.foregroundAttempt;
    // The lookahead becomes the foreground request once its part is reached.
    if (playback.prefetchIndex === index) playback.prefetchIndex = null;
    if (!playback.urls.has(index)) {
      updateReadingRange(null);
      updateStatus("loading");
    }
    try {
      const url = await requestPart(index, generation);
      if (
        !isCurrent(generation, index) ||
        playback.foregroundAttempt !== foregroundAttempt
      )
        return;
      if (playback.wantsPlay) await startAudio(url, generation, index);
      else updateStatus("paused");
    } catch (reason) {
      if (
        !isCurrent(generation, index) ||
        playback.foregroundAttempt !== foregroundAttempt ||
        (reason instanceof DOMException && reason.name === "AbortError")
      )
        return;
      playback.wantsPlay = false;
      updateReadingRange(null);
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not generate audio. Please try again.",
      );
      updateStatus("error");
    }
  }

  function pause() {
    const playback = playbackRef.current;
    playback.wantsPlay = false;
    playback.attempt++;
    abortPrefetch();
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
    if (playback.status === "error")
      playback.requestErrors.delete(playback.index);
    getAudio();
    if (playback.status === "complete") clearPlayback(false);
    if (!playback.chunks.length) {
      try {
        const language =
          SourceLanguageSelectOptions.find(
            (option) => option.label === sourceLanguage,
          )?.value ?? sourceLanguage;
        playback.chunks = getReaderSpeechChunks(text, language);
        playback.voice = settings.voice;
        playback.speed = settings.speed;
        playback.language = sourceLanguage;
        setPartCount(playback.chunks.length);
      } catch (reason) {
        updateReadingRange(null);
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

  function changeSettings(next: Settings) {
    clearPlayback(true);
    settingsRef.current = next;
    setSettings(next);
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
  const canListen =
    hasPremium &&
    Boolean(text.trim()) &&
    Boolean(sourceLanguage) &&
    settingsLoaded &&
    configStatus === "ready";
  const showFloatingControls =
    hasPremium &&
    controlsAboveViewport &&
    status !== "idle" &&
    status !== "complete";
  const mainAction = active
    ? "Pause reading"
    : status === "paused"
      ? "Resume reading"
      : status === "complete"
        ? "Listen to full text again"
        : status === "error"
          ? "Retry playback"
          : "Listen to full text";
  const mainLabel = active
    ? "Pause"
    : status === "paused"
      ? "Resume"
      : status === "complete"
        ? "Replay"
        : status === "error"
          ? "Retry"
          : "Listen";
  const speedIndex = READER_SPEEDS.findIndex(
    (speed) => speed.id === settings.speed,
  );
  const selectedSpeed = READER_SPEEDS[speedIndex];
  const progress =
    status === "complete"
      ? "Finished reading"
      : partCount > 0 && status !== "idle"
        ? `Part ${part} of ${partCount}${status === "loading" ? " · Generating audio…" : status === "gap" ? " · Sentence pause" : status === "paused" ? " · Paused" : ""}`
        : "";

  return (
    <section
      className={styles.player}
      aria-label={`Read full text aloud${languageName ? ` in ${languageName}` : ""}`}
    >
      <div className={styles.toolbar}>
        <div className={styles.controls} ref={controlsRef}>
          <button
            type="button"
            className={styles.listenButton}
            onClick={listen}
            disabled={!canListen}
            aria-label={mainAction}
          >
            <span aria-hidden="true">{active ? "Ⅱ" : "▶"}</span>
            {mainLabel}
          </button>
        </div>
        {hasPremium && (
          <div className={styles.settingsGrid}>
            <label className={styles.speedField}>
              <span>Reading speed</span>
              <span className={styles.speedControl}>
                <input
                  type="range"
                  className={styles.speedRange}
                  min={0}
                  max={READER_SPEEDS.length - 1}
                  step={1}
                  value={speedIndex}
                  aria-label="Reading speed"
                  aria-valuetext={`${selectedSpeed.speed}× — ${selectedSpeed.label}`}
                  title={selectedSpeed.label}
                  onChange={(event) => {
                    const index = Number(event.target.value);
                    const speed = Number.isInteger(index)
                      ? READER_SPEEDS[index]
                      : undefined;
                    if (speed) changeSettings({ ...settings, speed: speed.id });
                  }}
                />
                <span className={styles.speedMarks} aria-hidden="true">
                  {READER_SPEEDS.map((speed) => (
                    <span
                      key={speed.id}
                      className={styles.speedMark}
                      title={speed.label}
                      data-label={speed.label}
                    >
                      {speed.speed}
                    </span>
                  ))}
                </span>
                <span className={styles.speedTooltip} aria-hidden="true">
                  {selectedSpeed.label}
                </span>
              </span>
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
                    changeSettings({ ...settings, style, voice: voice.id });
                }}
              >
                <option value="all">All tones</option>
                <option
                  value="feminine"
                  disabled={!voices.some((voice) => voice.style === "feminine")}
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
                  disabled={!voices.some((voice) => voice.style === "neutral")}
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
                    changeSettings({ ...settings, voice });
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
        )}
      </div>
      {!hasPremium ? (
        <p className={styles.premiumNotice}>
          Full-text audio and voice settings are available with Premium.{" "}
          <Link href="/profile">View Premium</Link>
        </p>
      ) : (
        <>
          <p className={styles.progress} role="status" aria-live="polite">
            {progress ||
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
        </>
      )}
      {showFloatingControls && (
        <div
          className={styles.floatingDock}
          role="group"
          aria-label="Floating playback controls"
        >
          <button
            type="button"
            className={styles.listenButton}
            onClick={listen}
            disabled={!canListen}
            aria-label={mainAction}
          >
            <span aria-hidden="true">{active ? "Ⅱ" : "▶"}</span>
            {mainLabel}
          </button>
        </div>
      )}
    </section>
  );
}
