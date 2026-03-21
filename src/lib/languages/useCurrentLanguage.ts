import { useSyncExternalStore } from "react";
import { LanguageStore } from "@/lib/languages/languageStore";
import { Languages } from "@/components/ui/Languages";

export function useCurrentLanguage() {
  const storeState = useSyncExternalStore(
    LanguageStore.subscribe,
    LanguageStore.getSnapshot,
    LanguageStore.getServerSnapshot,
  );

  return storeState.currentSourceLanguage ?? Languages.German;
}
