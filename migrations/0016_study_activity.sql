ALTER TABLE user_preference ADD COLUMN previous_study_time_zone text;
ALTER TABLE user_preference ADD COLUMN previous_study_day_start_at timestamptz;
ALTER TABLE user_preference ADD COLUMN study_time_zone_effective_at timestamptz;

-- Content attribution is a snapshot, not a foreign key: deleting content must
-- never revoke earned effort. Only deleting the account removes activity.
CREATE TABLE study_activity (
  review_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL,
  credited_date date NOT NULL,
  study_time_zone text NOT NULL,
  template_key text NOT NULL,
  study_card_id uuid NOT NULL,
  word_set_item_id uuid NOT NULL,
  word_set_id uuid NOT NULL
);
CREATE INDEX study_activity_user_date_idx ON study_activity(user_id, credited_date);

--> statement-breakpoint
-- Retained native history only. Historical time zones are unavailable; the
-- saved zone at migration time is an explicit approximation. Resolve 02:00
-- itself (rather than subtracting two hours) so DST matches live study days.
INSERT INTO study_activity
  (review_id,user_id,completed_at,credited_date,study_time_zone,template_key,study_card_id,word_set_item_id,word_set_id)
SELECT history.id, history.user_id, history.reviewed_at,
  CASE WHEN history.reviewed_at >= (local_day + time '02:00') AT TIME ZONE zone
    THEN local_day ELSE local_day - 1 END,
  zone, card.template_key, card.id, item.id, owned_set.id
FROM review_event history
JOIN study_card card ON card.id = history.study_card_id
JOIN word_set_item item ON item.id = card.word_set_item_id
JOIN word_set owned_set ON owned_set.id = item.word_set_id AND owned_set.user_id = history.user_id
LEFT JOIN user_preference preference ON preference.user_id = history.user_id
CROSS JOIN LATERAL (SELECT coalesce(preference.study_time_zone, 'UTC') AS zone) settings
CROSS JOIN LATERAL (SELECT (history.reviewed_at AT TIME ZONE zone)::date AS local_day) calendar
WHERE history.source = 'gooseberry'
ON CONFLICT (review_id) DO NOTHING;
