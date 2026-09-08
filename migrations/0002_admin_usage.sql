CREATE TABLE "ai_usage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "app_user"("id") ON DELETE CASCADE,
  "operation" text NOT NULL,
  "model" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "input_words" integer NOT NULL,
  "input_tokens" integer,
  "cached_input_tokens" integer,
  "output_tokens" integer,
  "reasoning_tokens" integer,
  "response_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "ai_usage_user_created_at_idx" ON "ai_usage" ("user_id", "created_at");
