import OpenAI from "openai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { auth } from "@/auth";
import {
  isSourceLanguage,
  isTargetLanguage,
  LanguageCodes,
  SourceLanguages,
  TargetLanguages,
} from "@/components/ui/Languages";
import {
  AnalysisCandidateSchema,
  CandidateKindSchema,
  SelectionAnalysisSchema,
  TextToken,
  tokenizeText,
} from "@/app/utils/textAnalysisSchema";

export const maxDuration = 60;

const analysisModel =
  process.env.OPENAI_TEXT_ANALYSIS_MODEL ??
  process.env.OPENAI_TRANSLATION_MODEL ??
  "gpt-5-mini";

const RequestSchema = z.object({
  text: z.string().min(1).max(20000),
  selectedTokenIds: z.array(z.number().int().nonnegative()).min(1).max(30),
  sourceLanguage: z.unknown(),
  targetLanguage: z.unknown(),
});

const ModelResponseSchema = z.object({
  selection: z.object({
    expression: z.string().min(1),
    translation: z.string().min(1),
    explanation: z.string(),
  }),
  constructions: z.array(
    z.object({
      token_ids: z.array(z.number().int().nonnegative()).min(1),
      expression: z.string().min(1),
      translation: z.string().min(1),
      kind: CandidateKindSchema.exclude(["word", "selection"]),
      explanation: z.string(),
      stability: z.number().int().min(0).max(100),
    }),
  ),
});

function getContextTokens(tokens: TextToken[], selectedIds: Set<number>) {
  const selected = tokens.filter((token) => selectedIds.has(token.id));
  const first = selected[0]?.id ?? 0;
  const last = selected[selected.length - 1]?.id ?? first;
  let wordsBefore = 0;
  let wordsAfter = 0;
  let start = first;
  let end = last;

  for (let index = first - 1; index >= 0 && wordsBefore < 35; index -= 1) {
    start = index;
    if (tokens[index]?.isWord) wordsBefore += 1;
  }
  for (
    let index = last + 1;
    index < tokens.length && wordsAfter < 35;
    index += 1
  ) {
    end = index;
    if (tokens[index]?.isWord) wordsAfter += 1;
  }
  return tokens.slice(start, end + 1);
}

function getPrompt(
  sourceLanguage: string,
  targetLanguage: string,
  tokens: TextToken[],
  selectedIds: Set<number>,
) {
  const indexedText = tokens
    .map((token) => {
      if (!token.isWord) return token.text;
      const marker = selectedIds.has(token.id) ? " SELECTED" : "";
      return `[${token.id}${marker}:${JSON.stringify(token.text)}]`;
    })
    .join("");

  return `Analyze the selected token or tokens in this ${sourceLanguage} context for a learner who reads ${targetLanguage}.

Word-like segments are marked [token_id:"text"], and the user's selection is marked SELECTED. Use only the supplied token IDs.

Return a direct context-sensitive translation of the selection itself. Then find every genuinely conventionalized construction involving at least one selected token: idioms, fixed or semi-fixed phrases, lexical collocations, governed prepositional verbs, phrasal/separable verbs, compound or correlative conjunctions, and discontinuous grammatical frameworks. A construction may have gaps; include only the tokens that realize it.

The key criterion is conventional stability, not length. Stability 90–100 means a fixed idiom or strongly lexicalized expression; 70–89 an established collocation or governed construction; 45–69 a useful semi-fixed grammatical pattern; below 45 is weak. Do not return ordinary compositional phrases, arbitrary clauses, enumeration fragments, or the whole sentence merely because they contain the selection. Never return the full sentence unless it is itself a known proverb, quotation, or conversational formula. For example, prefer "am Ufer des Sees" over a complete sentence that happens to contain it.

For inflected and discontinuous surface forms, use the normal teaching/dictionary form as expression. Keep each explanation to one short sentence. Write translations and explanations in ${targetLanguage}.

Context:
${indexedText}`;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = RequestSchema.parse(await request.json());
    const sourceLanguage = isSourceLanguage(input.sourceLanguage)
      ? input.sourceLanguage
      : SourceLanguages.German;
    const targetLanguage = isTargetLanguage(input.targetLanguage)
      ? input.targetLanguage
      : TargetLanguages.English;
    const tokens = tokenizeText(input.text, LanguageCodes[sourceLanguage]);
    const validWordIds = new Set(
      tokens.filter((token) => token.isWord).map((token) => token.id),
    );
    const selectedTokenIds = [...new Set(input.selectedTokenIds)]
      .filter((id) => validWordIds.has(id))
      .sort((left, right) => left - right);

    if (!selectedTokenIds.length) {
      return NextResponse.json(
        { error: "Select one or more words from the text." },
        { status: 400 },
      );
    }

    const selectedIds = new Set(selectedTokenIds);
    const contextTokens = getContextTokens(tokens, selectedIds);
    const contextIds = new Set(contextTokens.map((token) => token.id));
    const client = new OpenAI({ maxRetries: 1 });
    const completion = await client.chat.completions.parse({
      model: analysisModel,
      max_completion_tokens: 2400,
      reasoning_effort: "minimal",
      messages: [
        {
          role: "system",
          content:
            "You are a conservative multilingual lexicographer. Reject accidental long phrases and identify only constructions a learner could usefully store as a reusable unit.",
        },
        {
          role: "user",
          content: getPrompt(
            sourceLanguage,
            targetLanguage,
            contextTokens,
            selectedIds,
          ),
        },
      ],
      response_format: zodResponseFormat(
        ModelResponseSchema,
        "selection_analysis",
      ),
    });

    const parsed = completion.choices[0]?.message.parsed;
    if (!parsed) throw new Error("The model returned no analysis.");

    const selectionText = tokens
      .filter((token) => selectedIds.has(token.id))
      .map((token) => token.text)
      .join(" ");
    const selection = AnalysisCandidateSchema.parse({
      id: "selection",
      tokenIds: selectedTokenIds,
      expression: parsed.selection.expression || selectionText,
      translation: parsed.selection.translation,
      kind: selectedTokenIds.length === 1 ? "word" : "selection",
      explanation: parsed.selection.explanation,
      stability: 0,
    });

    const constructions = parsed.constructions
      .flatMap((item, index) => {
        const tokenIds = [...new Set(item.token_ids)]
          .filter((id) => validWordIds.has(id) && contextIds.has(id))
          .sort((left, right) => left - right);
        if (!tokenIds.length || !tokenIds.some((id) => selectedIds.has(id))) {
          return [];
        }
        return [
          AnalysisCandidateSchema.parse({
            id: `construction-${index}`,
            tokenIds,
            expression: item.expression,
            translation: item.translation,
            kind: item.kind,
            explanation: item.explanation,
            stability: item.stability,
          }),
        ];
      })
      .filter(
        (item, index, all) =>
          item.stability >= 45 &&
          all.findIndex(
            (other) => other.tokenIds.join(",") === item.tokenIds.join(","),
          ) === index,
      )
      .sort(
        (left, right) =>
          right.stability - left.stability ||
          left.tokenIds.length - right.tokenIds.length,
      );

    return NextResponse.json(
      SelectionAnalysisSchema.parse({ selection, constructions }),
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Check the text, selection, and language settings." },
        { status: 400 },
      );
    }
    console.error("Selection analysis failed", error);
    return NextResponse.json(
      { error: "Could not analyze this selection. Please try again." },
      { status: 500 },
    );
  }
}
