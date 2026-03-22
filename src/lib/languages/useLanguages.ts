import { useSyncExternalStore } from "react";
import { LanguageStore } from "@/lib/languages/languageStore";
import { SourceLanguage, TargetLanguage } from "@/components/ui/Languages";

export function useLanguages(): {
  currentSourceLanguage: SourceLanguage;
  currentTargetLanguage: TargetLanguage;
} {
  return useSyncExternalStore(
    LanguageStore.subscribe,
    LanguageStore.getSnapshot,
    LanguageStore.getServerSnapshot,
  );
}
