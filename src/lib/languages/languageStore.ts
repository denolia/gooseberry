import {
  Language,
  Languages,
  TargetLanguage,
  TargetLanguages,
} from "@/components/ui/Languages";

interface LanguageStoreState {
  id: number;
  currentSourceLanguage: Language | null;
  currentTargetLanguage: TargetLanguage;
}

let nextId = 0;

const SOURCE_LANGUAGE_STORAGE_KEY = "currentSourceLanguage";
const LEGACY_SOURCE_LANGUAGE_STORAGE_KEY = "currentLanguage";
const TARGET_LANGUAGE_STORAGE_KEY = "currentTargetLanguage";

const DEFAULT_VALUE: LanguageStoreState = {
  id: 0,
  currentSourceLanguage: Languages.German,
  currentTargetLanguage: TargetLanguages.Russian,
};
let data: LanguageStoreState = DEFAULT_VALUE;

function isSourceLanguage(value: string | null): value is Language {
  return Boolean(value && Languages[value as keyof typeof Languages]);
}

function isTargetLanguage(value: string | null): value is TargetLanguage {
  return Boolean(
    value && TargetLanguages[value as keyof typeof TargetLanguages],
  );
}

function updateStore(nextState: Partial<LanguageStoreState>) {
  data = {
    ...data,
    ...nextState,
    id: nextId++,
  };
}

function initReadFromLocalStorage() {
  // only run on the client where we have the localStorage
  if (typeof window === "undefined") return;

  try {
    const savedSourceLanguage =
      localStorage.getItem(SOURCE_LANGUAGE_STORAGE_KEY) ??
      localStorage.getItem(LEGACY_SOURCE_LANGUAGE_STORAGE_KEY) ??
      Languages.German;
    const savedTargetLanguage =
      localStorage.getItem(TARGET_LANGUAGE_STORAGE_KEY) ??
      TargetLanguages.Russian;

    if (isSourceLanguage(savedSourceLanguage)) {
      data.currentSourceLanguage = savedSourceLanguage;
    }

    if (isTargetLanguage(savedTargetLanguage)) {
      data.currentTargetLanguage = savedTargetLanguage;
    }
  } catch (e) {
    console.error("Failed to get language from localStorage ", e);
  }
}

initReadFromLocalStorage();

let listeners: (() => void)[] = [];
function emitChange() {
  for (let listener of listeners) {
    listener();
  }
}

export const LanguageStore = {
  getSnapshot() {
    return data;
  },
  getServerSnapshot() {
    return DEFAULT_VALUE;
  },
  subscribe(listener: () => void) {
    listeners = [...listeners, listener];

    const handler = (e: StorageEvent) => {
      if (
        e.key === SOURCE_LANGUAGE_STORAGE_KEY ||
        e.key === LEGACY_SOURCE_LANGUAGE_STORAGE_KEY
      ) {
        const nextLanguage = e.newValue;

        if (
          isSourceLanguage(nextLanguage) &&
          data.currentSourceLanguage !== nextLanguage
        ) {
          updateStore({ currentSourceLanguage: nextLanguage });
          emitChange();
        }
      }

      if (e.key === TARGET_LANGUAGE_STORAGE_KEY) {
        const nextLanguage = e.newValue;

        if (
          isTargetLanguage(nextLanguage) &&
          data.currentTargetLanguage !== nextLanguage
        ) {
          updateStore({ currentTargetLanguage: nextLanguage });
          emitChange();
        }
      }
    };
    window.addEventListener("storage", handler);

    return () => {
      window.removeEventListener("storage", handler);
      listeners = listeners.filter((l) => l !== listener);
    };
  },
  setCurrentSourceLanguage(nextLanguage: Language) {
    try {
      if (
        isSourceLanguage(nextLanguage) &&
        data.currentSourceLanguage !== nextLanguage
      ) {
        updateStore({ currentSourceLanguage: nextLanguage });
        localStorage.setItem(SOURCE_LANGUAGE_STORAGE_KEY, nextLanguage);
        localStorage.setItem(LEGACY_SOURCE_LANGUAGE_STORAGE_KEY, nextLanguage);

        emitChange();
      }
    } catch (e) {
      console.error("Failed to save source language to localStorage ", e);
    }
  },
  setCurrentTargetLanguage(nextLanguage: TargetLanguage) {
    try {
      if (
        isTargetLanguage(nextLanguage) &&
        data.currentTargetLanguage !== nextLanguage
      ) {
        updateStore({ currentTargetLanguage: nextLanguage });
        localStorage.setItem(TARGET_LANGUAGE_STORAGE_KEY, nextLanguage);

        emitChange();
      }
    } catch (e) {
      console.error("Failed to save target language to localStorage ", e);
    }
  },
};
