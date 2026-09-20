"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  isLearningState,
  reviewControls,
  reviewPrompt,
} from "@/lib/review/controls";
import { formatReviewInterval } from "@/lib/review/formatInterval";
import type { FsrsCardStateValue, ReviewModeValue } from "@/lib/review/model";
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

export function ReviewSession({
  wordSetId,
  reviewMode,
}: {
  wordSetId: string;
  reviewMode: ReviewModeValue;
}) {
  const { status } = useSession();
  const router = useRouter();
  const [card, setCard] = useState<ReviewCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownAt = useRef(0);

  const loadNextCard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/word-sets/${wordSetId}/review`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Could not load the next review.");
      }
      const body = (await response.json()) as { card: ReviewCard | null };
      setCard(body.card);
      setRevealed(false);
      shownAt.current = performance.now();
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load the next review.",
      );
    } finally {
      setLoading(false);
    }
  }, [wordSetId]);

  useEffect(() => {
    if (status === "authenticated") void loadNextCard();
    if (status === "unauthenticated") router.replace("/");
  }, [loadNextCard, router, status]);

  const submitRating = useCallback(
    async (rating: Rating) => {
      if (!card || !revealed || submitting) return;

      setSubmitting(true);
      setError(null);
      try {
        const response = await fetch(`/api/word-sets/${wordSetId}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studyCardId: card.id,
            rating,
            durationMs: Math.max(
              0,
              Math.round(performance.now() - shownAt.current),
            ),
          }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || "Could not save this review.");
        }
        await loadNextCard();
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Could not save this review.",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [card, loadNextCard, revealed, submitting, wordSetId],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!revealed && (event.key === " " || event.key === "Enter")) {
        event.preventDefault();
        setRevealed(true);
        return;
      }
      if (revealed && card) {
        const control = reviewControls(card.state.state, reviewMode).find(
          ({ shortcut }) => shortcut === event.key,
        );
        if (!control) return;
        event.preventDefault();
        void submitRating(control.rating);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [card, revealed, reviewMode, submitRating]);

  if (status === "loading" || loading) {
    return (
      <div className={styles.centered} aria-busy="true">
        Loading review…
      </div>
    );
  }

  if (status !== "authenticated") return null;

  if (error && !card) {
    return (
      <div className={styles.centered}>
        <p className={styles.error} role="alert">
          {error}
        </p>
        <button className={styles.primaryButton} onClick={loadNextCard}>
          Try again
        </button>
        <Link className={styles.textLink} href={`/anki/${wordSetId}`}>
          Back to set
        </Link>
      </div>
    );
  }

  if (!card) {
    return (
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
    );
  }

  const learning = isLearningState(card.state.state);
  const controls = reviewControls(card.state.state, reviewMode);

  return (
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
          <p className={styles.promptLabel}>{reviewPrompt(card.state.state)}</p>
          <h2>{card.original}</h2>
        </div>

        {!revealed ? (
          <button
            className={styles.revealButton}
            onClick={() => setRevealed(true)}
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
              {!learning && <p>Do you remember it?</p>}
              <div
                className={`${styles.ratings} ${
                  learning
                    ? styles.learningRatings
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
                      } ${learning ? styles.okButton : ""}`}
                      disabled={submitting}
                      onClick={() => void submitRating(control.rating)}
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
  );
}
