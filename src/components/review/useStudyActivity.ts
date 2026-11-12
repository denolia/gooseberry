"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import type { StudyActivity } from "@/lib/review/activity";
import type { StudyDay } from "@/lib/review/exposure";
import { getStudyActivityTracker } from "@/lib/review/activityCache";

const noop = () => {};

export function useStudyActivity(day?: StudyDay | null) {
  const { data: session, status } = useSession();
  const client = useQueryClient();
  const userId = session?.user?.id;
  const tracker = userId ? getStudyActivityTracker(client, userId) : undefined;
  const query = useQuery<StudyActivity>({
    queryKey: ["studyActivity", userId],
    enabled: status === "authenticated" && !!userId,
    queryFn: ({ signal }) => tracker!.fetch(signal),
    staleTime: 0,
    refetchOnWindowFocus: "always",
  });
  useEffect(() => tracker?.setDay(day ?? undefined), [day, tracker]);
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
  return {
    ...query,
    addReview: tracker?.addReview ?? noop,
    startSave: tracker?.startSave ?? noop,
    completeSave: tracker?.completeSave ?? noop,
    failSave: tracker?.failSave ?? noop,
  };
}
