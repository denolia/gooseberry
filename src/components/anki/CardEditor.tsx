"use client";
import { CardDraft } from "@/app/utils/cardDraft";
import styles from "./CardEditor.module.css";

export function CardEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: CardDraft;
  onChange: (value: CardDraft) => void;
  disabled?: boolean;
}) {
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
          required={key === "original" || key === "translation"}
        />
      </label>
    );
  }
  return (
    <fieldset className={styles.editor} disabled={disabled}>
      <legend className={styles.legend}>Card content</legend>
      <div className={styles.columns}>
        {field("original", "Word · front")}
        {field("translation", "Translation · back")}
      </div>
      <div className={styles.exampleHeading}>
        <span>
          Examples <small>{value.examples.length}</small>
        </span>
        <button
          type="button"
          onClick={() =>
            onChange({
              ...value,
              examples: [...value.examples, { sample: "", translation: "" }],
            })
          }
        >
          + Add example
        </button>
      </div>
      {value.examples.length === 0 && (
        <p className={styles.hint}>No examples on this card.</p>
      )}
      {value.examples.map((example, index) => (
        <div className={styles.example} key={index}>
          <div className={styles.columns}>
            <label className={styles.field}>
              Example {index + 1}
              <textarea
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
            </label>
            <label className={styles.field}>
              Translation
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
          <button
            type="button"
            aria-label={`Remove example ${index + 1}`}
            onClick={() =>
              onChange({
                ...value,
                examples: value.examples.filter((_, i) => i !== index),
              })
            }
          >
            Remove
          </button>
        </div>
      ))}
      <details className={styles.more}>
        <summary>Word forms, notes & tags</summary>
        <div className={styles.extras}>
          {field("wordForms", "Word forms")}
          {field("comments", "Notes")}
          {field("tags", "Tags · separated by spaces")}
        </div>
      </details>
    </fieldset>
  );
}
