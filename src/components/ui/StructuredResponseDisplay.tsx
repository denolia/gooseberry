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
          {details.usage_frequency && (
            <div> Frequency: {details.usage_frequency}</div>
          )}

          {details.stylistic_kind && (
            <div>Stylistic Kind: {details.stylistic_kind}</div>
          )}

          <ul>
            {details.verb_forms &&
              (hasValue(details.verb_forms.infinitive) ||
                hasValue(details.verb_forms.third_person) ||
                hasValue(details.verb_forms.preterite) ||
                hasValue(details.verb_forms.perfect)) && (
                <li>
                  Verb Forms: {details.verb_forms.infinitive} *{" "}
                  {details.verb_forms.third_person} *{" "}
                  {details.verb_forms.preterite} * {details.verb_forms.perfect}
                </li>
              )}

            {details.common_phrases && details.common_phrases.length > 0 && (
              <div>
                Common Phrases:{" "}
                <ul>
                  {details.common_phrases.map((phrase, index) => (
                    <li key={index}>{phrase}</li>
                  ))}
                </ul>
              </div>
            )}
            {details.idioms && details.idioms.length > 0 && (
              <div>
                Idioms:{" "}
                <ul>
                  {details.idioms.map((idiom, index) => (
                    <li key={index}>{idiom}</li>
                  ))}
                </ul>
              </div>
            )}

            {hasValue(details.sentence_analysis) && (
              <li>Analysis: {details.sentence_analysis}</li>
            )}
          </ul>
        </div>
      )}

      {/* Example Usage Section */}
      {example_usage && (
        <div className={styles.examples}>
          <h4>Examples:</h4>
          <ul>
            {example_usage.map((example, index) => (
              <li key={index}>
                <strong>{example.sample}</strong> - {example.sample_translation}
              </li>
            ))}
          </ul>
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
