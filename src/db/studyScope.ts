import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/drizzle";
import { fsrsCardState, studyCard, wordSet, wordSetItem } from "@/db/schema";
import { FsrsCardState } from "@/lib/review/model";
import type { StudyFilter, StudyScope } from "@/lib/review/scope";

// Undefined means all owned sets. An explicit empty list always means none.
export type StudySetSelection = string | readonly string[] | undefined;

export function studySetSelection(input: {
  scope?: StudyScope;
  wordSetId?: string;
}): StudySetSelection {
  return input.scope
    ? input.scope.kind === "sets"
      ? input.scope.setIds
      : undefined
    : input.wordSetId;
}

export function studySetCondition(
  selection: StudySetSelection,
  alias?: string,
) {
  const id = alias ? sql`${sql.identifier(alias)}.id` : sql`${wordSet.id}`;
  if (selection === undefined) return sql`true`;
  if (typeof selection === "string") return sql`${id} = ${selection}`;
  return selection.length ? inArray(id, [...selection]) : sql`false`;
}

export function studyFilterCondition(filter?: StudyFilter) {
  return filter === "due_only"
    ? sql`${fsrsCardState.state} <> ${FsrsCardState.New}`
    : sql`true`;
}

export class StudyScopeNotFoundError extends Error {}

export async function assertOwnedStudyScope(userId: string, scope: StudyScope) {
  if (scope.kind === "all") return;
  const sets = await getDb()
    .select({ id: wordSet.id })
    .from(wordSet)
    .where(and(eq(wordSet.userId, userId), studySetCondition(scope.setIds)));
  if (sets.length !== scope.setIds.length) {
    throw new StudyScopeNotFoundError("One or more study sets are unavailable");
  }
}

// Mutations derive the current owned set from the card. Moving a note never
// makes a stale client-supplied set ID authoritative.
export async function getOwnedStudyCardSet(
  userId: string,
  studyCardId: string,
) {
  const [row] = await getDb()
    .select({ id: wordSet.id })
    .from(studyCard)
    .innerJoin(wordSetItem, eq(wordSetItem.id, studyCard.wordSetItemId))
    .innerJoin(wordSet, eq(wordSet.id, wordSetItem.wordSetId))
    .where(and(eq(wordSet.userId, userId), eq(studyCard.id, studyCardId)))
    .limit(1);
  if (!row) throw new StudyScopeNotFoundError("Review card not found");
  return row.id;
}
