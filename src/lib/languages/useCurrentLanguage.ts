import { useSyncExternalStore } from "react";
import { LanguageStore } from "@/lib/languages/languageStore";
import { Language, Languages } from "@/components/ui/Languages";

export function useCurrentLanguage(): Language | null {
  const storeState = useSyncExternalStore(
    LanguageStore.subscribe,
    LanguageStore.getSnapshot,
    LanguageStore.getServerSnapshot,
  );

  return storeState.currentSourceLanguage;
}
