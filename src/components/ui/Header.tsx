"use client";
import styles from "./Header.module.css";
import { signIn, signOut, useSession } from "next-auth/react";
import Link from "next/link";

import { useEffect, useRef, useState } from "react";
import {
  Language,
  LanguageOptions,
  TargetLanguage,
  TargetLanguageOptions,
} from "@/components/ui/Languages";
import { useLanguages } from "@/lib/languages/useLanguages";
import { LanguageStore } from "@/lib/languages/languageStore";

export function Header() {
  const { data: session } = useSession();
  const { currentSourceLanguage, currentTargetLanguage } = useLanguages();

  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  const onChangeSourceLanguage = (value: Language) => {
    LanguageStore.setCurrentSourceLanguage(value);
  };

  const onChangeTargetLanguage = (value: TargetLanguage) => {
    LanguageStore.setCurrentTargetLanguage(value);
  };

  useEffect(() => {
    if (!showMobileMenu) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(event.target as Node)
      ) {
        setShowMobileMenu(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowMobileMenu(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showMobileMenu]);

  const renderLanguageControl = ({
    id,
    label,
    value,
    options,
    onChange,
  }: {
    id: string;
    label: string;
    value: string | null;
    options: readonly string[];
    onChange: (value: string) => void;
  }) => (
    <div className={styles.languageControl}>
      <label className={styles.languageLabel} htmlFor={id}>
        {label}
      </label>
      <div className={styles.selectWrap}>
        {value && (
          <select
            id={id}
            className={styles.languageSelect}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            {options.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );

  const renderLanguageControls = (idSuffix: string) => (
    <>
      {renderLanguageControl({
        id: `header-source-language-select${idSuffix}`,
        label: "Source",
        value: currentSourceLanguage,
        options: LanguageOptions,
        onChange: (value) => onChangeSourceLanguage(value as Language),
      })}
      {renderLanguageControl({
        id: `header-target-language-select${idSuffix}`,
        label: "Target",
        value: currentTargetLanguage,
        options: TargetLanguageOptions,
        onChange: (value) => onChangeTargetLanguage(value as TargetLanguage),
      })}
    </>
  );

  return (
    <header className={styles.container}>
      <Link href="/" className={styles.logo}>
        LEARN.words
      </Link>

      <div className={styles.rightSlot}>
        <div className={styles.desktopActions}>
          {session && renderLanguageControls("")}
          {session ? (
            <button
              className={styles.secondaryAction}
              onClick={() => signOut()}
            >
              Sign out
            </button>
          ) : (
            <button
              className={styles.primaryAction}
              onClick={() => signIn("google")}
            >
              Sign in
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
            aria-label="Toggle header menu"
          >
            <span className={styles.menuGraphic} aria-hidden="true" />
          </button>

          <div
            className={`${styles.mobilePanel} ${showMobileMenu ? styles.mobilePanelOpen : ""}`}
            id="header-mobile-menu"
            aria-hidden={!showMobileMenu}
          >
            {session && renderLanguageControls("-mobile")}
            {session ? (
              <button
                className={styles.secondaryAction}
                onClick={() => {
                  setShowMobileMenu(false);
                  signOut();
                }}
              >
                Sign out
              </button>
            ) : (
              <button
                className={styles.primaryAction}
                onClick={() => {
                  setShowMobileMenu(false);
                  signIn("google");
                }}
              >
                Sign in
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
