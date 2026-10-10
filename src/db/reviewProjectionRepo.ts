import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { getDb } from "@/db/drizzle";
import {
  fsrsCardState,
  reviewEvent,
  studyCard,
  studyCardImportBaseline,
  wordSet,
  wordSetItem,
} from "@/db/schema";
import {
  deserializeFsrsState,
  FSRS_SCHEDULER_VERSION,
  replayReviewHistory,
  serializeFsrsState,
} from "@/lib/review/fsrs";
import { ReviewRatingSchema } from "@/lib/review/model";

// Restore replaceable caches before due queries and aggregate counts. Source
// reviews stay in their private archive; only real Gooseberry events are replayed
// after the canonical imported starting state. Fresh cards need no projection.
export async function ensureReviewProjections(
  userId: string,
  wordSetId?: string,
) {
  const candidates = await getDb()
    .select({
      id: studyCard.id,
      introducedAt: studyCard.createdAt,
      baseline: studyCardImportBaseline.baselineState,
      revision: fsrsCardState.revision,
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
    )
    .leftJoin(
      studyCardImportBaseline,
      and(
        eq(studyCardImportBaseline.studyCardId, studyCard.id),
        eq(studyCardImportBaseline.userId, userId),
      ),
    )
    .where(
      and(
        eq(wordSet.userId, userId),
        wordSetId ? eq(wordSet.id, wordSetId) : undefined,
        or(
          ne(fsrsCardState.schedulerVersion, FSRS_SCHEDULER_VERSION),
          and(
            isNull(fsrsCardState.studyCardId),
            or(
              isNotNull(studyCardImportBaseline.studyCardId),
              sql`EXISTS (SELECT 1 FROM review_event history WHERE history.study_card_id = ${studyCard.id}
            AND history.user_id = ${userId} AND history.source = 'gooseberry')`,
            ),
          ),
        ),
      ),
    );

  for (let offset = 0; offset < candidates.length; offset += 500) {
    const cards = candidates.slice(offset, offset + 500);
    const history = await getDb()
      .select({
        id: reviewEvent.id,
        studyCardId: reviewEvent.studyCardId,
        rating: reviewEvent.rating,
        reviewedAt: reviewEvent.reviewedAt,
        sequence: reviewEvent.sequence,
      })
      .from(reviewEvent)
      .where(
        and(
          eq(reviewEvent.userId, userId),
          eq(reviewEvent.source, "gooseberry"),
          inArray(
            reviewEvent.studyCardId,
            cards.map((card) => card.id),
          ),
        ),
      )
      .orderBy(asc(reviewEvent.reviewedAt), asc(reviewEvent.sequence));
    const historyByCard = new Map<string, typeof history>();
    for (const event of history) {
      const events = historyByCard.get(event.studyCardId) ?? [];
      events.push(event);
      historyByCard.set(event.studyCardId, events);
    }
    const rows = cards.map((card) => {
      const events = historyByCard.get(card.id) ?? [];
      const state = replayReviewHistory(
        card.introducedAt,
        events.map((event) => ({
          ...event,
          rating: ReviewRatingSchema.parse(event.rating),
        })),
        card.baseline ? deserializeFsrsState(card.baseline) : null,
      );
      return {
        study_card_id: card.id,
        expected_revision: card.revision,
        revision: events.length,
        last_review_event_id: events.at(-1)?.id ?? null,
        ...serializeFsrsState(state),
      };
    });
    await getDb().execute(sql`
      WITH data AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS value(
          study_card_id uuid, expected_revision integer, revision integer, last_review_event_id uuid,
          "dueAt" timestamptz, stability double precision, difficulty double precision,
          "elapsedDays" integer, "scheduledDays" integer, "learningSteps" integer,
          reps integer, lapses integer, state smallint, "lastReviewAt" timestamptz, "schedulerVersion" text
        )
      ) INSERT INTO fsrs_card_state (user_id,study_card_id,due_at,stability,difficulty,
          elapsed_days,scheduled_days,learning_steps,reps,lapses,state,revision,
          last_review_at,last_review_event_id,scheduler_version,updated_at)
        SELECT ${userId},study_card_id,"dueAt",stability,difficulty,"elapsedDays","scheduledDays",
          "learningSteps",reps,lapses,state,revision,"lastReviewAt",last_review_event_id,"schedulerVersion",now()
        FROM data
      ON CONFLICT (user_id,study_card_id) DO UPDATE SET
        due_at=excluded.due_at,stability=excluded.stability,difficulty=excluded.difficulty,
        elapsed_days=excluded.elapsed_days,scheduled_days=excluded.scheduled_days,
        learning_steps=excluded.learning_steps,reps=excluded.reps,lapses=excluded.lapses,
        state=excluded.state,revision=fsrs_card_state.revision+1,last_review_at=excluded.last_review_at,
        last_review_event_id=excluded.last_review_event_id,scheduler_version=excluded.scheduler_version,updated_at=now()
      WHERE fsrs_card_state.revision=(SELECT expected_revision FROM data WHERE data.study_card_id=excluded.study_card_id)
    `);
  }
}
