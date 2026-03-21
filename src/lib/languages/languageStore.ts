import { Language, Languages } from "@/components/ui/Languages";

interface LanguageStoreState {
  id: number;
  currentSourceLanguage: Language | null;
}

let nextId = 0;

let DEFAULT_VALUE = {
  id: 0,
  currentSourceLanguage: null,
  // currentTargetLang: Languages.English,
};
let data: LanguageStoreState = DEFAULT_VALUE;

function initReadFromLocalStorage() {
  // only run on the client where we have the localStorage
  if (typeof window === "undefined") return;

  try {
    const savedLang =
      (localStorage.getItem("currentLanguage") as Language | null) ??
      Languages.German;
    if (
      savedLang &&
      Languages[savedLang] &&
      data.currentSourceLanguage !== Languages[savedLang]
    ) {
      data = {
        ...data,
        id: nextId++,
        currentSourceLanguage: Languages[savedLang],
      };
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
      if (e.key === "currentLanguage") {
        const nextLanguage = e.newValue as Language;

        if (
          nextLanguage &&
          Languages[nextLanguage] &&
          data.currentSourceLanguage !== Languages[nextLanguage]
        ) {
          data = {
            ...data,
            id: nextId++,
            currentSourceLanguage: Languages[nextLanguage],
          };
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
  setCurrentLanguage(nextLanguage: Language) {
    try {
      if (
        nextLanguage &&
        Languages[nextLanguage] &&
        data.currentSourceLanguage !== Languages[nextLanguage]
      ) {
        data = {
          ...data,
          id: nextId++,
          currentSourceLanguage: Languages[nextLanguage],
        };
        localStorage.setItem("currentLanguage", nextLanguage);

        emitChange();
      }
    } catch (e) {
      console.error("Failed to save language to localStorage ", e);
    }
  },
};
