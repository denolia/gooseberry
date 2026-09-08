import { eq } from "drizzle-orm";
import type { CompletionUsage } from "openai/resources/completions";
import { getDb } from "@/db/drizzle";
import { aiUsage } from "@/db/schema";

export async function startUsage(input: {
  userId: string;
  operation: "translate" | "analyze";
  model: string;
  inputWords: number;
}) {
  const [row] = await getDb()
    .insert(aiUsage)
    .values(input)
    .returning({ id: aiUsage.id });
  return row.id;
}

export async function finishUsage(
  id: string,
  status: "succeeded" | "failed",
  completion?: {
    id: string;
    model: string;
    usage?: CompletionUsage | null;
  },
) {
  const usage = completion?.usage;
  try {
    await getDb()
      .update(aiUsage)
      .set({
        status,
        model: completion?.model,
        responseId: completion?.id,
        inputTokens: usage?.prompt_tokens ?? null,
        cachedInputTokens: usage
          ? (usage.prompt_tokens_details?.cached_tokens ?? 0)
          : null,
        outputTokens: usage?.completion_tokens ?? null,
        reasoningTokens: usage
          ? (usage.completion_tokens_details?.reasoning_tokens ?? 0)
          : null,
        completedAt: new Date(),
      })
      .where(eq(aiUsage.id, id));
  } catch (error) {
    // The pending record remains visible for reconciliation, without losing the user's result.
    console.error("Failed to finalize AI usage", {
      usageId: id,
      status,
      responseId: completion?.id,
      usage: completion?.usage,
      error,
    });
  }
}
