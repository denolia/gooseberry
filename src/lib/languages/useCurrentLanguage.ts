import { useSyncExternalStore } from "react";
import { LanguageStore } from "@/lib/languages/languageStore";

export function useCurrentLanguage() {
  const storeState = useSyncExternalStore(
    LanguageStore.subscribe,
    LanguageStore.getSnapshot,
    LanguageStore.getServerSnapshot,
  );
  console.log("changed store state", storeState);

  return storeState.currentSourceLanguage;
}
