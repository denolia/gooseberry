import { useSyncExternalStore } from "react";
import * as languageStore from "./languageStore";

export function useCurrentLanguage() {
  const storeState = useSyncExternalStore(
    languageStore.subscribe,
    languageStore.getSnapshot,
    languageStore.getServerSnapshot,
  );
  console.log("changed store state", storeState);

  return storeState.currentSourceLanguage;
}
