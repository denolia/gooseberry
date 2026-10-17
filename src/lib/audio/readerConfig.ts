export const READER_CHUNK_CHARACTERS = 1000;
export const MAX_READER_CHARACTERS = 20000;

export type ReaderVoiceStyle = "feminine" | "masculine" | "neutral";

// OpenAI names these voices without assigning genders. Styles describe their
// perceived sound and are only a browsing aid in the voice selector.
export const READER_VOICES = [
  { id: "alloy", name: "Alloy", style: "neutral" },
  { id: "ash", name: "Ash", style: "masculine" },
  { id: "ballad", name: "Ballad", style: "masculine" },
  { id: "coral", name: "Coral", style: "feminine" },
  { id: "echo", name: "Echo", style: "masculine" },
  { id: "fable", name: "Fable", style: "masculine" },
  { id: "nova", name: "Nova", style: "feminine" },
  { id: "onyx", name: "Onyx", style: "masculine" },
  { id: "sage", name: "Sage", style: "feminine" },
  { id: "shimmer", name: "Shimmer", style: "feminine" },
  { id: "verse", name: "Verse", style: "masculine" },
  { id: "marin", name: "Marin", style: "feminine" },
  { id: "cedar", name: "Cedar", style: "masculine" },
] as const satisfies ReadonlyArray<{
  id: string;
  name: string;
  style: ReaderVoiceStyle;
}>;

export type ReaderVoice = (typeof READER_VOICES)[number]["id"];

export const READER_SPEEDS = [
  { id: "very-slow", label: "Very slow", speed: 0.3 },
  { id: "slow", label: "Slow", speed: 0.5 },
  { id: "normal-pauses", label: "Normal with pauses", speed: 0.7 },
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
