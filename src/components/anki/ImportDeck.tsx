"use client";
import {
  languageLabelKey,
  SourceLanguageSelectOptions,
  TargetLanguageSelectOptions,
  getLanguageCode,
  isSourceLanguageCode,
  isTargetLanguageCode,
} from "@/components/ui/Languages";
import type { UiMessage, MessageKey, Translate } from "@/i18n/messages";
import { messageFromError, MessageError } from "@/i18n/errors";

import { useI18n } from "@/i18n/client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLanguages } from "@/lib/languages/useLanguages";
import {
  deckWithDescendants,
  importDisplayName,
  MAX_IMPORT_EXAMPLE_PAIRS,
  selectImportContent,
  suggestedImportLanguages,
  suggestNoteTypeMappings,
} from "@/lib/anki/import/clientHelpers";
import {
  createImportBatches,
  importJsonByteLength,
  importRequest,
  MAX_IMPORT_REQUEST_BYTES,
  type ImportJobStatus,
} from "@/lib/anki/import/clientTransport";
import {
  mapAnkiNote,
  unsupportedNoteTypeReason,
  type FieldMapping,
  type NoteTypeMapping,
} from "@/lib/anki/import/mapping";
import { readPackageFile } from "@/lib/anki/import/readerClient";
import {
  defaultSchedulingTimeZone,
  isValidSchedulingTimeZone,
  previewImportProgress,
} from "@/lib/anki/import/clientProgress";
import { resolveAnkiStudyTemplate } from "@/lib/anki/import/templateMapping";
import type {
  AnkiNoteType,
  AnkiPackage,
  AnkiReadProgress,
} from "@/lib/anki/import/readerTypes";
import {
  getApplicableStudyCardTemplateKeys,
  getStudyCardTemplate,
  isStudyCardTemplateKey,
  STUDY_CARD_TEMPLATES,
  type StudyCardTemplateKey,
} from "@/lib/review/templates";
import styles from "./ImportDeck.module.css";

type ExistingSet = {
  id: string;
  name: string;
  sourceLang: string;
  targetLang: string;
};

type Phase =
  | "idle"
  | "reading"
  | "ready"
  | "uploading"
  | "committing"
  | "paused"
  | "cancelling"
  | "complete";

type ResumeImport = {
  version: 1;
  sha256: string;
  requestKey: string;
  jobId?: string;
  name: string;
  sourceLang: string;
  targetLang: string;
  targetSetId: string;
  importProgress?: boolean;
  schedulingTimeZone?: string;
  selectedDeckIds: string[];
  mapping: NoteTypeMapping[];
};

const EMPTY_CONTENT = { notes: [], cards: [], revlogs: [] };
const EMPTY_MAPPING: FieldMapping = { fields: [], separator: " " };
const READ_LABELS: Record<AnkiReadProgress["phase"], MessageKey> = {
  archive: "importDeck.openingYourDeck",
  database: "importDeck.readingItsVocabulary",
  notes: "importDeck.preparingThePreview",
  complete: "importDeck.preparingThePreview",
};

function storageKey(userId: string, sha256: string) {
  return `gooseberry.anki-import.v1.${userId}.${sha256}`;
}

function readResume(userId: string, sha256: string): ResumeImport | null {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(storageKey(userId, sha256)) ?? "null",
    );
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<ResumeImport>;
    const fieldMappingValid = (field: unknown): field is FieldMapping => {
      if (!field || typeof field !== "object") return false;
      const mapping = field as Partial<FieldMapping>;
      return (
        typeof mapping.separator === "string" &&
        Array.isArray(mapping.fields) &&
        mapping.fields.every((index) => Number.isInteger(index) && index >= 0)
      );
    };
    if (
      candidate.version !== 1 ||
      candidate.sha256 !== sha256 ||
      typeof candidate.requestKey !== "string" ||
      typeof candidate.name !== "string" ||
      !isSourceLanguageCode(candidate.sourceLang) ||
      !isTargetLanguageCode(candidate.targetLang) ||
      typeof candidate.targetSetId !== "string" ||
      (candidate.importProgress !== undefined &&
        typeof candidate.importProgress !== "boolean") ||
      (candidate.schedulingTimeZone !== undefined &&
        (typeof candidate.schedulingTimeZone !== "string" ||
          !isValidSchedulingTimeZone(candidate.schedulingTimeZone))) ||
      !Array.isArray(candidate.selectedDeckIds) ||
      !candidate.selectedDeckIds.every((id) => typeof id === "string") ||
      !Array.isArray(candidate.mapping) ||
      !candidate.mapping.every(
        (mapping) =>
          mapping &&
          typeof mapping.modelId === "string" &&
          fieldMappingValid(mapping.original) &&
          fieldMappingValid(mapping.translation) &&
          (!mapping.wordForms || fieldMappingValid(mapping.wordForms)) &&
          (!mapping.comments || fieldMappingValid(mapping.comments)) &&
          (!mapping.exerciseTemplates ||
            (Array.isArray(mapping.exerciseTemplates) &&
              mapping.exerciseTemplates.every(
                (template) =>
                  template &&
                  Number.isInteger(template.ord) &&
                  template.ord >= 0 &&
                  (template.templateKey === null ||
                    isStudyCardTemplateKey(template.templateKey)),
              ))) &&
          (!mapping.examples ||
            (Array.isArray(mapping.examples) &&
              mapping.examples.every(
                (pair) =>
                  pair &&
                  fieldMappingValid(pair.sample) &&
                  fieldMappingValid(pair.translation),
              ))),
      )
    ) {
      return null;
    }
    return candidate as ResumeImport;
  } catch {
    return null;
  }
}

function writeResume(userId: string, value: ResumeImport) {
  try {
    localStorage.setItem(
      storageKey(userId, value.sha256),
      JSON.stringify(value),
    );
    return true;
  } catch {
    // The open page can still resume if browser storage is unavailable.
    return false;
  }
}

function clearResume(userId: string, sha256: string) {
  try {
    localStorage.removeItem(storageKey(userId, sha256));
  } catch {
    // Storage can be blocked independently from the import itself.
  }
}

function exerciseMatchLabel(
  key: StudyCardTemplateKey,
  sourceLabel: string,
  targetLabel: string,
  t: Translate,
) {
  const direction =
    key === "recognition"
      ? `${sourceLabel} → ${targetLabel}`
      : key === "word_forms"
        ? `${sourceLabel} → ${t("importDeck.wordForms2")}`
        : `${targetLabel} → ${sourceLabel}`;
  return `${t(getStudyCardTemplate(key).labelKey)} · ${direction}`;
}

function FieldMappingEditor({
  label,
  model,
  value = EMPTY_MAPPING,
  onChange,
}: {
  label: string;
  model: AnkiNoteType;
  value?: FieldMapping;
  onChange: (value: FieldMapping) => void;
}) {
  const { t } = useI18n();
  const selections = value.fields.length ? value.fields : [-1];
  return (
    <div className={styles.fieldMapping}>
      <span className={styles.fieldLabel}>{label}</span>
      {selections.map((ordinal, index) => (
        <div className={styles.fieldSelection} key={index}>
          <select
            aria-label={t("importDeck.fieldLabel", {
              model: model.name,
              label,
              suffix: index
                ? t("importDeck.fieldSuffix", { number: index + 1 })
                : "",
            })}
            value={ordinal}
            onChange={(event) => {
              const next = [...selections];
              next[index] = Number(event.target.value);
              onChange({
                ...value,
                fields: next.filter((field) => field >= 0),
              });
            }}
          >
            <option value={-1}>{t("importDeck.leaveEmpty")}</option>
            {model.fields.map((field) => (
              <option
                key={field.ord}
                value={field.ord}
                disabled={
                  field.ord !== ordinal && value.fields.includes(field.ord)
                }
              >
                {field.name}
              </option>
            ))}
          </select>
          {value.fields.length > 1 && (
            <button
              type="button"
              className={styles.smallButton}
              aria-label={t("importDeck.removeFieldValueFromValue", {
                value0: index + 1,
                value1: label,
              })}
              onClick={() =>
                onChange({
                  ...value,
                  fields: value.fields.filter(
                    (_, fieldIndex) => fieldIndex !== index,
                  ),
                })
              }
            >
              {t("importDeck.remove")}
            </button>
          )}
        </div>
      ))}
      {value.fields.length > 0 && value.fields.length < model.fields.length && (
        <button
          type="button"
          className={styles.textButton}
          onClick={() => {
            const next = model.fields.find(
              (field) => !value.fields.includes(field.ord),
            );
            if (next)
              onChange({ ...value, fields: [...value.fields, next.ord] });
          }}
        >
          {t("importDeck.addAnotherField")}
        </button>
      )}
      {value.fields.length > 1 && (
        <label className={styles.joinLabel}>
          {t("importDeck.joinFieldsWith")}
          <select
            value={value.separator}
            onChange={(event) =>
              onChange({ ...value, separator: event.target.value })
            }
          >
            <option value=" ">{t("importDeck.aSpace")}</option>
            <option value=" · ">{t("importDeck.aDot")}</option>
            <option value="; ">{t("importDeck.aSemicolon")}</option>
            <option value={"\n"}>{t("importDeck.lineBreaks")}</option>
          </select>
        </label>
      )}
    </div>
  );
}

export function ImportDeck() {
  const { t } = useI18n();
  const { data: session, status } = useSession();
  const { currentSourceLanguage, currentTargetLanguage } = useLanguages();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [pkg, setPackage] = useState<AnkiPackage | null>(null);
  const [sha256, setSha256] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [readProgress, setReadProgress] =
    useState<AnkiReadProgress["phase"]>("archive");
  const [name, setName] = useState("");
  const [sourceLang, setSourceLang] = useState<string>(
    getLanguageCode(currentSourceLanguage),
  );
  const [targetLang, setTargetLang] = useState<string>(
    getLanguageCode(currentTargetLanguage),
  );
  const [targetSetId, setTargetSetId] = useState("");
  const [importProgress, setImportProgress] = useState(true);
  const [schedulingTimeZone, setSchedulingTimeZone] = useState("UTC");
  const [selectedDeckIds, setSelectedDeckIds] = useState<string[]>([]);
  const [mapping, setMapping] = useState<NoteTypeMapping[]>([]);
  const [directionConfirmed, setDirectionConfirmed] = useState(false);
  const [requestKey, setRequestKey] = useState("");
  const [job, setJob] = useState<ImportJobStatus | null>(null);
  const [resumeAvailable, setResumeAvailable] = useState(false);
  const [resumeStored, setResumeStored] = useState(true);
  const [error, setError] = useState<UiMessage | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [batchCount, setBatchCount] = useState(0);
  const operationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const userId = session?.user?.id ?? "";

  useEffect(
    () => () => {
      operationRef.current++;
      controllerRef.current?.abort();
    },
    [],
  );

  const setsQuery = useQuery({
    queryKey: ["wordSets", userId],
    enabled: status === "authenticated" && Boolean(userId),
    queryFn: async (): Promise<ExistingSet[]> => {
      const response = await fetch("/api/word-sets");
      if (!response.ok)
        throw new MessageError("errors.couldNotLoadYourExistingSets");
      const body = await response.json();
      return body.wordSets;
    },
  });
  const compatibleSets = (setsQuery.data ?? []).filter(
    (set) => set.sourceLang === sourceLang && set.targetLang === targetLang,
  );
  const content = useMemo(
    () => (pkg ? selectImportContent(pkg, selectedDeckIds) : EMPTY_CONTENT),
    [pkg, selectedDeckIds],
  );
  const entries = useMemo(() => {
    if (!pkg) return [];
    const models = new Map(pkg.models.map((model) => [model.id, model]));
    const mappings = new Map(mapping.map((value) => [value.modelId, value]));
    return content.notes.map((note) => {
      const model = models.get(note.modelId);
      const mapped = model
        ? mapAnkiNote(note, mappings.get(note.modelId), model)
        : null;
      const exercises =
        mapped && !mapped.skipped
          ? getApplicableStudyCardTemplateKeys(mapped)
          : [];
      return { note, model, mapped, exercises };
    });
  }, [content.notes, mapping, pkg]);
  const included = entries.filter(
    (entry) => entry.mapped && !entry.mapped.skipped,
  );
  const needsAttentionCount = included.filter(
    (entry) => entry.mapped!.needsAttention.length > 0,
  ).length;
  const exerciseCount = included.reduce(
    (count, entry) => count + entry.exercises.length,
    0,
  );
  const skippedCount = entries.length - included.length;
  const validTimeZone = isValidSchedulingTimeZone(schedulingTimeZone);
  const progressPreview = useMemo(
    () =>
      pkg && validTimeZone
        ? previewImportProgress(pkg, content, mapping, schedulingTimeZone)
        : null,
    [pkg, validTimeZone, content, mapping, schedulingTimeZone],
  );
  const duplicateProgressMappings =
    importProgress && Boolean(progressPreview?.duplicateMappings.length);
  const preview =
    entries[Math.min(previewIndex, Math.max(0, entries.length - 1))];
  const locked =
    job !== null ||
    resumeAvailable ||
    ["uploading", "committing", "paused", "cancelling", "complete"].includes(
      phase,
    );
  const busy = ["reading", "uploading", "committing", "cancelling"].includes(
    phase,
  );
  // Only acknowledged server writes count as received. This also restores
  // progress immediately when resuming an already staged import.
  const receivedBatches = Math.min(job?.nextBatchIndex ?? 0, batchCount);
  const uploadPercent = batchCount
    ? Math.floor((100 * receivedBatches) / batchCount)
    : 0;
  const sourceLabel = t(languageLabelKey(sourceLang));
  const targetLabel = t(languageLabelKey(targetLang));

  function importNotice(warning: UiMessage) {
    return t(warning.key, warning.values);
  }

  async function chooseFile(nextFile: File) {
    const operation = ++operationRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setError(null);
    setPackage(null);
    setFile(nextFile);
    setJob(null);
    setBatchCount(0);
    setResumeAvailable(false);
    setDirectionConfirmed(false);
    setPhase("reading");
    setReadProgress("archive");
    setPreviewIndex(0);
    if (!/\.apkg$/iu.test(nextFile.name)) {
      setError({ key: "errors.chooseAnAnkiDeckFileEndingInApkg" });
      setPhase("idle");
      return;
    }
    if (nextFile.size > 100 * 1024 * 1024) {
      setError({ key: "errors.chooseAnAnkiDeckSmallerThan100Mb" });
      setPhase("idle");
      return;
    }
    try {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        await nextFile.arrayBuffer(),
      );
      controller.signal.throwIfAborted();
      const hash = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      const read = await readPackageFile(
        nextFile,
        (progress) => {
          if (operationRef.current === operation)
            setReadProgress(progress.phase);
        },
        controller.signal,
      );
      if (operationRef.current !== operation) return;
      setPackage(read);
      setSha256(hash);
      const saved = readResume(userId, hash);
      const languages = suggestedImportLanguages(read);
      setName(
        saved?.name ?? importDisplayName(nextFile.name, read).slice(0, 200),
      );
      setSourceLang(
        saved?.sourceLang ??
          (isSourceLanguageCode(languages.sourceLang)
            ? languages.sourceLang
            : getLanguageCode(currentSourceLanguage)),
      );
      setTargetLang(
        saved?.targetLang ??
          (isTargetLanguageCode(languages.targetLang)
            ? languages.targetLang
            : getLanguageCode(currentTargetLanguage)),
      );
      setTargetSetId(saved?.targetSetId ?? "");
      setImportProgress(saved?.importProgress ?? true);
      setSchedulingTimeZone(
        saved
          ? (saved.schedulingTimeZone ?? "UTC")
          : defaultSchedulingTimeZone(),
      );
      setSelectedDeckIds(
        saved?.selectedDeckIds ?? read.decks.map((deck) => deck.id),
      );
      setMapping(saved?.mapping ?? suggestNoteTypeMappings(read.models));
      setRequestKey(saved?.requestKey ?? crypto.randomUUID());
      setResumeAvailable(saved !== null);
      setDirectionConfirmed(saved !== null);
      if (saved?.jobId) {
        const current = await importRequest<ImportJobStatus>(
          `/api/anki/imports/${saved.jobId}`,
          "GET",
          undefined,
          controller.signal,
        );
        if (operationRef.current !== operation) return;
        if (current.status === "receiving") {
          setJob(current);
        } else if (current.status === "completed") {
          setJob(current);
          setPhase("complete");
          clearResume(userId, hash);
          return;
        } else {
          clearResume(userId, hash);
          setResumeAvailable(false);
          setRequestKey(crypto.randomUUID());
        }
      }
      setPhase("ready");
    } catch (readError) {
      if (operationRef.current !== operation) return;
      if (controller.signal.aborted) {
        setPhase("idle");
      } else {
        setError(
          messageFromError(readError, "errors.couldNotReadThisAnkiDeck"),
        );
        setPhase("ready");
      }
    }
  }

  function configuration(): ResumeImport {
    return {
      version: 1,
      sha256,
      requestKey,
      jobId: job?.jobId,
      name,
      sourceLang,
      targetLang,
      targetSetId,
      importProgress,
      schedulingTimeZone,
      selectedDeckIds,
      mapping,
    };
  }

  function beginPayload() {
    if (!pkg || !file) throw new MessageError("errors.chooseAnAnkiDeckFirst");
    const {
      notes: _notes,
      cards: _cards,
      revlogs: _revlogs,
      ...packageMetadata
    } = pkg;
    return {
      requestKey,
      file: { name: file.name, size: file.size, sha256 },
      name,
      sourceLang,
      targetLang,
      targetSetId: targetSetId || undefined,
      importProgress,
      schedulingTimeZone,
      mapping: mapping.filter((value) =>
        content.notes.some((note) => note.modelId === value.modelId),
      ),
      packageMetadata,
    };
  }

  async function runImport() {
    if (
      !pkg ||
      !file ||
      !directionConfirmed ||
      !included.length ||
      !validTimeZone ||
      duplicateProgressMappings
    )
      return;
    let batches;
    try {
      batches = createImportBatches(content);
      if (importJsonByteLength(beginPayload()) > MAX_IMPORT_REQUEST_BYTES) {
        throw new MessageError(
          "errors.thisDeckHasTooMuchNoteTypeInformationToImportExport",
        );
      }
    } catch (preflightError) {
      setError(
        messageFromError(
          preflightError,
          "errors.thisDeckCouldNotBePreparedForImport",
        ),
      );
      return;
    }
    const operation = ++operationRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setError(null);
    setBatchCount(batches.length);
    setPhase("uploading");
    const saved = configuration();
    setResumeStored(writeResume(userId, saved));
    let current = job;
    try {
      current = current
        ? await importRequest<ImportJobStatus>(
            `/api/anki/imports/${current.jobId}`,
            "GET",
            undefined,
            controller.signal,
          )
        : await importRequest<ImportJobStatus>(
            "/api/anki/imports",
            "POST",
            beginPayload(),
            controller.signal,
          );
      if (operationRef.current !== operation) return;
      setJob(current);
      setResumeAvailable(true);
      setResumeStored(writeResume(userId, { ...saved, jobId: current.jobId }));
      if (current.status !== "receiving" && current.status !== "completed") {
        throw new MessageError(
          "errors.thisImportWasCancelledStartOverToImportThisDeck",
        );
      }
      if (current.nextBatchIndex > batches.length) {
        throw new MessageError(
          "errors.theSavedImportNoLongerMatchesThisSelectionStartOverTo",
        );
      }
      if (current.status !== "completed") {
        for (
          let index = current.nextBatchIndex;
          index < batches.length;
          index++
        ) {
          current = await importRequest<ImportJobStatus>(
            `/api/anki/imports/${current.jobId}`,
            "PUT",
            batches[index],
            controller.signal,
          );
          if (operationRef.current !== operation) return;
          setJob(current);
        }
        setPhase("committing");
        current = await importRequest<ImportJobStatus>(
          `/api/anki/imports/${current.jobId}/commit`,
          "POST",
          {
            expectedBatchCount: batches.length,
            expectedNoteCount: content.notes.length,
          },
          controller.signal,
        );
      }
      if (operationRef.current !== operation) return;
      setJob(current);
      setPhase("complete");
      clearResume(userId, sha256);
      void queryClient.invalidateQueries({ queryKey: ["wordSets"] });
    } catch (importError) {
      if (operationRef.current !== operation) return;
      setPhase("paused");
      if (current) setJob(current);
      if (!controller.signal.aborted) {
        setError(
          messageFromError(importError, "errors.yourImportPausedTryResumingIt"),
        );
      }
    }
  }

  async function cancelImport() {
    const operation = ++operationRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPhase("cancelling");
    setError(null);
    try {
      // Recover a job whose creation response was lost before cancelling it.
      const current =
        job ??
        (await importRequest<ImportJobStatus>(
          "/api/anki/imports",
          "POST",
          beginPayload(),
          controller.signal,
        ));
      await importRequest(
        `/api/anki/imports/${current.jobId}`,
        "DELETE",
        undefined,
        controller.signal,
      );
      if (operationRef.current !== operation) return;
      clearResume(userId, sha256);
      setJob(null);
      setBatchCount(0);
      setResumeAvailable(false);
      setRequestKey(crypto.randomUUID());
      setPhase("ready");
      void queryClient.invalidateQueries({ queryKey: ["wordSets"] });
    } catch (cancelError) {
      if (operationRef.current !== operation) return;
      setPhase("paused");
      setError(
        messageFromError(cancelError, "errors.couldNotCancelTheImportTryAgain"),
      );
    }
  }

  function updateMapping(modelId: string, update: Partial<NoteTypeMapping>) {
    setMapping((current) =>
      current.map((value) =>
        value.modelId === modelId ? { ...value, ...update } : value,
      ),
    );
    if (update.original || update.translation || update.skip !== undefined) {
      setDirectionConfirmed(false);
    }
  }

  function downloadIssues() {
    if (!pkg) return;
    const lines = [
      t("importDeck.reportTitle", { file: file?.name ?? name }),
      `${sourceLabel} → ${targetLabel}`,
      t("importDeck.reportSummary", {
        selected: entries.length,
        included: included.length,
        skipped: skippedCount,
        attention: needsAttentionCount,
      }),
      t("importDeck.reportMedia", { count: pkg.diagnostics.omittedMediaCount }),
      importProgress
        ? t("importDeck.reportProgress", {
            timeZone: schedulingTimeZone,
            matched: progressPreview?.matchedCount ?? 0,
            total: progressPreview?.studiedCount ?? 0,
          })
        : t(
            "importDeck.freshStudyProgressRequestedExistingGooseberryProgressIsKeptOnReimport",
          ),
      ...(job?.status === "completed"
        ? [
            t("importDeck.reportApplied", {
              count: job.importedProgressCount ?? 0,
            }),
          ]
        : []),
      ...(importProgress
        ? [
            ...(progressPreview?.unmatchedTemplates ?? []).map((template) =>
              t("importDeck.reportUnmatched", {
                model: template.modelName,
                template: template.templateName,
                count: template.count,
              }),
            ),
            ...(progressPreview?.unsupportedCount
              ? [
                  t("importDeck.reportUnsupported", {
                    count: progressPreview.unsupportedCount,
                  }),
                ]
              : []),
          ]
        : []),
      ...pkg.diagnostics.warnings.map((warning) =>
        t("importDeck.reportWarning", { warning: importNotice(warning) }),
      ),
      "",
      ...entries.flatMap((entry) => {
        const identity = entry.mapped?.original || entry.note.guid;
        const reason = entry.model
          ? unsupportedNoteTypeReason(entry.model)
          : null;
        if (!entry.mapped || entry.mapped.skipped) {
          return [
            t("importDeck.reportSkipped", {
              word: identity,
              type: entry.model?.name ?? t("importDeck.unknownNoteType"),
              reason: reason
                ? t(reason.key, reason.values)
                : entry.model
                  ? t("importDeck.excludedInFieldMapping")
                  : t("importDeck.unknownNoteType2"),
            }),
          ];
        }
        return entry.mapped.needsAttention.length
          ? [
              t("importDeck.reportAttention", {
                word: identity,
                fields: entry.mapped.needsAttention
                  .map((field) =>
                    field === "original"
                      ? t("common.sourceWord")
                      : t("cardEditor.translation"),
                  )
                  .join(t("importDeck.andSeparator")),
              }),
            ]
          : [];
      }),
    ];
    const url = URL.createObjectURL(
      new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${name.replace(/[^\p{L}\p{N}._-]/gu, "_") || "anki"}-import-report.txt`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (status === "loading")
    return <p className={styles.loading}>{t("importDeck.loading")}</p>;
  if (status !== "authenticated")
    return <p>{t("importDeck.pleaseSignInToImportADeck")}</p>;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <Link className={styles.backLink} href="/anki">
            {t("importDeck.studySets")}
          </Link>
          <h1>{t("importDeck.importAnAnkiDeck")}</h1>
          <p>
            {t(
              "importDeck.bringSharedVocabularyIntoGooseberryAndStudyItInFive",
            )}
          </p>
        </div>
      </header>

      {error && (
        <p className={styles.error} role="alert">
          {t(error.key, error.values)}
        </p>
      )}

      {phase === "complete" && job?.wordSetId ? (
        <section className={styles.complete} aria-live="polite">
          <span className={styles.completeMark} aria-hidden="true">
            ✓
          </span>
          <h2>{t("importDeck.yourVocabularyIsReady")}</h2>
          <p>
            {t("importDeck.addedWords", { count: job.addedCount })}
            {job.skippedCount
              ? t("importDeck.valueAlreadyPresentOrSkipped", {
                  value0: job.skippedCount,
                })
              : ""}
            .
          </p>
          {job.needsAttentionCount > 0 && (
            <p>
              {t("importDeck.attentionWords", {
                count: job.needsAttentionCount,
              })}
            </p>
          )}
          <p className={styles.muted}>
            {importProgress
              ? t(
                  "importDeck.ankiLearningProgressWasKeptForValueStudiedExercisesAdditional",
                  { value0: job.importedProgressCount ?? 0 },
                )
              : t(
                  "importDeck.importedExercisesStartWithFreshStudyProgress",
                )}{" "}
            {t(
              "importDeck.existingGooseberryProgressIsKeptWhenWordsAreSkippedOn",
            )}
          </p>
          <div className={styles.actions}>
            {exerciseCount > 0 && (
              <Link
                className={styles.primaryButton}
                href={`/anki/${job.wordSetId}/review`}
              >
                {t("importDeck.studyNow")}
              </Link>
            )}
            <Link
              className={styles.secondaryButton}
              href={`/anki/${job.wordSetId}`}
            >
              {t("importDeck.openSet")}
            </Link>
            <button
              className={styles.textButton}
              type="button"
              onClick={downloadIssues}
            >
              {t("importDeck.downloadImportReport")}
            </button>
          </div>
          <button
            className={styles.textButton}
            type="button"
            onClick={() => {
              setFile(null);
              setPackage(null);
              setJob(null);
              setResumeAvailable(false);
              setPhase("idle");
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
          >
            {t("importDeck.importAnotherDeck")}
          </button>
          <button
            className={styles.dangerButton}
            type="button"
            onClick={() => void cancelImport()}
          >
            {t("importDeck.undoThisImport")}
          </button>
          <p className={styles.muted}>
            {t("importDeck.undoRemovesOnlyTheWordsAddedByThisImport")}
          </p>
        </section>
      ) : (
        <>
          <fieldset className={styles.panel}>
            <legend>{t("importDeck.step1ChooseYourDeck")}</legend>
            <label className={styles.fileLabel} htmlFor="anki-package-file">
              {t("importDeck.ankiDeckFileApkg")}
            </label>
            <input
              ref={fileInputRef}
              id="anki-package-file"
              className={styles.fileInput}
              type="file"
              accept=".apkg"
              disabled={locked || busy}
              onChange={(event) => {
                const selected = event.target.files?.[0];
                event.currentTarget.value = "";
                if (selected) void chooseFile(selected);
              }}
            />
            {file && (
              <p className={styles.muted}>
                {file.name} · {(file.size / (1024 * 1024)).toFixed(1)}{" "}
                {t("importDeck.mb")}
              </p>
            )}
            {phase === "reading" && (
              <div>
                <p role="status" aria-live="polite">
                  {t(READ_LABELS[readProgress])}
                </p>
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={() => {
                    operationRef.current++;
                    controllerRef.current?.abort();
                    setPhase("idle");
                    setFile(null);
                  }}
                >
                  {t("importDeck.cancelReading")}
                </button>
              </div>
            )}
            <p className={styles.muted}>
              {t("importDeck.audioAndImagesAreLeftOutYouCanGenerateGooseberry")}
            </p>
          </fieldset>

          {pkg && (
            <>
              {resumeAvailable && phase === "ready" && (
                <p className={styles.notice} role="status">
                  {t(
                    "importDeck.anUnfinishedImportForThisFileIsAvailableResumeIt",
                  )}
                </p>
              )}

              <fieldset className={styles.panel} disabled={locked || busy}>
                <legend>{t("importDeck.step2ChooseWordsAndLanguages")}</legend>
                <div className={styles.deckHeading}>
                  <h3>{t("importDeck.decks")}</h3>
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => {
                      setSelectedDeckIds(pkg.decks.map((deck) => deck.id));
                      setPreviewIndex(0);
                    }}
                  >
                    {t("importDeck.selectAll")}
                  </button>
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => {
                      setSelectedDeckIds([]);
                      setPreviewIndex(0);
                    }}
                  >
                    {t("importDeck.clearSelection")}
                  </button>
                </div>
                <div className={styles.deckList}>
                  {pkg.decks.map((deck) => (
                    <label className={styles.checkboxLabel} key={deck.id}>
                      <input
                        type="checkbox"
                        checked={selectedDeckIds.includes(deck.id)}
                        onChange={(event) => {
                          const ids = deckWithDescendants(pkg, deck.id);
                          setSelectedDeckIds((current) =>
                            event.target.checked
                              ? [...new Set([...current, ...ids])]
                              : current.filter((id) => !ids.includes(id)),
                          );
                          setPreviewIndex(0);
                        }}
                      />
                      <span>{deck.name}</span>
                    </label>
                  ))}
                </div>
                <p className={styles.muted}>
                  {t(
                    "importDeck.selectingADeckIncludesItsSubdecksWordsSharedBetweenSelected",
                  )}
                </p>
                <div className={styles.twoColumns}>
                  <label>
                    {t("importDeck.wordLanguage")}
                    <select
                      value={sourceLang}
                      onChange={(event) => {
                        setSourceLang(event.target.value);
                        setTargetSetId("");
                        setDirectionConfirmed(false);
                      }}
                    >
                      {SourceLanguageSelectOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {t(languageLabelKey(option.value))}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t("importDeck.translationLanguage")}
                    <select
                      value={targetLang}
                      onChange={(event) => {
                        setTargetLang(event.target.value);
                        setTargetSetId("");
                        setDirectionConfirmed(false);
                      }}
                    >
                      {TargetLanguageSelectOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {t(languageLabelKey(option.value))}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className={styles.destination}>
                  {t("importDeck.saveTo")}
                  <select
                    value={targetSetId}
                    onChange={(event) => setTargetSetId(event.target.value)}
                  >
                    <option value="">{t("importDeck.aNewStudySet")}</option>
                    {compatibleSets.map((set) => (
                      <option key={set.id} value={set.id}>
                        {set.name}
                      </option>
                    ))}
                  </select>
                </label>
                {!targetSetId && (
                  <label className={styles.destination}>
                    {t("importDeck.setName")}
                    <input
                      type="text"
                      value={name}
                      maxLength={200}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </label>
                )}
                {setsQuery.error && (
                  <p className={styles.muted}>
                    {t(
                      "importDeck.yourExistingSetsCouldNotBeLoadedYouCanStill",
                    )}
                  </p>
                )}
                {targetSetId && (
                  <p className={styles.muted}>
                    {t(
                      "importDeck.previouslyImportedWordsWithTheSameSourceIdentityAreSkipped",
                    )}
                  </p>
                )}
                <div className={styles.progressSettings}>
                  <label className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={importProgress}
                      onChange={(event) =>
                        setImportProgress(event.target.checked)
                      }
                    />
                    <span>{t("importDeck.keepAnkiLearningProgress")}</span>
                  </label>
                  <p className={styles.muted}>
                    {importProgress
                      ? t(
                          "importDeck.matchingExercisesKeepTheirDueDatesAndIntervalsAdditionalExercise",
                        )
                      : t(
                          "importDeck.importedExercisesStartNewYourAnkiReviewHistoryIsRetained",
                        )}
                  </p>
                  <label className={styles.destination}>
                    {t("importDeck.studyTimeZone")}
                    <input
                      type="text"
                      value={schedulingTimeZone}
                      maxLength={100}
                      placeholder={t("importDeck.europeHelsinki")}
                      aria-invalid={!validTimeZone}
                      aria-describedby="import-time-zone-help"
                      onChange={(event) =>
                        setSchedulingTimeZone(event.target.value.trim())
                      }
                    />
                  </label>
                  <p className={styles.muted} id="import-time-zone-help">
                    {t("importDeck.useTheTimeZoneYouStudiedInSuchAsEurope")}
                  </p>
                  {!validTimeZone && (
                    <p className={styles.error} role="alert">
                      {t(
                        "importDeck.enterAValidTimeZoneSuchAsEuropeHelsinkiOr",
                      )}
                    </p>
                  )}
                </div>
              </fieldset>

              <fieldset className={styles.panel} disabled={locked || busy}>
                <legend>{t("importDeck.step3MatchTheFields")}</legend>
                <p className={styles.muted}>
                  {t(
                    "importDeck.weSuggestedFamiliarFieldNamesCheckEachNoteTypeAgainst",
                  )}
                </p>
                {pkg.models
                  .filter((model) =>
                    content.notes.some((note) => note.modelId === model.id),
                  )
                  .map((model) => {
                    const value = mapping.find(
                      (candidate) => candidate.modelId === model.id,
                    );
                    if (!value) return null;
                    const unsupported = unsupportedNoteTypeReason(model);
                    return (
                      <details className={styles.noteType} key={model.id} open>
                        <summary>
                          {model.name}
                          <span>
                            {t("importDeck.noteCount", {
                              count: content.notes.filter(
                                (note) => note.modelId === model.id,
                              ).length,
                            })}
                          </span>
                        </summary>
                        {unsupported ? (
                          <p className={styles.notice}>
                            {t(unsupported.key, unsupported.values)}{" "}
                            {t("importDeck.theseNotesWillBeSkipped")}
                          </p>
                        ) : (
                          <>
                            <label className={styles.checkboxLabel}>
                              <input
                                type="checkbox"
                                checked={!value.skip}
                                onChange={(event) =>
                                  updateMapping(model.id, {
                                    skip: !event.target.checked,
                                  })
                                }
                              />
                              {t("importDeck.includeThisNoteType")}
                            </label>
                            {!value.skip && (
                              <>
                                <div className={styles.twoColumns}>
                                  <FieldMappingEditor
                                    label={t("importDeck.wordValue", {
                                      value0: sourceLabel,
                                    })}
                                    model={model}
                                    value={value.original}
                                    onChange={(original) =>
                                      updateMapping(model.id, { original })
                                    }
                                  />
                                  <FieldMappingEditor
                                    label={t("importDeck.translationValue", {
                                      value0: targetLabel,
                                    })}
                                    model={model}
                                    value={value.translation}
                                    onChange={(translation) =>
                                      updateMapping(model.id, { translation })
                                    }
                                  />
                                  <FieldMappingEditor
                                    label={t("importDeck.wordForms")}
                                    model={model}
                                    value={value.wordForms}
                                    onChange={(wordForms) =>
                                      updateMapping(model.id, { wordForms })
                                    }
                                  />
                                  <FieldMappingEditor
                                    label={t("importDeck.comments")}
                                    model={model}
                                    value={value.comments}
                                    onChange={(comments) =>
                                      updateMapping(model.id, { comments })
                                    }
                                  />
                                </div>
                                <h4>{t("importDeck.examplePairs")}</h4>
                                {(value.examples ?? []).map((pair, index) => (
                                  <div
                                    className={styles.examplePair}
                                    key={index}
                                  >
                                    <div className={styles.twoColumns}>
                                      <FieldMappingEditor
                                        label={t(
                                          "importDeck.exampleValueValue",
                                          {
                                            value0: index + 1,
                                            value1: sourceLabel,
                                          },
                                        )}
                                        model={model}
                                        value={pair.sample}
                                        onChange={(sample) =>
                                          updateMapping(model.id, {
                                            examples: value.examples!.map(
                                              (current, pairIndex) =>
                                                pairIndex === index
                                                  ? { ...current, sample }
                                                  : current,
                                            ),
                                          })
                                        }
                                      />
                                      <FieldMappingEditor
                                        label={t(
                                          "importDeck.exampleValueTranslationValue",
                                          {
                                            value0: index + 1,
                                            value1: targetLabel,
                                          },
                                        )}
                                        model={model}
                                        value={pair.translation}
                                        onChange={(translation) =>
                                          updateMapping(model.id, {
                                            examples: value.examples!.map(
                                              (current, pairIndex) =>
                                                pairIndex === index
                                                  ? { ...current, translation }
                                                  : current,
                                            ),
                                          })
                                        }
                                      />
                                    </div>
                                    <button
                                      type="button"
                                      className={styles.textButton}
                                      onClick={() =>
                                        updateMapping(model.id, {
                                          examples: value.examples!.filter(
                                            (_, pairIndex) =>
                                              pairIndex !== index,
                                          ),
                                        })
                                      }
                                    >
                                      {t("importDeck.removeExamplePair")}
                                    </button>
                                  </div>
                                ))}
                                {(value.examples?.length ?? 0) <
                                  MAX_IMPORT_EXAMPLE_PAIRS && (
                                  <button
                                    type="button"
                                    className={styles.secondaryButton}
                                    onClick={() =>
                                      updateMapping(model.id, {
                                        examples: [
                                          ...(value.examples ?? []),
                                          {
                                            sample: {
                                              fields: [],
                                              separator: " ",
                                            },
                                            translation: {
                                              fields: [],
                                              separator: " ",
                                            },
                                          },
                                        ],
                                      })
                                    }
                                  >
                                    {t("importDeck.addExamplePair")}
                                  </button>
                                )}
                                <p className={styles.muted}>
                                  {t(
                                    "importDeck.allMappedExamplesAreSavedStudyUsesTheFirstComplete",
                                  )}
                                </p>
                                {importProgress && (
                                  <div className={styles.templateMappings}>
                                    <h4>
                                      {t("importDeck.matchLearningProgress")}
                                    </h4>
                                    <p className={styles.muted}>
                                      {t(
                                        "importDeck.matchEachAnkiCardTypeToOneGooseberryExerciseChoose",
                                      )}
                                    </p>
                                    <div className={styles.twoColumns}>
                                      {model.templates.map((template) => {
                                        const explicit =
                                          value.exerciseTemplates?.find(
                                            (entry) =>
                                              entry.ord === template.ord,
                                          );
                                        const inferred =
                                          resolveAnkiStudyTemplate(
                                            model,
                                            {
                                              ...value,
                                              exerciseTemplates: [],
                                            },
                                            template.ord,
                                          );
                                        const resolved =
                                          resolveAnkiStudyTemplate(
                                            model,
                                            value,
                                            template.ord,
                                          );
                                        return (
                                          <label key={template.ord}>
                                            {template.name}
                                            <select
                                              value={
                                                explicit
                                                  ? (explicit.templateKey ??
                                                    "none")
                                                  : "auto"
                                              }
                                              onChange={(event) => {
                                                const selected =
                                                  event.target.value;
                                                const overrides = (
                                                  value.exerciseTemplates ?? []
                                                ).filter(
                                                  (entry) =>
                                                    entry.ord !== template.ord,
                                                );
                                                if (
                                                  selected === "none" ||
                                                  isStudyCardTemplateKey(
                                                    selected,
                                                  )
                                                )
                                                  overrides.push({
                                                    ord: template.ord,
                                                    templateKey:
                                                      selected === "none"
                                                        ? null
                                                        : selected,
                                                  });
                                                updateMapping(model.id, {
                                                  exerciseTemplates: overrides,
                                                });
                                              }}
                                            >
                                              <option value="auto">
                                                {inferred
                                                  ? t(
                                                      "importDeck.suggestedValue",
                                                      {
                                                        value0:
                                                          exerciseMatchLabel(
                                                            inferred,
                                                            sourceLabel,
                                                            targetLabel,
                                                            t,
                                                          ),
                                                      },
                                                    )
                                                  : t(
                                                      "importDeck.noSuggestedMatch",
                                                    )}
                                              </option>
                                              {STUDY_CARD_TEMPLATES.map(
                                                ({ key }) => (
                                                  <option
                                                    key={key}
                                                    value={key}
                                                    disabled={
                                                      key !== resolved &&
                                                      model.templates.some(
                                                        (other) =>
                                                          other.ord !==
                                                            template.ord &&
                                                          resolveAnkiStudyTemplate(
                                                            model,
                                                            value,
                                                            other.ord,
                                                          ) === key,
                                                      )
                                                    }
                                                  >
                                                    {exerciseMatchLabel(
                                                      key,
                                                      sourceLabel,
                                                      targetLabel,
                                                      t,
                                                    )}
                                                  </option>
                                                ),
                                              )}
                                              <option value="none">
                                                {t("importDeck.doNotTransfer")}
                                              </option>
                                            </select>
                                          </label>
                                        );
                                      })}
                                    </div>
                                    {(progressPreview?.duplicateMappings ?? [])
                                      .filter(
                                        (issue) => issue.modelId === model.id,
                                      )
                                      .map((issue) => (
                                        <p
                                          className={styles.error}
                                          role="alert"
                                          key={issue.modelId}
                                        >
                                          {t(
                                            "importDeck.moreThanOneAnkiCardTypeMatches",
                                          )}{" "}
                                          {issue.templateKeys
                                            .map((key) =>
                                              t(
                                                getStudyCardTemplate(key)
                                                  .labelKey,
                                              ),
                                            )
                                            .join(", ")}
                                          {t(
                                            "importDeck.matchEachExerciseOnceOrChooseDoNotTransferFor",
                                          )}
                                        </p>
                                      ))}
                                  </div>
                                )}
                              </>
                            )}
                          </>
                        )}
                      </details>
                    );
                  })}
              </fieldset>

              <fieldset className={styles.panel}>
                <legend>{t("importDeck.step4CheckThePreview")}</legend>
                <div className={styles.summary}>
                  <p>
                    {t("importDeck.includedWords", { count: included.length })}
                  </p>
                  <p>
                    {t("importDeck.availableExercises", {
                      count: exerciseCount,
                    })}
                  </p>
                  <p>
                    <strong>{needsAttentionCount}</strong>{" "}
                    {t("importDeck.needAttention")}
                  </p>
                  {skippedCount > 0 && (
                    <p>
                      <strong>{skippedCount}</strong> {t("importDeck.skipped")}
                    </p>
                  )}
                </div>
                {importProgress && progressPreview && (
                  <div className={styles.progressPreview}>
                    <p>
                      {t("importDeck.progressMatched", {
                        matched: progressPreview.matchedCount,
                        total: progressPreview.studiedCount,
                      })}
                    </p>
                    <p className={styles.muted}>
                      {t(
                        "importDeck.progressIsRetainedForMatchedExercisesEvenWhenMissingContent",
                      )}
                    </p>
                    {progressPreview.unmatchedTemplates.length > 0 && (
                      <details className={styles.savedExamples}>
                        <summary>
                          {t("importDeck.unmatchedCards", {
                            count: progressPreview.unmatchedTemplates.reduce(
                              (count, template) => count + template.count,
                              0,
                            ),
                          })}
                        </summary>
                        <p>
                          {t(
                            "importDeck.theirLearningProgressWillNotTransferReviewTheMatchesAbove",
                          )}
                        </p>
                        <ul>
                          {progressPreview.unmatchedTemplates.map(
                            (template) => (
                              <li key={`${template.modelId}:${template.ord}`}>
                                {template.modelName} · {template.templateName}:{" "}
                                {template.count}
                              </li>
                            ),
                          )}
                        </ul>
                      </details>
                    )}
                    {progressPreview.unsupportedCount > 0 && (
                      <p className={styles.notice}>
                        {t("importDeck.unsupportedProgress", {
                          count: progressPreview.unsupportedCount,
                        })}
                      </p>
                    )}
                    {duplicateProgressMappings && (
                      <p className={styles.error} role="alert">
                        {t(
                          "importDeck.resolveTheDuplicateExerciseMatchesAboveBeforeImportingOrTurn",
                        )}
                      </p>
                    )}
                  </div>
                )}
                {needsAttentionCount > 0 && (
                  <p className={styles.notice}>
                    {t(
                      "importDeck.incompleteWordsAreSavedForLaterExercisesAppearAsSoon",
                    )}
                  </p>
                )}
                {preview ? (
                  <>
                    <div className={styles.previewNavigation}>
                      <button
                        type="button"
                        className={styles.smallButton}
                        disabled={previewIndex <= 0}
                        onClick={() => setPreviewIndex((index) => index - 1)}
                      >
                        {t("importDeck.previous")}
                      </button>
                      <span>
                        {t("importDeck.note")}{" "}
                        {Math.min(previewIndex + 1, entries.length)}{" "}
                        {t("importDeck.of")} {entries.length} ·{" "}
                        {preview.model?.name ?? t("importDeck.unknownType")}
                      </span>
                      <button
                        type="button"
                        className={styles.smallButton}
                        disabled={previewIndex >= entries.length - 1}
                        onClick={() => setPreviewIndex((index) => index + 1)}
                      >
                        {t("importDeck.next")}
                      </button>
                    </div>
                    {!preview.mapped || preview.mapped.skipped ? (
                      <p className={styles.notice}>
                        {t(
                          "importDeck.thisNoteWillBeSkippedSelectASupportedVocabularyNote",
                        )}
                      </p>
                    ) : (
                      <>
                        <dl className={styles.previewFields}>
                          <div>
                            <dt>{t("importDeck.word")}</dt>
                            <dd lang={sourceLang}>
                              {preview.mapped.original || (
                                <em>{t("importDeck.missing")}</em>
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>{t("cardEditor.translation")}</dt>
                            <dd lang={targetLang}>
                              {preview.mapped.translation || (
                                <em>{t("importDeck.missing")}</em>
                              )}
                            </dd>
                          </div>
                          {preview.mapped.wordForms && (
                            <div>
                              <dt>{t("importDeck.forms")}</dt>
                              <dd lang={sourceLang}>
                                {preview.mapped.wordForms}
                              </dd>
                            </div>
                          )}
                          {preview.mapped.comments && (
                            <div>
                              <dt>{t("importDeck.comments")}</dt>
                              <dd>{preview.mapped.comments}</dd>
                            </div>
                          )}
                        </dl>
                        <h3>{t("importDeck.studyExercises")}</h3>
                        {preview.exercises.length ? (
                          <ul className={styles.exercisePreview}>
                            {preview.exercises.map((key) => {
                              const template = getStudyCardTemplate(key);
                              return (
                                <li key={key}>
                                  <strong>{t(template.labelKey)}</strong>
                                  <p>
                                    {preview.mapped![template.promptField]}
                                    <span aria-label={t("importDeck.answer")}>
                                      {" "}
                                      →{" "}
                                    </span>
                                    {preview.mapped![template.answerField]}
                                  </p>
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className={styles.muted}>
                            {t(
                              "importDeck.noExercisesYetAddTheMissingContentAfterImporting",
                            )}
                          </p>
                        )}
                        {preview.mapped.examplePairs.length > 0 && (
                          <details className={styles.savedExamples}>
                            <summary>
                              {t("importDeck.savedPairs", {
                                count: preview.mapped.examplePairs.length,
                              })}
                            </summary>
                            {preview.mapped.examplePairs.map((pair, index) => (
                              <div key={index}>
                                <p lang={sourceLang}>
                                  {pair.sample ||
                                    t("importDeck.missingSourceExample")}
                                </p>
                                <p lang={targetLang}>
                                  {pair.translation ||
                                    t("importDeck.missingExampleTranslation")}
                                </p>
                              </div>
                            ))}
                          </details>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <p className={styles.muted}>
                    {t("importDeck.selectAtLeastOneDeckToPreviewItsWords")}
                  </p>
                )}
                {pkg.diagnostics.warnings.length > 0 && (
                  <details className={styles.savedExamples}>
                    <summary>
                      {t("importDeck.deckNoticeCount", {
                        count: pkg.diagnostics.warnings.length,
                      })}
                    </summary>
                    <ul>
                      {pkg.diagnostics.warnings.map((warning, index) => (
                        <li key={index}>{importNotice(warning)}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <button
                  className={styles.textButton}
                  type="button"
                  onClick={downloadIssues}
                >
                  {t("importDeck.downloadIssuesReport")}
                </button>
                <label className={styles.directionConfirmation}>
                  <input
                    type="checkbox"
                    checked={directionConfirmed}
                    disabled={locked || busy}
                    onChange={(event) =>
                      setDirectionConfirmed(event.target.checked)
                    }
                  />
                  <span>
                    {t("importDeck.confirmDirection", {
                      source: sourceLabel,
                      target: targetLabel,
                    })}
                  </span>
                </label>
              </fieldset>

              <section className={styles.importActions} aria-live="polite">
                {(phase === "uploading" ||
                  phase === "committing" ||
                  phase === "paused") && (
                  <>
                    <p role="status">
                      {phase === "committing"
                        ? t("importDeck.finishingYourImport")
                        : phase === "paused"
                          ? t("importDeck.importPausedValueReceived", {
                              value0: uploadPercent,
                            })
                          : t("importDeck.uploadingYourVocabularyValue", {
                              value0: uploadPercent,
                            })}
                    </p>
                    <progress
                      aria-label={
                        phase === "committing"
                          ? t("importDeck.savingYourStudySet")
                          : t("importDeck.deckUploadProgress")
                      }
                      max={Math.max(1, batchCount)}
                      value={
                        phase === "committing" ? undefined : receivedBatches
                      }
                    />
                    <ul className={styles.receivedCounts}>
                      <li>
                        {job?.stagedNoteCount ?? 0} {t("importDeck.of")}{" "}
                        {content.notes.length} {t("importDeck.wordsReceived")}
                      </li>
                      {content.cards.length > 0 && (
                        <li>
                          {job?.stagedCardCount ?? 0} {t("importDeck.of")}{" "}
                          {content.cards.length}{" "}
                          {t("importDeck.ankiCardsReceived")}
                        </li>
                      )}
                      {content.revlogs.length > 0 && (
                        <li>
                          {t("importDeck.receivedReviews", {
                            received: job?.stagedReviewCount ?? 0,
                            total: content.revlogs.length,
                          })}
                        </li>
                      )}
                    </ul>
                    {phase === "committing" && (
                      <p className={styles.muted}>
                        {t(
                          "importDeck.allDeckDataReceivedYourWordsAndLearningProgressAre",
                        )}
                      </p>
                    )}
                  </>
                )}
                {phase === "uploading" ||
                phase === "committing" ||
                phase === "cancelling" ? (
                  <>
                    {phase === "cancelling" && (
                      <p role="status">
                        {t("importDeck.cancellingYourImport")}
                      </p>
                    )}
                    {phase === "uploading" && (
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => controllerRef.current?.abort()}
                      >
                        {t("importDeck.pauseImport")}
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    {phase === "paused" && (
                      <p className={styles.notice}>
                        {t("importDeck.yourProgressIsSaved")}{" "}
                        {resumeStored
                          ? t(
                              "importDeck.resumeHereOrChooseThisSameFileLaterToContinue",
                            )
                          : t(
                              "importDeck.keepThisPageOpenToResumeBrowserStorageIsUnavailable",
                            )}
                      </p>
                    )}
                    <button
                      type="button"
                      className={styles.primaryButton}
                      disabled={
                        !directionConfirmed ||
                        !included.length ||
                        !name.trim() ||
                        !content.notes.length ||
                        !validTimeZone ||
                        duplicateProgressMappings
                      }
                      onClick={() => void runImport()}
                    >
                      {job || resumeAvailable || phase === "paused"
                        ? t("importDeck.resumeImport")
                        : t("importDeck.importWords", {
                            count: included.length,
                          })}
                    </button>
                    {(job || resumeAvailable || phase === "paused") && (
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => void cancelImport()}
                      >
                        {t("importDeck.cancelImport")}
                      </button>
                    )}
                  </>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
