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

export const LanguageStore = {
  getSnapshot() {
    return data;
  },
  getServerSnapshot() {
    return DEFAULT_VALUE;
  },
  subscribe(listener: () => void) {
    listeners = [...listeners, listener];
    return () => {
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

        for (let listener of listeners) {
          listener();
        }
      }
    } catch (e) {
      console.error("Failed to save language to localStorage ", e);
    }
  },
};
