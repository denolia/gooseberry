import { MessageError } from "@/i18n/errors";
import { getDb } from "@/db/drizzle";
import {
  fsrsCardState,
  reviewEvent,
  studyCard,
  studyCardImportBaseline,
  wordSet,
  wordSetItem,
} from "@/db/schema";
import { and, asc, eq, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import {
  applyReview,
  createInitialFsrsState,
  deserializeFsrsState,
  FSRS_SCHEDULER_VERSION,
  replayReviewHistory,
  type FsrsStateProjection,
  type SerializedFsrsStateProjection,
} from "@/lib/review/fsrs";
import {
  FsrsCardState,
  ReviewRatingSchema,
  type FsrsCardStateValue,
  type ReviewRatingValue,
} from "@/lib/review/model";
import {
  eligibleStudyCardCondition,
  availableStudyCardCondition,
  ensureStudyCards,
} from "@/db/studyCardRepo";
import { STUDY_CARD_INTRODUCTION_ORDER } from "@/lib/review/policy";
import { ensureReviewProjections } from "@/db/reviewProjectionRepo";
import { studyWordAvailabilityCondition } from "@/db/studyAllowance";
import { studyCardIntroductionCondition } from "@/db/studyPolicy";
import { getStudyDay, type StudyDayContext } from "@/db/studyDay";
import {
  effectiveReviewDueAt,
  exposureSensitiveCardCondition,
  firstSensitiveStudyCardCondition,
  studyExposureAllowedCondition,
} from "@/db/studyExposurePolicy";
import {
  consumeStudyExposure,
  getStudyExposure,
  persistStudyExposure,
  touchStudyExposure,
  type StudyExposure,
} from "@/db/studyExposureRepo";
import { isExposureSensitive } from "@/lib/review/policy";
import type { RatingPreview } from "@/lib/review/fsrs";
import {
  studyFilterCondition,
  studySetCondition,
  studySetSelection,
} from "@/db/studyScope";
import type { StudyFilter, StudyScope } from "@/lib/review/scope";

const MAX_REVIEW_WRITE_ATTEMPTS = 3;

export class ReviewCardNotFoundError extends MessageError {}
export class ReviewCardNotDueError extends MessageError {}
export class ReviewWriteConflictError extends MessageError {}
export class ReviewWordSeenTodayError extends ReviewCardNotDueError {}

export type DueReviewCard = {
  id: string;
  wordSetItemId: string;
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
  baseline: SerializedFsrsStateProjection | null;
  introductionAllowed: boolean;
  allowanceAllowed: boolean;
  lastExposedAt: Date | null;
  isSuspended: boolean;
  buriedUntil: Date | null;
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
  wordSetId?: string;
  scope?: StudyScope;
  filter?: StudyFilter;
  now: Date;
}): Promise<DueReviewCard | null> {
  const [card] = await getDueReviewCards({ ...input, limit: 1 });
  return card ?? null;
}

export async function getDueReviewCards(input: {
  userId: string;
  wordSetId?: string;
  scope?: StudyScope;
  filter?: StudyFilter;
  now: Date;
  limit: number;
  excludedStudyCardIds?: string[];
  studyDay?: StudyDayContext;
}): Promise<DueReviewCard[]> {
  const selection = studySetSelection(input);
  await ensureStudyCards(input.userId, selection);
  await ensureReviewProjections(input.userId, selection);
  const day = input.studyDay ?? (await getStudyDay(input.userId, input.now));

  const conditions = [
    eq(wordSet.userId, input.userId),
    studySetCondition(selection),
    studyFilterCondition(input.filter),
    eligibleStudyCardCondition(),
    availableStudyCardCondition(input.now),
    studyCardIntroductionCondition(input.userId),
    studyExposureAllowedCondition(day),
    firstSensitiveStudyCardCondition(input.userId, input.now),
    studyWordAvailabilityCondition(input),
    or(isNull(fsrsCardState.studyCardId), lte(fsrsCardState.dueAt, input.now)),
  ];
  const rankedCandidates = getDb()
    .$with("ranked_study_candidates")
    .as(
      getDb()
        .select({
          id: studyCard.id,
          rank: sql<number>`row_number() OVER (
        PARTITION BY ${wordSet.id}, coalesce(${fsrsCardState.state}, 0) = 0
        ORDER BY ${exerciseIntroductionOrder()}, ${wordSetItem.position}, ${wordSetItem.id}, ${studyCard.id}
      )`.as("candidate_rank"),
        })
        .from(studyCard)
        .innerJoin(wordSetItem, eq(wordSetItem.id, studyCard.wordSetItemId))
        .innerJoin(wordSet, eq(wordSet.id, wordSetItem.wordSetId))
        .leftJoin(
          fsrsCardState,
          and(
            eq(fsrsCardState.studyCardId, studyCard.id),
            eq(fsrsCardState.userId, input.userId),
          ),
        )
        .where(and(...conditions)),
    );
  const rows = await baseCardQuery(
    input.userId,
    false,
    undefined,
    undefined,
    getDb().with(rankedCandidates),
  )
    .innerJoin(rankedCandidates, eq(rankedCandidates.id, studyCard.id))
    .where(
      input.excludedStudyCardIds?.length
        ? notInArray(studyCard.id, input.excludedStudyCardIds)
        : sql`true`,
    )
    .orderBy(
      // Existing reviews keep their due-date priority. New exercises follow
      // the same introduction order for every note, regardless of position.
      sql`CASE WHEN ${fsrsCardState.studyCardId} IS NULL OR ${fsrsCardState.state} = ${FsrsCardState.New} THEN 1 ELSE 0 END`,
      sql`CASE WHEN ${fsrsCardState.state} <> ${FsrsCardState.New} THEN ${fsrsCardState.dueAt} ELSE NULL END ASC NULLS LAST`,
      // Fair rounds preserve each set's introduction/word order. Ranking before
      // exclusions keeps refills stable and handles sparse imported positions.
      asc(rankedCandidates.rank),
      asc(wordSet.id),
      asc(studyCard.id),
    )
    .limit(Math.max(1, Math.min(input.limit, 50)));

  return rows.map(toDueReviewCard);
}

export async function getNextScheduledReviewAt(input: {
  userId: string;
  wordSetId?: string;
  scope?: StudyScope;
  filter?: StudyFilter;
  now: Date;
  studyDay?: StudyDayContext;
}): Promise<Date | null> {
  return (await getReviewQueueTiming(input)).nextDueAt;
}

export async function getReviewQueueTiming(input: {
  userId: string;
  wordSetId?: string;
  scope?: StudyScope;
  filter?: StudyFilter;
  now: Date;
  studyDay?: StudyDayContext;
}): Promise<{
  nextDueAt: Date | null;
  exposureDeferredCount: number;
  allowanceBlockedCount: number;
}> {
  const day = input.studyDay ?? (await getStudyDay(input.userId, input.now));
  const effectiveDue = effectiveReviewDueAt(day);
  const [row] = await getDb()
    .select({
      nextDueAt:
        sql<Date | null>`min(${effectiveDue}) FILTER (WHERE ${fsrsCardState.state} <> ${FsrsCardState.New} AND ${effectiveDue} > ${input.now})`.mapWith(
          fsrsCardState.dueAt,
        ),
      exposureDeferredCount: sql<number>`count(*) FILTER (WHERE
        ${exposureSensitiveCardCondition()} AND ${wordSetItem.lastExposedAt} >= ${day.startAt}
        AND ${fsrsCardState.dueAt} <= ${input.now}
        AND (${studyCard.buriedUntil} IS NULL OR ${studyCard.buriedUntil} <= ${input.now})
      )`.mapWith(Number),
      allowanceBlockedCount:
        sql<number>`count(DISTINCT ${wordSetItem.id}) FILTER (WHERE
        coalesce(${fsrsCardState.state}, 0) = 0
        AND ${studyFilterCondition(input.filter)}
        AND (${fsrsCardState.dueAt} IS NULL OR ${fsrsCardState.dueAt} <= ${input.now})
        AND (${studyCard.buriedUntil} IS NULL OR ${studyCard.buriedUntil} <= ${input.now})
        AND ${studyCardIntroductionCondition(input.userId)}
        AND NOT (${studyWordAvailabilityCondition(input)})
      )`.mapWith(Number),
    })
    .from(studyCard)
    .innerJoin(wordSetItem, eq(wordSetItem.id, studyCard.wordSetItemId))
    .innerJoin(wordSet, eq(wordSet.id, wordSetItem.wordSetId))
    .leftJoin(
      fsrsCardState,
      and(
        eq(fsrsCardState.studyCardId, studyCard.id),
        eq(fsrsCardState.userId, input.userId),
      ),
    )
    .where(
      and(
        eq(wordSet.userId, input.userId),
        studySetCondition(studySetSelection(input)),
        eligibleStudyCardCondition(),
        eq(studyCard.isSuspended, false),
      ),
    );
  return {
    nextDueAt: row?.nextDueAt ?? null,
    exposureDeferredCount: row?.exposureDeferredCount ?? 0,
    allowanceBlockedCount: row?.allowanceBlockedCount ?? 0,
  };
}

// Rating previews show actual availability without changing the FSRS result.
export function exposureAwareRatingPreviews(
  templateKey: string,
  ratings: RatingPreview[],
  now: Date,
  day: StudyDayContext,
): RatingPreview[] {
  return ratings.map((preview) =>
    isExposureSensitive(templateKey, preview.state) &&
    preview.dueAt < day.nextStartAt
      ? {
          ...preview,
          dueAt: day.nextStartAt,
          intervalMs: Math.max(0, day.nextStartAt.getTime() - now.getTime()),
        }
      : preview,
  );
}

export async function getRecordedCardAvailableAt(input: {
  userId: string;
  wordSetId: string;
  studyCardId: string;
  state: FsrsStateProjection;
  studyDay: StudyDayContext;
}): Promise<Date> {
  const row = await getOwnedReviewCard(
    input.userId,
    input.wordSetId,
    input.studyCardId,
  );
  if (!row) return input.state.dueAt;
  const policyUntil =
    isExposureSensitive(row.templateKey, input.state.state) &&
    row.lastExposedAt &&
    row.lastExposedAt >= input.studyDay.startAt
      ? input.studyDay.nextStartAt.getTime()
      : 0;
  return new Date(
    Math.max(
      input.state.dueAt.getTime(),
      row.buriedUntil?.getTime() ?? 0,
      policyUntil,
    ),
  );
}

export async function activateReviewCard(input: {
  userId: string;
  wordSetId: string;
  studyCardId: string;
  exposureId: string;
  now: Date;
  studyDay?: StudyDayContext;
}): Promise<{
  card: DueReviewCard;
  exposure: StudyExposure;
  studyDay: StudyDayContext;
}> {
  // The queue reconciles identities in bulk. Activation repairs only this
  // known card if needed; it must not scan or rebuild the entire set per display.
  await ensureReviewProjections(
    input.userId,
    input.wordSetId,
    input.studyCardId,
  );
  const day = input.studyDay ?? (await getStudyDay(input.userId, input.now));
  const row = await getOwnedReviewCard(
    input.userId,
    input.wordSetId,
    input.studyCardId,
    input.now,
  );
  if (!row) throw new ReviewCardNotFoundError("errors.reviewCardNotFound");
  const card = toDueReviewCard(row);
  const previous = await getStudyExposure(input.userId, input.exposureId);
  if (previous) {
    if (
      previous.studyCardId !== card.id ||
      previous.wordSetItemId !== card.wordSetItemId ||
      previous.reviewEventId
    ) {
      throw new ReviewWriteConflictError(
        "errors.thisPresentationIsNoLongerAvailable",
      );
    }
    if (
      previous.stateBefore !== card.state.state ||
      previous.repsBefore !== card.state.reps
    ) {
      throw new ReviewWriteConflictError(
        "errors.theCardChangedReloadTheExercise",
      );
    }
    if (row.isSuspended || (row.buriedUntil && row.buriedUntil > input.now)) {
      throw new ReviewCardNotDueError("errors.reviewCardIsSuspendedOrBuried");
    }
    await touchStudyExposure(previous, input.now);
    return { card, exposure: previous, studyDay: day };
  }
  if (
    !row.introductionAllowed ||
    !row.allowanceAllowed ||
    row.isSuspended ||
    (row.buriedUntil && row.buriedUntil > input.now) ||
    card.state.dueAt > input.now
  ) {
    throw new ReviewCardNotDueError("errors.thisExerciseIsNotAvailableYet");
  }
  const receipt = await persistStudyExposure({
    ...input,
    wordSetItemId: card.wordSetItemId,
    day,
    stateBefore: card.state.state,
    repsBefore: card.state.reps,
    cardCondition: and(
      eq(studyCard.id, card.id),
      eq(studyCard.wordSetItemId, wordSetItem.id),
      eq(wordSet.userId, input.userId),
      eq(wordSet.id, input.wordSetId),
      eligibleStudyCardCondition(),
      availableStudyCardCondition(input.now),
      studyCardIntroductionCondition(input.userId),
      activationAllowanceCondition(input),
      or(
        isNull(fsrsCardState.studyCardId),
        lte(fsrsCardState.dueAt, input.now),
      ),
      sql`coalesce(${fsrsCardState.state}, 0) = ${card.state.state}`,
      sql`coalesce(${fsrsCardState.reps}, 0) = ${card.state.reps}`,
    )!,
  });
  if (!receipt) {
    const current = await getOwnedReviewCard(
      input.userId,
      input.wordSetId,
      input.studyCardId,
    );
    if (
      current?.lastExposedAt &&
      current.lastExposedAt >= day.startAt &&
      isExposureSensitive(
        current.templateKey,
        toDueReviewCard(current).state.state,
      )
    ) {
      throw new ReviewWordSeenTodayError(
        "errors.youHaveAlreadySeenThisWordTodayRepetitionsResumeAfter2",
      );
    }
    throw new ReviewCardNotDueError(
      "errors.thisExerciseChangedReloadTheNextExercise",
    );
  }
  if (receipt.studyCardId !== card.id || receipt.reviewEventId) {
    throw new ReviewWriteConflictError(
      "errors.thisPresentationIsNoLongerAvailable",
    );
  }
  return { card, exposure: receipt, studyDay: day };
}

function exerciseIntroductionOrder() {
  return sql`CASE ${studyCard.templateKey} ${sql.join(
    STUDY_CARD_INTRODUCTION_ORDER.map(
      (key, index) => sql`WHEN ${key} THEN ${index}::integer`,
    ),
    sql` `,
  )} ELSE ${STUDY_CARD_INTRODUCTION_ORDER.length}::integer END`;
}

export async function recordReview(input: {
  userId: string;
  wordSetId: string;
  studyCardId: string;
  reviewEventId: string;
  rating: ReviewRatingValue;
  reviewedAt: Date;
  durationMs?: number;
  exposureId: string;
  now?: Date;
}): Promise<FsrsStateProjection> {
  const recordedState = await getRecordedReviewState(input);
  if (recordedState) return recordedState;
  const now = input.now ?? input.reviewedAt;
  // Existing UUID retries above remain valid indefinitely, including rollover.
  // New writes allow delayed delivery, but never trust arbitrary client clocks.
  const skew = input.reviewedAt.getTime() - now.getTime();
  if (!Number.isFinite(skew) || skew > 5 * 60_000 || skew < -24 * 60 * 60_000) {
    throw new ReviewCardNotDueError("errors.reviewTimestampOutsideWindow");
  }
  const activityDay = await getStudyDay(input.userId, now);

  for (let attempt = 0; attempt < MAX_REVIEW_WRITE_ATTEMPTS; attempt += 1) {
    const row = await getOwnedReviewCard(
      input.userId,
      input.wordSetId,
      input.studyCardId,
    );
    if (!row) throw new ReviewCardNotFoundError("errors.reviewCardNotFound");
    if (!row.introductionAllowed) {
      throw new ReviewCardNotDueError(
        "errors.completeTheEarlierWordExercisesFirst",
      );
    }
    if (
      row.isSuspended ||
      (row.buriedUntil && row.buriedUntil > input.reviewedAt)
    ) {
      throw new ReviewCardNotDueError("errors.reviewCardIsSuspendedOrBuried");
    }

    let currentState = row.projection
      ? projectionFromRow(row.projection)
      : row.baseline
        ? deserializeFsrsState(row.baseline)
        : createInitialFsrsState(row.introducedAt);

    if (
      !row.projection ||
      row.projection.schedulerVersion !== FSRS_SCHEDULER_VERSION
    ) {
      currentState = await rebuildCardState(
        input.userId,
        input.studyCardId,
        row.introducedAt,
        row.baseline,
      );
    }

    let permission = await getStudyExposure(input.userId, input.exposureId);
    if (!permission && input.exposureId) {
      // A rating may arrive before its best-effort display request. Create the
      // same presentation receipt here without waiting for that marker write.
      const now = input.now ?? input.reviewedAt;
      permission = await persistStudyExposure({
        ...input,
        now,
        wordSetItemId: row.wordSetItemId,
        day: await getStudyDay(input.userId, now),
        stateBefore: currentState.state,
        repsBefore: currentState.reps,
        enforceExposureGate: false,
        cardCondition: and(
          eq(studyCard.id, input.studyCardId),
          eq(studyCard.wordSetItemId, wordSetItem.id),
          eq(wordSet.userId, input.userId),
          eq(wordSet.id, input.wordSetId),
          eligibleStudyCardCondition(),
          availableStudyCardCondition(now),
          studyCardIntroductionCondition(input.userId),
          activationAllowanceCondition({ ...input, now }),
          row.projection
            ? eq(fsrsCardState.revision, row.projection.revision)
            : isNull(fsrsCardState.studyCardId),
        )!,
      });
    }
    if (
      !permission ||
      permission.studyCardId !== input.studyCardId ||
      permission.wordSetItemId !== row.wordSetItemId
    ) {
      throw new ReviewCardNotDueError(
        "errors.openThisExerciseBeforeSavingItsRating",
      );
    }
    if (
      permission.reviewEventId ||
      permission.stateBefore !== currentState.state ||
      permission.repsBefore !== currentState.reps
    ) {
      // Another retry may have committed after the initial idempotency read.
      const alreadyRecorded = await getRecordedReviewState(input);
      if (alreadyRecorded) return alreadyRecorded;
      throw new ReviewWriteConflictError(
        "errors.theCardChangedReloadTheExercise",
      );
    }
    if (currentState.dueAt.getTime() > input.reviewedAt.getTime()) {
      throw new ReviewCardNotDueError("errors.reviewCardIsNotDueYet");
    }

    const nextState = applyReview(currentState, input.rating, input.reviewedAt);

    try {
      await persistReview({
        ...input,
        exposureId: permission.id,
        exposedAt: input.now ?? input.reviewedAt,
        expectedRevision: row.projection?.revision ?? null,
        nextState,
        activityDay,
        templateKey: row.templateKey,
        wordSetItemId: row.wordSetItemId,
        wordSetId: row.wordSetId,
      });
      return nextState;
    } catch (error) {
      const alreadyRecorded = await getRecordedReviewState(input);
      if (alreadyRecorded) return alreadyRecorded;
      if (!isRevisionConflict(error)) throw error;
    }
  }

  throw new ReviewWriteConflictError(
    "errors.theCardChangedWhileTheReviewWasBeingRecorded",
  );
}

async function getRecordedReviewState(input: {
  userId: string;
  wordSetId: string;
  studyCardId: string;
  reviewEventId: string;
  rating: ReviewRatingValue;
  reviewedAt: Date;
}): Promise<FsrsStateProjection | null> {
  const [row] = await getDb()
    .select({
      studyCardId: reviewEvent.studyCardId,
      rating: reviewEvent.rating,
      reviewedAt: reviewEvent.reviewedAt,
      introducedAt: studyCard.createdAt,
      baseline: studyCardImportBaseline.baselineState,
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
    .from(reviewEvent)
    .innerJoin(studyCard, eq(studyCard.id, reviewEvent.studyCardId))
    .innerJoin(wordSetItem, eq(wordSetItem.id, studyCard.wordSetItemId))
    .innerJoin(wordSet, eq(wordSet.id, wordSetItem.wordSetId))
    .leftJoin(
      studyCardImportBaseline,
      and(
        eq(studyCardImportBaseline.userId, input.userId),
        eq(studyCardImportBaseline.studyCardId, reviewEvent.studyCardId),
      ),
    )
    .leftJoin(
      fsrsCardState,
      and(
        eq(fsrsCardState.userId, input.userId),
        eq(fsrsCardState.studyCardId, reviewEvent.studyCardId),
      ),
    )
    .where(
      and(
        eq(reviewEvent.id, input.reviewEventId),
        eq(reviewEvent.userId, input.userId),
        eq(wordSet.userId, input.userId),
        eq(wordSet.id, input.wordSetId),
      ),
    )
    .limit(1);

  if (!row) return null;
  if (
    row.studyCardId !== input.studyCardId ||
    row.rating !== input.rating ||
    row.reviewedAt.getTime() !== input.reviewedAt.getTime()
  ) {
    throw new ReviewWriteConflictError(
      "errors.theReviewIdWasAlreadyUsedForADifferentReview",
    );
  }

  return row.projection &&
    row.projection.schedulerVersion === FSRS_SCHEDULER_VERSION
    ? projectionFromRow(row.projection)
    : rebuildCardState(
        input.userId,
        input.studyCardId,
        row.introducedAt,
        row.baseline,
      );
}

// Only a brand-new recognition exercise can consume an unseen-word slot.
// All other introductions require a saved earlier exercise of the same word.
function activationAllowanceCondition(input: {
  userId: string;
  wordSetId?: string;
  now: Date;
}) {
  return sql<boolean>`CASE WHEN ${studyCard.templateKey} = 'recognition'
    AND coalesce(${fsrsCardState.state}, 0) = ${FsrsCardState.New}
    THEN ${studyWordAvailabilityCondition(input)} ELSE true END`;
}

function baseCardQuery(
  userId: string,
  checkIntroduction = false,
  allowanceNow?: Date,
  wordSetId?: string,
  database: Pick<ReturnType<typeof getDb>, "select"> = getDb(),
) {
  return database
    .select({
      id: studyCard.id,
      wordSetItemId: wordSetItem.id,
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
      baseline: studyCardImportBaseline.baselineState,
      introductionAllowed: checkIntroduction
        ? studyCardIntroductionCondition(userId)
        : sql<boolean>`true`,
      allowanceAllowed: allowanceNow
        ? activationAllowanceCondition({ userId, wordSetId, now: allowanceNow })
        : sql<boolean>`true`,
      lastExposedAt: wordSetItem.lastExposedAt,
      isSuspended: studyCard.isSuspended,
      buriedUntil: studyCard.buriedUntil,
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
      studyCardImportBaseline,
      and(
        eq(studyCardImportBaseline.studyCardId, studyCard.id),
        eq(studyCardImportBaseline.userId, userId),
      ),
    )
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
  now?: Date,
): Promise<ReviewCardRow | null> {
  const [row] = await baseCardQuery(userId, true, now, wordSetId)
    .where(
      and(
        eq(wordSet.userId, userId),
        eq(wordSet.id, wordSetId),
        eq(studyCard.id, studyCardId),
        eligibleStudyCardCondition(),
      ),
    )
    .limit(1);

  return row ?? null;
}

async function rebuildCardState(
  userId: string,
  studyCardId: string,
  introducedAt: Date,
  baseline: SerializedFsrsStateProjection | null,
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
        eq(reviewEvent.source, "gooseberry"),
      ),
    )
    .orderBy(asc(reviewEvent.reviewedAt), asc(reviewEvent.sequence));

  return replayReviewHistory(
    introducedAt,
    history.map((event) => ({
      ...event,
      rating: ReviewRatingSchema.parse(event.rating),
    })),
    baseline ? deserializeFsrsState(baseline) : null,
  );
}

async function persistReview(input: {
  userId: string;
  studyCardId: string;
  rating: ReviewRatingValue;
  reviewedAt: Date;
  durationMs?: number;
  reviewEventId: string;
  exposureId: string;
  exposedAt: Date;
  expectedRevision: number | null;
  nextState: FsrsStateProjection;
  activityDay: StudyDayContext;
  templateKey: string;
  wordSetItemId: string;
  wordSetId: string;
}) {
  const db = getDb();
  const eventWrite = db.insert(reviewEvent).values({
    id: input.reviewEventId,
    userId: input.userId,
    studyCardId: input.studyCardId,
    rating: input.rating,
    reviewedAt: input.reviewedAt,
    durationMs: input.durationMs,
    sourceMetadata: { exposureId: input.exposureId },
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

  await db.batch([
    eventWrite,
    stateWrite,
    db.execute(consumeStudyExposure(input)),
    db.execute(sql`UPDATE word_set_item SET last_exposed_at = greatest(last_exposed_at, ${input.exposedAt}::timestamptz)
      WHERE id = (SELECT word_set_item_id FROM study_exposure WHERE id = ${input.exposureId} AND user_id = ${input.userId})`),
    db.execute(sql`INSERT INTO study_activity
      (review_id,user_id,completed_at,credited_date,study_time_zone,template_key,study_card_id,word_set_item_id,word_set_id)
      VALUES (${input.reviewEventId},${input.userId},${input.exposedAt},${input.activityDay.creditedDate}::date,
        ${input.activityDay.timeZone},${input.templateKey},${input.studyCardId},${input.wordSetItemId},${input.wordSetId})`),
  ]);
}

function toDueReviewCard(row: ReviewCardRow): DueReviewCard {
  return {
    id: row.id,
    wordSetItemId: row.wordSetItemId,
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
      : row.baseline
        ? deserializeFsrsState(row.baseline)
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
