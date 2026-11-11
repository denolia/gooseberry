"use client";
import { languageLabelKey } from "@/components/ui/Languages";

import { useI18n } from "@/i18n/client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import styles from "./SignedOutLanding.module.css";

const words = [
  {
    word: "rêver",
    language: "French",
    code: "fr",
    meaning: "to dream",
    example: "On peut toujours rêver.",
    translation: "We can always dream.",
  },
  {
    word: "mögen",
    language: "German",
    code: "de",
    meaning: "to like",
    example: "Ich mag neue Wörter.",
    translation: "I like new words.",
  },
  {
    word: "sueño",
    language: "Spanish",
    code: "es",
    meaning: "a dream",
    example: "Todo empieza con un sueño.",
    translation: "Everything begins with a dream.",
  },
  {
    word: "håp",
    language: "Norwegian",
    code: "no",
    meaning: "hope",
    example: "Det er alltid håp.",
    translation: "There is always hope.",
  },
];

const glyphs = [
  "ø",
  "あ",
  "ë",
  "ß",
  "ñ",
  "ж",
  "ç",
  "å",
  "ü",
  "æ",
  "é",
  "字",
  "ő",
  "ł",
  "ψ",
  "œ",
  "ї",
  "&",
];

const steps = [
  {
    number: "01",
    titleKey: "signedOutLanding.findAWord",
    textKey:
      "signedOutLanding.aWordThatStopsYouASentenceYouAlmostUnderstandStart",
    detailKey: "signedOutLanding.translateWordsPhrases",
  },
  {
    number: "02",
    titleKey: "signedOutLanding.findTheMeaning",
    textKey:
      "signedOutLanding.goBeyondTheTranslationExploreGrammarExamplesAndTheLittleDetails",
    detailKey: "signedOutLanding.understandInContext",
  },
  {
    number: "03",
    titleKey: "signedOutLanding.makeItYours",
    textKey:
      "signedOutLanding.collectYourDiscoveriesInWordSetsExportThemToAnkiAnd",
    detailKey: "signedOutLanding.collectPracticeWithAnki",
  },
] as const;

export function SignedOutLanding() {
  const { t } = useI18n();
  const [activeWord, setActiveWord] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [inView, setInView] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState(false);
  const heroRef = useRef<HTMLElement>(null);
  const word = words[activeWord];
  const motionPaused = paused || reducedMotion || !inView || !pageVisible;

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(preference.matches);
    const updateVisibility = () => setPageVisible(!document.hidden);
    updatePreference();
    updateVisibility();
    preference.addEventListener("change", updatePreference);
    document.addEventListener("visibilitychange", updateVisibility);
    const observer = new IntersectionObserver(([entry]) =>
      setInView(entry.isIntersecting),
    );
    if (heroRef.current) observer.observe(heroRef.current);
    return () => {
      preference.removeEventListener("change", updatePreference);
      document.removeEventListener("visibilitychange", updateVisibility);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (motionPaused) return;
    const timer = window.setTimeout(
      () => setActiveWord((current) => (current + 1) % words.length),
      8000,
    );
    return () => window.clearTimeout(timer);
  }, [activeWord, motionPaused]);

  async function startLearning() {
    setSigningIn(true);
    setSignInError(false);
    try {
      await signIn("google", { redirectTo: "/" });
    } catch {
      setSignInError(true);
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <div
      className={styles.landing}
      data-paused={paused || reducedMotion || !pageVisible}
    >
      <a className={styles.skipLink} href="#landing-main">
        {t("signedOutLanding.skipToContent")}
      </a>
      <header className={styles.header}>
        <Link
          href="/"
          className={styles.logo}
          aria-label={t("signedOutLanding.learnWordsHome")}
        >
          LEARN.words
        </Link>
        <nav
          className={styles.navigation}
          aria-label={t("signedOutLanding.landingPage")}
        >
          <a className={styles.aboutLink} href="#how-it-works">
            {t("signedOutLanding.theIdea")}
          </a>
          <button
            className={styles.signIn}
            onClick={startLearning}
            disabled={signingIn}
          >
            {signingIn ? t("signedOutLanding.connecting") : t("header.signIn")}
            <span aria-hidden="true">↗</span>
          </button>
        </nav>
      </header>

      <main id="landing-main">
        <section
          className={styles.hero}
          ref={heroRef}
          aria-labelledby="landing-title"
        >
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>
              <span className={styles.blueDot} />{" "}
              {t("signedOutLanding.aLittleCuriosityAWholeNewWorld")}
            </p>
            <h1 id="landing-title">
              {t("signedOutLanding.strangeLetters")}
              <br />
              {t("signedOutLanding.familiar")}{" "}
              <span className={styles.meaning}>
                {t("signedOutLanding.feelings")}
              </span>
            </h1>
            <p className={styles.intro}>
              {t("signedOutLanding.thenSuddenlyItClicks")}
              <br />
              {t(
                "signedOutLanding.turnTheWordsYouDiscoverIntoALanguageThatFeels",
              )}
            </p>
            <div className={styles.heroActions}>
              <button
                className={styles.primaryButton}
                onClick={startLearning}
                disabled={signingIn}
              >
                {signingIn
                  ? t("signedOutLanding.connecting")
                  : t("signedOutLanding.findYourFirstWord")}
                <span aria-hidden="true">↗</span>
              </button>
              <span className={styles.ctaNote}>
                {t("signedOutLanding.yourCuriosityYourVocabulary")}
              </span>
            </div>
          </div>

          <div className={styles.wordScene} data-paused={motionPaused}>
            <div className={styles.sceneTopline}>
              <span>{t("signedOutLanding.fromLettersToPossibility")}</span>
              <span>0{activeWord + 1} / 04</span>
            </div>
            <div className={styles.constellation} aria-hidden="true">
              <div className={styles.halo} />
              <div className={styles.orbit} />
              <div className={styles.orbitInner} />
              {glyphs.map((glyph, index) => (
                <span
                  className={styles.glyph}
                  key={glyph}
                  style={
                    {
                      "--x": `${7 + ((index * 29) % 88)}%`,
                      "--y": `${7 + ((index * 37) % 83)}%`,
                      "--rotation": `${((index % 5) - 2) * 13}deg`,
                      "--delay": `${-index * 1.3}s`,
                      "--size": `${20 + (index % 4) * 9}px`,
                    } as CSSProperties
                  }
                >
                  {glyph}
                </span>
              ))}
              <div
                className={styles.assembledWord}
                key={word.word}
                lang={word.code}
              >
                {Array.from(word.word).map((letter, index) => (
                  <span
                    className={styles.letter}
                    key={index}
                    style={
                      {
                        "--from-x": `${(index % 2 ? 1 : -1) * (70 + index * 28)}px`,
                        "--from-y": `${(index % 2 ? -1 : 1) * (100 + index * 16)}px`,
                        "--from-rotation": `${(index - 2) * 27}deg`,
                        "--letter-delay": `${index * 110}ms`,
                      } as CSSProperties
                    }
                  >
                    {letter}
                  </span>
                ))}
              </div>
            </div>
            <div className={styles.wordMeaning}>
              <span className={styles.wordLanguage}>
                {t(languageLabelKey(word.language))}{" "}
                <span aria-hidden="true">→</span>{" "}
                {t("signedOutLanding.english")}
              </span>
              <p>
                <span lang={word.code}>{word.word}</span>
                <span className={styles.definition}>{word.meaning}</span>
              </p>
            </div>
            <div className={styles.sceneControls}>
              <div
                className={styles.languageButtons}
                role="group"
                aria-label={t("signedOutLanding.exploreAWord")}
              >
                {words.map((item, index) => (
                  <button
                    key={item.code}
                    aria-label={t("signedOutLanding.exploreValueValue", {
                      value0: t(languageLabelKey(item.language)),
                      value1: item.word,
                    })}
                    aria-pressed={activeWord === index}
                    className={
                      activeWord === index ? styles.languageActive : undefined
                    }
                    onClick={() => {
                      setActiveWord(index);
                    }}
                  >
                    {item.code.toUpperCase()}
                  </button>
                ))}
              </div>
              <button
                className={styles.motionButton}
                aria-pressed={paused}
                disabled={reducedMotion}
                onClick={() => setPaused((current) => !current)}
                aria-label={
                  reducedMotion
                    ? t(
                        "signedOutLanding.animationsDisabledByReducedMotionPreference",
                      )
                    : paused
                      ? t("signedOutLanding.playAnimations")
                      : t("signedOutLanding.pauseAnimations")
                }
              >
                <span aria-hidden="true">
                  {paused || reducedMotion ? "▷" : "Ⅱ"}
                </span>
                {reducedMotion
                  ? t("signedOutLanding.stillMode")
                  : paused
                    ? t("signedOutLanding.play")
                    : t("signedOutLanding.pause")}
              </button>
            </div>
          </div>

          <div className={styles.heroFooter}>
            <span>
              {t("signedOutLanding.differentAlphabetsSharedHumanity")}
            </span>
            <a href="#how-it-works">
              {t("signedOutLanding.makeSenseOfIt")}{" "}
              <span aria-hidden="true">↓</span>
            </a>
          </div>
        </section>

        <section
          className={styles.howItWorks}
          id="how-it-works"
          aria-labelledby="how-title"
        >
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>
              {t("signedOutLanding.lessMemorisingMoreMeaning")}
            </p>
            <h2 id="how-title">
              {t("signedOutLanding.aWordIsOnly")}
              <br />
              {t("signedOutLanding.the")}{" "}
              <span>{t("signedOutLanding.beginning")}</span>
            </h2>
            <p>
              {t("signedOutLanding.aConversationAConnectionANewWayToSeeThings")}
              <br />
              {t("signedOutLanding.buildAVocabularyThatMeansSomethingToYou")}
            </p>
          </div>
          <div className={styles.steps}>
            {steps.map((step) => (
              <article className={styles.step} key={step.number}>
                <span className={styles.stepNumber}>
                  {step.number}
                  <span aria-hidden="true"> /</span>
                </span>
                <h3>{t(step.titleKey)}</h3>
                <p>{t(step.textKey)}</p>
                <span className={styles.stepDetail}>
                  {t(step.detailKey)}
                  <span aria-hidden="true">↗</span>
                </span>
              </article>
            ))}
          </div>
        </section>

        <section
          className={styles.contextSection}
          aria-labelledby="context-title"
        >
          <div className={styles.exampleCard}>
            <div className={styles.cardTopline}>
              <span>{t("signedOutLanding.aLittleMomentOfUnderstanding")}</span>
              <span aria-hidden="true">↗</span>
            </div>
            <p className={styles.exampleWord} lang={word.code}>
              {word.word}
              <span>{word.meaning}</span>
            </p>
            <div className={styles.exampleSentence}>
              <p lang={word.code}>{word.example}</p>
              <p>{word.translation}</p>
            </div>
            <div className={styles.cardBottomline}>
              <span>
                {t(languageLabelKey(word.language))}{" "}
                {t("signedOutLanding.english2")}
              </span>
              <span>{t("signedOutLanding.examplePreview")}</span>
            </div>
          </div>
          <div className={styles.contextCopy}>
            <p className={styles.eyebrow}>
              {t("signedOutLanding.letItBecomeSecondNature")}
            </p>
            <h2 id="context-title">
              {t("signedOutLanding.translated")}
              <br />
              <span>{t("signedOutLanding.andUnderstood")}</span>
            </h2>
            <p>{t("signedOutLanding.seeAWordInASentenceGetToKnowIts")}</p>
            <button
              className={styles.textButton}
              onClick={startLearning}
              disabled={signingIn}
            >
              {t("signedOutLanding.startMakingConnections")}{" "}
              <span aria-hidden="true">↗</span>
            </button>
          </div>
        </section>

        <section className={styles.finalCta} aria-labelledby="start-title">
          <span className={styles.finalGlyph} aria-hidden="true">
            æ
          </span>
          <p className={styles.eyebrow}>
            {t("signedOutLanding.thereSAWordForWhatComesNext")}
          </p>
          <h2 id="start-title">
            {t("signedOutLanding.goFind")}{" "}
            <span>{t("signedOutLanding.yours")}</span>
          </h2>
          <button
            className={styles.primaryButton}
            onClick={startLearning}
            disabled={signingIn}
          >
            {signingIn
              ? t("signedOutLanding.connecting")
              : t("signedOutLanding.startWithGoogle")}
            <span aria-hidden="true">↗</span>
          </button>
        </section>
      </main>

      <footer className={styles.footer}>
        <Link href="/" className={styles.logo}>
          LEARN.words
        </Link>
        <span>{t("signedOutLanding.stayCuriousTheWorldHasALotToSay")}</span>
        <a href="#landing-main">{t("signedOutLanding.backToTop")}</a>
      </footer>
      {signInError && (
        <div className={styles.error} role="alert">
          {t("signedOutLanding.couldnTConnectToGooglePleaseTrySigningInAgain")}
          <button
            aria-label={t("signedOutLanding.dismissSignInError")}
            onClick={() => setSignInError(false)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
