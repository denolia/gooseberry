import { Language, Languages } from "@/components/ui/Languages";

interface LanguageStoreState {
  id: number;
  currentSourceLanguage: Language;
}

let nextId = 0;

let data: LanguageStoreState = {
  id: nextId++,
  currentSourceLanguage: Languages.German,
  // currentTargetLang: Languages.English,
};

let listeners: (() => void)[] = [];

export const LanguageStore = {
  getSnapshot() {
    try {
      const savedLang = localStorage.getItem(
        "currentLanguage",
      ) as Language | null;
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
    return data;
  },
  getServerSnapshot() {
    return data;
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
