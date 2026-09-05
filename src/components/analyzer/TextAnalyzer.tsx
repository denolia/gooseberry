"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { TranslationCard } from "@/components/anki/TranslationCard";
import { CardDraft } from "@/app/utils/cardDraft";
import { mapTranslationToWordSetItem } from "@/app/utils/ankiMapper";
import { readJsonLines } from "@/app/utils/readJsonLines";
import {
  AnalysisCandidate,
  SelectionAnalysis,
  SelectionAnalysisSchema,
  tokenizeText,
} from "@/app/utils/textAnalysisSchema";
import {
  TranslationResponse,
  TranslationResponseSchema,
} from "@/app/utils/translationSchema";
import {
  getLanguageCode,
  SourceLanguage,
  SourceLanguages,
  TargetLanguage,
} from "@/components/ui/Languages";
import { useLanguages } from "@/lib/languages/useLanguages";
import styles from "./TextAnalyzer.module.css";

const CACHE_KEY = "textAnalyzerState:v2";
const SAMPLE_TEXT =
  "Berlin liegt mit dem Auto nur 90 Minuten entfernt. Größere Städte am Ufer des Sees sind Waren und Röbel.";

type CachedState = {
  text: string;
  readerText: string;
  editorExpanded: boolean;
  selectedTokenIds: number[];
  analysis?: SelectionAnalysis;
  sourceLanguage: SourceLanguage;
  targetLanguage: TargetLanguage;
};

function readCache(
  sourceLanguage: SourceLanguage,
  targetLanguage: TargetLanguage,
): Partial<CachedState> {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    if (
      !parsed ||
      parsed.sourceLanguage !== sourceLanguage ||
      parsed.targetLanguage !== targetLanguage
    ) {
      return {};
    }
    return {
      text: typeof parsed.text === "string" ? parsed.text : "",
      readerText:
        typeof parsed.readerText === "string" ? parsed.readerText : "",
      editorExpanded: Boolean(parsed.editorExpanded),
      selectedTokenIds: Array.isArray(parsed.selectedTokenIds)
        ? parsed.selectedTokenIds.filter(Number.isInteger)
        : [],
      analysis: parsed.analysis
        ? SelectionAnalysisSchema.parse(parsed.analysis)
        : undefined,
    };
  } catch {
    return {};
  }
}

function isDiscontinuous(
  tokenIds: number[],
  tokens: ReturnType<typeof tokenizeText>,
) {
  const selected = new Set(tokenIds);
  const first = tokenIds[0];
  const last = tokenIds[tokenIds.length - 1];
  return tokens.some(
    (token) =>
      token.isWord &&
      token.id > first &&
      token.id < last &&
      !selected.has(token.id),
  );
}

function responseForCandidate(
  candidate: AnalysisCandidate,
): TranslationResponse {
  return {
    original: candidate.expression,
    translation: candidate.translation,
    type: "other",
    details: {
      article: null,
      plural: null,
      genitive: null,
      verb_forms: null,
      verb_preposition_case: null,
      verb_noun: null,
      alternative_translations: null,
      common_phrases: null,
      idioms: null,
      usage_frequency: null,
      stylistic_kind: null,
      sentence_grammatical_analysis: candidate.explanation,
      comments: null,
    },
    example_usage: null,
  };
}

export function TextAnalyzer() {
  const { status } = useSession();
  const router = useRouter();
  const { currentSourceLanguage, currentTargetLanguage } = useLanguages();
  const [text, setText] = useState("");
  const [readerText, setReaderText] = useState("");
  const [editorExpanded, setEditorExpanded] = useState(true);
  const [selectedTokenIds, setSelectedTokenIds] = useState<number[]>([]);
  const [analysis, setAnalysis] = useState<SelectionAnalysis>();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [cacheReady, setCacheReady] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const handledTextSelection = useRef(false);
  const previousLanguagePair = useRef(
    `${currentSourceLanguage}:${currentTargetLanguage}`,
  );

  const sourceCode = getLanguageCode(currentSourceLanguage);
  const targetCode = getLanguageCode(currentTargetLanguage);
  const tokens = useMemo(
    () => tokenizeText(readerText, sourceCode),
    [readerText, sourceCode],
  );
  const winningConstruction = analysis?.constructions[0];
  const highlightedTokenIds = new Set(
    winningConstruction?.tokenIds ?? selectedTokenIds,
  );

  useEffect(() => () => activeRequest.current?.abort(), []);
  useEffect(() => {
    const cached = readCache(currentSourceLanguage, currentTargetLanguage);
    setText(cached.text ?? "");
    setReaderText(cached.readerText ?? "");
    setEditorExpanded(
      cached.readerText ? Boolean(cached.editorExpanded) : true,
    );
    setSelectedTokenIds(cached.selectedTokenIds ?? []);
    setAnalysis(cached.analysis);
    setCacheReady(true);
  }, []);
  useEffect(() => {
    if (!cacheReady) return;
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          text,
          readerText,
          editorExpanded,
          selectedTokenIds,
          analysis,
          sourceLanguage: currentSourceLanguage,
          targetLanguage: currentTargetLanguage,
        } satisfies CachedState),
      );
    } catch {
      /* The analyzer also works when storage is unavailable. */
    }
  }, [
    analysis,
    cacheReady,
    currentSourceLanguage,
    currentTargetLanguage,
    editorExpanded,
    readerText,
    selectedTokenIds,
    text,
  ]);

  useEffect(() => {
    const languagePair = `${currentSourceLanguage}:${currentTargetLanguage}`;
    if (previousLanguagePair.current === languagePair) return;
    previousLanguagePair.current = languagePair;
    activeRequest.current?.abort();
    setAnalysis(undefined);
    setSelectedTokenIds([]);
    setError("");
  }, [currentSourceLanguage, currentTargetLanguage]);

  function openText() {
    const value = text.trim();
    if (!value) return;
    activeRequest.current?.abort();
    setReaderText(value);
    setText(value);
    setEditorExpanded(false);
    setAnalysis(undefined);
    setSelectedTokenIds([]);
    setError("");
  }

  async function analyzeSelection(tokenIds: number[]) {
    const uniqueIds = [...new Set(tokenIds)].sort(
      (left, right) => left - right,
    );
    if (!readerText || !uniqueIds.length) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setSelectedTokenIds(uniqueIds);
    setAnalysis(undefined);
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          text: readerText,
          selectedTokenIds: uniqueIds,
          sourceLanguage: currentSourceLanguage,
          targetLanguage: currentTargetLanguage,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Analysis failed.");
      setAnalysis(SelectionAnalysisSchema.parse(body));
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(caught instanceof Error ? caught.message : "Analysis failed.");
      }
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setIsLoading(false);
      }
    }
  }

  function analyzeNativeSelection() {
    const selection = window.getSelection();
    const container = readerRef.current;
    if (!selection || selection.isCollapsed || !container) return false;
    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return false;
    const ids = Array.from(
      container.querySelectorAll<HTMLElement>("[data-token-id]"),
    )
      .filter((element) => range.intersectsNode(element))
      .map((element) => Number(element.dataset.tokenId))
      .filter(Number.isInteger);
    if (!ids.length) return false;
    handledTextSelection.current = true;
    selection.removeAllRanges();
    void analyzeSelection(ids);
    window.setTimeout(() => {
      handledTextSelection.current = false;
    }, 0);
    return true;
  }

  function handleReaderClick(event: React.MouseEvent<HTMLDivElement>) {
    if (handledTextSelection.current) return;
    const element = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-token-id]",
    );
    if (element) void analyzeSelection([Number(element.dataset.tokenId)]);
  }

  function openTranslation(value: string) {
    try {
      localStorage.setItem("translationDraft", value);
    } catch {
      /* The event still updates the mounted translation panel. */
    }
    window.dispatchEvent(
      new CustomEvent("gooseberry:translation-draft", { detail: value }),
    );
    router.push("/");
  }

  async function prepareCandidateCard(
    candidate: AnalysisCandidate,
  ): Promise<CardDraft> {
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: candidate.expression,
        sourceLanguage: currentSourceLanguage,
        targetLanguage: currentTargetLanguage,
      }),
    });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body.error || "Could not prepare the card.");
    }
    if (!response.body) throw new Error("Translation response is unavailable.");
    for await (const value of readJsonLines(response.body)) {
      if (!value || typeof value !== "object") continue;
      const event = value as Record<string, unknown>;
      if (event.type === "error") {
        throw new Error(
          typeof event.error === "string"
            ? event.error
            : "Could not prepare the card.",
        );
      }
      if (event.type === "result") {
        const translated = TranslationResponseSchema.parse(event.response);
        const fields = mapTranslationToWordSetItem(translated, "", sourceCode);
        return {
          original: fields.original,
          translation: fields.translation,
          wordForms: fields.wordForms,
          comments: fields.comments,
          tags: fields.tags,
          examples: (translated.example_usage ?? []).map((example) => ({
            sample: example.sample,
            translation: example.sample_translation,
          })),
        };
      }
    }
    throw new Error("Translation was interrupted. Please try again.");
  }

  if (status === "loading") return <div className={styles.empty} />;
  if (status !== "authenticated") {
    return <div className={styles.empty}>Please sign in to analyze text.</div>;
  }

  const candidates = analysis
    ? [analysis.selection, ...analysis.constructions]
    : [];

  return (
    <div className={styles.container}>
      <header className={styles.intro}>
        <div>
          <h1>Text analyzer</h1>
          <p>
            Open a text, then click a word or select a phrase. Analysis runs
            only for what you choose.
          </p>
        </div>
      </header>

      {editorExpanded || !readerText ? (
        <div className={styles.composer}>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={`Paste ${currentSourceLanguage} text…`}
            rows={6}
            maxLength={20000}
          />
          <div className={styles.composerFooter}>
            {!text && currentSourceLanguage === SourceLanguages.German && (
              <button
                type="button"
                className={styles.exampleButton}
                onClick={() => setText(SAMPLE_TEXT)}
              >
                Use an example
              </button>
            )}
            <span>{text.length.toLocaleString()} / 20,000</span>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={openText}
              disabled={!text.trim()}
            >
              Open text
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.compactComposer}>
          <span>{readerText.replaceAll(/\s+/g, " ")}</span>
          <button type="button" onClick={() => setEditorExpanded(true)}>
            Edit text
          </button>
        </div>
      )}

      {readerText && (
        <div className={styles.workspace}>
          <section className={styles.reader} aria-label="Text reader">
            <div className={styles.readerHeading}>
              <span>Click a word or select several words</span>
              {isLoading && <span>Looking for stable expressions…</span>}
            </div>
            <div
              className={styles.tokens}
              ref={readerRef}
              onClick={handleReaderClick}
              onMouseUp={analyzeNativeSelection}
              onKeyDown={(event) => {
                const element = (
                  event.target as HTMLElement
                ).closest<HTMLElement>("[data-token-id]");
                if (element && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  void analyzeSelection([Number(element.dataset.tokenId)]);
                }
              }}
            >
              {tokens.map((token) =>
                token.isWord ? (
                  <span
                    key={token.id}
                    data-token-id={token.id}
                    role="button"
                    tabIndex={0}
                    className={`${styles.token} ${highlightedTokenIds.has(token.id) ? styles.selectedToken : ""} ${isLoading && selectedTokenIds.includes(token.id) ? styles.analyzingToken : ""}`}
                  >
                    {token.text}
                  </span>
                ) : (
                  <span key={token.id}>{token.text}</span>
                ),
              )}
            </div>
            {error && <p className={styles.error}>{error}</p>}
            <button
              type="button"
              className={styles.fullTranslationButton}
              onClick={() => openTranslation(readerText)}
            >
              Translate full text →
            </button>
          </section>

          <aside className={styles.inspector} aria-live="polite">
            {isLoading ? (
              <div className={styles.loadingCard}>
                <span className={styles.pulse} aria-hidden="true" />
                Checking the selected words and their context…
              </div>
            ) : candidates.length ? (
              <div className={styles.candidateList}>
                {candidates.map((candidate) => {
                  const isBest = candidate.id === winningConstruction?.id;
                  return (
                    <section
                      className={`${styles.candidate} ${isBest ? styles.bestCandidate : ""}`}
                      key={candidate.id}
                    >
                      <div className={styles.matchMeta}>
                        <span>{candidate.kind.replaceAll("-", " ")}</span>
                        {isBest && <span>best match</span>}
                        {isDiscontinuous(candidate.tokenIds, tokens) && (
                          <span>discontinuous</span>
                        )}
                      </div>
                      <TranslationCard
                        response={responseForCandidate(candidate)}
                        sourceLang={sourceCode}
                        targetLang={targetCode}
                        prepareCard={() => prepareCandidateCard(candidate)}
                      >
                        <h2 className={styles.expression}>
                          {candidate.expression}
                        </h2>
                        <p className={styles.quickTranslation}>
                          {candidate.translation}
                        </p>
                      </TranslationCard>
                      {candidate.explanation && (
                        <p className={styles.explanation}>
                          {candidate.explanation}
                        </p>
                      )}
                      <button
                        type="button"
                        className={styles.translationButton}
                        onClick={() => openTranslation(candidate.expression)}
                      >
                        Open in Translation →
                      </button>
                    </section>
                  );
                })}
              </div>
            ) : (
              <div className={styles.emptySelection}>
                Select something in the text. The selected word and every useful
                construction found around it will appear here.
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
