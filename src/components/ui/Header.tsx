"use client";
import styles from "./Header.module.css";
import { signIn, signOut, useSession } from "next-auth/react";
import Link from "next/link";

import { useEffect, useRef, useState } from "react";
import { Language, LanguageOptions } from "@/components/ui/Languages";
import { useCurrentLanguage } from "@/lib/languages/useCurrentLanguage";
import { LanguageStore } from "@/lib/languages/languageStore";

export function Header() {
  const { data: session } = useSession();
  const currentLanguage = useCurrentLanguage();

  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  const onChangeLanguage = (value: Language) => {
    LanguageStore.setCurrentLanguage(value);
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

  const renderLanguageControl = (id: string) => (
    <div className={styles.languageControl}>
      <div className={styles.selectWrap}>
        <select
          id={id}
          className={styles.languageSelect}
          value={currentLanguage}
          onChange={(e) => onChangeLanguage(e.target.value as Language)}
        >
          {LanguageOptions.map((lang) => (
            <option key={lang} value={lang}>
              {lang}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  return (
    <header className={styles.container}>
      <Link href="/" className={styles.logo}>
        LEARN.words
      </Link>

      <div className={styles.rightSlot}>
        <div className={styles.desktopActions}>
          {session && renderLanguageControl("header-language-select")}
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
            {session && renderLanguageControl("header-language-select-mobile")}
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
