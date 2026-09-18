DROP INDEX IF EXISTS "translation_history_user_created_at_idx";
--> statement-breakpoint
CREATE INDEX "translation_history_user_created_at_idx" ON "translation_history" ("user_id", "created_at" DESC, "id" DESC);
