"use client";
import { MessageError } from "@/i18n/errors";

import { useCallback, useEffect, useRef } from "react";
import type { StudyDay, StudyExposurePermission } from "@/lib/review/exposure";
import { withAutomaticRetries } from "@/lib/review/retry";

export type ActivatedStudyCard<T> = {
  card: T;
  exposure: StudyExposurePermission;
  exposedAt: string;
  studyDay: StudyDay;
};

type Presentation = { id: string; studyCardId: string };

async function recordPresentation<T>(
  attempt: Presentation,
): Promise<ActivatedStudyCard<T> | null> {
  return withAutomaticRetries(async () => {
    const response = await fetch("/api/study/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        exposureId: attempt.id,
        studyCardId: attempt.studyCardId,
        displayed: true,
      }),
      keepalive: true,
    });
    // A stale display is still recorded by the endpoint. It must not interrupt
    // the visible exercise; queue filtering handles future siblings.
    if (response.status === 404 || response.status === 409) return null;
    if (!response.ok)
      throw new MessageError("errors.couldNotRecordStudyExposure");
    const body = await response.json();
    if (
      body.exposure?.id !== attempt.id ||
      body.exposure?.studyCardId !== attempt.studyCardId ||
      !body.card ||
      !body.studyDay
    ) {
      throw new MessageError("errors.invalidStudyExposureResponse");
    }
    return body as ActivatedStudyCard<T>;
  });
}

export function useStudyExposure<T>({
  studyCardId,
  onPresented,
  onRecorded,
}: {
  studyCardId?: string;
  onPresented: (studyCardId: string) => void;
  onRecorded: (result: ActivatedStudyCard<T>) => void;
}) {
  const attemptRef = useRef<Presentation | null>(null);
  const renewalRef = useRef<Promise<void> | null>(null);

  const getPresentation = useCallback(() => {
    if (!studyCardId) return null;
    if (attemptRef.current?.studyCardId !== studyCardId) {
      attemptRef.current = { id: crypto.randomUUID(), studyCardId };
    }
    return attemptRef.current;
  }, [studyCardId]);

  useEffect(() => {
    const attempt = getPresentation();
    if (!attempt) return;
    let active = true;
    queueMicrotask(async () => {
      if (!active || attemptRef.current !== attempt) return;
      onPresented(attempt.studyCardId);
      try {
        const result = await recordPresentation<T>(attempt);
        if (active && attemptRef.current === attempt && result)
          onRecorded(result);
      } catch {
        // Exposure is best effort. A failed marker write never blocks studying.
        // Saving a rating can create the same presentation receipt on the server.
      }
    });
    return () => {
      active = false;
    };
  }, [getPresentation, onPresented, onRecorded]);

  const clear = useCallback(() => {
    attemptRef.current = null;
  }, []);

  const renew = useCallback((): Promise<void> => {
    const attempt = attemptRef.current;
    if (!attempt || attempt.studyCardId !== studyCardId)
      return Promise.resolve();
    if (renewalRef.current) return renewalRef.current;
    const renewal = (async () => {
      try {
        const result = await recordPresentation<T>(attempt);
        if (attemptRef.current === attempt && result) onRecorded(result);
      } catch {
        // Focus and day rollover refresh exposure without changing the prompt.
      }
    })().finally(() => {
      renewalRef.current = null;
    });
    renewalRef.current = renewal;
    return renewal;
  }, [studyCardId, onRecorded]);

  const getPresentationId = useCallback(
    () => getPresentation()?.id ?? null,
    [getPresentation],
  );
  return { getPresentationId, clear, renew };
}
