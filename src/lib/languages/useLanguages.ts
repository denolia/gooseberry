import { useSyncExternalStore } from "react";
import { LanguageStore } from "@/lib/languages/languageStore";
import { Language, TargetLanguage } from "@/components/ui/Languages";

export function useLanguages(): {
  currentSourceLanguage: Language;
  currentTargetLanguage: TargetLanguage;
} {
  return useSyncExternalStore(
    LanguageStore.subscribe,
    LanguageStore.getSnapshot,
    LanguageStore.getServerSnapshot,
  );
}
