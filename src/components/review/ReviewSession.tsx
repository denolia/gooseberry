"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  isNewState,
  reviewControls,
  reviewPrompt,
} from "@/lib/review/controls";
import { formatReviewInterval } from "@/lib/review/formatInterval";
import type { FsrsCardStateValue, ReviewModeValue } from "@/lib/review/model";
import { withAutomaticRetries } from "@/lib/review/retry";
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
  state: { state: FsrsCardStateValue };
  ratings: RatingPreview[];
};

type ReviewSubmission = {
  reviewId: string;
  studyCardId: string;
  rating: Rating;
  reviewedAt: string;
  durationMs: number;
};

const QUEUE_LOW_WATERMARK = 5;
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
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedReviews, setFailedReviews] = useState<ReviewSubmission[]>([]);
  const cardsRef = useRef<ReviewCard[]>([]);
  const pendingReviewsRef = useRef(new Map<string, ReviewSubmission>());
  const failedReviewsRef = useRef<ReviewSubmission[]>([]);
  const ignoredCardIdsRef = useRef(new Set<string>());
  const loadingQueueRef = useRef(false);
  const revealedCardIdRef = useRef<string | null>(null);
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

        const body = (await response.json()) as { cards: ReviewCard[] };
        const existingIds = new Set(currentCards.map(({ id }) => id));
        const incoming = body.cards.filter(({ id }) => !existingIds.has(id));
        const nextCards = replace ? incoming : [...currentCards, ...incoming];
        const startsNewCard = currentCards.length === 0 && nextCards.length > 0;
        updateCards(nextCards);

        if (replace || startsNewCard) {
          setRevealed(false);
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
        });
        pendingReviewsRef.current.delete(submission.reviewId);
      } catch {
        pendingReviewsRef.current.delete(submission.reviewId);
        updateFailedReviews((current) =>
          current.some(({ reviewId }) => reviewId === submission.reviewId)
            ? current
            : [...current, submission],
        );
      } finally {
        if (cardsRef.current.length <= QUEUE_LOW_WATERMARK) {
          void loadCards();
        }
      }
    },
    [loadCards, updateFailedReviews, wordSetId],
  );

  useEffect(() => {
    if (status === "authenticated") void loadCards({ replace: true });
    if (status === "unauthenticated") router.replace("/");
  }, [loadCards, router, status]);

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
      setError(null);
      shownAt.current = performance.now();
      void sendReview(submission);

      if (remainingCards.length <= QUEUE_LOW_WATERMARK) {
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
    if (cardsRef.current.length <= QUEUE_LOW_WATERMARK) void loadCards();
  }, [loadCards, updateFailedReviews]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
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
          <Link className={styles.textLink} href={`/anki/${wordSetId}`}>
            Back to set
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
          <p>No cards in this set are due right now.</p>
          <Link className={styles.primaryButton} href={`/anki/${wordSetId}`}>
            Back to set
          </Link>
        </div>
        {failureToast}
      </>
    );
  }

  const newCard = isNewState(card.state.state);
  const controls = reviewControls(card.state.state, reviewMode);

  return (
    <>
      <div className={styles.session}>
        <header className={styles.sessionHeader}>
          <div>
            <p className={styles.eyebrow}>Reviewing</p>
            <h1>{card.wordSetName}</h1>
            <p className={styles.languagePair}>
              {card.sourceLang.toUpperCase()} → {card.targetLang.toUpperCase()}
            </p>
          </div>
          <Link className={styles.exitLink} href={`/anki/${wordSetId}`}>
            End session
          </Link>
        </header>

        <main className={styles.card} aria-live="polite">
          <div className={styles.promptSide}>
            <p className={styles.promptLabel}>
              {reviewPrompt(card.state.state)}
            </p>
            <h2>{card.original}</h2>
          </div>

          {!revealed ? (
            <button
              className={styles.revealButton}
              onClick={revealAnswer}
              autoFocus
            >
              Show answer
              <span className={styles.shortcutHint}>Space</span>
            </button>
          ) : (
            <div className={styles.answerWrap}>
              <div className={styles.answerSide}>
                <p className={styles.sideLabel}>Answer</p>
                <h2>{card.translation}</h2>
                {card.wordForms && (
                  <p className={styles.supporting}>{card.wordForms}</p>
                )}
                {card.sample && (
                  <div className={styles.example}>
                    <p>{card.sample}</p>
                    {card.sampleTranslation && <p>{card.sampleTranslation}</p>}
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
                {!newCard && <p>Do you remember it?</p>}
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
                            {control.shortcut}
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
