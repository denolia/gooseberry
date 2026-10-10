ALTER TABLE "word_set_item" ADD COLUMN "source_note_key" text;
ALTER TABLE "word_set_item" ADD COLUMN "import_job_id" uuid;
ALTER TABLE "word_set_item" ADD COLUMN "example_pairs" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "word_set_item" ADD COLUMN "content_revision" integer DEFAULT 0 NOT NULL;
ALTER TABLE "word_set_item" ADD COLUMN "field_origins" jsonb DEFAULT '{}'::jsonb NOT NULL;
CREATE UNIQUE INDEX "word_set_item_source_note_idx" ON "word_set_item" ("word_set_id", "source_note_key") WHERE "source_note_key" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "anki_import_job" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "app_user"("id") ON DELETE CASCADE,
  "request_key" uuid NOT NULL,
  "request_hash" text NOT NULL,
  "file_name" text NOT NULL,
  "file_size" integer NOT NULL,
  "file_sha256" text NOT NULL,
  "name" text NOT NULL,
  "source_lang" text NOT NULL,
  "target_lang" text NOT NULL,
  "target_set_id" uuid,
  "word_set_id" uuid,
  "owns_set" boolean DEFAULT false NOT NULL,
  "status" text DEFAULT 'receiving' NOT NULL,
  "mapping" jsonb NOT NULL,
  "package_metadata" jsonb NOT NULL,
  "next_batch_index" integer DEFAULT 0 NOT NULL,
  "staged_note_count" integer DEFAULT 0 NOT NULL,
  "staged_card_count" integer DEFAULT 0 NOT NULL,
  "staged_review_count" integer DEFAULT 0 NOT NULL,
  "staged_byte_count" integer DEFAULT 0 NOT NULL,
  "added_count" integer DEFAULT 0 NOT NULL,
  "skipped_count" integer DEFAULT 0 NOT NULL,
  "needs_attention_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "completed_at" timestamptz,
  CONSTRAINT "anki_import_job_status_check" CHECK ("status" IN ('receiving', 'completed', 'cancelled', 'removed'))
);
CREATE UNIQUE INDEX "anki_import_job_request_idx" ON "anki_import_job" ("user_id", "request_key");
CREATE INDEX "anki_import_job_user_idx" ON "anki_import_job" ("user_id", "created_at");
--> statement-breakpoint
CREATE TABLE "anki_import_batch" (
  "job_id" uuid NOT NULL REFERENCES "anki_import_job"("id") ON DELETE CASCADE,
  "batch_index" integer NOT NULL,
  "payload_hash" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY ("job_id", "batch_index")
);
CREATE TABLE "import_source_note" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL REFERENCES "anki_import_job"("id") ON DELETE CASCADE,
  "item_id" uuid REFERENCES "word_set_item"("id") ON DELETE SET NULL,
  "proposed_item_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "source_note_id" text NOT NULL,
  "source_note_key" text NOT NULL,
  "source_guid" text NOT NULL,
  "model_id" text NOT NULL,
  "raw_note" jsonb NOT NULL,
  "mapped_content" jsonb NOT NULL,
  "skipped" boolean DEFAULT false NOT NULL,
  "needs_attention" boolean DEFAULT false NOT NULL,
  "position" integer NOT NULL
);
CREATE UNIQUE INDEX "import_source_note_id_idx" ON "import_source_note" ("job_id", "source_note_id");
CREATE UNIQUE INDEX "import_source_note_key_idx" ON "import_source_note" ("job_id", "source_note_key");
CREATE INDEX "import_source_note_item_idx" ON "import_source_note" ("item_id");
CREATE TABLE "import_source_card" (
  "job_id" uuid NOT NULL REFERENCES "anki_import_job"("id") ON DELETE CASCADE,
  "source_card_id" text NOT NULL,
  "source_note_id" text NOT NULL,
  "raw_card" jsonb NOT NULL,
  PRIMARY KEY ("job_id", "source_card_id")
);
CREATE INDEX "import_source_card_note_idx" ON "import_source_card" ("job_id", "source_note_id");
CREATE TABLE "import_source_review" (
  "job_id" uuid NOT NULL REFERENCES "anki_import_job"("id") ON DELETE CASCADE,
  "source_review_id" text NOT NULL,
  "source_card_id" text NOT NULL,
  "raw_review" jsonb NOT NULL,
  PRIMARY KEY ("job_id", "source_review_id")
);
CREATE INDEX "import_source_review_card_idx" ON "import_source_review" ("job_id", "source_card_id");
