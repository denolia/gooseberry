import {
  isSourceLanguage,
  isTargetLanguage,
  SourceLanguage,
  SourceLanguageOptions,
  SourceLanguages,
  TargetLanguage,
  TargetLanguageOptions,
  TargetLanguages,
} from "@/components/ui/Languages";
import {
  updateLanguagePairForSourceChange,
  updateLanguagePairForTargetChange,
} from "@/lib/languages/languagePair";

interface LanguageStoreState {
  id: number;
  currentSourceLanguage: SourceLanguage;
  currentTargetLanguage: TargetLanguage;
  previousSourceLanguage: SourceLanguage;
  previousTargetLanguage: TargetLanguage;
}

let nextId = 0;

const SOURCE_LANGUAGE_STORAGE_KEY = "currentSourceLanguage";
const TARGET_LANGUAGE_STORAGE_KEY = "currentTargetLanguage";

const DEFAULT_VALUE: LanguageStoreState = {
  id: 0,
  currentSourceLanguage: SourceLanguages.German,
  currentTargetLanguage: TargetLanguages.English,
  previousSourceLanguage: SourceLanguages.German,
  previousTargetLanguage: TargetLanguages.English,
};
let data: LanguageStoreState = DEFAULT_VALUE;

const languagePairConfig = {
  defaultSource: SourceLanguages.German,
  defaultTarget: TargetLanguages.English,
  sourceOptions: SourceLanguageOptions,
  targetOptions: TargetLanguageOptions,
  isSource: isSourceLanguage,
  isTarget: isTargetLanguage,
} as const;

function updateStore(nextState: Partial<LanguageStoreState>) {
  data = {
    ...data,
    ...nextState,
    id: nextId++,
  };
}

function getLanguagePairState() {
  return {
    currentSource: data.currentSourceLanguage,
    currentTarget: data.currentTargetLanguage,
    previousSource: data.previousSourceLanguage,
    previousTarget: data.previousTargetLanguage,
  };
}

function applyLanguagePairState(nextState: ReturnType<typeof getLanguagePairState>) {
  const hasChanged =
    data.currentSourceLanguage !== nextState.currentSource ||
    data.currentTargetLanguage !== nextState.currentTarget ||
    data.previousSourceLanguage !== nextState.previousSource ||
    data.previousTargetLanguage !== nextState.previousTarget;

  if (!hasChanged) {
    return false;
  }

  updateStore({
    currentSourceLanguage: nextState.currentSource,
    currentTargetLanguage: nextState.currentTarget,
    previousSourceLanguage: nextState.previousSource,
    previousTargetLanguage: nextState.previousTarget,
  });

  return true;
}

function persistLanguages(nextState: ReturnType<typeof getLanguagePairState>) {
  localStorage.setItem(SOURCE_LANGUAGE_STORAGE_KEY, nextState.currentSource);
  localStorage.setItem(TARGET_LANGUAGE_STORAGE_KEY, nextState.currentTarget);
}

function initReadFromLocalStorage() {
  // only run on the client where we have the localStorage
  if (typeof window === "undefined") return;

  try {
    const savedSourceLanguage =
      localStorage.getItem(SOURCE_LANGUAGE_STORAGE_KEY) ??
      SourceLanguages.German;
    const savedTargetLanguage =
      localStorage.getItem(TARGET_LANGUAGE_STORAGE_KEY) ??
      TargetLanguages.English;

    if (isSourceLanguage(savedSourceLanguage)) {
      data.currentSourceLanguage = savedSourceLanguage;
      data.previousSourceLanguage = savedSourceLanguage;
    }

    if (isTargetLanguage(savedTargetLanguage)) {
      data.currentTargetLanguage = savedTargetLanguage;
      data.previousTargetLanguage = savedTargetLanguage;
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
      if (e.key === SOURCE_LANGUAGE_STORAGE_KEY) {
        const nextLanguage = e.newValue;

        if (isSourceLanguage(nextLanguage)) {
          const nextState = updateLanguagePairForSourceChange(
            getLanguagePairState(),
            nextLanguage,
            languagePairConfig,
          );

          if (applyLanguagePairState(nextState)) {
            emitChange();
          }
        }
      }

      if (e.key === TARGET_LANGUAGE_STORAGE_KEY) {
        const nextLanguage = e.newValue;

        if (isTargetLanguage(nextLanguage)) {
          const nextState = updateLanguagePairForTargetChange(
            getLanguagePairState(),
            nextLanguage,
            languagePairConfig,
          );

          if (applyLanguagePairState(nextState)) {
            emitChange();
          }
        }
      }
    };
    window.addEventListener("storage", handler);

    return () => {
      window.removeEventListener("storage", handler);
      listeners = listeners.filter((l) => l !== listener);
    };
  },
  setCurrentSourceLanguage(nextLanguage: SourceLanguage) {
    try {
      if (isSourceLanguage(nextLanguage)) {
        const nextState = updateLanguagePairForSourceChange(
          getLanguagePairState(),
          nextLanguage,
          languagePairConfig,
        );

        if (!applyLanguagePairState(nextState)) {
          return;
        }

        persistLanguages(nextState);
        emitChange();
      }
    } catch (e) {
      console.error("Failed to save source language to localStorage ", e);
    }
  },
  setCurrentTargetLanguage(nextLanguage: TargetLanguage) {
    try {
      if (isTargetLanguage(nextLanguage)) {
        const nextState = updateLanguagePairForTargetChange(
          getLanguagePairState(),
          nextLanguage,
          languagePairConfig,
        );

        if (!applyLanguagePairState(nextState)) {
          return;
        }

        persistLanguages(nextState);
        emitChange();
      }
    } catch (e) {
      console.error("Failed to save target language to localStorage ", e);
    }
  },
};
