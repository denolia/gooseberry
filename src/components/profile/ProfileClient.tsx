"use client";

import { useState } from "react";
import Link from "next/link";
import {
  SourceLanguage,
  SourceLanguageOptions,
  TargetLanguage,
  TargetLanguageOptions,
} from "@/components/ui/Languages";
import { LanguageStore } from "@/lib/languages/languageStore";
import { ReviewMode, type ReviewModeValue } from "@/lib/review/model";
import styles from "./ProfileClient.module.css";

type Profile = {
  email: string | null;
  name: string | null;
  imageUrl: string | null;
  tier: "free" | "premium";
  createdAt: string | Date;
  premiumGrantedAt: string | Date | null;
  preferences: {
    defaultSourceLang: SourceLanguage;
    defaultTargetLang: TargetLanguage;
    reviewMode: ReviewModeValue;
  };
  pendingRequest: {
    id: string;
    message: string | null;
    createdAt: string | Date;
  } | null;
};

export function ProfileClient({ initialProfile }: { initialProfile: Profile }) {
  const [sourceLang, setSourceLang] = useState(
    initialProfile.preferences.defaultSourceLang,
  );
  const [targetLang, setTargetLang] = useState(
    initialProfile.preferences.defaultTargetLang,
  );
  const [reviewMode, setReviewMode] = useState(
    initialProfile.preferences.reviewMode,
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [preferenceError, setPreferenceError] = useState("");
  const [message, setMessage] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [pendingRequest, setPendingRequest] = useState(
    initialProfile.pendingRequest,
  );

  async function savePreferences(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setPreferenceError("");
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultSourceLang: sourceLang,
          defaultTargetLang: targetLang,
          reviewMode,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(body.error || "Could not save settings.");
      LanguageStore.setCurrentSourceLanguage(sourceLang);
      LanguageStore.setCurrentTargetLanguage(targetLang);
      setSaved(true);
    } catch (error) {
      setPreferenceError(
        error instanceof Error ? error.message : "Could not save settings.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function requestPremium(event: React.FormEvent) {
    event.preventDefault();
    setRequesting(true);
    setRequestError("");
    try {
      const response = await fetch("/api/premium-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(body.error || "Could not send request.");
      setPendingRequest({
        id: body.request.id,
        message: message || null,
        createdAt: body.request.createdAt,
      });
      setMessage("");
    } catch (error) {
      setRequestError(
        error instanceof Error ? error.message : "Could not send request.",
      );
    } finally {
      setRequesting(false);
    }
  }

  return (
    <div className={styles.grid}>
      <section className={styles.card} aria-labelledby="account-heading">
        <p className={styles.eyebrow}>Account</p>
        <div className={styles.identity}>
          {initialProfile.imageUrl ? (
            <img
              src={initialProfile.imageUrl}
              alt=""
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className={styles.avatarFallback} aria-hidden="true">
              {(initialProfile.name ||
                initialProfile.email ||
                "U")[0].toUpperCase()}
            </span>
          )}
          <div>
            <h2 id="account-heading">
              {initialProfile.name || "Learn.words user"}
            </h2>
            <p>{initialProfile.email || "No email provided"}</p>
          </div>
        </div>
        <dl className={styles.details}>
          <div>
            <dt>Plan</dt>
            <dd>
              <span className={`${styles.tier} ${styles[initialProfile.tier]}`}>
                {initialProfile.tier === "premium" ? "Premium" : "Free"}
              </span>
            </dd>
          </div>
          <div>
            <dt>Member since</dt>
            <dd>{new Date(initialProfile.createdAt).toLocaleDateString()}</dd>
          </div>
        </dl>

        {initialProfile.tier === "premium" ? (
          <div className={styles.notice}>
            Premium access is active. You can include AI pronunciation when
            exporting Anki decks.
          </div>
        ) : pendingRequest ? (
          <div className={styles.notice} role="status">
            <strong>Premium request pending</strong>
            <span>
              Sent {new Date(pendingRequest.createdAt).toLocaleDateString()}.
              You’ll receive access after an administrator approves it.
            </span>
          </div>
        ) : (
          <form className={styles.requestForm} onSubmit={requestPremium}>
            <label htmlFor="premium-message">
              Request Premium
              <span>Optional message</span>
            </label>
            <textarea
              id="premium-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Tell us what you’d like to use Premium for."
            />
            <div className={styles.formFooter}>
              <small>{message.length}/500</small>
              <button disabled={requesting}>
                {requesting ? "Sending…" : "Request Premium"}
              </button>
            </div>
            {requestError && <p className={styles.error}>{requestError}</p>}
          </form>
        )}
      </section>

      <section className={styles.card} aria-labelledby="preferences-heading">
        <p className={styles.eyebrow}>Preferences</p>
        <h2 id="preferences-heading">Learning preferences</h2>
        <p className={styles.intro}>
          Choose your language defaults and how much detail you want while
          reviewing.
        </p>
        <form className={styles.preferences} onSubmit={savePreferences}>
          <label>
            Source language
            <select
              value={sourceLang}
              onChange={(event) =>
                setSourceLang(event.target.value as SourceLanguage)
              }
            >
              {SourceLanguageOptions.map((language) => (
                <option key={language}>{language}</option>
              ))}
            </select>
          </label>
          <label>
            Translation language
            <select
              value={targetLang}
              onChange={(event) =>
                setTargetLang(event.target.value as TargetLanguage)
              }
            >
              {TargetLanguageOptions.map((language) => (
                <option key={language}>{language}</option>
              ))}
            </select>
          </label>
          <fieldset className={styles.reviewMode}>
            <legend>Review buttons</legend>
            <label>
              <input
                type="radio"
                name="review-mode"
                value={ReviewMode.Simple}
                checked={reviewMode === ReviewMode.Simple}
                onChange={() => setReviewMode(ReviewMode.Simple)}
              />
              <span>
                <strong>Simple</strong>
                <small>Answer with Yes or No.</small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="review-mode"
                value={ReviewMode.Full}
                checked={reviewMode === ReviewMode.Full}
                onChange={() => setReviewMode(ReviewMode.Full)}
              />
              <span>
                <strong>Full</strong>
                <small>Use Again, Hard, Good, and Easy.</small>
              </span>
            </label>
          </fieldset>
          <div className={styles.formFooter}>
            <span className={styles.saved} role="status">
              {saved ? "Settings saved" : ""}
            </span>
            <button disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </button>
          </div>
          {preferenceError && <p className={styles.error}>{preferenceError}</p>}
        </form>
        <Link className={styles.backLink} href="/">
          ← Back to learning
        </Link>
      </section>
    </div>
  );
}
