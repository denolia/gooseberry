"use client";

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
    title: "Find a word.",
    text: "A word that stops you. A sentence you almost understand. Start with whatever makes you curious.",
    detail: "Translate words & phrases",
  },
  {
    number: "02",
    title: "Find the meaning.",
    text: "Go beyond the translation. Explore grammar, examples, and the little details that make a word click.",
    detail: "Understand in context",
  },
  {
    number: "03",
    title: "Make it yours.",
    text: "Collect your discoveries in word sets. Export them to Anki and keep them with you for the long run.",
    detail: "Collect & practice with Anki",
  },
];

export function SignedOutLanding() {
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
        Skip to content
      </a>
      <header className={styles.header}>
        <Link href="/" className={styles.logo} aria-label="Learn.words home">
          LEARN.words
        </Link>
        <nav className={styles.navigation} aria-label="Landing page">
          <a className={styles.aboutLink} href="#how-it-works">
            The idea
          </a>
          <button
            className={styles.signIn}
            onClick={startLearning}
            disabled={signingIn}
          >
            {signingIn ? "Connecting…" : "Sign in"}
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
              <span className={styles.blueDot} /> A little curiosity. A whole
              new world.
            </p>
            <h1 id="landing-title">
              Strange letters.
              <br />
              Familiar <span className={styles.meaning}>feelings.</span>
            </h1>
            <p className={styles.intro}>
              Then, suddenly, it clicks.
              <br />
              Turn the words you discover into a language that feels like yours.
            </p>
            <div className={styles.heroActions}>
              <button
                className={styles.primaryButton}
                onClick={startLearning}
                disabled={signingIn}
              >
                {signingIn ? "Connecting…" : "Find your first word"}
                <span aria-hidden="true">↗</span>
              </button>
              <span className={styles.ctaNote}>
                Your curiosity. Your vocabulary.
              </span>
            </div>
          </div>

          <div className={styles.wordScene} data-paused={motionPaused}>
            <div className={styles.sceneTopline}>
              <span>From letters to possibility</span>
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
                {word.language} <span aria-hidden="true">→</span> English
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
                aria-label="Explore a word"
              >
                {words.map((item, index) => (
                  <button
                    key={item.code}
                    aria-label={`Explore ${item.language}: ${item.word}`}
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
                    ? "Animations disabled by reduced motion preference"
                    : paused
                      ? "Play animations"
                      : "Pause animations"
                }
              >
                <span aria-hidden="true">
                  {paused || reducedMotion ? "▷" : "Ⅱ"}
                </span>
                {reducedMotion ? "Still mode" : paused ? "Play" : "Pause"}
              </button>
            </div>
          </div>

          <div className={styles.heroFooter}>
            <span>Different alphabets. Shared humanity.</span>
            <a href="#how-it-works">
              Make sense of it <span aria-hidden="true">↓</span>
            </a>
          </div>
        </section>

        <section
          className={styles.howItWorks}
          id="how-it-works"
          aria-labelledby="how-title"
        >
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>Less memorising. More meaning.</p>
            <h2 id="how-title">
              A word is only
              <br />
              the <span>beginning.</span>
            </h2>
            <p>
              A conversation. A connection. A new way to see things.
              <br />
              Build a vocabulary that means something to you.
            </p>
          </div>
          <div className={styles.steps}>
            {steps.map((step) => (
              <article className={styles.step} key={step.number}>
                <span className={styles.stepNumber}>
                  {step.number}
                  <span aria-hidden="true"> /</span>
                </span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
                <span className={styles.stepDetail}>
                  {step.detail}
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
              <span>A little moment of understanding</span>
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
              <span>{word.language} → English</span>
              <span>Example preview</span>
            </div>
          </div>
          <div className={styles.contextCopy}>
            <p className={styles.eyebrow}>Let it become second nature</p>
            <h2 id="context-title">
              Translated
              <br />
              <span>and understood.</span>
            </h2>
            <p>
              See a word in a sentence. Get to know its forms. Save it for
              later. Give every new discovery a little space to stay.
            </p>
            <button
              className={styles.textButton}
              onClick={startLearning}
              disabled={signingIn}
            >
              Start making connections <span aria-hidden="true">↗</span>
            </button>
          </div>
        </section>

        <section className={styles.finalCta} aria-labelledby="start-title">
          <span className={styles.finalGlyph} aria-hidden="true">
            æ
          </span>
          <p className={styles.eyebrow}>There’s a word for what comes next.</p>
          <h2 id="start-title">
            Go find <span>yours.</span>
          </h2>
          <button
            className={styles.primaryButton}
            onClick={startLearning}
            disabled={signingIn}
          >
            {signingIn ? "Connecting…" : "Start with Google"}
            <span aria-hidden="true">↗</span>
          </button>
        </section>
      </main>

      <footer className={styles.footer}>
        <Link href="/" className={styles.logo}>
          LEARN.words
        </Link>
        <span>Stay curious. The world has a lot to say.</span>
        <a href="#landing-main">Back to top ↑</a>
      </footer>
      {signInError && (
        <div className={styles.error} role="alert">
          Couldn’t connect to Google. Please try signing in again.
          <button
            aria-label="Dismiss sign-in error"
            onClick={() => setSignInError(false)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
