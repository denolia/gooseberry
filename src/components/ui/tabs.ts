import type { MessageKey } from "@/i18n/messages";
export const tabs = [
  { id: "translation", labelKey: "cardEditor.translation" },
  { id: "analyzer", labelKey: "textAnalyzer.reader" },
  { id: "anki", labelKey: "common.studySets" },
] as const satisfies readonly { id: string; labelKey: MessageKey }[];

export type TabId = (typeof tabs)[number]["id"];
