"use client";
import {
  languageLabelKey,
  LanguageCodes,
  SourceLanguageOptions,
  TargetLanguageOptions,
  getLanguageCode,
  SourceLanguage,
  SourceLanguages,
  TargetLanguage,
} from "@/components/ui/Languages";
import type { UiMessage } from "@/i18n/messages";
import {
  messageFromError,
  errorFromResponse,
  MessageError,
} from "@/i18n/errors";

import { useI18n } from "@/i18n/client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { History, Languages as TranslateIcon, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQueryClient } from "@tanstack/react-query";
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
import { useLanguages } from "@/lib/languages/useLanguages";
import { LanguageStore } from "@/lib/languages/languageStore";
import { READER_TITLE_LIMIT, type ReaderDocument } from "@/lib/reader/library";
import { BottomPanelLayout } from "@/components/ui/BottomPanelLayout";
import type { ReaderTextRange } from "@/lib/audio/readerText";
import {
  ReaderAudioPlayer,
  type ReaderAudioPlayerHandle,
} from "./ReaderAudioPlayer";
import { AnalyzerPopover } from "./AnalyzerPopover";
import { useReadingFollow } from "./useReadingFollow";
import { ReaderHistoryDialog } from "./ReaderHistoryDialog";
import styles from "./TextAnalyzer.module.css";

const LEGACY_CACHE_KEY = "textAnalyzerState:v2";
const CACHE_KEY = "readerDraft:v1";
const SAMPLE_TEXT =
  "Berlin liegt mit dem Auto nur 90 Minuten entfernt. Größere Städte am Ufer des Sees sind Waren und Röbel.";

type CachedState = {
  text: string;
  draftId?: string;
  savedId?: string;
  sourceLanguage: SourceLanguage;
  targetLanguage: TargetLanguage;
};

function readCache(
  accountId: string,
  sourceLanguage: SourceLanguage,
  targetLanguage: TargetLanguage,
): Partial<CachedState> {
  try {
    const scoped = localStorage.getItem(`${CACHE_KEY}:${accountId}`);
    const parsed = JSON.parse(
      scoped ?? localStorage.getItem(LEGACY_CACHE_KEY) ?? "null",
    );
    if (
      !parsed ||
      parsed.sourceLanguage !== sourceLanguage ||
      parsed.targetLanguage !== targetLanguage
    ) {
      return {};
    }
    return {
      text:
        typeof parsed.text === "string" && parsed.text
          ? parsed.text
          : typeof parsed.readerText === "string"
            ? parsed.readerText
            : "",
      draftId: typeof parsed.draftId === "string" ? parsed.draftId : undefined,
      savedId: typeof parsed.savedId === "string" ? parsed.savedId : undefined,
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
  const { t } = useI18n();
  const { data: session, status } = useSession();
  const accountId = session?.user?.id;
  const queryClient = useQueryClient();
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
  const [error, setError] = useState<UiMessage | null>(null);
  const [cacheReady, setCacheReady] = useState<string>();
  const [savedText, setSavedText] = useState<ReaderDocument | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [documentError, setDocumentError] = useState<UiMessage | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState("");
  const [documentVersion, setDocumentVersion] = useState(0);
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
  const documentRequest = useRef<AbortController | null>(null);
  const [draftId, setDraftId] = useState<string>();
  const savedId = useRef<string | undefined>(undefined);
  const latestAccount = useRef(accountId);
  const restoredAccount = useRef<string | undefined>(undefined);
  latestAccount.current = accountId;
  const readerRef = useRef<HTMLDivElement>(null);
  const audioPlayerRef = useRef<ReaderAudioPlayerHandle>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const handledTextSelection = useRef(false);
  const touchSelectionTimer = useRef<number | undefined>(undefined);
  const previousLanguagePair = useRef(
    `${currentSourceLanguage}:${currentTargetLanguage}`,
  );

  const sourceCode = getLanguageCode(currentSourceLanguage);
  const targetCode = getLanguageCode(currentTargetLanguage);
  const hasUnsavedChanges = savedText
    ? text.trim() !== savedText.text ||
      sourceCode !== savedText.sourceLang ||
      targetCode !== savedText.targetLang
    : !!text.trim();
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
      documentRequest.current?.abort();
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
    // Activity reconnects effects when returning to this tab, while retaining state.
    if (restoredAccount.current === accountId) return;
    restoredAccount.current = accountId;
    documentRequest.current?.abort();
    documentRequest.current = null;
    activeRequest.current?.abort();
    activeRequest.current = null;
    window.clearTimeout(touchSelectionTimer.current);
    // oxlint-disable-next-line react/set-state-in-effect -- Synchronize reader state with an external account change before restoring its draft.
    setHistoryOpen(false);
    setSavedText(null);
    setRenaming(false);
    setDocumentBusy(false);
    setDocumentError(null);
    setPopoverOpen(false);
    setIsLoading(false);
    setError(null);
    setReadingHighlight(null);
    setPlaybackActive(false);
    setAudioAvailable(false);
    setSelectedTokenIds([]);
    setSelectionPreviewIds([]);
    setAnalysis(undefined);
    const languages = LanguageStore.getSnapshot();
    const cached = accountId
      ? readCache(
          accountId,
          languages.currentSourceLanguage,
          languages.currentTargetLanguage,
        )
      : {};
    setText(cached.text ?? "");
    setReaderText("");
    setEditorExpanded(true);
    setDraftId(cached.draftId);
    savedId.current = cached.savedId;
    setCacheReady(accountId);
  }, [accountId]);
  useEffect(() => {
    if (!accountId || cacheReady !== accountId) return;
    try {
      localStorage.setItem(
        `${CACHE_KEY}:${accountId}`,
        JSON.stringify({
          text: hasUnsavedChanges ? text : "",
          draftId: hasUnsavedChanges ? draftId : undefined,
          savedId: hasUnsavedChanges ? savedId.current : undefined,
          sourceLanguage: currentSourceLanguage,
          targetLanguage: currentTargetLanguage,
        } satisfies CachedState),
      );
      localStorage.removeItem(LEGACY_CACHE_KEY);
    } catch {
      /* The analyzer also works when storage is unavailable. */
    }
  }, [
    accountId,
    cacheReady,
    currentSourceLanguage,
    currentTargetLanguage,
    hasUnsavedChanges,
    savedText,
    documentBusy,
    draftId,
    text,
  ]);

  useEffect(() => {
    if (renaming) {
      titleRef.current?.focus();
      titleRef.current?.select();
    }
  }, [renaming]);

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
    setError(null);
  }, [currentSourceLanguage, currentTargetLanguage]);

  function resetReading() {
    closePopover();
    setAnalysis(undefined);
    setSelectedTokenIds([]);
    setSelectionPreviewIds([]);
    setReadingHighlight(null);
    setPlaybackActive(false);
    setAudioAvailable(false);
    setError(null);
    setDocumentVersion((version) => version + 1);
  }

  function showDocument(document: ReaderDocument) {
    const source = SourceLanguageOptions.find(
      (language) => LanguageCodes[language] === document.sourceLang,
    );
    const target = TargetLanguageOptions.find(
      (language) => LanguageCodes[language] === document.targetLang,
    );
    if (!source || !target)
      throw new MessageError("errors.readerUnsupportedLanguage");
    resetReading();
    LanguageStore.setLanguages(source, target);
    setSavedText(document);
    savedId.current = document.id;
    setDraftId(document.id);
    setText(document.text);
    setReaderText(document.text);
    setEditorExpanded(false);
    setRenaming(false);
    setDocumentError(null);
  }

  async function openText() {
    const value = text.trim();
    if (!value || !accountId || documentRequest.current) return;
    const id = savedId.current ?? draftId ?? crypto.randomUUID();
    setDraftId(id);
    const controller = new AbortController();
    documentRequest.current = controller;
    setDocumentBusy(true);
    setDocumentError(null);
    try {
      const response = await fetch(
        savedId.current ? `/api/reader-texts/${id}` : "/api/reader-texts",
        {
          method: savedId.current ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            ...(savedId.current ? {} : { id }),
            text: value,
            sourceLang: sourceCode,
            targetLang: targetCode,
          }),
        },
      );
      const body = await response.json();
      if (controller.signal.aborted || latestAccount.current !== accountId)
        return;
      if (!response.ok)
        throw errorFromResponse(body, "errors.readerSaveFailed");
      showDocument(body.text);
      void queryClient.invalidateQueries({
        queryKey: ["readerTexts", accountId],
      });
    } catch (cause) {
      if (!controller.signal.aborted && latestAccount.current === accountId)
        setDocumentError(messageFromError(cause, "errors.readerSaveFailed"));
    } finally {
      if (documentRequest.current === controller) {
        documentRequest.current = null;
        setDocumentBusy(false);
      }
    }
  }

  function canLeaveDocument() {
    return (
      (!hasUnsavedChanges &&
        !(renaming && savedText && title.trim() !== savedText.title)) ||
      window.confirm(t("readerHistory.discardUnsavedChanges"))
    );
  }

  function newText(checkChanges = true, closeHistory = true) {
    if (documentRequest.current || (checkChanges && !canLeaveDocument()))
      return;
    resetReading();
    setSavedText(null);
    setDraftId(undefined);
    savedId.current = undefined;
    setText("");
    setReaderText("");
    setEditorExpanded(true);
    setRenaming(false);
    setDocumentError(null);
    if (closeHistory) {
      setHistoryOpen(false);
      window.requestAnimationFrame(() => editorRef.current?.focus());
    }
  }

  async function openSavedText(id: string) {
    if (documentRequest.current || !canLeaveDocument()) return;
    const controller = new AbortController();
    documentRequest.current = controller;
    try {
      const response = await fetch(`/api/reader-texts/${id}`, {
        signal: controller.signal,
      });
      const body = await response.json();
      if (controller.signal.aborted || latestAccount.current !== accountId)
        return;
      if (!response.ok)
        throw errorFromResponse(body, "errors.readerOpenFailed");
      showDocument(body.text);
      setHistoryOpen(false);
    } finally {
      if (documentRequest.current === controller)
        documentRequest.current = null;
    }
  }

  async function renameText(event: React.FormEvent) {
    event.preventDefault();
    if (!savedText || !title.trim() || documentRequest.current) return;
    const controller = new AbortController();
    documentRequest.current = controller;
    setDocumentBusy(true);
    setDocumentError(null);
    try {
      const response = await fetch(`/api/reader-texts/${savedText.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ title: title.trim() }),
      });
      const body = await response.json();
      if (controller.signal.aborted || latestAccount.current !== accountId)
        return;
      if (!response.ok)
        throw errorFromResponse(body, "errors.readerRenameFailed");
      setSavedText((current) =>
        current
          ? {
              ...current,
              title: body.text.title,
              updatedAt: body.text.updatedAt,
            }
          : current,
      );
      setRenaming(false);
      void queryClient.invalidateQueries({
        queryKey: ["readerTexts", accountId],
      });
    } catch (cause) {
      if (!controller.signal.aborted && latestAccount.current === accountId)
        setDocumentError(messageFromError(cause, "errors.readerRenameFailed"));
    } finally {
      if (documentRequest.current === controller) {
        documentRequest.current = null;
        setDocumentBusy(false);
      }
    }
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
    setError(null);
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
    setError(null);
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
      if (!response.ok) throw errorFromResponse(body, "errors.analysisFailed");
      setAnalysis(SelectionAnalysisSchema.parse(body));
    } catch (caught) {
      if (!controller.signal.aborted && activeRequest.current === controller) {
        setError(messageFromError(caught, "errors.analysisFailed"));
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
      throw errorFromResponse(body, "errors.couldNotPrepareTheCard");
    }
    if (!response.body)
      throw new MessageError("errors.translationResponseIsUnavailable");
    for await (const value of readJsonLines(response.body)) {
      if (!value || typeof value !== "object") continue;
      const event = value as Record<string, unknown>;
      if (event.type === "error") {
        throw errorFromResponse(event, "errors.couldNotPrepareTheCard");
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
    throw new MessageError("errors.translationWasInterruptedPleaseTryAgain");
  }

  if (status === "loading") return <div className={styles.empty} />;
  if (status !== "authenticated") {
    return (
      <div className={styles.empty}>
        {t("textAnalyzer.pleaseSignInToAnalyzeText")}
      </div>
    );
  }

  const candidates = analysis
    ? [analysis.selection, ...analysis.constructions]
    : [];

  const content = (
    <div className={styles.container}>
      <header className={styles.intro}>
        <div>
          <h1>{t("textAnalyzer.reader")}</h1>
          {!readerText && (
            <p>{t("textAnalyzer.openATextThenClickAWordOrSelectA")}</p>
          )}
        </div>
        <button
          type="button"
          className={styles.historyButton}
          disabled={documentBusy}
          aria-haspopup="dialog"
          onClick={() => {
            closePopover();
            setHistoryOpen(true);
          }}
        >
          <History size={18} aria-hidden="true" />
          {t("readerHistory.history")}
        </button>
      </header>

      {savedText && (
        <div className={styles.documentHeading}>
          {renaming ? (
            <form
              className={styles.titleForm}
              onSubmit={(event) => void renameText(event)}
            >
              <input
                ref={titleRef}
                aria-label={t("readerHistory.textTitle")}
                value={title}
                maxLength={READER_TITLE_LIMIT}
                disabled={documentBusy}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && !documentBusy) {
                    event.preventDefault();
                    setRenaming(false);
                    setDocumentError(null);
                  }
                }}
              />
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={documentBusy || !title.trim()}
              >
                {t("readerHistory.saveTitle")}
              </button>
              <button
                type="button"
                className={styles.editButton}
                disabled={documentBusy}
                onClick={() => {
                  setRenaming(false);
                  setDocumentError(null);
                }}
              >
                {t("readerHistory.cancel")}
              </button>
            </form>
          ) : (
            <>
              <h2>{savedText.title}</h2>
              <button
                type="button"
                className={styles.renameButton}
                disabled={documentBusy}
                aria-label={t("readerHistory.renameText")}
                title={t("readerHistory.renameText")}
                onClick={() => {
                  setTitle(savedText.title);
                  setRenaming(true);
                  setDocumentError(null);
                }}
              >
                <Pencil size={16} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      )}

      {(text || savedText) && (
        <p className={styles.saveStatus} role="status">
          {documentBusy
            ? t("premiumTierControl.saving")
            : savedText && !hasUnsavedChanges
              ? t("readerHistory.savedToHistory")
              : t("readerHistory.unsavedChanges")}
        </p>
      )}
      {documentError && (
        <p className={styles.error} role="alert">
          {t(documentError.key, documentError.values)}
        </p>
      )}

      {(editorExpanded || !readerText) && (
        <div className={styles.composer}>
          <textarea
            ref={editorRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t("textAnalyzer.pasteValueText", {
              value0: t(languageLabelKey(currentSourceLanguage)),
            })}
            rows={6}
            maxLength={20000}
            aria-label={t("readerHistory.textToRead")}
            disabled={documentBusy}
          />
          <div className={styles.composerFooter}>
            {!text && currentSourceLanguage === SourceLanguages.German && (
              <button
                type="button"
                className={styles.exampleButton}
                onClick={() => setText(SAMPLE_TEXT)}
                disabled={documentBusy}
              >
                {t("textAnalyzer.useAnExample")}
              </button>
            )}
            <span>{text.length.toLocaleString()} / 20,000</span>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => void openText()}
              disabled={!text.trim() || documentBusy || renaming}
            >
              {documentBusy
                ? t("premiumTierControl.saving")
                : t("textAnalyzer.openText")}
            </button>
          </div>
        </div>
      )}

      {readerText && (
        <>
          <section
            className={styles.reader}
            aria-label={t("textAnalyzer.textReader")}
          >
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
                {t("textAnalyzer.translateFullText")}
              </button>
              <button
                type="button"
                className={styles.editButton}
                onClick={editText}
                disabled={documentBusy}
              >
                {t("textAnalyzer.editText")}
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
                          ? t("textAnalyzer.availableWithPremium")
                          : !audioAvailable
                            ? t("textAnalyzer.loadingAudioSettings")
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
                      {t("textAnalyzer.listen")}
                    </button>
                    <button
                      type="button"
                      className={styles.selectionAction}
                      onClick={() => void analyzeSelection(selectedTokenIds)}
                    >
                      <TranslateIcon
                        size={16}
                        aria-hidden="true"
                        focusable="false"
                      />
                      {t("textAnalyzer.translate")}
                    </button>
                  </div>
                  {!hasPremium && (
                    <p className={styles.selectionNotice}>
                      {t("textAnalyzer.audioReadingIsAvailableWith")}{" "}
                      <Link href="/profile">
                        {t("premiumTierControl.premium")}
                      </Link>
                      .
                    </p>
                  )}
                </>
              ) : isLoading ? (
                <div className={styles.loadingCard} role="status">
                  <span className={styles.pulse} aria-hidden="true" />
                  {t("textAnalyzer.checkingTheSelectedWordsAndTheirContext")}
                </div>
              ) : error ? (
                <div className={styles.analysisError}>
                  <p className={styles.error} role="alert">
                    {t(error.key, error.values)}
                  </p>
                  <button
                    type="button"
                    className={styles.translationButton}
                    onClick={() => void analyzeSelection(selectedTokenIds)}
                  >
                    {t("textAnalyzer.retryAnalysis")}
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
                          {isBest && <span>{t("textAnalyzer.bestMatch")}</span>}
                          {isDiscontinuous(candidate.tokenIds, tokens) && (
                            <span>{t("textAnalyzer.discontinuous")}</span>
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
      {historyOpen && accountId && (
        <ReaderHistoryDialog
          key={accountId}
          accountId={accountId}
          activeId={savedId.current}
          onOpen={openSavedText}
          onNew={() => newText()}
          onDeleted={(id) => {
            if (savedId.current === id) newText(false, false);
          }}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );

  return readerText ? (
    <BottomPanelLayout
      label={t("textAnalyzer.readerControls")}
      panel={
        <ReaderAudioPlayer
          key={`${accountId}:${documentVersion}`}
          ref={audioPlayerRef}
          text={readerText}
          sourceLanguage={sourceCode}
          hasPremium={hasPremium}
          accountId={session?.user?.id ?? null}
          onAvailabilityChange={setAudioAvailable}
          onReadingRangeChange={handleReadingRangeChange}
          onPlaybackActiveChange={setPlaybackActive}
        />
      }
    >
      {content}
    </BottomPanelLayout>
  ) : (
    content
  );
}
