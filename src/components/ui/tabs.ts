export const tabs = [
  { id: "translation", label: "Translation" },
  { id: "analyzer", label: "Text analyzer" },
  { id: "anki", label: "Anki Sets" },
] as const;

export type TabId = (typeof tabs)[number]["id"];
