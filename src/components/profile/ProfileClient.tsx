"use client";
import type { UiMessage } from "@/i18n/messages";
import { messageFromError, errorFromResponse } from "@/i18n/errors";

import { useI18n } from "@/i18n/client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isUiLocale, type UiLocale } from "@/i18n/locale";
import Link from "next/link";
import { ReviewMode, type ReviewModeValue } from "@/lib/review/model";
import { isStudyTimeZone } from "@/lib/review/settings";
import styles from "./ProfileClient.module.css";

type Profile = {
  email: string | null;
  name: string | null;
  imageUrl: string | null;
  tier: "free" | "premium";
  createdAt: string | Date;
  premiumGrantedAt: string | Date | null;
  preferences: {
    uiLocale: UiLocale | null;
    reviewMode: ReviewModeValue;
    newWordsPerDay: number;
    studyTimeZone: string;
  };
  pendingRequest: {
    id: string;
    message: string | null;
    createdAt: string | Date;
  } | null;
};

export function ProfileClient({ initialProfile }: { initialProfile: Profile }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [uiLocale, setUiLocale] = useState(
    initialProfile.preferences.uiLocale ?? locale,
  );
  const [reviewMode, setReviewMode] = useState(
    initialProfile.preferences.reviewMode,
  );
  const [saving, setSaving] = useState(false);
  const [newWordsPerDay, setNewWordsPerDay] = useState(
    String(initialProfile.preferences.newWordsPerDay),
  );
  const [studyTimeZone, setStudyTimeZone] = useState(
    initialProfile.preferences.studyTimeZone,
  );
  const [saved, setSaved] = useState(false);
  const [preferenceError, setPreferenceError] = useState<UiMessage | null>(
    null,
  );
  const [message, setMessage] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<UiMessage | null>(null);
  const [pendingRequest, setPendingRequest] = useState(
    initialProfile.pendingRequest,
  );
  // Server and browser defaults can differ during hydration.
  const dateFormatter = new Intl.DateTimeFormat(locale, { timeZone: "UTC" });

  async function savePreferences(event: React.FormEvent) {
    event.preventDefault();
    if (!isStudyTimeZone(studyTimeZone)) {
      setPreferenceError({
        key: "errors.chooseAValidStudyTimeZoneSuchAsEuropeBerlin",
      });
      return;
    }
    setSaving(true);
    setSaved(false);
    setPreferenceError(null);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewMode,
          newWordsPerDay: Number(newWordsPerDay),
          studyTimeZone,
          uiLocale,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw errorFromResponse(body, "errors.couldNotSaveSettings");
      const savedLocale = body.preferences?.uiLocale;
      if (isUiLocale(savedLocale) && savedLocale !== locale) {
        // Recreate the root provider and server-rendered content together.
        window.location.reload();
        return;
      }
      setSaved(true);
      router.refresh();
    } catch (error) {
      setPreferenceError(
        messageFromError(error, "errors.couldNotSaveSettings"),
      );
    } finally {
      setSaving(false);
    }
  }

  async function requestPremium(event: React.FormEvent) {
    event.preventDefault();
    setRequesting(true);
    setRequestError(null);
    try {
      const response = await fetch("/api/premium-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw errorFromResponse(body, "errors.couldNotSendRequest");
      setPendingRequest({
        id: body.request.id,
        message: message || null,
        createdAt: body.request.createdAt,
      });
      setMessage("");
    } catch (error) {
      setRequestError(messageFromError(error, "errors.couldNotSendRequest"));
    } finally {
      setRequesting(false);
    }
  }

  return (
    <div className={styles.grid}>
      <section className={styles.card} aria-labelledby="account-heading">
        <p className={styles.eyebrow}>{t("profileClient.account")}</p>
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
              {initialProfile.name || t("profileClient.learnWordsUser")}
            </h2>
            <p>{initialProfile.email || t("profileClient.noEmailProvided")}</p>
          </div>
        </div>
        <dl className={styles.details}>
          <div>
            <dt>{t("profileClient.plan")}</dt>
            <dd>
              <span className={`${styles.tier} ${styles[initialProfile.tier]}`}>
                {initialProfile.tier === "premium"
                  ? t("premiumTierControl.premium")
                  : t("premiumTierControl.free")}
              </span>
            </dd>
          </div>
          <div>
            <dt>{t("profileClient.memberSince")}</dt>
            <dd>{dateFormatter.format(new Date(initialProfile.createdAt))}</dd>
          </div>
        </dl>

        {initialProfile.tier === "premium" ? (
          <div className={styles.notice}>
            {t("profileClient.premiumAccessIsActiveYouCanListenToFullTexts")}
          </div>
        ) : pendingRequest ? (
          <div className={styles.notice} role="status">
            <strong>{t("profileClient.premiumRequestPending")}</strong>
            <span>
              {t("profileClient.requestSent", {
                date: dateFormatter.format(new Date(pendingRequest.createdAt)),
              })}
            </span>
          </div>
        ) : (
          <form className={styles.requestForm} onSubmit={requestPremium}>
            <label htmlFor="premium-message">
              {t("profileClient.requestPremium")}
              <span>{t("profileClient.optionalMessage")}</span>
            </label>
            <textarea
              id="premium-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder={t("profileClient.tellUsWhatYouDLikeToUsePremiumFor")}
            />
            <div className={styles.formFooter}>
              <small>{message.length}/500</small>
              <button disabled={requesting}>
                {requesting
                  ? t("profileClient.sending")
                  : t("profileClient.requestPremium")}
              </button>
            </div>
            {requestError && (
              <p className={styles.error}>
                {t(requestError.key, requestError.values)}
              </p>
            )}
          </form>
        )}
      </section>

      <section className={styles.card} aria-labelledby="preferences-heading">
        <p className={styles.eyebrow}>{t("profileClient.preferences")}</p>
        <h2 id="preferences-heading">
          {t("profileClient.learningPreferences")}
        </h2>
        <p className={styles.intro}>
          {t("profileClient.chooseHowYouAnswerWhileReviewing")}
        </p>
        <form className={styles.preferences} onSubmit={savePreferences}>
          <div className={styles.studySettings}>
            <label htmlFor="interface-language">
              {t("profileClient.interfaceLanguage")}
              <select
                id="interface-language"
                aria-describedby="interface-language-help"
                disabled={saving}
                value={uiLocale}
                onChange={(event) => {
                  setUiLocale(event.target.value as UiLocale);
                  setSaved(false);
                }}
              >
                <option value="en">English</option>
                <option value="ru">Русский</option>
              </select>
            </label>
            <p id="interface-language-help" className={styles.intro}>
              {t(
                "profileClient.chooseTheLanguageForButtonsTabsAndOtherInterfaceTextYour",
              )}
            </p>
          </div>
          <fieldset className={styles.reviewMode}>
            <legend>{t("profileClient.reviewButtons")}</legend>
            <label>
              <input
                type="radio"
                name="review-mode"
                value={ReviewMode.Simple}
                checked={reviewMode === ReviewMode.Simple}
                onChange={() => setReviewMode(ReviewMode.Simple)}
              />
              <span>
                <strong>{t("profileClient.simple")}</strong>
                <small>{t("profileClient.answerWithYesOrNo")}</small>
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
                <strong>{t("profileClient.full")}</strong>
                <small>{t("profileClient.useAgainHardGoodAndEasy")}</small>
              </span>
            </label>
          </fieldset>
          <fieldset className={styles.studySettings}>
            <legend>{t("profileClient.studySetSettings")}</legend>
            <label htmlFor="new-words-per-day">
              {t("profileClient.newWordsPerDayPerSet")}
              <input
                id="new-words-per-day"
                type="number"
                min={0}
                max={1000}
                step={1}
                required
                value={newWordsPerDay}
                onChange={(event) => {
                  setNewWordsPerDay(event.target.value);
                  setSaved(false);
                }}
              />
            </label>
            <p className={styles.intro}>
              {t(
                "profileClient.eachWordCountsOnceAcrossItsExercisesDueReviewsCome",
              )}
            </p>
            <label htmlFor="study-time-zone">
              {t("importDeck.studyTimeZone")}
              <input
                id="study-time-zone"
                type="text"
                required
                value={studyTimeZone}
                onChange={(event) => {
                  setStudyTimeZone(event.target.value.trim());
                  setSaved(false);
                }}
              />
            </label>
            <button
              className={styles.timeZoneButton}
              type="button"
              onClick={() => {
                setStudyTimeZone(
                  Intl.DateTimeFormat().resolvedOptions().timeZone,
                );
                setSaved(false);
              }}
            >
              {t("profileClient.useMyTimeZone")}
            </button>
            <p className={styles.intro}>
              {t(
                "profileClient.yourDailyAllowanceResetsAtMidnightInThisTimeZone",
              )}
            </p>
          </fieldset>
          <div className={styles.formFooter}>
            <span className={styles.saved} role="status">
              {saved ? t("profileClient.settingsSaved") : ""}
            </span>
            <button disabled={saving}>
              {saving
                ? t("premiumTierControl.saving")
                : t("profileClient.saveSettings")}
            </button>
          </div>
          {preferenceError && (
            <p className={styles.error}>
              {t(preferenceError.key, preferenceError.values)}
            </p>
          )}
        </form>
        <Link className={styles.backLink} href="/">
          {t("profileClient.backToLearning")}
        </Link>
      </section>
    </div>
  );
}
