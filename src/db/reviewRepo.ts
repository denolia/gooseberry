import { getDb } from "@/db/drizzle";
import {
  fsrsCardState,
  reviewEvent,
  studyCard,
  wordSet,
  wordSetItem,
} from "@/db/schema";
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import {
  applyReview,
  createInitialFsrsState,
  FSRS_SCHEDULER_VERSION,
  replayReviewHistory,
  type FsrsStateProjection,
} from "@/lib/review/fsrs";
import {
  NATIVE_STUDY_CARD_TEMPLATE,
  ReviewRatingSchema,
  type FsrsCardStateValue,
  type ReviewRatingValue,
} from "@/lib/review/model";

const MAX_REVIEW_WRITE_ATTEMPTS = 3;

export class ReviewCardNotFoundError extends Error {}
export class ReviewCardNotDueError extends Error {}
export class ReviewWriteConflictError extends Error {}

export type DueReviewCard = {
  id: string;
  wordSetId: string;
  wordSetName: string;
  sourceLang: string;
  targetLang: string;
  templateKey: string;
  original: string;
  translation: string;
  wordForms: string;
  sample: string;
  sampleTranslation: string;
  comments: string;
  tags: string;
  state: FsrsStateProjection;
  revision: number | null;
};

type ReviewCardRow = Omit<DueReviewCard, "state" | "revision"> & {
  introducedAt: Date;
  projection: {
    dueAt: Date;
    stability: number;
    difficulty: number;
    elapsedDays: number;
    scheduledDays: number;
    learningSteps: number;
    reps: number;
    lapses: number;
    state: number;
    lastReviewAt: Date | null;
    schedulerVersion: string;
    revision: number;
  } | null;
};

export async function getNextDueReviewCard(input: {
  userId: string;
  wordSetId: string;
  now: Date;
}): Promise<DueReviewCard | null> {
  const db = getDb();
  const [row] = await baseCardQuery(input.userId)
    .where(
      and(
        eq(wordSet.userId, input.userId),
        eq(wordSet.id, input.wordSetId),
        eq(wordSetItem.isEnabled, true),
        eq(studyCard.templateKey, NATIVE_STUDY_CARD_TEMPLATE),
        or(
          isNull(fsrsCardState.studyCardId),
          lte(fsrsCardState.dueAt, input.now),
        ),
      ),
    )
    .orderBy(
      sql`${fsrsCardState.dueAt} ASC NULLS FIRST`,
      asc(wordSetItem.position),
      asc(studyCard.id),
    )
    .limit(1);

  return row ? toDueReviewCard(row) : null;
}

export async function recordReview(input: {
  userId: string;
  wordSetId: string;
  studyCardId: string;
  rating: ReviewRatingValue;
  reviewedAt: Date;
  durationMs?: number;
}): Promise<FsrsStateProjection> {
  const reviewEventId = crypto.randomUUID();

  for (let attempt = 0; attempt < MAX_REVIEW_WRITE_ATTEMPTS; attempt += 1) {
    const row = await getOwnedReviewCard(
      input.userId,
      input.wordSetId,
      input.studyCardId,
    );
    if (!row) throw new ReviewCardNotFoundError("Review card not found");

    let currentState = row.projection
      ? projectionFromRow(row.projection)
      : createInitialFsrsState(row.introducedAt);

    if (
      row.projection &&
      row.projection.schedulerVersion !== FSRS_SCHEDULER_VERSION
    ) {
      currentState = await rebuildCardState(
        input.userId,
        input.studyCardId,
        row.introducedAt,
      );
    }

    if (currentState.dueAt.getTime() > input.reviewedAt.getTime()) {
      throw new ReviewCardNotDueError("Review card is not due yet");
    }

    const nextState = applyReview(currentState, input.rating, input.reviewedAt);

    try {
      await persistReview({
        ...input,
        reviewEventId,
        expectedRevision: row.projection?.revision ?? null,
        nextState,
      });
      return nextState;
    } catch (error) {
      if (!isRevisionConflict(error)) throw error;
    }
  }

  throw new ReviewWriteConflictError(
    "The card changed while the review was being recorded",
  );
}

function baseCardQuery(userId: string) {
  return getDb()
    .select({
      id: studyCard.id,
      wordSetId: wordSet.id,
      wordSetName: wordSet.name,
      sourceLang: wordSet.sourceLang,
      targetLang: wordSet.targetLang,
      templateKey: studyCard.templateKey,
      original: wordSetItem.original,
      translation: wordSetItem.translation,
      wordForms: wordSetItem.wordForms,
      sample: wordSetItem.sample,
      sampleTranslation: wordSetItem.sampleTranslation,
      comments: wordSetItem.comments,
      tags: wordSetItem.tags,
      introducedAt: studyCard.createdAt,
      projection: {
        dueAt: fsrsCardState.dueAt,
        stability: fsrsCardState.stability,
        difficulty: fsrsCardState.difficulty,
        elapsedDays: fsrsCardState.elapsedDays,
        scheduledDays: fsrsCardState.scheduledDays,
        learningSteps: fsrsCardState.learningSteps,
        reps: fsrsCardState.reps,
        lapses: fsrsCardState.lapses,
        state: fsrsCardState.state,
        lastReviewAt: fsrsCardState.lastReviewAt,
        schedulerVersion: fsrsCardState.schedulerVersion,
        revision: fsrsCardState.revision,
      },
    })
    .from(studyCard)
    .innerJoin(wordSetItem, eq(wordSetItem.id, studyCard.wordSetItemId))
    .innerJoin(wordSet, eq(wordSet.id, wordSetItem.wordSetId))
    .leftJoin(
      fsrsCardState,
      and(
        eq(fsrsCardState.studyCardId, studyCard.id),
        eq(fsrsCardState.userId, userId),
      ),
    );
}

async function getOwnedReviewCard(
  userId: string,
  wordSetId: string,
  studyCardId: string,
): Promise<ReviewCardRow | null> {
  const [row] = await baseCardQuery(userId)
    .where(
      and(
        eq(wordSet.userId, userId),
        eq(wordSet.id, wordSetId),
        eq(studyCard.id, studyCardId),
        eq(wordSetItem.isEnabled, true),
        eq(studyCard.templateKey, NATIVE_STUDY_CARD_TEMPLATE),
      ),
    )
    .limit(1);

  return row ?? null;
}

async function rebuildCardState(
  userId: string,
  studyCardId: string,
  introducedAt: Date,
): Promise<FsrsStateProjection> {
  const history = await getDb()
    .select({
      rating: reviewEvent.rating,
      reviewedAt: reviewEvent.reviewedAt,
      sequence: reviewEvent.sequence,
    })
    .from(reviewEvent)
    .where(
      and(
        eq(reviewEvent.userId, userId),
        eq(reviewEvent.studyCardId, studyCardId),
      ),
    )
    .orderBy(asc(reviewEvent.reviewedAt), asc(reviewEvent.sequence));

  return replayReviewHistory(
    introducedAt,
    history.map((event) => ({
      ...event,
      rating: ReviewRatingSchema.parse(event.rating),
    })),
  );
}

async function persistReview(input: {
  userId: string;
  studyCardId: string;
  rating: ReviewRatingValue;
  reviewedAt: Date;
  durationMs?: number;
  reviewEventId: string;
  expectedRevision: number | null;
  nextState: FsrsStateProjection;
}) {
  const db = getDb();
  const eventWrite = db.insert(reviewEvent).values({
    id: input.reviewEventId,
    userId: input.userId,
    studyCardId: input.studyCardId,
    rating: input.rating,
    reviewedAt: input.reviewedAt,
    durationMs: input.durationMs,
  });
  const state = input.nextState;
  const stateWrite =
    input.expectedRevision === null
      ? db.execute(sql`
          WITH written AS (
            INSERT INTO fsrs_card_state (
              user_id, study_card_id, due_at, stability, difficulty,
              elapsed_days, scheduled_days, learning_steps, reps, lapses,
              state, revision, last_review_at, last_review_event_id,
              scheduler_version, updated_at
            ) VALUES (
              ${input.userId}, ${input.studyCardId}, ${state.dueAt},
              ${state.stability}, ${state.difficulty}, ${state.elapsedDays},
              ${state.scheduledDays}, ${state.learningSteps}, ${state.reps},
              ${state.lapses}, ${state.state}, 1, ${state.lastReviewAt},
              ${input.reviewEventId}, ${state.schedulerVersion}, now()
            )
            ON CONFLICT (user_id, study_card_id) DO NOTHING
            RETURNING 1
          )
          SELECT 1 / count(*)::integer AS committed FROM written
        `)
      : db.execute(sql`
          WITH written AS (
            UPDATE fsrs_card_state SET
              due_at = ${state.dueAt},
              stability = ${state.stability},
              difficulty = ${state.difficulty},
              elapsed_days = ${state.elapsedDays},
              scheduled_days = ${state.scheduledDays},
              learning_steps = ${state.learningSteps},
              reps = ${state.reps},
              lapses = ${state.lapses},
              state = ${state.state},
              revision = revision + 1,
              last_review_at = ${state.lastReviewAt},
              last_review_event_id = ${input.reviewEventId},
              scheduler_version = ${state.schedulerVersion},
              updated_at = now()
            WHERE user_id = ${input.userId}
              AND study_card_id = ${input.studyCardId}
              AND revision = ${input.expectedRevision}
            RETURNING 1
          )
          SELECT 1 / count(*)::integer AS committed FROM written
        `);

  await db.batch([eventWrite, stateWrite]);
}

function toDueReviewCard(row: ReviewCardRow): DueReviewCard {
  return {
    id: row.id,
    wordSetId: row.wordSetId,
    wordSetName: row.wordSetName,
    sourceLang: row.sourceLang,
    targetLang: row.targetLang,
    templateKey: row.templateKey,
    original: row.original,
    translation: row.translation,
    wordForms: row.wordForms,
    sample: row.sample,
    sampleTranslation: row.sampleTranslation,
    comments: row.comments,
    tags: row.tags,
    state: row.projection
      ? projectionFromRow(row.projection)
      : createInitialFsrsState(row.introducedAt),
    revision: row.projection?.revision ?? null,
  };
}

function projectionFromRow(
  row: NonNullable<ReviewCardRow["projection"]>,
): FsrsStateProjection {
  return {
    dueAt: row.dueAt,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsedDays: row.elapsedDays,
    scheduledDays: row.scheduledDays,
    learningSteps: row.learningSteps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as FsrsCardStateValue,
    lastReviewAt: row.lastReviewAt,
    schedulerVersion: row.schedulerVersion,
  };
}

function isRevisionConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes("division by zero")
  );
}
