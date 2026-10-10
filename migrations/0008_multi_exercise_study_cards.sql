-- Backfill identities without changing existing recognition IDs, review events,
-- or scheduling projections. Missing content affects availability, not identity.
INSERT INTO "study_card" ("word_set_item_id", "template_key", "created_at")
SELECT item."id", template."key",
  CASE WHEN template."key" = 'recognition' THEN item."created_at" ELSE now() END
FROM "word_set_item" AS item
CROSS JOIN (VALUES
  ('recognition'),
  ('production'),
  ('word_forms'),
  ('type_answer'),
  ('example')
) AS template("key")
ON CONFLICT ("word_set_item_id", "template_key") DO NOTHING;
