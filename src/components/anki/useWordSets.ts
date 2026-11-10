"use client";

import { useQuery } from "@tanstack/react-query";

export type WordSetOption = {
  id: string;
  name: string;
  sourceLang: string;
  targetLang: string;
};

export function useWordSets(userId?: string) {
  return useQuery({
    queryKey: ["wordSets", userId],
    enabled: !!userId,
    queryFn: async (): Promise<WordSetOption[]> => {
      const response = await fetch("/api/word-sets");
      if (!response.ok) throw new Error("Could not load sets.");
      return (await response.json()).wordSets;
    },
  });
}
