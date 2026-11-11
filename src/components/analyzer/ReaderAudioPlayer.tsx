"use client";
import {
  languageLabelKey,
  SourceLanguageSelectOptions,
} from "@/components/ui/Languages";
import type { UiMessage } from "@/i18n/messages";
import {
  messageFromError,
  errorFromResponse,
  MessageError,
} from "@/i18n/errors";

import { useI18n } from "@/i18n/client";

import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import Link from "next/link";
import {
  Gauge,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
} from "lucide-react";
import {
  ReaderAudioCache,
  getReaderAudioCacheKey,
} from "@/lib/audio/readerAudioCache";
import {
  DEFAULT_READER_SPEED,
  DEFAULT_READER_VOICE,
  READER_SPEEDS,
  READER_VOICES,
  isReaderSpeed,
  isReaderVoice,
  type ReaderSpeed,
  type ReaderVoice,
} from "@/lib/audio/readerConfig";
import {
  getReaderSpeechChunks,
  findReaderSentenceChunkIndex,
  getReaderSentenceNavigation,
  type ReaderSpeechChunk,
  type ReaderTextRange,
} from "@/lib/audio/readerText";
import styles from "./ReaderAudioPlayer.module.css";

const SETTINGS_KEY = "readerAudioSettings:v1";

type VoiceOption = (typeof READER_VOICES)[number];
type Settings = {
  voice: ReaderVoice;
  speed: ReaderSpeed;
};
type Status =
  "idle" | "loading" | "playing" | "paused" | "waiting" | "complete" | "error";
type PlaybackIntent = "continuous" | "sentence";
export type ReaderAudioPlayerHandle = {
  readFrom(offset: number): Promise<void>;
};
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
  voice: ReaderVoice;
  language: string;
};

const DEFAULT_SETTINGS: Settings = {
  voice: DEFAULT_READER_VOICE,
  speed: DEFAULT_READER_SPEED,
};

function applyPlaybackSpeed(audio: HTMLAudioElement, speed: ReaderSpeed) {
  const rate = READER_SPEEDS.find((preset) => preset.id === speed)?.speed ?? 1;
  // Keep the selected rate through source changes and preserve the voice's pitch.
  audio.defaultPlaybackRate = rate;
  audio.playbackRate = rate;
  audio.preservesPitch = true;
}

export function ReaderAudioPlayer({
  text,
  sourceLanguage,
  hasPremium,
  accountId,
  onReadingRangeChange,
  onPlaybackActiveChange,
  onAvailabilityChange,
  ref,
}: {
  text: string;
  sourceLanguage: string;
  hasPremium: boolean;
  accountId?: string | null;
  onReadingRangeChange?: (range: ReaderTextRange | null) => void;
  onPlaybackActiveChange?: (active: boolean) => void;
  onAvailabilityChange?: (available: boolean) => void;
  ref?: Ref<ReaderAudioPlayerHandle>;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<UiMessage | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [configStatus, setConfigStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [configError, setConfigError] = useState<UiMessage | null>(null);
  const [configRetry, setConfigRetry] = useState(0);
  const [speedPopoverOpen, setSpeedPopoverOpen] = useState(false);
  const speedPopoverId = useId();
  const speedSettingsRef = useRef<HTMLDivElement>(null);
  const speedButtonRef = useRef<HTMLButtonElement>(null);
  const speedRangeRef = useRef<HTMLInputElement>(null);
  const [sentenceNavigation, setSentenceNavigation] = useState(() =>
    getReaderSentenceNavigation([], 0),
  );
  const playbackIntentRef = useRef<PlaybackIntent>("continuous");
  const settingsRef = useRef(settings);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const contentCacheRef = useRef<ReaderAudioCache | null>(null);
  if (!contentCacheRef.current)
    contentCacheRef.current = new ReaderAudioCache();
  const mountedRef = useRef(true);
  const readingCallbackRef = useRef(onReadingRangeChange);
  const readingRangeRef = useRef<ReaderTextRange | null>(null);
  const activeCallbackRef = useRef(onPlaybackActiveChange);
  const playbackActiveRef = useRef(false);
  const availabilityCallbackRef = useRef(onAvailabilityChange);
  const previousInputRef = useRef({
    text,
    sourceLanguage,
    hasPremium,
    accountId,
  });
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
    voice: DEFAULT_READER_VOICE,
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
    availabilityCallbackRef.current = onAvailabilityChange;
  }, [onAvailabilityChange]);

  useEffect(() => {
    if (!speedPopoverOpen || !hasPremium) return;
    speedRangeRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!speedSettingsRef.current?.contains(event.target as Node))
        setSpeedPopoverOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setSpeedPopoverOpen(false);
      speedButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [speedPopoverOpen, hasPremium]);

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
        playbackIntentRef.current = "continuous";
        if (updateUi && mountedRef.current)
          setSentenceNavigation(getReaderSentenceNavigation([], 0));
      }
      playback.status = "idle";
      if (updateUi && mountedRef.current) {
        setStatus("idle");
        setError(null);
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
      availabilityCallbackRef.current?.(false);
      clearPlayback(true, false);
      contentCacheRef.current?.clear();
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
    previousInputRef.current = { text, sourceLanguage, hasPremium, accountId };
    if (
      previous.text === text &&
      previous.sourceLanguage === sourceLanguage &&
      previous.hasPremium === hasPremium &&
      previous.accountId === accountId
    )
      return;
    if (previous.hasPremium !== hasPremium || previous.accountId !== accountId)
      contentCacheRef.current?.clear();
    clearPlayback(true);
  }, [text, sourceLanguage, hasPremium, accountId, clearPlayback]);

  useEffect(() => {
    if (!hasPremium) return;
    const request = new AbortController();
    async function loadVoices() {
      await Promise.resolve();
      if (request.signal.aborted) return;
      setConfigStatus("loading");
      setConfigError(null);
      try {
        const response = await fetch("/api/speech/reader", {
          signal: request.signal,
        });
        const body = await response.json();
        if (!response.ok)
          throw errorFromResponse(body, "errors.couldNotLoadAvailableVoices");
        const ids = new Set(
          Array.isArray(body.voices)
            ? body.voices.map((voice: { id?: unknown }) => voice?.id)
            : [],
        );
        const available = READER_VOICES.filter((voice) => ids.has(voice.id));
        if (!available.length)
          throw new MessageError(
            "errors.noReadingVoicesAreAvailablePleaseTryAgain",
          );
        if (request.signal.aborted) return;
        setVoices(available);
        const current = settingsRef.current;
        const voice =
          available.find((voice) => voice.id === current.voice) ??
          available.find((voice) => voice.id === body.defaultVoice) ??
          available[0];
        const next = { ...current, voice: voice.id };
        settingsRef.current = next;
        setSettings(next);
        setConfigStatus("ready");
      } catch (reason) {
        if (request.signal.aborted) return;
        setConfigStatus("error");
        setConfigError(
          messageFromError(reason, "errors.couldNotLoadAvailableVoices"),
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
      applyPlaybackSpeed(audioRef.current, settingsRef.current.speed);
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

  async function startAudio(url: string, generation: number, index: number) {
    const playback = playbackRef.current;
    if (!isCurrent(generation, index) || !playback.wantsPlay) return;
    const audio = getAudio();
    const attempt = ++playback.attempt;
    if (audio.src !== url) audio.src = url;
    applyPlaybackSpeed(audio, settingsRef.current.speed);
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
      const chunk = playback.chunks[index];
      const nextChunk = playback.chunks[index + 1];
      if (
        playbackIntentRef.current === "sentence" &&
        (!nextChunk || nextChunk.sentenceIndex !== chunk.sentenceIndex)
      ) {
        playback.wantsPlay = false;
        const navigation = getReaderSentenceNavigation(playback.chunks, index);
        playback.index = navigation.firstChunkIndex;
        setSentenceNavigation(navigation);
        updateReadingRange({
          start: chunk.sentenceStart,
          end: chunk.sentenceEnd,
        });
        updateStatus("waiting");
        return;
      }
      updateReadingRange(null);
      playback.index++;
      if (playback.index >= playback.chunks.length) {
        playback.wantsPlay = false;
        updateStatus("complete");
        return;
      }
      setSentenceNavigation(
        getReaderSentenceNavigation(playback.chunks, playback.index),
      );
      if (!playback.wantsPlay) updateStatus("paused");
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
      const key = getReaderAudioCacheKey(
        playback.chunks[index].text,
        playback.language,
        playback.voice,
      );
      contentCacheRef.current?.delete(key);
      for (const [cachedIndex, cachedUrl] of playback.urls) {
        if (
          getReaderAudioCacheKey(
            playback.chunks[cachedIndex].text,
            playback.language,
            playback.voice,
          ) === key
        ) {
          URL.revokeObjectURL(cachedUrl);
          playback.urls.delete(cachedIndex);
        }
      }
      setError({ key: "errors.couldNotPlayThisPartPressListenToTryAgain" });
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
        setError({ key: "errors.playbackNeedsATapPressListenToContinue" });
        updateStatus("paused");
      } else {
        setError({ key: "errors.couldNotStartPlaybackPressListenToTryAgain" });
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
    const key = getReaderAudioCacheKey(
      playback.chunks[index].text,
      playback.language,
      playback.voice,
    );
    const cachedBlob = contentCacheRef.current?.get(key);
    if (
      cachedBlob &&
      mountedRef.current &&
      playback.generation === generation
    ) {
      const url = URL.createObjectURL(cachedBlob);
      playback.urls.set(index, url);
      return Promise.resolve(url);
    }
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
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw errorFromResponse(
            body,
            "errors.couldNotGenerateAudioPleaseTryAgain",
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
        contentCacheRef.current?.set(key, blob);
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
              : new MessageError("errors.couldNotGenerateAudioPleaseTryAgain"),
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
      (playbackIntentRef.current === "sentence" &&
        playback.chunks[nextIndex].sentenceIndex !==
          playback.chunks[index].sentenceIndex) ||
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
        messageFromError(reason, "errors.couldNotGenerateAudioPleaseTryAgain"),
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
    playbackIntentRef.current = "continuous";
    setError(null);
    if (playback.status === "error")
      playback.requestErrors.delete(playback.index);
    getAudio();
    if (playback.status === "waiting") {
      await startAtChunk(
        getReaderSentenceNavigation(playback.chunks, playback.index)
          .firstChunkIndex,
        "continuous",
      );
      return;
    }
    if (playback.status === "complete") clearPlayback(false);
    if (!prepareChunks()) return;
    playback.wantsPlay = true;
    setSentenceNavigation(
      getReaderSentenceNavigation(playback.chunks, playback.index),
    );
    await playPart(playback.generation);
  }

  function prepareChunks() {
    const playback = playbackRef.current;
    try {
      if (!playback.chunks.length) {
        const language =
          SourceLanguageSelectOptions.find(
            (option) => option.label === sourceLanguage,
          )?.value ?? sourceLanguage;
        playback.chunks = getReaderSpeechChunks(text, language);
      }
      playback.voice = settingsRef.current.voice;
      playback.language = sourceLanguage;
      return playback.chunks.length > 0;
    } catch (reason) {
      updateReadingRange(null);
      setError(messageFromError(reason, "errors.thisTextCannotBeRead"));
      updateStatus("error");
      return false;
    }
  }

  async function startAtChunk(index: number, intent: PlaybackIntent) {
    if (!canListen || index < 0 || index >= playbackRef.current.chunks.length)
      return;
    getAudio();
    clearPlayback(false);
    playbackIntentRef.current = intent;
    const playback = playbackRef.current;
    playback.index = index;
    playback.wantsPlay = true;
    updateStatus("loading");
    setSentenceNavigation(getReaderSentenceNavigation(playback.chunks, index));
    await playPart(playback.generation);
  }

  async function readFrom(offset: number) {
    if (!canListen || !prepareChunks()) return;
    const index = findReaderSentenceChunkIndex(
      playbackRef.current.chunks,
      offset,
    );
    if (index >= 0) await startAtChunk(index, "continuous");
  }

  useImperativeHandle(ref, () => ({ readFrom }));

  async function playSentence(target?: number) {
    if (!canListen || !prepareChunks()) return;
    const playback = playbackRef.current;
    const currentIndex = Math.min(playback.index, playback.chunks.length - 1);
    const navigation = getReaderSentenceNavigation(
      playback.chunks,
      currentIndex,
    );
    await startAtChunk(target ?? navigation.firstChunkIndex, "sentence");
  }

  function changeSettings(next: Settings) {
    if (next.voice !== settingsRef.current.voice) clearPlayback(true);
    settingsRef.current = next;
    setSettings(next);
    if (audioRef.current) applyPlaybackSpeed(audioRef.current, next.speed);
  }

  const languageName =
    SourceLanguageSelectOptions.find(
      (option) => option.value === sourceLanguage,
    )?.label ?? sourceLanguage;
  const active = status === "loading" || status === "playing";
  const canListen =
    hasPremium &&
    Boolean(text.trim()) &&
    Boolean(sourceLanguage) &&
    settingsLoaded &&
    configStatus === "ready";
  useEffect(() => {
    availabilityCallbackRef.current?.(canListen);
  }, [canListen, onAvailabilityChange]);
  const initialNavigation = useMemo(() => {
    try {
      const language =
        SourceLanguageSelectOptions.find(
          (option) => option.label === sourceLanguage,
        )?.value ?? sourceLanguage;
      return getReaderSentenceNavigation(
        getReaderSpeechChunks(text, language),
        0,
      );
    } catch {
      return getReaderSentenceNavigation([], 0);
    }
  }, [text, sourceLanguage]);
  const navigation =
    sentenceNavigation.firstChunkIndex >= 0
      ? sentenceNavigation
      : initialNavigation;
  const mainAction = active
    ? t("readerAudioPlayer.pauseReading")
    : t("readerAudioPlayer.listenToFullText");
  const mainLabel = active
    ? t("signedOutLanding.pause")
    : t("textAnalyzer.listen");
  const speedIndex = READER_SPEEDS.findIndex(
    (speed) => speed.id === settings.speed,
  );
  const selectedSpeed = READER_SPEEDS[speedIndex];
  const progress =
    status === "complete"
      ? t("readerAudioPlayer.finishedReading")
      : navigation.sentenceCount > 0
        ? t("readerAudioPlayer.sentenceValueOfValueValue", {
            value0: navigation.sentenceIndex + 1,
            value1: navigation.sentenceCount,
            value2:
              status === "loading"
                ? t("readerAudioPlayer.generatingAudio")
                : status === "paused"
                  ? t("readerAudioPlayer.paused")
                  : "",
          })
        : "";
  const PlaybackIcon = active ? Pause : Play;
  const navigationButton = (direction: "previous" | "next") => {
    const target =
      direction === "previous"
        ? navigation.previousChunkIndex
        : navigation.nextChunkIndex;
    const label =
      direction === "previous"
        ? t("readerAudioPlayer.previousSentence")
        : t("readerAudioPlayer.nextSentence");
    const Icon = direction === "previous" ? SkipBack : SkipForward;
    return (
      <button
        type="button"
        className={`${styles.controlButton} ${styles.navigationButton}`}
        aria-label={label}
        title={label}
        disabled={!canListen || target < 0}
        onClick={() => playSentence(target)}
      >
        <Icon
          className={styles.playbackIcon}
          size={16}
          aria-hidden="true"
          focusable="false"
        />
      </button>
    );
  };
  const playbackControls = (
    <>
      {navigationButton("previous")}
      <button
        type="button"
        className={styles.controlButton}
        onClick={listen}
        disabled={!canListen}
        aria-label={mainAction}
      >
        <PlaybackIcon
          className={styles.playbackIcon}
          size={16}
          aria-hidden="true"
          focusable="false"
        />
        {mainLabel}
      </button>
      <button
        type="button"
        className={styles.controlButton}
        onClick={() => playSentence()}
        disabled={!canListen}
        aria-label={t("readerAudioPlayer.repeatSentence")}
      >
        <RotateCcw
          className={styles.playbackIcon}
          size={16}
          aria-hidden="true"
          focusable="false"
        />
        {t("readerAudioPlayer.repeat")}
      </button>
      {navigationButton("next")}
    </>
  );

  return (
    <section
      className={styles.player}
      aria-label={
        languageName
          ? t("readerAudioPlayer.listenToFullTextInValue", {
              value0: t(languageLabelKey(languageName)),
            })
          : t("readerAudioPlayer.listenToFullText")
      }
    >
      <div className={styles.toolbar}>
        <div className={styles.playback}>
          {hasPremium && (
            <p className={styles.progress} role="status" aria-live="polite">
              {progress ||
                (configStatus === "loading"
                  ? t("readerAudioPlayer.loadingAvailableVoices")
                  : "")}
            </p>
          )}
          <div className={styles.controls}>{playbackControls}</div>
        </div>
        {hasPremium && (
          <div className={styles.settingsGrid}>
            <div
              ref={speedSettingsRef}
              className={styles.speedSettings}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                  setSpeedPopoverOpen(false);
              }}
            >
              <span>{t("readerAudioPlayer.readingSpeed")}</span>
              <button
                ref={speedButtonRef}
                type="button"
                className={`${styles.controlButton} ${styles.speedButton}`}
                aria-label={t("readerAudioPlayer.readingSpeedValueValue", {
                  value0: selectedSpeed.speed,
                  value1: t(selectedSpeed.labelKey),
                })}
                aria-haspopup="dialog"
                aria-expanded={speedPopoverOpen}
                aria-controls={speedPopoverOpen ? speedPopoverId : undefined}
                onClick={() => setSpeedPopoverOpen((open) => !open)}
              >
                <Gauge size={16} aria-hidden="true" focusable="false" />
                {selectedSpeed.speed}×
              </button>
              {speedPopoverOpen && (
                <div
                  id={speedPopoverId}
                  role="dialog"
                  aria-label={t("readerAudioPlayer.readingSpeed")}
                  className={styles.speedPopover}
                >
                  <label>
                    <span>
                      {t("readerAudioPlayer.readingSpeed2")}{" "}
                      {t(selectedSpeed.labelKey)}
                    </span>
                    <span className={styles.speedControl}>
                      <input
                        ref={speedRangeRef}
                        type="range"
                        className={styles.speedRange}
                        min={0}
                        max={READER_SPEEDS.length - 1}
                        step={1}
                        value={speedIndex}
                        aria-label={t("readerAudioPlayer.readingSpeed")}
                        aria-valuetext={`${selectedSpeed.speed}× — ${t(selectedSpeed.labelKey)}`}
                        title={t(selectedSpeed.labelKey)}
                        onChange={(event) => {
                          const index = Number(event.target.value);
                          const speed = Number.isInteger(index)
                            ? READER_SPEEDS[index]
                            : undefined;
                          if (speed)
                            changeSettings({ ...settings, speed: speed.id });
                        }}
                      />
                      <span className={styles.speedMarks} aria-hidden="true">
                        {READER_SPEEDS.map((speed) => (
                          <span
                            key={speed.id}
                            className={styles.speedMark}
                            title={t(speed.labelKey)}
                            data-label={t(speed.labelKey)}
                          >
                            {speed.speed}×
                          </span>
                        ))}
                      </span>
                      <span className={styles.speedTooltip} aria-hidden="true">
                        {t(selectedSpeed.labelKey)}
                      </span>
                    </span>
                  </label>
                </div>
              )}
            </div>
            <label className={styles.voiceControl}>
              {t("readerAudioPlayer.voiceName")}
              <select
                value={settings.voice}
                disabled={configStatus !== "ready"}
                onChange={(event) => {
                  const voice = event.target.value;
                  if (
                    isReaderVoice(voice) &&
                    voices.some((option) => option.id === voice)
                  )
                    changeSettings({ ...settings, voice });
                }}
              >
                {!voices.length && (
                  <option value={settings.voice}>
                    {t("readerAudioPlayer.loadingVoices")}
                  </option>
                )}
                {voices.map((voice) => (
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
          {t(
            "readerAudioPlayer.fullTextAudioAndVoiceSettingsAreAvailableWithPremium",
          )}{" "}
          <Link href="/profile">{t("readerAudioPlayer.viewPremium")}</Link>
        </p>
      ) : (
        <>
          {configError && (
            <p className={styles.error} role="alert">
              {t(configError.key, configError.values)}{" "}
              <button
                type="button"
                className={styles.retryButton}
                onClick={() => setConfigRetry((value) => value + 1)}
              >
                {t("readerAudioPlayer.retryVoices")}
              </button>
            </p>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {t(error.key, error.values)}
            </p>
          )}
        </>
      )}
    </section>
  );
}
