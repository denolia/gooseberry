import { z } from "zod";

export const TextTokenSchema = z.object({
  id: z.number().int().nonnegative(),
  text: z.string(),
  isWord: z.boolean(),
});

export const CandidateKindSchema = z.enum([
  "word",
  "selection",
  "idiom",
  "collocation",
  "grammar",
  "phrasal-verb",
  "prepositional-verb",
  "correlative",
  "framework",
  "other",
]);

export const AnalysisCandidateSchema = z.object({
  id: z.string(),
  tokenIds: z.array(z.number().int().nonnegative()).min(1),
  expression: z.string().min(1),
  translation: z.string().min(1),
  kind: CandidateKindSchema,
  explanation: z.string(),
  stability: z.number().int().min(0).max(100),
});

export const SelectionAnalysisSchema = z.object({
  selection: AnalysisCandidateSchema,
  constructions: z.array(AnalysisCandidateSchema),
});

export type TextToken = z.infer<typeof TextTokenSchema>;
export type AnalysisCandidate = z.infer<typeof AnalysisCandidateSchema>;
export type SelectionAnalysis = z.infer<typeof SelectionAnalysisSchema>;

export function tokenizeText(text: string, locale: string): TextToken[] {
  const segmenter = new Intl.Segmenter(locale, { granularity: "word" });
  return Array.from(segmenter.segment(text), (part, id) => ({
    id,
    text: part.segment,
    isWord: Boolean(part.isWordLike),
  }));
}
