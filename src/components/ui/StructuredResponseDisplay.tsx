"use client";
import styles from "./StructuredResponseDisplay.module.css";
import { TranslationResponse } from "@/app/utils/translationSchema";
import { useState } from "react";

function hasValue(line: string | undefined): line is string {
  if (!line || line === "-") {
    return false;
  }
  return true;
}

export function StructuredResponseDisplay({
  response,
}: {
  response: TranslationResponse;
}) {
  const [isRawVisible, setIsRawVisible] = useState(false);

  const toggleRawVisibility = () => setIsRawVisible(!isRawVisible);

  const { original, translation, details, example_usage } = response;

  return (
    <div className={styles.structuredResponse}>
      {/* Header */}
      <h2>
        {hasValue(details.article) && `${details.article} `} {original}
      </h2>
      <h3>{translation}</h3>

      {details.alternative_translations &&
        details.alternative_translations.length > 0 && (
          <div>{details.alternative_translations.join(", ")}</div>
        )}

      {/* Details Section */}
      {details && (
        <div className={styles.details}>
          <div>
            {hasValue(details.plural) && (
              <span>Plural: {details.plural}, </span>
            )}
            {hasValue(details.genitive) && (
              <span>Genitive: {details.genitive}</span>
            )}
          </div>

          <div className={styles.paragraph}>
            {details.verb_forms &&
              (hasValue(details.verb_forms.infinitive) ||
                hasValue(details.verb_forms.third_person) ||
                hasValue(details.verb_forms.preterite) ||
                hasValue(details.verb_forms.perfect)) && (
                <div>
                  {details.verb_forms.infinitive} *{" "}
                  {details.verb_forms.third_person} *{" "}
                  {details.verb_forms.preterite} * {details.verb_forms.perfect}
                </div>
              )}
          </div>

          {details.usage_frequency && (
            <div className={styles.paragraph}>
              {" "}
              Frequency: {details.usage_frequency}
            </div>
          )}

          {details.stylistic_kind && (
            <div>Stylistic Kind: {details.stylistic_kind}</div>
          )}

          <ul className={styles.paragraph}>
            {details.common_phrases && details.common_phrases.length > 0 && (
              <div className={styles.paragraph}>
                <h4>Common Phrases:</h4>

                {details.common_phrases.map((phrase, index) => (
                  <div key={index}>{phrase}</div>
                ))}
              </div>
            )}
            {details.idioms && details.idioms.length > 0 && (
              <div className={styles.paragraph}>
                <h4>Idioms:</h4>

                {details.idioms.map((idiom, index) => (
                  <div key={index}>{idiom}</div>
                ))}
              </div>
            )}

            {hasValue(details.sentence_grammatical_analysis) && (
              <div className={styles.paragraph}>
                <h4>Analysis:</h4>
                <div>{details.sentence_grammatical_analysis}</div>{" "}
              </div>
            )}
          </ul>
        </div>
      )}

      {/* Example Usage Section */}
      {example_usage && (
        <div className={styles.paragraph}>
          <h4>Examples:</h4>
          <div>
            {example_usage.map((example, index) => (
              <div key={index}>
                <span className={styles.italic}>{example.sample}</span> -{" "}
                {example.sample_translation}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fallback Raw Response */}
      {/* Collapsible Raw Response */}
      <div className={styles.rawResponse}>
        <button onClick={toggleRawVisibility} className={styles.toggleButton}>
          {isRawVisible ? "Hide Raw Response" : "Show Raw Response"}
        </button>
        {isRawVisible && (
          <div className={styles.rawResponseContent}>
            <div>{JSON.stringify(response, null, 2)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
