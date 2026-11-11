"use client";
import { MessageError } from "@/i18n/errors";

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
      if (!response.ok) throw new MessageError("errors.couldNotLoadSets");
      return (await response.json()).wordSets;
    },
  });
}
