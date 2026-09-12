ALTER TABLE "app_user" ADD COLUMN "tier" text DEFAULT 'free' NOT NULL;
--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "premium_granted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "premium_granted_by" uuid;
--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_tier_check" CHECK ("tier" IN ('free', 'premium'));
--> statement-breakpoint
CREATE TABLE "user_preference" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "app_user"("id") ON DELETE cascade,
  "default_source_lang" text DEFAULT 'German' NOT NULL,
  "default_target_lang" text DEFAULT 'English' NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "premium_request" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "app_user"("id") ON DELETE cascade,
  "status" text DEFAULT 'pending' NOT NULL,
  "message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  "resolved_by" uuid,
  CONSTRAINT "premium_request_status_check" CHECK ("status" IN ('pending', 'approved', 'declined', 'cancelled')),
  CONSTRAINT "premium_request_message_length_check" CHECK (char_length("message") <= 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "premium_request_one_pending_user_idx" ON "premium_request" ("user_id") WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX "premium_request_status_created_at_idx" ON "premium_request" ("status", "created_at");
--> statement-breakpoint
CREATE TABLE "speech_audio_cache" (
  "cache_key" text PRIMARY KEY NOT NULL,
  "audio_data" bytea NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
