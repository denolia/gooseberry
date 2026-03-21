import { Language, Languages } from "@/components/ui/Languages";

interface LanguageStoreState {
  currentSourceLanguage: Language;
}

let data: LanguageStoreState = {
  currentSourceLanguage: Languages.German,
  // currentTargetLang: Languages.English,
};

function getSnapshot() {
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
        currentSourceLanguage: Languages[savedLang],
      };
    }
  } catch (e) {
    console.error("Failed to get language from localStorage ", e);
  }
  return data;
}

function getServerSnapshot() {
  return data;
}

function subscribe(listener: () => void) {
  const handler = (e: StorageEvent) => {
    if (e.key === "currentLanguage") {
      console.log("handler", e.newValue);
      const value = (e.newValue as Language) || Languages.German;

      if (
        value &&
        Languages[value] &&
        data.currentSourceLanguage !== Languages[value]
      ) {
        data = {
          ...data,
          currentSourceLanguage: Languages[value],
        };
        listener();
      }
    }
  };
  window.addEventListener("storage", handler);

  return () => window.removeEventListener("storage", handler);
}

function setCurrentLanguage(nextLanguage: Language) {
  try {
    localStorage.setItem("currentLanguage", nextLanguage);
    console.log("set the lang, calling event");
    // Notify other tabs/components (like WordInput) via storage event
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "currentLanguage",
        newValue: nextLanguage,
      }),
    );
  } catch (e) {
    console.error("Failed to save language to localStorage ", e);
  }
}

export { subscribe, getSnapshot, getServerSnapshot, setCurrentLanguage };
