ALTER TABLE "user_preference" ADD COLUMN "review_mode" text DEFAULT 'simple' NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_review_mode_check" CHECK ("review_mode" IN ('simple', 'full'));
