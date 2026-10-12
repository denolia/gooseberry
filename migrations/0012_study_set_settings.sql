ALTER TABLE "user_preference" ADD COLUMN "new_words_per_day" integer DEFAULT 20 NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_preference" ADD COLUMN "study_time_zone" text DEFAULT 'UTC' NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_new_words_per_day_check" CHECK ("new_words_per_day" BETWEEN 0 AND 1000);
