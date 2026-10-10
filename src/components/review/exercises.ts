import { diffArrays } from "diff";
import type { StudyCardContentField } from "@/lib/review/templates";

export function exerciseFieldLanguage(
  field: StudyCardContentField,
  sourceLang: string,
  targetLang: string,
): string {
  return field === "translation" || field === "sampleTranslation"
    ? targetLang
    : sourceLang;
}

// This comparison is a reading aid. Learners still choose the review rating,
// including when their answer uses a valid alternative or a different form.
export function typedAnswerMatches(
  answer: string,
  expected: string,
  language: string,
): boolean {
  return (
    answer.trim().length > 0 &&
    foldTypedText(normalizeTypedText(answer), language) ===
      foldTypedText(normalizeTypedText(expected), language)
  );
}

export type TypedAnswerSegment = { value: string; changed: boolean };

export type TypedAnswerComparison = {
  matches: boolean;
  entered: TypedAnswerSegment[];
  expected: TypedAnswerSegment[];
};

function normalizeTypedText(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ");
}

function foldTypedText(value: string, language: string): string {
  try {
    return value.toLocaleLowerCase(language);
  } catch {
    return value.toLowerCase();
  }
}

function addSegment(
  segments: TypedAnswerSegment[],
  value: string,
  changed: boolean,
) {
  if (!value) return;
  const previous = segments[segments.length - 1];
  if (previous?.changed === changed) previous.value += value;
  else segments.push({ value, changed });
}

// Display the learner's own spelling, while comparing the same normalized text
// as typedAnswerMatches. Graphemes keep accents and joined emoji intact.
export function typedAnswerDiff(
  answer: string,
  expected: string,
  language: string,
): TypedAnswerComparison {
  const enteredText = normalizeTypedText(answer);
  const expectedText = normalizeTypedText(expected);
  const matches = typedAnswerMatches(answer, expected, language);
  const wholeFragments = (): TypedAnswerComparison => ({
    matches,
    entered: enteredText ? [{ value: enteredText, changed: !matches }] : [],
    expected: expectedText ? [{ value: expectedText, changed: !matches }] : [],
  });

  // Imported answers and pasted input can be arbitrarily long. Exact matches
  // need no diff, and large differences fall back to two complete fragments.
  if (
    matches ||
    enteredText.length > 4096 ||
    expectedText.length > 4096 ||
    typeof Intl.Segmenter !== "function"
  )
    return wholeFragments();

  let segmenter: Intl.Segmenter;
  try {
    segmenter = new Intl.Segmenter(language, { granularity: "grapheme" });
  } catch {
    segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  }
  const graphemes = (text: string) =>
    Array.from(segmenter.segment(text), ({ segment }) => segment);
  const tokens = (text: string) => {
    const values = graphemes(text);
    // Lowercase the complete string first: Greek sigma and some other letters
    // depend on their surrounding text. Keep display graphemes separately.
    const folded = graphemes(foldTypedText(text, language));
    return values.map((value, index) => ({
      value,
      key:
        folded.length === values.length
          ? folded[index]
          : foldTypedText(value, language),
    }));
  };
  const enteredTokens = tokens(enteredText);
  const expectedTokens = tokens(expectedText);
  const changes = diffArrays(enteredTokens, expectedTokens, {
    comparator: (left, right) => left.key === right.key,
    maxEditLength: 256,
    timeout: 20,
  });
  if (!changes) return wholeFragments();

  const entered: TypedAnswerSegment[] = [];
  const target: TypedAnswerSegment[] = [];
  let enteredIndex = 0;
  let expectedIndex = 0;
  for (const change of changes) {
    if (!change.added) {
      const value = enteredTokens
        .slice(enteredIndex, enteredIndex + change.count)
        .map((token) => token.value)
        .join("");
      addSegment(entered, value, change.removed);
      enteredIndex += change.count;
    }
    if (!change.removed) {
      const value = expectedTokens
        .slice(expectedIndex, expectedIndex + change.count)
        .map((token) => token.value)
        .join("");
      addSegment(target, value, change.added);
      expectedIndex += change.count;
    }
  }
  return { matches, entered, expected: target };
}
