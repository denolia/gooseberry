"use client";
import styles from "./WordInput.module.css";
import ReactMarkdown from "react-markdown";
import { TranslationResponse } from "@/app/utils/translationSchema";

export function StructuredResponseDisplay({
  response,
}: {
  response: TranslationResponse;
}) {
  const { original, translation, details, example_usage } = response;

  return (
    <div className={styles.structuredResponse}>
      {/* Header */}
      <h2>{original}</h2>
      <h3>{translation}</h3>

      {/* Details Section */}
      {details && (
        <div className={styles.details}>
          <h4>Details:</h4>
          <ul>
            {details.article && <li>Article: {details.article}</li>}
            {details.plural && <li>Plural: {details.plural}</li>}
            {details.genitive && <li>Genitive: {details.genitive}</li>}
            {details.verb_forms && (
              <li>
                Verb Forms: {details.verb_forms.infinitive} *{" "}
                {details.verb_forms.third_person} *{" "}
                {details.verb_forms.preterite} * {details.verb_forms.perfect}
              </li>
            )}
            {details.alternative_translations &&
              details.alternative_translations.length > 0 && (
                <li>
                  Alternative Translations:{" "}
                  <ul>
                    {details.alternative_translations.map((alt, index) => (
                      <li key={index}>{alt}</li>
                    ))}
                  </ul>
                </li>
              )}
            {details.common_phrases && details.common_phrases.length > 0 && (
              <li>
                Common Phrases:{" "}
                <ul>
                  {details.common_phrases.map((phrase, index) => (
                    <li key={index}>{phrase}</li>
                  ))}
                </ul>
              </li>
            )}
            {details.idioms && details.idioms.length > 0 && (
              <li>
                Idioms:{" "}
                <ul>
                  {details.idioms.map((idiom, index) => (
                    <li key={index}>{idiom}</li>
                  ))}
                </ul>
              </li>
            )}
            {details.usage_frequency && (
              <li>Usage Frequency: {details.usage_frequency}</li>
            )}
            {details.stylistic_kind && (
              <li>Stylistic Kind: {details.stylistic_kind}</li>
            )}
            {details.sentence_analysis && (
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
      {/*{!details && !example_usage && (*/}
      <ReactMarkdown>{JSON.stringify(response, null, 2)}</ReactMarkdown>
      {/*)}*/}
    </div>
  );
}
