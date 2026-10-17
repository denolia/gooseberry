export const READER_CHUNK_CHARACTERS = 1000;
export const MAX_READER_CHARACTERS = 20000;

export const READER_VOICES = [
  { id: "alloy", name: "Alloy" },
  { id: "ash", name: "Ash" },
  { id: "ballad", name: "Ballad" },
  { id: "coral", name: "Coral" },
  { id: "echo", name: "Echo" },
  { id: "fable", name: "Fable" },
  { id: "nova", name: "Nova" },
  { id: "onyx", name: "Onyx" },
  { id: "sage", name: "Sage" },
  { id: "shimmer", name: "Shimmer" },
  { id: "verse", name: "Verse" },
  { id: "marin", name: "Marin" },
  { id: "cedar", name: "Cedar" },
] as const;

export type ReaderVoice = (typeof READER_VOICES)[number]["id"];

// These multipliers control native audio playback; generation always produces
// normal-speed audio.
export const READER_SPEEDS = [
  { id: "very-slow", label: "Very slow", speed: 0.3 },
  { id: "slow", label: "Slow", speed: 0.5 },
  { id: "Slower", label: "Slower", speed: 0.7 },
  { id: "normal", label: "Normal", speed: 1 },
  { id: "fast", label: "Fast", speed: 1.5 },
] as const;

export type ReaderSpeed = (typeof READER_SPEEDS)[number]["id"];

export const DEFAULT_READER_VOICE: ReaderVoice = "marin";
export const DEFAULT_READER_SPEED: ReaderSpeed = "normal";

const legacyVoices = new Set<ReaderVoice>([
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
]);

export function getReaderVoices(model: string) {
  return model.startsWith("tts-1")
    ? READER_VOICES.filter((voice) => legacyVoices.has(voice.id))
    : [...READER_VOICES];
}

export function isReaderVoice(value: unknown): value is ReaderVoice {
  return READER_VOICES.some((voice) => voice.id === value);
}

export function isReaderSpeed(value: unknown): value is ReaderSpeed {
  return READER_SPEEDS.some((speed) => speed.id === value);
}
