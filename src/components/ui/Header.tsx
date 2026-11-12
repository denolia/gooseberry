"use client";
import {
  languageLabelKey,
  SourceLanguage,
  SourceLanguageOptions,
  TargetLanguage,
  TargetLanguageOptions,
} from "@/components/ui/Languages";
import { useI18n } from "@/i18n/client";

import styles from "./Header.module.css";
import { signIn, signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { ArrowRightLeft } from "lucide-react";

import { useEffect, useRef, useState } from "react";
import { useLanguages } from "@/lib/languages/useLanguages";
import { LanguageStore } from "@/lib/languages/languageStore";

type LanguageControlProps = {
  id: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  label?: string;
  showLabel?: boolean;
};

function LanguageControl({
  id,
  value,
  options,
  onChange,
  label,
  showLabel = true,
}: LanguageControlProps) {
  const { t } = useI18n();
  return (
    <div className={styles.languageControl}>
      {showLabel && label && (
        <label className={styles.languageLabel} htmlFor={id}>
          {label}
        </label>
      )}
      <div className={styles.selectWrap}>
        <select
          id={id}
          className={styles.languageSelect}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((lang) => (
            <option key={lang} value={lang}>
              {t(languageLabelKey(lang))}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function DesktopLanguageControls() {
  const { currentSourceLanguage, currentTargetLanguage } = useLanguages();

  return (
    <div className={styles.languagePair}>
      <LanguageControl
        id="header-source-language-select"
        value={currentSourceLanguage}
        options={SourceLanguageOptions}
        onChange={(value) =>
          LanguageStore.setCurrentSourceLanguage(value as SourceLanguage)
        }
        showLabel={false}
      />
      <SwapLanguagesButton />
      <LanguageControl
        id="header-target-language-select"
        value={currentTargetLanguage}
        options={TargetLanguageOptions}
        onChange={(value) =>
          LanguageStore.setCurrentTargetLanguage(value as TargetLanguage)
        }
        showLabel={false}
      />
    </div>
  );
}

function SwapLanguagesButton() {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className={styles.swapButton}
      onClick={LanguageStore.swapLanguages}
      aria-label={t("header.swapSourceAndTargetLanguages")}
      title={t("header.swapSourceAndTargetLanguages")}
    >
      <ArrowRightLeft size={18} aria-hidden="true" />
    </button>
  );
}

function MobileLanguageControls() {
  const { t } = useI18n();
  const { currentSourceLanguage, currentTargetLanguage } = useLanguages();

  return (
    <>
      <LanguageControl
        id="header-source-language-select-mobile"
        label={t("header.source")}
        value={currentSourceLanguage}
        options={SourceLanguageOptions}
        onChange={(value) =>
          LanguageStore.setCurrentSourceLanguage(value as SourceLanguage)
        }
      />
      <SwapLanguagesButton />
      <LanguageControl
        id="header-target-language-select-mobile"
        label={t("header.target")}
        value={currentTargetLanguage}
        options={TargetLanguageOptions}
        onChange={(value) =>
          LanguageStore.setCurrentTargetLanguage(value as TargetLanguage)
        }
      />
    </>
  );
}

export function Header() {
  const { t } = useI18n();
  const { data: session } = useSession();

  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMobileMenu && !showAccountMenu) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (
        showMobileMenu &&
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(event.target as Node)
      ) {
        setShowMobileMenu(false);
      }
      if (
        showAccountMenu &&
        accountMenuRef.current &&
        !accountMenuRef.current.contains(event.target as Node)
      ) {
        setShowAccountMenu(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowMobileMenu(false);
        setShowAccountMenu(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showAccountMenu, showMobileMenu]);

  return (
    <header className={styles.container}>
      <Link href="/" className={styles.logo}>
        LEARN.words
      </Link>

      <div className={styles.rightSlot}>
        <div className={styles.desktopActions}>
          {session && <DesktopLanguageControls />}
          {session ? (
            <div className={styles.accountMenu} ref={accountMenuRef}>
              <button
                className={styles.accountButton}
                type="button"
                onClick={() => setShowAccountMenu((open) => !open)}
                aria-expanded={showAccountMenu}
                aria-controls="header-account-menu"
              >
                {session.user.image ? (
                  <img
                    src={session.user.image}
                    alt=""
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span aria-hidden="true">
                    {(session.user.name ||
                      session.user.email ||
                      "U")[0].toUpperCase()}
                  </span>
                )}
                <span className={styles.accountName}>
                  {session.user.name?.split(" ")[0] ||
                    t("profileClient.account")}
                </span>
              </button>
              <div
                id="header-account-menu"
                className={`${styles.accountPanel} ${showAccountMenu ? styles.accountPanelOpen : ""}`}
              >
                <Link href="/profile" onClick={() => setShowAccountMenu(false)}>
                  {t("header.profile")}
                </Link>
                <Link href="/stats" onClick={() => setShowAccountMenu(false)}>
                  {t("header.stats")}
                </Link>
                {session.user.isAdmin && (
                  <Link href="/admin" onClick={() => setShowAccountMenu(false)}>
                    {t("header.admin")}
                  </Link>
                )}
                <button type="button" onClick={() => signOut()}>
                  {t("header.signOut")}
                </button>
              </div>
            </div>
          ) : (
            <button
              className={styles.primaryAction}
              onClick={() => signIn("google")}
            >
              {t("header.signIn")}
            </button>
          )}
        </div>

        <div className={styles.mobileMenu} ref={mobileMenuRef}>
          <button
            className={styles.menuButton}
            type="button"
            onClick={() => setShowMobileMenu((open) => !open)}
            aria-expanded={showMobileMenu}
            aria-controls="header-mobile-menu"
            aria-label={t("header.toggleHeaderMenu")}
          >
            <span className={styles.menuGraphic} aria-hidden="true" />
          </button>

          <div
            className={`${styles.mobilePanel} ${showMobileMenu ? styles.mobilePanelOpen : ""}`}
            id="header-mobile-menu"
            aria-hidden={!showMobileMenu}
          >
            {session && (
              <>
                <div className={styles.mobileIdentity}>
                  {session.user.image ? (
                    <img
                      src={session.user.image}
                      alt=""
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span aria-hidden="true">
                      {(session.user.name ||
                        session.user.email ||
                        "U")[0].toUpperCase()}
                    </span>
                  )}
                  <strong className={styles.mobileIdentityName}>
                    {session.user.name ||
                      session.user.email ||
                      t("profileClient.account")}
                  </strong>
                </div>
                <MobileLanguageControls />
              </>
            )}
            {session ? (
              <>
                <Link href="/profile" onClick={() => setShowMobileMenu(false)}>
                  {t("header.profile")}
                </Link>
                <Link href="/stats" onClick={() => setShowMobileMenu(false)}>
                  {t("header.stats")}
                </Link>
                {session.user.isAdmin && (
                  <Link href="/admin" onClick={() => setShowMobileMenu(false)}>
                    {t("header.admin")}
                  </Link>
                )}
                <button
                  className={styles.secondaryAction}
                  onClick={() => {
                    setShowMobileMenu(false);
                    signOut();
                  }}
                >
                  {t("header.signOut")}
                </button>
              </>
            ) : (
              <button
                className={styles.primaryAction}
                onClick={() => {
                  setShowMobileMenu(false);
                  signIn("google");
                }}
              >
                {t("header.signIn")}
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
