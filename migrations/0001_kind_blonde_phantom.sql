-- Drop existing tables if they exist
DROP TABLE IF EXISTS "word_set_item" CASCADE;
DROP TABLE IF EXISTS "word_set" CASCADE;

-- Create word_set table
CREATE TABLE "word_set" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source_lang" text NOT NULL,
	"target_lang" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_exported_at" timestamp with time zone
);
--> statement-breakpoint

-- Create word_set_item table with Anki fields
CREATE TABLE "word_set_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"word_set_id" uuid NOT NULL,
	"anki_note_guid" text NOT NULL,
	"original" text NOT NULL,
	"translation" text NOT NULL,
	"word_forms" text DEFAULT '' NOT NULL,
	"sample" text DEFAULT '' NOT NULL,
	"sample_translation" text DEFAULT '' NOT NULL,
	"comments" text DEFAULT '' NOT NULL,
	"tags" text DEFAULT '' NOT NULL,
	"source_translation_id" uuid,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Add foreign key constraints
ALTER TABLE "word_set" ADD CONSTRAINT "word_set_user_id_app_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "word_set_item" ADD CONSTRAINT "word_set_item_word_set_id_word_set_id_fk"
  FOREIGN KEY ("word_set_id") REFERENCES "public"."word_set"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- Create indexes
CREATE INDEX "word_set_user_id_idx" ON "word_set" USING btree ("user_id");
--> statement-breakpoint

CREATE INDEX "word_set_item_set_id_position_idx" ON "word_set_item" USING btree ("word_set_id","position");
--> statement-breakpoint

CREATE INDEX "word_set_item_guid_idx" ON "word_set_item" USING btree ("anki_note_guid");