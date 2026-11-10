ALTER TABLE "word_set_item" ADD COLUMN "last_exposed_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE "study_exposure" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "app_user"("id") ON DELETE CASCADE,
  "study_card_id" uuid NOT NULL REFERENCES "study_card"("id") ON DELETE CASCADE,
  "word_set_item_id" uuid NOT NULL REFERENCES "word_set_item"("id") ON DELETE CASCADE,
  "state_before" smallint NOT NULL CONSTRAINT "study_exposure_state_check" CHECK ("state_before" BETWEEN 0 AND 3),
  "reps_before" integer NOT NULL CONSTRAINT "study_exposure_reps_check" CHECK ("reps_before" >= 0),
  "activated_at" timestamp with time zone NOT NULL,
  "study_day_start" timestamp with time zone NOT NULL,
  "study_time_zone" text NOT NULL,
  "review_event_id" uuid UNIQUE REFERENCES "review_event"("id") ON DELETE SET NULL
);
--> statement-breakpoint
UPDATE "word_set_item" AS item SET "last_exposed_at" = history.last_seen
FROM (
  SELECT card.word_set_item_id, max(event.reviewed_at) AS last_seen
  FROM review_event event
  INNER JOIN study_card card ON card.id = event.study_card_id
  INNER JOIN word_set_item note ON note.id = card.word_set_item_id
  INNER JOIN word_set owned_set ON owned_set.id = note.word_set_id
  WHERE event.source = 'gooseberry' AND event.user_id = owned_set.user_id
  GROUP BY card.word_set_item_id
) history
WHERE item.id = history.word_set_item_id;
