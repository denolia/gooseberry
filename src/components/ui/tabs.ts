export const tabs = [
  { id: "translation", label: "Translation" },
  { id: "anki", label: "Anki Sets" },
] as const;

export type TabId = (typeof tabs)[number]["id"];
