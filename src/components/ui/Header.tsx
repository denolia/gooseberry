"use client";
import styles from "./Header.module.css";
import { signIn, signOut, useSession } from "next-auth/react";

import { useEffect, useState } from "react";
import { Language, LanguageOptions, Languages } from "@/components/ui/Languages";

export function Header() {
  const { data: session } = useSession();
  const [currentLanguage, setCurrentLanguage] = useState<Language>(Languages.German);
  const [showLanguage, setShowLanguage] = useState<boolean>(true);

  useEffect(() => {
    try {
      const savedLang = localStorage.getItem("currentLanguage") as Language | null;
      if (savedLang && Languages[savedLang]) {
        setCurrentLanguage(savedLang);
      }
    } catch {}
  }, []);

  const onChangeLanguage = (value: Language) => {
    setCurrentLanguage(value);
    try {
      localStorage.setItem("currentLanguage", value);
      // Notify other tabs/components (like WordInput) via storage event
      window.dispatchEvent(new StorageEvent("storage", { key: "currentLanguage", newValue: value }));
    } catch (e) {
      console.error("Failed to save language to localStorage ", e);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.logo}>LEARN.words</div>
      <div className={styles.rightControls}>
        {session && (
          <>
            <button className={styles.signInButton} onClick={() => signOut()}>
              Sign out
            </button>
            <div className={`${styles.languageRow}`}>
              <div className={`${styles.languageTray} ${showLanguage ? styles.visible : ""}`} aria-hidden={!showLanguage}>
                <label className={styles.languageLabel} htmlFor="header-language-select">Language:</label>
                <select
                  id="header-language-select"
                  className={styles.languageSelect}
                  value={currentLanguage}
                  onChange={(e) => onChangeLanguage(e.target.value as Language)}
                  tabIndex={showLanguage ? 0 : -1}
                >
                  {LanguageOptions.map((lang) => (
                    <option key={lang} value={lang}>
                      {lang}
                    </option>
                  ))}
                </select>
              </div>
              <button
                className={styles.langToggleButton}
                onClick={() => setShowLanguage((v) => !v)}
                aria-expanded={showLanguage}
                aria-controls="header-language-select"
                title="Show/Hide language selector"
              >
                文A
              </button>
            </div>
          </>
        )}

        {!session && (
          <button
            className={styles.signInButton}
            onClick={() => signIn("google")}
          >
            Sign in
          </button>
        )}
      </div>
    </div>
  );
}
