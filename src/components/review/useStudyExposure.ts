"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StudyDay, StudyExposurePermission } from "@/lib/review/exposure";
import { withAutomaticRetries } from "@/lib/review/retry";

export type ActivatedStudyCard<T> = {
  card: T;
  exposure: StudyExposurePermission;
  exposedAt: string;
  studyDay: StudyDay;
};

type Unavailable = { available: false; code?: string; studyDay?: StudyDay };

async function openPresentation<T>(
  wordSetId: string,
  attempt: { id: string; studyCardId: string },
): Promise<ActivatedStudyCard<T> | Unavailable> {
  return withAutomaticRetries(async () => {
    const response = await fetch(
      `/api/word-sets/${wordSetId}/review/exposure`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exposureId: attempt.id,
          studyCardId: attempt.studyCardId,
        }),
        keepalive: true,
      },
    );
    const body = await response.json();
    if (response.status === 404 || response.status === 409) {
      return { available: false, code: body.code, studyDay: body.studyDay };
    }
    if (!response.ok)
      throw new Error(body.error || "Could not open this exercise.");
    if (
      body.exposure?.id !== attempt.id ||
      body.exposure?.studyCardId !== attempt.studyCardId ||
      !body.card ||
      !body.studyDay
    ) {
      throw new Error("Could not confirm this exercise. Please retry.");
    }
    return body as ActivatedStudyCard<T>;
  });
}

export function useStudyExposure<T>({
  studyCardId,
  wordSetId,
  onActivated,
  onUnavailable,
}: {
  studyCardId?: string;
  wordSetId: string;
  onActivated: (result: ActivatedStudyCard<T>) => void;
  onUnavailable: (studyCardId: string, result: Unavailable) => void;
}) {
  const [authorizedId, setAuthorizedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const attemptRef = useRef<{ id: string; studyCardId: string } | null>(null);
  const renewalRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (!studyCardId) {
      attemptRef.current = null;
      return;
    }
    const attempt =
      attemptRef.current?.studyCardId === studyCardId
        ? attemptRef.current
        : { id: crypto.randomUUID(), studyCardId };
    attemptRef.current = attempt;
    let active = true;
    queueMicrotask(async () => {
      if (!active) return;
      setError(null);
      try {
        const result = await openPresentation<T>(wordSetId, attempt);
        if (!active) return;
        if ("available" in result) {
          setAuthorizedId(null);
          onUnavailable(studyCardId, result);
        } else {
          onActivated(result);
          setAuthorizedId(studyCardId);
        }
      } catch (openingError) {
        if (active)
          setError(
            openingError instanceof Error
              ? openingError.message
              : "Could not open this exercise.",
          );
      }
    });
    return () => {
      active = false;
    };
  }, [studyCardId, wordSetId, retryVersion, onActivated, onUnavailable]);

  const clear = useCallback(() => {
    attemptRef.current = null;
    setAuthorizedId(null);
    setError(null);
  }, []);

  const retry = useCallback(() => {
    // Preserve the attempt ID in case the server committed a lost response.
    setAuthorizedId(null);
    setError(null);
    setRetryVersion((version) => version + 1);
  }, []);

  const renew = useCallback((): Promise<void> => {
    const attempt = attemptRef.current;
    if (!attempt || authorizedId !== studyCardId) return Promise.resolve();
    if (renewalRef.current) return renewalRef.current;
    const renewal = (async () => {
      try {
        const result = await openPresentation<T>(wordSetId, attempt);
        if (attemptRef.current !== attempt) return;
        if ("available" in result) {
          clear();
          onUnavailable(attempt.studyCardId, result);
        } else onActivated(result);
      } catch {
        // Keep the already-authorized prompt stable. A grade still persists
        // visibility and failed grade saves retain their existing retry UI.
      }
    })().finally(() => {
      renewalRef.current = null;
    });
    renewalRef.current = renewal;
    return renewal;
  }, [authorizedId, studyCardId, wordSetId, onActivated, onUnavailable, clear]);

  return {
    authorized: Boolean(studyCardId && authorizedId === studyCardId),
    error,
    clear,
    retry,
    renew,
  };
}
