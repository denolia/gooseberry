"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
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
import type { ReaderTextRange } from "@/lib/audio/readerText";
import {
  ReaderAudioPlayer,
  type ReaderAudioPlayerHandle,
} from "./ReaderAudioPlayer";
import { AnalyzerPopover } from "./AnalyzerPopover";
import { useReadingFollow } from "./useReadingFollow";
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
  const { data: session, status } = useSession();
  const hasPremium = session?.user?.tier === "premium";
  const router = useRouter();
  const { currentSourceLanguage, currentTargetLanguage } = useLanguages();
  const [text, setText] = useState("");
  const [readerText, setReaderText] = useState("");
  const [editorExpanded, setEditorExpanded] = useState(true);
  const [selectedTokenIds, setSelectedTokenIds] = useState<number[]>([]);
  const [selectionPreviewIds, setSelectionPreviewIds] = useState<number[]>([]);
  const [analysis, setAnalysis] = useState<SelectionAnalysis>();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [cacheReady, setCacheReady] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverStage, setPopoverStage] = useState<"actions" | "translation">(
    "actions",
  );
  const [focusPopover, setFocusPopover] = useState(false);
  const [playbackActive, setPlaybackActive] = useState(false);
  const [audioAvailable, setAudioAvailable] = useState(false);
  const [readingHighlight, setReadingHighlight] = useState<{
    range: ReaderTextRange;
    text: string;
    sourceLanguage: string;
  } | null>(null);
  const popoverId = useId();
  const activeRequest = useRef<AbortController | null>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const audioPlayerRef = useRef<ReaderAudioPlayerHandle>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const handledTextSelection = useRef(false);
  const touchSelectionTimer = useRef<number | undefined>(undefined);
  const previousLanguagePair = useRef(
    `${currentSourceLanguage}:${currentTargetLanguage}`,
  );

  const sourceCode = getLanguageCode(currentSourceLanguage);
  const targetCode = getLanguageCode(currentTargetLanguage);
  const tokens = useMemo(
    () => tokenizeText(readerText, sourceCode),
    [readerText, sourceCode],
  );
  const positionedTokens = useMemo(() => {
    let offset = 0;
    return tokens.map((token) => {
      const start = offset;
      offset += token.text.length;
      return { ...token, start, end: offset };
    });
  }, [tokens]);
  const selectedWordIds = new Set(selectedTokenIds);
  const selectedReadingToken = positionedTokens.find(
    (token) => token.isWord && selectedWordIds.has(token.id),
  );
  const winningConstruction =
    popoverStage === "translation" ? analysis?.constructions[0] : undefined;
  const highlightedTokenIds = new Set(
    winningConstruction?.tokenIds ?? selectedTokenIds,
  );
  const handleReadingRangeChange = useCallback(
    (range: ReaderTextRange | null) => {
      setReadingHighlight(
        range &&
          range.start >= 0 &&
          range.end <= readerText.length &&
          range.start < range.end
          ? { range, text: readerText, sourceLanguage: sourceCode }
          : null,
      );
    },
    [readerText, sourceCode],
  );
  const currentReadingRange =
    readingHighlight?.text === readerText &&
    readingHighlight.sourceLanguage === sourceCode
      ? readingHighlight.range
      : null;
  const speakingTokenIds = new Set<number>();
  if (currentReadingRange) {
    for (const token of positionedTokens) {
      if (
        token.start < currentReadingRange.end &&
        token.end > currentReadingRange.start
      ) {
        speakingTokenIds.add(token.id);
      }
    }
  }
  useReadingFollow({
    readerRef,
    range: currentReadingRange,
    active: playbackActive,
    suspended: popoverOpen || editorExpanded || status !== "authenticated",
  });

  useEffect(
    () => () => {
      activeRequest.current?.abort();
      window.clearTimeout(touchSelectionTimer.current);
    },
    [],
  );
  useEffect(() => {
    const updateSelectionPreview = () => {
      setSelectionPreviewIds(getNativeSelectedIds());
    };
    document.addEventListener("selectionchange", updateSelectionPreview);
    return () =>
      document.removeEventListener("selectionchange", updateSelectionPreview);
  }, [readerText]);
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
    activeRequest.current = null;
    window.clearTimeout(touchSelectionTimer.current);
    setPopoverOpen(false);
    setIsLoading(false);
    setAnalysis(undefined);
    setSelectedTokenIds([]);
    setSelectionPreviewIds([]);
    setError("");
  }, [currentSourceLanguage, currentTargetLanguage]);

  function openText() {
    const value = text.trim();
    if (!value) return;
    activeRequest.current?.abort();
    activeRequest.current = null;
    window.clearTimeout(touchSelectionTimer.current);
    setPopoverOpen(false);
    setIsLoading(false);
    setReaderText(value);
    setText(value);
    setEditorExpanded(false);
    setAnalysis(undefined);
    setSelectedTokenIds([]);
    setSelectionPreviewIds([]);
    setError("");
  }

  function closePopover() {
    activeRequest.current?.abort();
    activeRequest.current = null;
    window.clearTimeout(touchSelectionTimer.current);
    setIsLoading(false);
    setPopoverOpen(false);
  }

  function editText() {
    closePopover();
    setEditorExpanded(true);
    window.requestAnimationFrame(() => editorRef.current?.focus());
  }

  function listenFromSelection() {
    const player = audioPlayerRef.current;
    if (!hasPremium || !audioAvailable || !selectedReadingToken || !player)
      return;
    closePopover();
    readerRef.current
      ?.querySelector<HTMLElement>(
        `[data-token-id="${selectedReadingToken.id}"]`,
      )
      ?.focus({ preventScroll: true });
    void player.readFrom(selectedReadingToken.start);
  }

  function openSelectionActions(tokenIds: number[], keyboard = false) {
    const uniqueIds = [...new Set(tokenIds)].sort(
      (left, right) => left - right,
    );
    if (!readerText || !uniqueIds.length) return;
    window.clearTimeout(touchSelectionTimer.current);
    activeRequest.current?.abort();
    activeRequest.current = null;
    setIsLoading(false);
    setError("");
    setFocusPopover(keyboard);
    setPopoverStage("actions");
    setPopoverOpen(true);
    const sameSelection =
      uniqueIds.length === selectedTokenIds.length &&
      uniqueIds.every((id, index) => id === selectedTokenIds[index]);
    setSelectedTokenIds(uniqueIds);
    setSelectionPreviewIds([]);
    if (!sameSelection) setAnalysis(undefined);
  }

  async function analyzeSelection(tokenIds: number[]) {
    const uniqueIds = [...new Set(tokenIds)].sort(
      (left, right) => left - right,
    );
    if (!readerText || !uniqueIds.length) return;
    window.clearTimeout(touchSelectionTimer.current);
    setFocusPopover(true);
    setPopoverStage("translation");
    setPopoverOpen(true);
    if (
      analysis &&
      uniqueIds.length === selectedTokenIds.length &&
      uniqueIds.every((id, index) => id === selectedTokenIds[index])
    ) {
      return;
    }
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setSelectedTokenIds(uniqueIds);
    setSelectionPreviewIds([]);
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
      if (controller.signal.aborted || activeRequest.current !== controller)
        return;
      if (!response.ok) throw new Error(body.error || "Analysis failed.");
      setAnalysis(SelectionAnalysisSchema.parse(body));
    } catch (caught) {
      if (!controller.signal.aborted && activeRequest.current === controller) {
        setError(caught instanceof Error ? caught.message : "Analysis failed.");
      }
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setIsLoading(false);
      }
    }
  }

  function getNativeSelectedIds() {
    const selection = window.getSelection();
    const container = readerRef.current;
    if (!selection || selection.isCollapsed || !container) return [];
    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return [];
    return Array.from(
      container.querySelectorAll<HTMLElement>("[data-token-id]"),
    )
      .filter((element) => range.intersectsNode(element))
      .map((element) => Number(element.dataset.tokenId))
      .filter(Number.isInteger);
  }

  function openNativeSelectionActions() {
    const ids = getNativeSelectedIds();
    if (!ids.length) return false;
    handledTextSelection.current = true;
    window.getSelection()?.removeAllRanges();
    openSelectionActions(ids);
    window.setTimeout(() => {
      handledTextSelection.current = false;
    }, 0);
    return true;
  }

  function scheduleTouchSelectionActions() {
    window.clearTimeout(touchSelectionTimer.current);
    touchSelectionTimer.current = window.setTimeout(() => {
      openNativeSelectionActions();
    }, 450);
  }

  function handleReaderClick(event: React.MouseEvent<HTMLDivElement>) {
    if (
      handledTextSelection.current ||
      window.getSelection()?.isCollapsed === false
    ) {
      return;
    }
    const element = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-token-id]",
    );
    if (element) openSelectionActions([Number(element.dataset.tokenId)]);
    else closePopover();
  }

  function openTranslation(value: string) {
    closePopover();
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
          <h1>Reader</h1>
          <p>Open a text, then click a word or select a phrase.</p>
        </div>
      </header>

      {(editorExpanded || !readerText) && (
        <div className={styles.composer}>
          <textarea
            ref={editorRef}
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
      )}

      {readerText && (
        <>
          <ReaderAudioPlayer
            ref={audioPlayerRef}
            text={readerText}
            sourceLanguage={sourceCode}
            hasPremium={hasPremium}
            accountId={session?.user?.id ?? null}
            onAvailabilityChange={setAudioAvailable}
            onReadingRangeChange={handleReadingRangeChange}
            onPlaybackActiveChange={setPlaybackActive}
          />
          <section className={styles.reader} aria-label="Text reader">
            <div
              className={styles.tokens}
              ref={readerRef}
              onClick={handleReaderClick}
              onMouseUp={openNativeSelectionActions}
              onTouchEnd={scheduleTouchSelectionActions}
              onKeyDown={(event) => {
                const element = (
                  event.target as HTMLElement
                ).closest<HTMLElement>("[data-token-id]");
                if (element && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  openSelectionActions([Number(element.dataset.tokenId)], true);
                }
              }}
            >
              {positionedTokens.map((token) =>
                token.isWord ? (
                  <span
                    key={token.id}
                    data-token-id={token.id}
                    data-text-start={token.start}
                    data-text-end={token.end}
                    role="button"
                    tabIndex={0}
                    aria-haspopup="dialog"
                    aria-expanded={
                      popoverOpen && selectedTokenIds.includes(token.id)
                    }
                    aria-controls={
                      popoverOpen && selectedTokenIds.includes(token.id)
                        ? popoverId
                        : undefined
                    }
                    className={`${styles.token} ${highlightedTokenIds.has(token.id) ? styles.selectedToken : ""} ${selectionPreviewIds.includes(token.id) ? styles.selectionPreview : ""} ${isLoading && selectedTokenIds.includes(token.id) ? styles.analyzingToken : ""} ${speakingTokenIds.has(token.id) ? styles.spokenText : ""}`}
                  >
                    {token.text}
                  </span>
                ) : (
                  <span
                    key={token.id}
                    data-text-start={token.start}
                    data-text-end={token.end}
                    className={
                      speakingTokenIds.has(token.id)
                        ? styles.spokenText
                        : undefined
                    }
                  >
                    {token.text}
                  </span>
                ),
              )}
            </div>
            <div className={styles.readerFooter}>
              <button
                type="button"
                className={styles.fullTranslationButton}
                onClick={() => openTranslation(readerText)}
              >
                Translate full text →
              </button>
              <button
                type="button"
                className={styles.editButton}
                onClick={editText}
              >
                Edit text
              </button>
            </div>
          </section>

          {popoverOpen && (
            <AnalyzerPopover
              id={popoverId}
              readerRef={readerRef}
              tokenIds={selectedTokenIds}
              compact={popoverStage === "actions"}
              focusOnOpen={focusPopover}
              onClose={closePopover}
            >
              {popoverStage === "actions" ? (
                <>
                  <div className={styles.selectionActions}>
                    <button
                      type="button"
                      className={styles.selectionAction}
                      onClick={listenFromSelection}
                      disabled={
                        !hasPremium || !audioAvailable || !selectedReadingToken
                      }
                      title={
                        !hasPremium
                          ? "Available with Premium"
                          : !audioAvailable
                            ? "Loading audio settings…"
                            : undefined
                      }
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path d="M6 3.5 16 10 6 16.5z" />
                      </svg>
                      Listen
                    </button>
                    <button
                      type="button"
                      className={styles.selectionAction}
                      onClick={() => void analyzeSelection(selectedTokenIds)}
                    >
                      Translate
                    </button>
                  </div>
                  {!hasPremium && (
                    <p className={styles.selectionNotice}>
                      Audio reading is available with{" "}
                      <Link href="/profile">Premium</Link>.
                    </p>
                  )}
                </>
              ) : isLoading ? (
                <div className={styles.loadingCard} role="status">
                  <span className={styles.pulse} aria-hidden="true" />
                  Checking the selected words and their context…
                </div>
              ) : error ? (
                <div className={styles.analysisError}>
                  <p className={styles.error} role="alert">
                    {error}
                  </p>
                  <button
                    type="button"
                    className={styles.translationButton}
                    onClick={() => void analyzeSelection(selectedTokenIds)}
                  >
                    Retry analysis
                  </button>
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
                          onOpenTranslation={() =>
                            openTranslation(candidate.expression)
                          }
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
                      </section>
                    );
                  })}
                </div>
              ) : null}
            </AnalyzerPopover>
          )}
        </>
      )}
    </div>
  );
}
