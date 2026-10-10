ALTER TABLE "ai_usage" ADD COLUMN "reserved_tokens" integer DEFAULT 0 NOT NULL;
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_reserved_tokens_check" CHECK ("reserved_tokens" >= 0);
--> statement-breakpoint
CREATE TABLE "enrichment_request" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "app_user"("id") ON DELETE CASCADE,
  "item_id" uuid NOT NULL REFERENCES "word_set_item"("id") ON DELETE CASCADE,
  "request_key" uuid NOT NULL,
  "content_revision" integer NOT NULL,
  "fields" jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "proposal" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "completed_at" timestamptz,
  CONSTRAINT "enrichment_request_status_check" CHECK ("status" IN ('pending', 'completed', 'failed', 'applied'))
);
CREATE UNIQUE INDEX "enrichment_request_key_idx" ON "enrichment_request" ("user_id", "request_key");
CREATE UNIQUE INDEX "enrichment_request_pending_item_idx" ON "enrichment_request" ("item_id") WHERE "status" = 'pending';
