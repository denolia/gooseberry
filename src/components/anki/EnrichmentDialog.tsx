"use client";

import { useEffect, useRef, useState } from "react";
import {
  ENRICHMENT_LABELS,
  EnrichmentInputSchema,
  missingEnrichmentFields,
  selectEnrichmentValues,
  type EnrichmentContent,
  type EnrichmentField,
  type EnrichmentProposal,
} from "@/lib/anki/enrichment";
import styles from "./EnrichmentDialog.module.css";

type GenerationResult = {
  requestKey: string;
  contentRevision: number;
  status: string;
  proposal: EnrichmentProposal | null;
};

export function EnrichmentDialog({
  item,
  wordSetId,
  onClose,
  onSaved,
}: {
  item: EnrichmentContent & { id: string; contentRevision: number };
  wordSetId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const missing = missingEnrichmentFields(item);
  const storageKey = `gooseberry-enrichment-${item.id}`;
  const [requestState, setRequestState] = useState<{
    requestKey: string;
    contentRevision: number;
    fields: EnrichmentField[];
  } | null>(() => {
    try {
      const stored = EnrichmentInputSchema.safeParse(
        JSON.parse(sessionStorage.getItem(storageKey) ?? "null"),
      );
      return stored.success &&
        stored.data.contentRevision === item.contentRevision
        ? stored.data
        : null;
    } catch {
      return null;
    }
  });
  const [selected, setSelected] = useState<EnrichmentField[]>(
    requestState?.fields ?? missing.filter((field) => field !== "comments"),
  );
  const [result, setResult] = useState<GenerationResult | null>(
    requestState
      ? {
          requestKey: requestState.requestKey,
          contentRevision: requestState.contentRevision,
          status: "unknown",
          proposal: null,
        }
      : null,
  );
  const [values, setValues] = useState<
    Partial<Record<EnrichmentField, string>>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const endpoint = `/api/word-sets/${wordSetId}/items/${item.id}/enrichment`;

  useEffect(() => {
    const previous = document.activeElement;
    closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key === "Tab" && panel.current) {
        const elements = [
          ...panel.current.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href]",
          ),
        ];
        const first = elements[0];
        const last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [onClose]);

  async function generate() {
    if (busy || selected.length === 0) return;
    setBusy(true);
    setError(null);
    const attempt = requestState ?? {
      requestKey: crypto.randomUUID(),
      contentRevision: item.contentRevision,
      fields: [...selected],
    };
    setRequestState(attempt);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(attempt));
    } catch {
      /* Recovery still works while this dialog is open. */
    }
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attempt),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Could not generate content.");
      setResult(body);
      if (body.proposal)
        setValues(selectEnrichmentValues(attempt.fields, body.proposal.values));
      if (body.status === "failed")
        setError(
          "This generation did not finish. You can start a new request.",
        );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not generate content. Retry to recover the same request.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function checkPending() {
    if (busy || !requestState) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `${endpoint}?requestKey=${encodeURIComponent(requestState.requestKey)}`,
        { cache: "no-store" },
      );
      const body = await response.json();
      if (response.status === 404) {
        // A local attempt does not prove that the server reserved it. Retrying
        // the same key remains safe if an earlier POST is still arriving.
        setResult(null);
        setError(
          "This request was not found. Retry to send the same request safely.",
        );
        return;
      }
      if (!response.ok)
        throw new Error(body.error || "Could not check generation.");
      setResult(body);
      if (body.proposal)
        setValues(
          selectEnrichmentValues(requestState.fields, body.proposal.values),
        );
      if (body.status === "failed")
        setError(
          "This generation did not finish. You can start a new request.",
        );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not check generation.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (busy || !result) return;
    const chosen = Object.fromEntries(
      Object.entries(values).filter(([, value]) => value?.trim()),
    );
    if (!Object.keys(chosen).length) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestKey: result.requestKey,
          contentRevision: result.contentRevision,
          values: chosen,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Could not save the proposal.");
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* Optional local recovery cache. */
      }
      onSaved();
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save the proposal.",
      );
    } finally {
      setBusy(false);
    }
  }

  const hasValues = Object.values(values).some((value) => value?.trim());
  function resetRequest() {
    setRequestState(null);
    setResult(null);
    setValues({});
    setError(null);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* Optional local recovery cache. */
    }
  }
  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={panel}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="enrichment-title"
      >
        <header>
          <h2 id="enrichment-title">Generate missing content</h2>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            aria-label="Close generation"
          >
            ×
          </button>
        </header>
        <p className={styles.context}>
          {item.original || item.translation || item.sample || "Imported word"}
        </p>
        {!result?.proposal && (
          <>
            <p>
              Choose what to add with AI. Existing content is kept. You can edit
              the result before saving.
            </p>
            <fieldset disabled={busy || !!requestState}>
              <legend>Missing fields</legend>
              {missing.map((field) => (
                <label key={field} className={styles.option}>
                  <input
                    type="checkbox"
                    checked={selected.includes(field)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, field]
                          : current.filter((value) => value !== field),
                      )
                    }
                  />
                  {ENRICHMENT_LABELS[field]}
                </label>
              ))}
            </fieldset>
          </>
        )}
        {result?.status === "pending" && (
          <p role="status">Generation is still running. Check again shortly.</p>
        )}
        {result?.status === "unknown" && (
          <p role="status">
            You have an earlier request. Check its status to continue.
          </p>
        )}
        {result?.proposal && (
          <>
            <p className={styles.origin}>AI proposal · review for accuracy</p>
            {result.proposal.message && <p>{result.proposal.message}</p>}
            {(requestState?.fields ?? []).map((field) => (
              <label key={field} className={styles.field}>
                {ENRICHMENT_LABELS[field]}
                <textarea
                  rows={
                    field === "sample" || field === "sampleTranslation" ? 3 : 2
                  }
                  value={values[field] ?? ""}
                  disabled={busy}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [field]: event.target.value,
                    }))
                  }
                />
                {!result.proposal?.values[field] && (
                  <small>
                    No confident suggestion. Leave empty or add your own.
                  </small>
                )}
              </label>
            ))}
          </>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <footer>
          <button type="button" onClick={onClose}>
            Close
          </button>
          {result?.proposal && (
            <button type="button" disabled={busy} onClick={resetRequest}>
              Discard proposal
            </button>
          )}
          {result?.status === "failed" ? (
            <button type="button" disabled={busy} onClick={resetRequest}>
              New request
            </button>
          ) : result?.status === "pending" || result?.status === "unknown" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void checkPending()}
            >
              {busy ? "Checking…" : "Check again"}
            </button>
          ) : result?.proposal ? (
            <button
              type="button"
              disabled={busy || !hasValues}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save selected content"}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || selected.length === 0}
              onClick={() => void generate()}
            >
              {busy
                ? "Generating…"
                : requestState
                  ? "Retry request"
                  : "Generate selected fields"}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
