-- Leave existing accounts unset so their browser language is detected once.
ALTER TABLE "user_preference" ADD COLUMN "ui_locale" text;
--> statement-breakpoint
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_ui_locale_check"
  CHECK ("ui_locale" IN ('en', 'ru'));
