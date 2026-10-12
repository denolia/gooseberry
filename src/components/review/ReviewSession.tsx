"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { SourceAudioButton } from "@/components/ui/SourceAudioButton";
import {
  isNewState,
  reviewControls,
  reviewPrompt,
} from "@/lib/review/controls";
import { formatReviewInterval } from "@/lib/review/formatInterval";
import type { FsrsCardStateValue, ReviewModeValue } from "@/lib/review/model";
import { withAutomaticRetries } from "@/lib/review/retry";
import { mergeReviewQueue, shouldRefillReviewQueue } from "@/lib/review/queue";
import {
  getStudyCardTemplate,
  type StudyCardTemplateKey,
} from "@/lib/review/templates";
import { exerciseFieldLanguage, typedAnswerDiff } from "./exercises";
import styles from "./ReviewSession.module.css";

type Rating = 1 | 2 | 3 | 4;

type RatingPreview = {
  rating: Rating;
  dueAt: string;
  intervalMs: number;
  state: number;
};

type ReviewCard = {
  id: string;
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
  const { status } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextDueAt, setNextDueAt] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [typedAnswer, setTypedAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failedReviews, setFailedReviews] = useState<ReviewSubmission[]>([]);
  const cardsRef = useRef<ReviewCard[]>([]);
  const pendingReviewsRef = useRef(new Map<string, ReviewSubmission>());
  const failedReviewsRef = useRef<ReviewSubmission[]>([]);
  const ignoredCardIdsRef = useRef(new Set<string>());
  const scheduledReviewsRef = useRef(new Map<string, string>());
  const loadingQueueRef = useRef(false);
  const revealedCardIdRef = useRef<string | null>(null);
  const audioButtonRef = useRef<HTMLButtonElement | null>(null);
  const shownAt = useRef(0);
  const card = cards[0] ?? null;

  const updateCards = useCallback((nextCards: ReviewCard[]) => {
    cardsRef.current = nextCards;
    setCards(nextCards);
  }, []);

  const updateFailedReviews = useCallback(
    (update: (current: ReviewSubmission[]) => ReviewSubmission[]) => {
      const next = update(failedReviewsRef.current);
      failedReviewsRef.current = next;
      setFailedReviews(next);
    },
    [],
  );

  const loadCards = useCallback(
    async ({ replace = false }: { replace?: boolean } = {}) => {
      if (loadingQueueRef.current) return;

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
          throw new Error(body.error || "Could not load the next review.");
        }

        const body = (await response.json()) as {
          cards: ReviewCard[];
          nextDueAt?: string | null;
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
        const nextCards = mergeReviewQueue(liveCards, incoming);
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

        if (replace || startsNewCard) {
          setRevealed(false);
          setTypedAnswer("");
          revealedCardIdRef.current = null;
          shownAt.current = performance.now();
        }
      } catch (loadError) {
        if (replace || currentCards.length === 0) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load the next review.",
          );
        }
      } finally {
        loadingQueueRef.current = false;
        if (replace) setLoading(false);
        else setLoadingMore(false);
      }
    },
    [updateCards, wordSetId],
  );

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
            throw new Error(body.error || "Could not save this review.");
          }
          const body = await response.json();
          const dueAt = body.state?.dueAt as string | undefined;
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
      if (status === "authenticated") void loadCards();
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [loadCards, status]);

  const revealAnswer = useCallback(() => {
    if (!card) return;
    revealedCardIdRef.current = card.id;
    setRevealed(true);
  }, [card]);

  const submitRating = useCallback(
    (rating: Rating) => {
      if (!card || revealedCardIdRef.current !== card.id) return;

      revealedCardIdRef.current = null;
      const submission: ReviewSubmission = {
        reviewId: crypto.randomUUID(),
        studyCardId: card.id,
        rating,
        reviewedAt: new Date().toISOString(),
        durationMs: Math.max(
          0,
          Math.round(performance.now() - shownAt.current),
        ),
      };
      const remainingCards = cardsRef.current.slice(1);
      updateCards(remainingCards);
      setRevealed(false);
      setTypedAnswer("");
      setError(null);
      shownAt.current = performance.now();
      void sendReview(submission);

      if (
        shouldRefillReviewQueue(remainingCards, !isNewState(card.state.state))
      ) {
        void loadCards();
      }
    },
    [card, loadCards, sendReview, updateCards],
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
      <p>We had an issue trying to update your progress.</p>
      <div>
        <button onClick={retryFailedReview}>Retry</button>
        <button onClick={ignoreFailedReview}>Ignore</button>
      </div>
    </aside>
  ) : null;

  if (status === "loading" || loading || (!card && loadingMore)) {
    return (
      <div className={styles.centered} aria-busy="true">
        Loading review…
      </div>
    );
  }

  if (status !== "authenticated") return null;

  if (error && !card) {
    return (
      <>
        <div className={styles.centered}>
          <p className={styles.error} role="alert">
            {error}
          </p>
          <button
            className={styles.primaryButton}
            onClick={() => void loadCards({ replace: true })}
          >
            Try again
          </button>
          <Link className={styles.textLink} href="/anki">
            Back to sets
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
          <p className={styles.eyebrow}>Session complete</p>
          <h1>You’re caught up</h1>
          <p>
            No more exercises are available right now within your daily new-word
            allowance.
          </p>
          {nextDueAt && (
            <p>Next review: {new Date(nextDueAt).toLocaleString()}.</p>
          )}
          <Link className={styles.textLink} href="/profile">
            Study set settings
          </Link>
          <Link className={styles.primaryButton} href="/anki">
            Back to sets
          </Link>
        </div>
        {failureToast}
      </>
    );
  }

  const newCard = isNewState(card.state.state);
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

  return (
    <>
      <div className={styles.session}>
        <header className={styles.sessionHeader}>
          <div>
            <p className={styles.eyebrow}>Reviewing</p>
            <h1>{card.wordSetName}</h1>
            <p className={styles.languagePair}>
              {promptLanguage.toUpperCase()} → {answerLanguage.toUpperCase()}
            </p>
          </div>
          <Link className={styles.exitLink} href="/anki">
            End session
          </Link>
        </header>

        <main key={card.id} className={styles.card} aria-live="polite">
          <div className={styles.promptSide}>
            <p className={styles.exerciseLabel}>{template.label}</p>
            <p className={styles.promptLabel}>
              {reviewPrompt(card.state.state)}
            </p>
            <h2
              lang={promptLanguage}
              className={isExample ? styles.sentence : undefined}
            >
              {card[template.promptField]}
            </h2>
            {(card.templateKey === "word_forms" || isExample) &&
              card.translation && (
                <p className={styles.supporting} lang={card.targetLang}>
                  {card.translation}
                </p>
              )}
            {sourceVisibleOnPrompt && hasSourceAudio && (
              <SourceAudioButton
                key={card.id}
                ref={audioButtonRef}
                text={card.original}
                sourceLanguage={card.sourceLang}
                shortcut="P"
              />
            )}
            {template.requiresTyping && !revealed && (
              <div className={styles.typedAnswer}>
                <label htmlFor="study-typed-answer">
                  Your answer in {card.sourceLang.toUpperCase()}
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
                  Press Enter to check, then rate your recall.
                </p>
              </div>
            )}
          </div>

          {!revealed ? (
            <button
              className={styles.revealButton}
              onClick={revealAnswer}
              autoFocus={!template.requiresTyping}
            >
              {template.requiresTyping ? "Check answer" : "Show answer"}
              <span className={styles.shortcutHint}>
                {template.requiresTyping ? "Enter" : "Space"}
              </span>
            </button>
          ) : (
            <div className={styles.answerWrap}>
              <div className={styles.answerSide}>
                {typedComparison && (
                  <div
                    className={styles.answerComparison}
                    role="status"
                    aria-label={
                      typedComparison.matches
                        ? "Your answer matches"
                        : "Your answer differs"
                    }
                  >
                    <p className={styles.sideLabel}>Your answer</p>
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
                        : "No answer entered"}
                    </p>
                  </div>
                )}
                <p className={styles.sideLabel}>Answer</p>
                {isExample && card.original && (
                  <p className={styles.answerContext} lang={card.sourceLang}>
                    {card.original}
                  </p>
                )}
                <h2
                  lang={answerLanguage}
                  className={isExample ? styles.sentence : undefined}
                >
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
                    ref={audioButtonRef}
                    text={card.original}
                    sourceLanguage={card.sourceLang}
                    shortcut="P"
                  />
                )}
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
                  {error}
                </p>
              )}

              <div className={styles.ratingArea}>
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
                              ? "Space"
                              : control.shortcut}
                          </span>
                        )}
                        <span className={styles.ratingCopy}>
                          <strong>{control.label}</strong>
                          <small>
                            {formatReviewInterval(preview.intervalMs)}
                          </small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
      {failureToast}
    </>
  );
}
