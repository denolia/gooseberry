"use client";
import { useI18n } from "@/i18n/client";

import { useId, useState } from "react";
import { CardDraft } from "@/app/utils/cardDraft";
import styles from "./CardEditor.module.css";

export function CardEditor({
  value,
  onChange,
  disabled = false,
  allowIncomplete = false,
}: {
  value: CardDraft;
  onChange: (value: CardDraft) => void;
  disabled?: boolean;
  allowIncomplete?: boolean;
}) {
  const { t } = useI18n();
  const [editingExamples, setEditingExamples] = useState(false);
  const examplesId = useId();

  function field(
    key: "original" | "translation" | "wordForms" | "comments" | "tags",
    label: string,
  ) {
    return (
      <label className={styles.field}>
        {label}
        <textarea
          rows={key === "comments" ? 2 : 1}
          value={value[key]}
          onChange={(e) => onChange({ ...value, [key]: e.target.value })}
          required={
            !allowIncomplete && (key === "original" || key === "translation")
          }
        />
      </label>
    );
  }
  return (
    <fieldset className={styles.editor} disabled={disabled}>
      <legend className={styles.legend}>{t("cardEditor.cardContent")}</legend>
      <div className={styles.columns}>
        {field("original", t("cardEditor.wordFront"))}
        {field("translation", t("cardEditor.translationBack"))}
      </div>
      <div className={styles.exampleHeading}>
        <span>
          {t("cardEditor.examples")} <small>{value.examples.length}</small>
        </span>
        <button
          type="button"
          aria-expanded={editingExamples}
          aria-controls={examplesId}
          aria-label={
            editingExamples
              ? t("cardEditor.closeExampleControls")
              : t("cardEditor.editExamples")
          }
          onClick={() => setEditingExamples(!editingExamples)}
        >
          {editingExamples ? t("cardEditor.close") : t("cardEditor.edit")}
        </button>
      </div>
      <div className={styles.examples} id={examplesId}>
        {value.examples.length === 0 && (
          <p className={styles.hint}>{t("cardEditor.noExamplesOnThisCard")}</p>
        )}
        {value.examples.map((example, index) => (
          <div className={styles.columns} key={index}>
            <div className={styles.field}>
              <div className={styles.exampleLabel}>
                {editingExamples && (
                  <button
                    className={styles.removeButton}
                    type="button"
                    aria-label={t("cardEditor.removeExampleValue", {
                      value0: index + 1,
                    })}
                    onClick={() =>
                      onChange({
                        ...value,
                        examples: value.examples.filter((_, i) => i !== index),
                      })
                    }
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
                    </svg>
                  </button>
                )}
                <label htmlFor={`${examplesId}-${index}`}>
                  {t("cardEditor.example")} {index + 1}
                </label>
              </div>
              <textarea
                id={`${examplesId}-${index}`}
                rows={2}
                value={example.sample}
                onChange={(e) =>
                  onChange({
                    ...value,
                    examples: value.examples.map((item, i) =>
                      i === index ? { ...item, sample: e.target.value } : item,
                    ),
                  })
                }
              />
            </div>
            <label className={styles.field}>
              <span className={styles.exampleLabel}>
                {t("cardEditor.translation")}
              </span>
              <textarea
                rows={2}
                value={example.translation}
                onChange={(e) =>
                  onChange({
                    ...value,
                    examples: value.examples.map((item, i) =>
                      i === index
                        ? { ...item, translation: e.target.value }
                        : item,
                    ),
                  })
                }
              />
            </label>
          </div>
        ))}
        {editingExamples && (
          <button
            className={styles.addExample}
            type="button"
            onClick={() =>
              onChange({
                ...value,
                examples: [...value.examples, { sample: "", translation: "" }],
              })
            }
          >
            {t("cardEditor.addExample")}
          </button>
        )}
      </div>
      <details className={styles.more}>
        <summary>{t("cardEditor.wordFormsNotesTags")}</summary>
        <div className={styles.extras}>
          {field("wordForms", t("importDeck.wordForms"))}
          {field("comments", t("common.notes"))}
          {field("tags", t("cardEditor.tagsSeparatedBySpaces"))}
        </div>
      </details>
    </fieldset>
  );
}
