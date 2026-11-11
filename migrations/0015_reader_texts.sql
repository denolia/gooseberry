CREATE TABLE "reader_text" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "app_user"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "text" text NOT NULL,
  "source_lang" text NOT NULL,
  "target_lang" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "reader_text_title_length_check" CHECK (char_length(trim("title")) BETWEEN 1 AND 200),
  CONSTRAINT "reader_text_text_length_check" CHECK (char_length(trim("text")) BETWEEN 1 AND 20000)
);

CREATE INDEX "reader_text_user_created_at_idx"
  ON "reader_text" ("user_id", "created_at" DESC, "id" DESC);
