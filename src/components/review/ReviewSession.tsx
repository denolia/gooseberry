"use client";
import type { UiMessage } from "@/i18n/messages";
import { messageFromError, errorFromResponse } from "@/i18n/errors";

import { useI18n } from "@/i18n/client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Repeat2, X } from "lucide-react";
import { SourceAudioButton } from "@/components/ui/SourceAudioButton";
import { BottomPanelLayout } from "@/components/ui/BottomPanelLayout";
import { isNewState, reviewControls } from "@/lib/review/controls";
import { formatReviewInterval } from "@/lib/review/formatInterval";
import type { FsrsCardStateValue, ReviewModeValue } from "@/lib/review/model";
import { withAutomaticRetries } from "@/lib/review/retry";
import {
  filterExposedReviewQueue,
  mergeReviewQueue,
  shouldRefillReviewQueue,
} from "@/lib/review/queue";
import type { StudyDay } from "@/lib/review/exposure";
import {
  getStudyCardTemplate,
  type StudyCardTemplateKey,
} from "@/lib/review/templates";
import { exerciseFieldLanguage, typedAnswerDiff } from "./exercises";
import styles from "./ReviewSession.module.css";
import { useStudyExposure, type ActivatedStudyCard } from "./useStudyExposure";

type Rating = 1 | 2 | 3 | 4;

type RatingPreview = {
  rating: Rating;
  dueAt: string;
  intervalMs: number;
  state: number;
};

type ReviewCard = {
  id: string;
  wordSetItemId: string;
  templateKey: StudyCardTemplateKey;
  wordSetId: string;
  wordSetName: string;
  sourceLang: string;
  targetLang: string;
  original: string;
  translation: string;
  wordForms: string;
  sample: string;
  sampleTranslation: string;
  comments: string;
  tags: string;
  state: { state: FsrsCardStateValue; dueAt?: string };
  ratings: RatingPreview[];
};

type ReviewSubmission = {
  reviewId: string;
  studyCardId: string;
  exposureId: string;
  rating: Rating;
  reviewedAt: string;
  durationMs: number;
};

const MAX_QUEUE_EXCLUSIONS = 100;

export function ReviewSession({
  wordSetId,
  reviewMode,
}: {
  wordSetId: string;
  reviewMode: ReviewModeValue;
}) {
  const { t } = useI18n();
  const { status } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextDueAt, setNextDueAt] = useState<string | null>(null);
  const [studyDay, setStudyDay] = useState<StudyDay | null>(null);
  const [exposureDeferredCount, setExposureDeferredCount] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [typedAnswer, setTypedAnswer] = useState("");
  const [error, setError] = useState<UiMessage | null>(null);
  const [failedReviews, setFailedReviews] = useState<ReviewSubmission[]>([]);
  const cardsRef = useRef<ReviewCard[]>([]);
  const pendingReviewsRef = useRef(new Map<string, ReviewSubmission>());
  const failedReviewsRef = useRef<ReviewSubmission[]>([]);
  const ignoredCardIdsRef = useRef(new Set<string>());
  const scheduledReviewsRef = useRef(new Map<string, string>());
  const loadingQueueRef = useRef(false);
  const queueRefreshPendingRef = useRef(false);
  const studyDayRef = useRef<StudyDay | null>(null);
  const seenNotesRef = useRef(new Map<string, number>());
  const presentedCardIdRef = useRef<string | null>(null);
  const revealedCardIdRef = useRef<string | null>(null);
  const audioButtonRef = useRef<HTMLButtonElement | null>(null);
  const shownAt = useRef(0);
  const card = cards[0] ?? null;

  const updateCards = useCallback((nextCards: ReviewCard[]) => {
    cardsRef.current = nextCards;
    setCards(nextCards);
  }, []);

  const acceptStudyDay = useCallback((incoming: StudyDay) => {
    const current = studyDayRef.current;
    if (
      current?.serverNow &&
      incoming.serverNow &&
      incoming.serverNow < current.serverNow
    )
      return current;
    studyDayRef.current = incoming;
    setStudyDay(incoming);
    const start = new Date(incoming.startAt).getTime();
    for (const [noteId, seenAt] of seenNotesRef.current) {
      if (seenAt < start) seenNotesRef.current.delete(noteId);
    }
    const visible = cardsRef.current[0];
    if (visible && presentedCardIdRef.current === visible.id) {
      seenNotesRef.current.set(
        visible.wordSetItemId,
        Math.max(seenNotesRef.current.get(visible.wordSetItemId) ?? 0, start),
      );
    }
    return incoming;
  }, []);

  const onRecorded = useCallback(
    (result: ActivatedStudyCard<ReviewCard>) => {
      if (cardsRef.current[0]?.id !== result.card.id) return;
      const day = acceptStudyDay(result.studyDay);
      const seenAt = new Date(result.exposedAt).getTime();
      seenNotesRef.current.set(
        result.card.wordSetItemId,
        Math.max(
          seenNotesRef.current.get(result.card.wordSetItemId) ?? 0,
          seenAt,
        ),
      );
      void queryClient.invalidateQueries({
        queryKey: ["wordSets"],
        refetchType: "none",
      });
      updateCards(
        filterExposedReviewQueue(
          cardsRef.current,
          seenNotesRef.current,
          new Date(day.startAt).getTime(),
          true,
        ),
      );
    },
    [acceptStudyDay, queryClient, updateCards],
  );

  const onPresented = useCallback(
    (cardId: string) => {
      const current = cardsRef.current[0];
      if (current?.id !== cardId) return;
      if (presentedCardIdRef.current !== cardId) {
        presentedCardIdRef.current = cardId;
        shownAt.current = performance.now();
      }
      const day = studyDayRef.current;
      if (!day) return;
      const dayStart = new Date(day.startAt).getTime();
      // The local map guards the buffer immediately; server confirmation records
      // the exact timestamp. Fetching a waiting card never marks it as seen.
      seenNotesRef.current.set(
        current.wordSetItemId,
        Math.max(
          seenNotesRef.current.get(current.wordSetItemId) ?? 0,
          dayStart,
        ),
      );
      updateCards(
        filterExposedReviewQueue(
          cardsRef.current,
          seenNotesRef.current,
          dayStart,
          true,
        ),
      );
    },
    [updateCards],
  );

  const updateFailedReviews = useCallback(
    (update: (current: ReviewSubmission[]) => ReviewSubmission[]) => {
      const next = update(failedReviewsRef.current);
      failedReviewsRef.current = next;
      setFailedReviews(next);
    },
    [],
  );

  const loadCards = useCallback(
    async function loadQueue({
      replace = false,
    }: { replace?: boolean } = {}): Promise<void> {
      if (loadingQueueRef.current) {
        queueRefreshPendingRef.current = true;
        return;
      }

      const currentCards = replace ? [] : cardsRef.current;
      const exclusions = new Set([
        ...currentCards.map(({ id }) => id),
        ...Array.from(
          pendingReviewsRef.current.values(),
          ({ studyCardId }) => studyCardId,
        ),
        ...failedReviewsRef.current.map(({ studyCardId }) => studyCardId),
        ...ignoredCardIdsRef.current,
      ]);
      if (exclusions.size > MAX_QUEUE_EXCLUSIONS) return;

      loadingQueueRef.current = true;
      const requestedAt = Date.now();
      if (replace) {
        setLoading(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }

      const search = new URLSearchParams();
      for (const studyCardId of exclusions) {
        search.append("exclude", studyCardId);
      }

      try {
        const encodedSearch = search.toString();
        const query = encodedSearch ? `?${encodedSearch}` : "";
        const response = await fetch(
          `/api/word-sets/${wordSetId}/review${query}`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw errorFromResponse(body, "errors.couldNotLoadTheNextReview");
        }

        const body = (await response.json()) as {
          cards: ReviewCard[];
          nextDueAt?: string | null;
          studyDay?: StudyDay;
          exposureDeferredCount?: number;
        };
        // Answers can advance the queue while this request is in flight.
        // Merge against the live queue so they never reappear from a snapshot.
        const liveCards = replace ? [] : cardsRef.current;
        const unavailable = new Set([
          ...Array.from(
            pendingReviewsRef.current.values(),
            ({ studyCardId }) => studyCardId,
          ),
          ...failedReviewsRef.current.map(({ studyCardId }) => studyCardId),
          ...ignoredCardIdsRef.current,
        ]);
        const incoming = body.cards.filter(({ id }) => !unavailable.has(id));
        const day = body.studyDay
          ? acceptStudyDay(body.studyDay)
          : studyDayRef.current;
        const merged = mergeReviewQueue(liveCards, incoming);
        const nextCards = day
          ? filterExposedReviewQueue(
              merged,
              seenNotesRef.current,
              new Date(day.startAt).getTime(),
              liveCards.length > 0,
            )
          : merged;
        const startsNewCard = liveCards.length === 0 && nextCards.length > 0;
        updateCards(nextCards);
        const upcoming = body.nextDueAt ? [body.nextDueAt] : [];
        for (const [id, dueAt] of scheduledReviewsRef.current) {
          if (new Date(dueAt).getTime() <= requestedAt) {
            scheduledReviewsRef.current.delete(id);
          } else {
            upcoming.push(dueAt);
          }
        }
        upcoming.sort();
        setNextDueAt(upcoming[0] ?? null);
        setExposureDeferredCount(body.exposureDeferredCount ?? 0);

        if (replace || startsNewCard) {
          setRevealed(false);
          setTypedAnswer("");
          revealedCardIdRef.current = null;
          shownAt.current = performance.now();
        }
      } catch (loadError) {
        if (replace || currentCards.length === 0) {
          setError(
            messageFromError(loadError, "errors.couldNotLoadTheNextReview"),
          );
        }
      } finally {
        loadingQueueRef.current = false;
        if (replace) setLoading(false);
        else setLoadingMore(false);
        // A saved introduction may unlock siblings after this fetch started.
        // Do not lose that refill just because an older request was in flight.
        if (queueRefreshPendingRef.current) {
          queueRefreshPendingRef.current = false;
          queueMicrotask(() => void loadQueue());
        }
      }
    },
    [acceptStudyDay, updateCards, wordSetId],
  );

  const {
    getPresentationId,
    clear: clearExposure,
    renew: renewExposure,
  } = useStudyExposure<ReviewCard>({
    studyCardId: card?.id,
    wordSetId,
    onPresented,
    onRecorded,
  });

  const sendReview = useCallback(
    async (submission: ReviewSubmission) => {
      pendingReviewsRef.current.set(submission.reviewId, submission);

      try {
        await withAutomaticRetries(async () => {
          const response = await fetch(`/api/word-sets/${wordSetId}/review`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(submission),
            keepalive: true,
          });
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw errorFromResponse(body, "errors.couldNotSaveThisReview");
          }
          const body = await response.json();
          const dueAt = (body.nextAvailableAt ?? body.state?.dueAt) as
            string | undefined;
          if (dueAt) {
            scheduledReviewsRef.current.set(submission.studyCardId, dueAt);
            setNextDueAt((current) =>
              !current || new Date(dueAt) < new Date(current) ? dueAt : current,
            );
          }
        });
        pendingReviewsRef.current.delete(submission.reviewId);
        void queryClient.invalidateQueries({ queryKey: ["wordSets"] });
      } catch {
        pendingReviewsRef.current.delete(submission.reviewId);
        updateFailedReviews((current) =>
          current.some(({ reviewId }) => reviewId === submission.reviewId)
            ? current
            : [...current, submission],
        );
      } finally {
        if (shouldRefillReviewQueue(cardsRef.current)) {
          void loadCards();
        }
      }
    },
    [loadCards, queryClient, updateFailedReviews, wordSetId],
  );

  useEffect(() => {
    if (status === "authenticated") {
      let active = true;
      queueMicrotask(() => {
        if (active) void loadCards({ replace: true });
      });
      return () => {
        active = false;
      };
    }
    if (status === "unauthenticated") router.replace("/");
  }, [loadCards, router, status]);

  useEffect(() => {
    if (!nextDueAt || status !== "authenticated") return;
    const timeout = setTimeout(
      () => {
        if (loadingQueueRef.current) {
          setNextDueAt(new Date(Date.now() + 500).toISOString());
        } else {
          void loadCards();
        }
      },
      Math.min(
        2_147_483_647,
        Math.max(0, new Date(nextDueAt).getTime() - Date.now()),
      ),
    );
    return () => clearTimeout(timeout);
  }, [loadCards, nextDueAt, status]);

  useEffect(() => {
    const refresh = () => {
      if (status === "authenticated") {
        void renewExposure();
        void loadCards();
      }
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [loadCards, renewExposure, status]);

  useEffect(() => {
    if (!studyDay || status !== "authenticated") return;
    const timer = setTimeout(
      () => {
        const visible =
          typeof document === "undefined" ||
          document.visibilityState !== "hidden";
        if (visible) void renewExposure();
        void loadCards();
      },
      Math.min(
        2_147_483_647,
        Math.max(500, new Date(studyDay.nextStartAt).getTime() - Date.now()),
      ),
    );
    return () => clearTimeout(timer);
  }, [studyDay, loadCards, renewExposure, status]);

  const revealAnswer = useCallback(() => {
    if (!card) return;
    revealedCardIdRef.current = card.id;
    setRevealed(true);
  }, [card]);

  const submitRating = useCallback(
    (rating: Rating) => {
      if (!card || revealedCardIdRef.current !== card.id) return;

      onPresented(card.id);
      const presentationId = getPresentationId();
      if (!presentationId) return;

      revealedCardIdRef.current = null;
      const submission: ReviewSubmission = {
        reviewId: crypto.randomUUID(),
        studyCardId: card.id,
        exposureId: presentationId,
        rating,
        reviewedAt: new Date().toISOString(),
        durationMs: Math.max(
          0,
          Math.round(performance.now() - shownAt.current),
        ),
      };
      const remainingCards = cardsRef.current.slice(1);
      presentedCardIdRef.current = null;
      clearExposure();
      updateCards(remainingCards);
      setRevealed(false);
      setTypedAnswer("");
      setError(null);
      shownAt.current = performance.now();
      window.scrollTo({ top: 0, behavior: "instant" });
      void sendReview(submission);

      if (
        shouldRefillReviewQueue(remainingCards, !isNewState(card.state.state))
      ) {
        void loadCards();
      }
    },
    [
      card,
      clearExposure,
      getPresentationId,
      onPresented,
      loadCards,
      sendReview,
      updateCards,
    ],
  );

  const retryFailedReview = useCallback(() => {
    const failed = failedReviewsRef.current[0];
    if (!failed) return;
    updateFailedReviews((current) => current.slice(1));
    void sendReview(failed);
  }, [sendReview, updateFailedReviews]);

  const ignoreFailedReview = useCallback(() => {
    const failed = failedReviewsRef.current[0];
    if (!failed) return;
    ignoredCardIdsRef.current.add(failed.studyCardId);
    updateFailedReviews((current) => current.slice(1));
    if (shouldRefillReviewQueue(cardsRef.current)) void loadCards();
  }, [loadCards, updateFailedReviews]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) {
        return;
      }
      if (
        event.target instanceof Element &&
        event.target.closest("input, select, textarea, [contenteditable]")
      ) {
        return;
      }
      if (event.key.toLowerCase() === "p") {
        if (audioButtonRef.current) {
          event.preventDefault();
          if (!event.repeat) audioButtonRef.current.click();
        }
        return;
      }
      if (
        event.key === "Enter" &&
        event.target instanceof Element &&
        event.target.closest("button, a")
      ) {
        return;
      }
      if (event.repeat && event.key === " ") {
        event.preventDefault();
        return;
      }
      if (!revealed && (event.key === " " || event.key === "Enter")) {
        event.preventDefault();
        revealAnswer();
        return;
      }
      if (revealed && card) {
        const control = reviewControls(card.state.state, reviewMode).find(
          ({ shortcut }) => shortcut === event.key,
        );
        if (!control) return;
        event.preventDefault();
        submitRating(control.rating);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [card, revealAnswer, revealed, reviewMode, submitRating]);

  const failureToast = failedReviews[0] ? (
    <aside className={styles.syncToast} role="alert" aria-live="assertive">
      <p>{t("reviewSession.weHadAnIssueTryingToUpdateYourProgress")}</p>
      <div>
        <button onClick={retryFailedReview}>{t("reviewSession.retry")}</button>
        <button onClick={ignoreFailedReview}>
          {t("reviewSession.ignore")}
        </button>
      </div>
    </aside>
  ) : null;

  if (status === "loading" || loading || (!card && loadingMore)) {
    return (
      <div className={styles.centered} aria-busy="true">
        {t("reviewSession.loadingReview")}
      </div>
    );
  }

  if (status !== "authenticated") return null;

  if (error && !card) {
    return (
      <>
        <div className={styles.centered}>
          <p className={styles.error} role="alert">
            {t(error.key, error.values)}
          </p>
          <button
            className={styles.primaryButton}
            onClick={() => void loadCards({ replace: true })}
          >
            {t("moveWordDialog.tryAgain")}
          </button>
          <Link className={styles.textLink} href="/anki">
            {t("reviewSession.backToSets")}
          </Link>
        </div>
        {failureToast}
      </>
    );
  }

  if (!card) {
    return (
      <>
        <div className={styles.complete}>
          <span className={styles.completeMark} aria-hidden="true">
            ✓
          </span>
          <p className={styles.eyebrow}>{t("reviewSession.sessionComplete")}</p>
          <h1>{t("reviewSession.youReCaughtUp")}</h1>
          <p>
            {t(
              "reviewSession.noMoreExercisesAreAvailableRightNowWithinYourDaily",
            )}
          </p>
          {nextDueAt && (
            <p>
              {t("reviewSession.nextReview")}{" "}
              {new Date(nextDueAt).toLocaleString()}.
            </p>
          )}
          {exposureDeferredCount > 0 && (
            <p>
              {t("reviewSession.repetitionsOfWordsYouVeSeenTodayResumeAfter2")}
            </p>
          )}
          <Link className={styles.textLink} href="/profile">
            {t("profileClient.studySetSettings")}
          </Link>
          <Link className={styles.primaryButton} href="/anki">
            {t("reviewSession.backToSets")}
          </Link>
        </div>
        {failureToast}
      </>
    );
  }

  const newCard = isNewState(card.state.state);
  const PhaseIcon = newCard ? BookOpen : Repeat2;
  const controls = reviewControls(card.state.state, reviewMode);
  const template = getStudyCardTemplate(card.templateKey);
  const promptLanguage = exerciseFieldLanguage(
    template.promptField,
    card.sourceLang,
    card.targetLang,
  );
  const answerLanguage = exerciseFieldLanguage(
    template.answerField,
    card.sourceLang,
    card.targetLang,
  );
  const sourceVisibleOnPrompt = template.promptField === "original";
  const hasSourceAudio = card.original.trim().length > 0;
  const isExample = card.templateKey === "example";
  const typedComparison =
    template.requiresTyping && revealed
      ? typedAnswerDiff(typedAnswer, card[template.answerField], answerLanguage)
      : null;

  const actions = !revealed ? (
    <button
      className={styles.revealButton}
      onClick={revealAnswer}
      autoFocus={!template.requiresTyping}
    >
      {template.requiresTyping
        ? t("reviewSession.checkAnswer")
        : t("reviewSession.showAnswer")}
      <span className={styles.shortcutHint}>
        {template.requiresTyping
          ? t("reviewSession.enter")
          : t("reviewSession.space")}
      </span>
    </button>
  ) : (
    <div
      className={`${styles.ratings} ${
        newCard
          ? styles.newCardRatings
          : reviewMode === "full"
            ? styles.fullRatings
            : styles.simpleRatings
      }`}
    >
      {controls.map((control) => {
        const preview = card.ratings.find(
          ({ rating }) => rating === control.rating,
        );
        if (!preview) return null;

        return (
          <button
            key={control.rating}
            className={`${styles.ratingButton} ${
              styles[`rating${control.rating}`]
            } ${newCard ? styles.okButton : ""}`}
            onClick={() => submitRating(control.rating)}
          >
            {control.shortcut && (
              <span className={styles.ratingKey}>
                {control.shortcut === " "
                  ? t("reviewSession.space")
                  : control.shortcut}
              </span>
            )}
            <span className={styles.ratingCopy}>
              <strong>{t(control.labelKey)}</strong>
              <small>{formatReviewInterval(preview.intervalMs)}</small>
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <BottomPanelLayout
      className={styles.reviewLayout}
      label={t("reviewSession.studyControls")}
      panel={actions}
    >
      <div className={styles.session}>
        <header className={styles.sessionHeader}>
          <div className={styles.sessionInfo}>
            <h1 title={card.wordSetName}>{card.wordSetName}</h1>
            <p className={styles.languagePair}>
              {promptLanguage.toUpperCase()} → {answerLanguage.toUpperCase()}
            </p>
          </div>
          <Link
            className={styles.exitButton}
            href="/anki"
            aria-label={t("reviewSession.endSession")}
            title={t("reviewSession.endSession")}
          >
            <X size={20} aria-hidden="true" />
          </Link>
        </header>

        <article key={card.id} className={styles.card} aria-live="polite">
          <div className={styles.exerciseMeta}>
            <p
              className={`${styles.phaseLabel} ${
                newCard ? styles.learningPhase : styles.repeatingPhase
              }`}
            >
              <PhaseIcon size={16} aria-hidden="true" />
              {newCard
                ? t("reviewSession.learning")
                : t("reviewSession.repeating")}
            </p>
            <p className={styles.exerciseLabel}>{t(template.labelKey)}</p>
          </div>
          <div className={styles.promptSide}>
            <div
              className={`${styles.wordRow} ${
                sourceVisibleOnPrompt && hasSourceAudio
                  ? styles.wordRowWithAudio
                  : ""
              }`}
            >
              <h2 lang={promptLanguage}>{card[template.promptField]}</h2>
              {sourceVisibleOnPrompt && hasSourceAudio && (
                <SourceAudioButton
                  key={card.id}
                  className={styles.listenControl}
                  ref={audioButtonRef}
                  text={card.original}
                  sourceLanguage={card.sourceLang}
                  shortcut="P"
                />
              )}
            </div>
            {(card.templateKey === "word_forms" || isExample) &&
              card.translation && (
                <p className={styles.supporting} lang={card.targetLang}>
                  {card.translation}
                </p>
              )}
            {template.requiresTyping && !revealed && (
              <div className={styles.typedAnswer}>
                <label htmlFor="study-typed-answer">
                  {t("reviewSession.yourAnswerIn")}{" "}
                  {card.sourceLang.toUpperCase()}
                </label>
                <input
                  id="study-typed-answer"
                  lang={card.sourceLang}
                  type="text"
                  value={typedAnswer}
                  onChange={(event) => setTypedAnswer(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.repeat &&
                      !event.metaKey &&
                      !event.ctrlKey &&
                      !event.altKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      revealAnswer();
                    }
                  }}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  writingsuggestions="false"
                  aria-describedby="study-typed-answer-help"
                  autoFocus
                />
                <p id="study-typed-answer-help">
                  {t("reviewSession.pressEnterToCheckThenRateYourRecall")}
                </p>
              </div>
            )}
          </div>

          {revealed && (
            <div className={styles.answerWrap}>
              <div className={styles.answerSide}>
                {typedComparison && (
                  <div
                    className={styles.answerComparison}
                    role="status"
                    aria-label={
                      typedComparison.matches
                        ? t("reviewSession.yourAnswerMatches")
                        : t("reviewSession.yourAnswerDiffers")
                    }
                  >
                    <p className={styles.sideLabel}>
                      {t("reviewSession.yourAnswer")}
                    </p>
                    <p
                      className={`${styles.enteredAnswer} ${
                        typedComparison.matches ? styles.matchedAnswer : ""
                      }`}
                      lang={answerLanguage}
                    >
                      {typedComparison.entered.length
                        ? typedComparison.entered.map((part, index) =>
                            part.changed ? (
                              <del className={styles.incorrectText} key={index}>
                                {part.value}
                              </del>
                            ) : (
                              <span key={index}>{part.value}</span>
                            ),
                          )
                        : t("reviewSession.noAnswerEntered")}
                    </p>
                  </div>
                )}
                {isExample && card.original && (
                  <p className={styles.answerContext} lang={card.sourceLang}>
                    {card.original}
                  </p>
                )}
                <div
                  className={`${styles.wordRow} ${
                    !sourceVisibleOnPrompt && hasSourceAudio
                      ? styles.wordRowWithAudio
                      : ""
                  }`}
                >
                  <h2 lang={answerLanguage}>
                    {typedComparison
                      ? typedComparison.expected.map((part, index) =>
                          part.changed ? (
                            <ins className={styles.correctText} key={index}>
                              {part.value}
                            </ins>
                          ) : (
                            <span key={index}>{part.value}</span>
                          ),
                        )
                      : card[template.answerField]}
                  </h2>
                  {!sourceVisibleOnPrompt && hasSourceAudio && (
                    <SourceAudioButton
                      key={card.id}
                      className={styles.listenControl}
                      ref={audioButtonRef}
                      text={card.original}
                      sourceLanguage={card.sourceLang}
                      shortcut="P"
                    />
                  )}
                </div>
                {card.wordForms && template.answerField !== "wordForms" && (
                  <p className={styles.supporting} lang={card.sourceLang}>
                    {card.wordForms}
                  </p>
                )}
                {card.sample && !isExample && (
                  <div className={styles.example}>
                    <p lang={card.sourceLang}>{card.sample}</p>
                    {card.sampleTranslation && (
                      <p lang={card.targetLang}>{card.sampleTranslation}</p>
                    )}
                  </div>
                )}
                {card.comments && (
                  <p className={styles.comments}>{card.comments}</p>
                )}
              </div>

              {error && (
                <p className={styles.inlineError} role="alert">
                  {t(error.key, error.values)}
                </p>
              )}
            </div>
          )}
        </article>
      </div>
      {failureToast}
    </BottomPanelLayout>
  );
}
