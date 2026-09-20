CREATE TABLE "study_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"word_set_item_id" uuid NOT NULL,
	"template_key" text NOT NULL,
	"external_source" text,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_card_template_key_not_blank_check" CHECK (char_length(trim("template_key")) > 0),
	CONSTRAINT "study_card_external_identity_check" CHECK (("external_source" IS NULL AND "external_id" IS NULL) OR ("external_source" IS NOT NULL AND "external_id" IS NOT NULL AND char_length(trim("external_source")) > 0 AND char_length(trim("external_id")) > 0))
);
--> statement-breakpoint
ALTER TABLE "study_card" ADD CONSTRAINT "study_card_word_set_item_id_word_set_item_id_fk" FOREIGN KEY ("word_set_item_id") REFERENCES "public"."word_set_item"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "study_card_item_template_idx" ON "study_card" USING btree ("word_set_item_id", "template_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "study_card_external_identity_idx" ON "study_card" USING btree ("word_set_item_id", "external_source", "external_id") WHERE "external_source" IS NOT NULL AND "external_id" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "study_card" ("word_set_item_id", "template_key")
SELECT "id", 'recognition' FROM "word_set_item"
ON CONFLICT ("word_set_item_id", "template_key") DO NOTHING;
--> statement-breakpoint
CREATE TABLE "review_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" bigserial NOT NULL,
	"user_id" uuid NOT NULL,
	"study_card_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"duration_ms" integer,
	"source" text DEFAULT 'gooseberry' NOT NULL,
	"external_id" text,
	"source_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_event_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "review_event_rating_check" CHECK ("rating" BETWEEN 1 AND 4),
	CONSTRAINT "review_event_duration_ms_check" CHECK ("duration_ms" IS NULL OR "duration_ms" >= 0),
	CONSTRAINT "review_event_source_not_blank_check" CHECK (char_length(trim("source")) > 0),
	CONSTRAINT "review_event_external_id_not_blank_check" CHECK ("external_id" IS NULL OR char_length(trim("external_id")) > 0)
);
--> statement-breakpoint
ALTER TABLE "review_event" ADD CONSTRAINT "review_event_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_event" ADD CONSTRAINT "review_event_study_card_id_study_card_id_fk" FOREIGN KEY ("study_card_id") REFERENCES "public"."study_card"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "review_event_card_history_idx" ON "review_event" USING btree ("study_card_id", "reviewed_at", "sequence");
--> statement-breakpoint
CREATE INDEX "review_event_user_history_idx" ON "review_event" USING btree ("user_id", "reviewed_at", "sequence");
--> statement-breakpoint
CREATE UNIQUE INDEX "review_event_external_identity_idx" ON "review_event" USING btree ("user_id", "source", "external_id") WHERE "external_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "fsrs_card_state" (
	"user_id" uuid NOT NULL,
	"study_card_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"stability" double precision DEFAULT 0 NOT NULL,
	"difficulty" double precision DEFAULT 0 NOT NULL,
	"elapsed_days" integer DEFAULT 0 NOT NULL,
	"scheduled_days" integer DEFAULT 0 NOT NULL,
	"learning_steps" integer DEFAULT 0 NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"state" smallint DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"last_review_at" timestamp with time zone,
	"last_review_event_id" uuid,
	"scheduler_version" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fsrs_card_state_pk" PRIMARY KEY("user_id", "study_card_id"),
	CONSTRAINT "fsrs_card_state_state_check" CHECK ("state" BETWEEN 0 AND 3),
	CONSTRAINT "fsrs_card_state_nonnegative_check" CHECK ("stability" >= 0 AND "difficulty" >= 0 AND "elapsed_days" >= 0 AND "scheduled_days" >= 0 AND "learning_steps" >= 0 AND "reps" >= 0 AND "lapses" >= 0 AND "revision" >= 0),
	CONSTRAINT "fsrs_card_state_scheduler_version_not_blank_check" CHECK (char_length(trim("scheduler_version")) > 0)
);
--> statement-breakpoint
ALTER TABLE "fsrs_card_state" ADD CONSTRAINT "fsrs_card_state_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fsrs_card_state" ADD CONSTRAINT "fsrs_card_state_study_card_id_study_card_id_fk" FOREIGN KEY ("study_card_id") REFERENCES "public"."study_card"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fsrs_card_state" ADD CONSTRAINT "fsrs_card_state_last_review_event_id_review_event_id_fk" FOREIGN KEY ("last_review_event_id") REFERENCES "public"."review_event"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "fsrs_card_state_due_idx" ON "fsrs_card_state" USING btree ("user_id", "due_at");
