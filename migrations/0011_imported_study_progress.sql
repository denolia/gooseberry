ALTER TABLE "anki_import_job"
  ADD COLUMN "import_progress" boolean DEFAULT true NOT NULL,
  ADD COLUMN "scheduling_time_zone" text DEFAULT 'UTC' NOT NULL,
  ADD COLUMN "imported_progress_count" integer DEFAULT 0 NOT NULL;

ALTER TABLE "study_card"
  ADD COLUMN "is_suspended" boolean DEFAULT false NOT NULL,
  ADD COLUMN "buried_until" timestamp with time zone;

CREATE TABLE "study_card_import_baseline" (
  "user_id" uuid NOT NULL REFERENCES "app_user"("id") ON DELETE CASCADE,
  "study_card_id" uuid NOT NULL REFERENCES "study_card"("id") ON DELETE CASCADE,
  "import_job_id" uuid NOT NULL REFERENCES "anki_import_job"("id") ON DELETE CASCADE,
  "source_card_id" text NOT NULL,
  "baseline_state" jsonb NOT NULL,
  "imported_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("user_id", "study_card_id")
);
