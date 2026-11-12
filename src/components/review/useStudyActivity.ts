"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import type { StudyActivity } from "@/lib/review/activity";

export function useStudyActivity() {
  const { data: session, status } = useSession();
  const client = useQueryClient();
  const userId = session?.user?.id;
  const query = useQuery<StudyActivity>({
    queryKey: ["studyActivity", userId],
    enabled: status === "authenticated" && !!userId,
    queryFn: async () => {
      const response = await fetch("/api/study/activity", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Activity unavailable");
      return response.json();
    },
    staleTime: 0,
    refetchOnWindowFocus: "always",
  });
  const boundary = query.data?.studyDay.nextStartAt;
  useEffect(() => {
    if (!boundary) return;
    const timer = setTimeout(
      () =>
        void client.invalidateQueries({ queryKey: ["studyActivity", userId] }),
      Math.min(
        2_147_483_647,
        Math.max(1000, new Date(boundary).getTime() - Date.now()),
      ),
    );
    return () => clearTimeout(timer);
  }, [boundary, client, userId, query.dataUpdatedAt]);
  return query;
}
