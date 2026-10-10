"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  SourceLanguageSelectOptions,
  TargetLanguageSelectOptions,
  getLanguageCode,
  isSourceLanguageCode,
  isTargetLanguageCode,
} from "@/components/ui/Languages";
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
import type {
  AnkiNoteType,
  AnkiPackage,
  AnkiReadProgress,
} from "@/lib/anki/import/readerTypes";
import {
  getApplicableStudyCardTemplateKeys,
  getStudyCardTemplate,
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
  selectedDeckIds: string[];
  mapping: NoteTypeMapping[];
};

const EMPTY_CONTENT = { notes: [], cards: [], revlogs: [] };
const EMPTY_MAPPING: FieldMapping = { fields: [], separator: " " };
const READ_LABELS: Record<AnkiReadProgress["phase"], string> = {
  archive: "Opening your deck…",
  database: "Reading its vocabulary…",
  notes: "Preparing the preview…",
  complete: "Preparing the preview…",
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
  const selections = value.fields.length ? value.fields : [-1];
  return (
    <div className={styles.fieldMapping}>
      <span className={styles.fieldLabel}>{label}</span>
      {selections.map((ordinal, index) => (
        <div className={styles.fieldSelection} key={index}>
          <select
            aria-label={`${model.name}: ${label}${index ? `, field ${index + 1}` : ""}`}
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
            <option value={-1}>Leave empty</option>
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
              aria-label={`Remove field ${index + 1} from ${label}`}
              onClick={() =>
                onChange({
                  ...value,
                  fields: value.fields.filter(
                    (_, fieldIndex) => fieldIndex !== index,
                  ),
                })
              }
            >
              Remove
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
          Add another field
        </button>
      )}
      {value.fields.length > 1 && (
        <label className={styles.joinLabel}>
          Join fields with
          <select
            value={value.separator}
            onChange={(event) =>
              onChange({ ...value, separator: event.target.value })
            }
          >
            <option value=" ">a space</option>
            <option value=" · ">a dot</option>
            <option value="; ">a semicolon</option>
            <option value={"\n"}>line breaks</option>
          </select>
        </label>
      )}
    </div>
  );
}

export function ImportDeck() {
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
  const [selectedDeckIds, setSelectedDeckIds] = useState<string[]>([]);
  const [mapping, setMapping] = useState<NoteTypeMapping[]>([]);
  const [directionConfirmed, setDirectionConfirmed] = useState(false);
  const [requestKey, setRequestKey] = useState("");
  const [job, setJob] = useState<ImportJobStatus | null>(null);
  const [resumeAvailable, setResumeAvailable] = useState(false);
  const [resumeStored, setResumeStored] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
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
      if (!response.ok) throw new Error("Could not load your existing sets.");
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
  const sourceLabel =
    SourceLanguageSelectOptions.find((option) => option.value === sourceLang)
      ?.label ?? sourceLang;
  const targetLabel =
    TargetLanguageSelectOptions.find((option) => option.value === targetLang)
      ?.label ?? targetLang;

  async function chooseFile(nextFile: File) {
    const operation = ++operationRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setError(null);
    setPackage(null);
    setFile(nextFile);
    setJob(null);
    setResumeAvailable(false);
    setDirectionConfirmed(false);
    setPhase("reading");
    setReadProgress("archive");
    setPreviewIndex(0);
    if (!/\.apkg$/iu.test(nextFile.name)) {
      setError("Choose an Anki deck file ending in .apkg.");
      setPhase("idle");
      return;
    }
    if (nextFile.size > 100 * 1024 * 1024) {
      setError("Choose an Anki deck smaller than 100 MB.");
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
          readError instanceof Error
            ? readError.message
            : "Could not read this Anki deck.",
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
      selectedDeckIds,
      mapping,
    };
  }

  function beginPayload() {
    if (!pkg || !file) throw new Error("Choose an Anki deck first.");
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
      mapping,
      packageMetadata,
    };
  }

  async function runImport() {
    if (!pkg || !file || !directionConfirmed || !included.length) return;
    let batches;
    try {
      batches = createImportBatches(content);
      if (importJsonByteLength(beginPayload()) > MAX_IMPORT_REQUEST_BYTES) {
        throw new Error(
          "This deck has too much note type information to import. Export a smaller selection from Anki and try again.",
        );
      }
    } catch (preflightError) {
      setError(
        preflightError instanceof Error
          ? preflightError.message
          : "This deck could not be prepared for import.",
      );
      return;
    }
    const operation = ++operationRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setError(null);
    setPhase("uploading");
    const saved = configuration();
    setResumeStored(writeResume(userId, saved));
    let current = job;
    try {
      setBatchProgress({
        done: current?.nextBatchIndex ?? 0,
        total: batches.length,
      });
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
        throw new Error(
          "This import was cancelled. Start over to import this deck.",
        );
      }
      if (current.nextBatchIndex > batches.length) {
        throw new Error(
          "The saved import no longer matches this selection. Start over to import this deck.",
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
          setBatchProgress({ done: index + 1, total: batches.length });
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
          importError instanceof Error
            ? importError.message
            : "Your import paused. Try resuming it.",
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
      setResumeAvailable(false);
      setRequestKey(crypto.randomUUID());
      setPhase("ready");
      void queryClient.invalidateQueries({ queryKey: ["wordSets"] });
    } catch (cancelError) {
      if (operationRef.current !== operation) return;
      setPhase("paused");
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : "Could not cancel the import. Try again.",
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
      `Anki import report: ${file?.name ?? name}`,
      `${sourceLabel} → ${targetLabel}`,
      `${entries.length} selected notes; ${included.length} included; ${skippedCount} skipped; ${needsAttentionCount} need attention.`,
      `${pkg.diagnostics.omittedMediaCount} media files omitted. Review history and deck settings are retained; Gooseberry progress starts fresh.`,
      ...pkg.diagnostics.warnings.map((warning) => `Warning: ${warning}`),
      "",
      ...entries.flatMap((entry) => {
        const identity = entry.mapped?.original || entry.note.guid;
        if (!entry.mapped || entry.mapped.skipped) {
          return [
            `Skipped ${identity} (${entry.model?.name ?? "Unknown note type"}): ${entry.model ? (unsupportedNoteTypeReason(entry.model) ?? "Excluded in field mapping.") : "Unknown note type."}`,
          ];
        }
        return entry.mapped.needsAttention.length
          ? [
              `Needs attention: ${identity}. Missing ${entry.mapped.needsAttention.map((field) => (field === "original" ? "source word" : "translation")).join(" and ")}.`,
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

  if (status === "loading") return <p className={styles.loading}>Loading…</p>;
  if (status !== "authenticated")
    return <p>Please sign in to import a deck.</p>;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <Link className={styles.backLink} href="/anki">
            ← Study sets
          </Link>
          <h1>Import an Anki deck</h1>
          <p>
            Bring shared vocabulary into Gooseberry and study it in five
            directions.
          </p>
        </div>
      </header>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {phase === "complete" && job?.wordSetId ? (
        <section className={styles.complete} aria-live="polite">
          <span className={styles.completeMark} aria-hidden="true">
            ✓
          </span>
          <h2>Your vocabulary is ready</h2>
          <p>
            {job.addedCount} words added
            {job.skippedCount
              ? ` · ${job.skippedCount} already present or skipped`
              : ""}
            .
          </p>
          {job.needsAttentionCount > 0 && (
            <p>
              {job.needsAttentionCount} words need missing content. Open the set
              to request generation when you’re ready.
            </p>
          )}
          <p className={styles.muted}>
            Imported audio and images were omitted. Your Gooseberry study
            progress starts fresh.
          </p>
          <div className={styles.actions}>
            {exerciseCount > 0 && (
              <Link
                className={styles.primaryButton}
                href={`/anki/${job.wordSetId}/review`}
              >
                Study now
              </Link>
            )}
            <Link
              className={styles.secondaryButton}
              href={`/anki/${job.wordSetId}`}
            >
              Open set
            </Link>
            <button
              className={styles.textButton}
              type="button"
              onClick={downloadIssues}
            >
              Download import report
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
            Import another deck
          </button>
          <button
            className={styles.dangerButton}
            type="button"
            onClick={() => void cancelImport()}
          >
            Undo this import
          </button>
          <p className={styles.muted}>
            Undo removes only the words added by this import.
          </p>
        </section>
      ) : (
        <>
          <section className={styles.panel}>
            <h2>1. Choose your deck</h2>
            <label className={styles.fileLabel} htmlFor="anki-package-file">
              Anki deck file (.apkg)
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
                {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB
              </p>
            )}
            {phase === "reading" && (
              <div>
                <p role="status" aria-live="polite">
                  {READ_LABELS[readProgress]}
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
                  Cancel reading
                </button>
              </div>
            )}
            <p className={styles.muted}>
              Audio and images are left out. You can generate Gooseberry
              pronunciation later. Existing Anki reviews and deck settings are
              retained for future support; study starts fresh here.
            </p>
          </section>

          {pkg && (
            <>
              {resumeAvailable && phase === "ready" && (
                <p className={styles.notice} role="status">
                  An unfinished import for this file is available. Resume it
                  below or cancel it to change the selection.
                </p>
              )}

              <fieldset className={styles.panel} disabled={locked || busy}>
                <legend>2. Choose words and languages</legend>
                <div className={styles.deckHeading}>
                  <h3>Decks</h3>
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => {
                      setSelectedDeckIds(pkg.decks.map((deck) => deck.id));
                      setPreviewIndex(0);
                    }}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => {
                      setSelectedDeckIds([]);
                      setPreviewIndex(0);
                    }}
                  >
                    Clear selection
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
                  Selecting a deck includes its subdecks. Words shared between
                  selected decks are imported once.
                </p>
                <div className={styles.twoColumns}>
                  <label>
                    Word language
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
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Translation language
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
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className={styles.destination}>
                  Save to
                  <select
                    value={targetSetId}
                    onChange={(event) => setTargetSetId(event.target.value)}
                  >
                    <option value="">A new study set</option>
                    {compatibleSets.map((set) => (
                      <option key={set.id} value={set.id}>
                        {set.name}
                      </option>
                    ))}
                  </select>
                </label>
                {!targetSetId && (
                  <label className={styles.destination}>
                    Set name
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
                    Your existing sets could not be loaded. You can still create
                    a new set.
                  </p>
                )}
                {targetSetId && (
                  <p className={styles.muted}>
                    Previously imported words with the same source identity are
                    skipped. Your edits and study progress stay intact.
                  </p>
                )}
              </fieldset>

              <fieldset className={styles.panel} disabled={locked || busy}>
                <legend>3. Match the fields</legend>
                <p className={styles.muted}>
                  We suggested familiar field names. Check each note type
                  against the preview. Leave missing content empty and generate
                  it later when you request it.
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
                            {
                              content.notes.filter(
                                (note) => note.modelId === model.id,
                              ).length
                            }{" "}
                            notes
                          </span>
                        </summary>
                        {unsupported ? (
                          <p className={styles.notice}>
                            {unsupported} These notes will be skipped.
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
                              Include this note type
                            </label>
                            {!value.skip && (
                              <>
                                <div className={styles.twoColumns}>
                                  <FieldMappingEditor
                                    label={`Word (${sourceLabel})`}
                                    model={model}
                                    value={value.original}
                                    onChange={(original) =>
                                      updateMapping(model.id, { original })
                                    }
                                  />
                                  <FieldMappingEditor
                                    label={`Translation (${targetLabel})`}
                                    model={model}
                                    value={value.translation}
                                    onChange={(translation) =>
                                      updateMapping(model.id, { translation })
                                    }
                                  />
                                  <FieldMappingEditor
                                    label="Word forms"
                                    model={model}
                                    value={value.wordForms}
                                    onChange={(wordForms) =>
                                      updateMapping(model.id, { wordForms })
                                    }
                                  />
                                  <FieldMappingEditor
                                    label="Comments"
                                    model={model}
                                    value={value.comments}
                                    onChange={(comments) =>
                                      updateMapping(model.id, { comments })
                                    }
                                  />
                                </div>
                                <h4>Example pairs</h4>
                                {(value.examples ?? []).map((pair, index) => (
                                  <div
                                    className={styles.examplePair}
                                    key={index}
                                  >
                                    <div className={styles.twoColumns}>
                                      <FieldMappingEditor
                                        label={`Example ${index + 1} (${sourceLabel})`}
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
                                        label={`Example ${index + 1} translation (${targetLabel})`}
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
                                      Remove example pair
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
                                    Add example pair
                                  </button>
                                )}
                                <p className={styles.muted}>
                                  All mapped examples are saved. Study uses the
                                  first complete pair for now.
                                </p>
                              </>
                            )}
                          </>
                        )}
                      </details>
                    );
                  })}
              </fieldset>

              <section className={styles.panel}>
                <h2>4. Check the preview</h2>
                <div className={styles.summary}>
                  <p>
                    <strong>{included.length}</strong> words included
                  </p>
                  <p>
                    <strong>{exerciseCount}</strong> exercises available
                  </p>
                  <p>
                    <strong>{needsAttentionCount}</strong> need attention
                  </p>
                  {skippedCount > 0 && (
                    <p>
                      <strong>{skippedCount}</strong> skipped
                    </p>
                  )}
                </div>
                {needsAttentionCount > 0 && (
                  <p className={styles.notice}>
                    Incomplete words are saved for later. Exercises appear as
                    soon as their required content is available. Generation only
                    starts when you request it.
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
                        Previous
                      </button>
                      <span>
                        Note {Math.min(previewIndex + 1, entries.length)} of{" "}
                        {entries.length} ·{" "}
                        {preview.model?.name ?? "Unknown type"}
                      </span>
                      <button
                        type="button"
                        className={styles.smallButton}
                        disabled={previewIndex >= entries.length - 1}
                        onClick={() => setPreviewIndex((index) => index + 1)}
                      >
                        Next
                      </button>
                    </div>
                    {!preview.mapped || preview.mapped.skipped ? (
                      <p className={styles.notice}>
                        This note will be skipped. Select a supported vocabulary
                        note type above.
                      </p>
                    ) : (
                      <>
                        <dl className={styles.previewFields}>
                          <div>
                            <dt>Word</dt>
                            <dd lang={sourceLang}>
                              {preview.mapped.original || <em>Missing</em>}
                            </dd>
                          </div>
                          <div>
                            <dt>Translation</dt>
                            <dd lang={targetLang}>
                              {preview.mapped.translation || <em>Missing</em>}
                            </dd>
                          </div>
                          {preview.mapped.wordForms && (
                            <div>
                              <dt>Forms</dt>
                              <dd lang={sourceLang}>
                                {preview.mapped.wordForms}
                              </dd>
                            </div>
                          )}
                          {preview.mapped.comments && (
                            <div>
                              <dt>Comments</dt>
                              <dd>{preview.mapped.comments}</dd>
                            </div>
                          )}
                        </dl>
                        <h3>Study exercises</h3>
                        {preview.exercises.length ? (
                          <ul className={styles.exercisePreview}>
                            {preview.exercises.map((key) => {
                              const template = getStudyCardTemplate(key);
                              return (
                                <li key={key}>
                                  <strong>{template.label}</strong>
                                  <p>
                                    {preview.mapped![template.promptField]}
                                    <span aria-label="answer"> → </span>
                                    {preview.mapped![template.answerField]}
                                  </p>
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className={styles.muted}>
                            No exercises yet. Add the missing content after
                            importing.
                          </p>
                        )}
                        {preview.mapped.examplePairs.length > 0 && (
                          <details className={styles.savedExamples}>
                            <summary>
                              Saved example pairs (
                              {preview.mapped.examplePairs.length})
                            </summary>
                            {preview.mapped.examplePairs.map((pair, index) => (
                              <div key={index}>
                                <p lang={sourceLang}>
                                  {pair.sample || "Missing source example"}
                                </p>
                                <p lang={targetLang}>
                                  {pair.translation ||
                                    "Missing example translation"}
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
                    Select at least one deck to preview its words.
                  </p>
                )}
                {pkg.diagnostics.warnings.length > 0 && (
                  <details className={styles.savedExamples}>
                    <summary>
                      Deck notices ({pkg.diagnostics.warnings.length})
                    </summary>
                    <ul>
                      {pkg.diagnostics.warnings.map((warning, index) => (
                        <li key={index}>{warning}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <button
                  className={styles.textButton}
                  type="button"
                  onClick={downloadIssues}
                >
                  Download issues report
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
                    I confirm the words are in {sourceLabel} and the
                    translations are in {targetLabel}, with the fields matched
                    in the correct direction.
                  </span>
                </label>
              </section>

              <section className={styles.importActions} aria-live="polite">
                {phase === "uploading" ||
                phase === "committing" ||
                phase === "cancelling" ? (
                  <>
                    <p role="status">
                      {phase === "cancelling"
                        ? "Cancelling your import…"
                        : phase === "committing"
                          ? "Saving your study set…"
                          : `Saving your vocabulary… ${batchProgress.total ? Math.round((100 * batchProgress.done) / batchProgress.total) : 0}%`}
                    </p>
                    {phase === "uploading" && (
                      <>
                        <progress
                          max={Math.max(1, batchProgress.total)}
                          value={batchProgress.done}
                        />
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() => controllerRef.current?.abort()}
                        >
                          Pause import
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {phase === "paused" && (
                      <p className={styles.notice}>
                        Your progress is saved.{" "}
                        {resumeStored
                          ? "Resume here, or choose this same file later to continue."
                          : "Keep this page open to resume; browser storage is unavailable."}
                      </p>
                    )}
                    <button
                      type="button"
                      className={styles.primaryButton}
                      disabled={
                        !directionConfirmed ||
                        !included.length ||
                        !name.trim() ||
                        !content.notes.length
                      }
                      onClick={() => void runImport()}
                    >
                      {job || resumeAvailable || phase === "paused"
                        ? "Resume import"
                        : `Import ${included.length} ${included.length === 1 ? "word" : "words"}`}
                    </button>
                    {(job || resumeAvailable || phase === "paused") && (
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => void cancelImport()}
                      >
                        Cancel import
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
