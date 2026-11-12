-- Durable cancellations also cover reviews whose background POST has not arrived.
-- Keep these after content deletion so reversed activity cannot become credit again.
CREATE TABLE study_review_undo (
  review_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  study_card_id uuid NOT NULL,
  session_id uuid NOT NULL,
  exposure_id uuid NOT NULL UNIQUE,
  replacement_exposure_id uuid NOT NULL UNIQUE,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 4),
  reviewed_at timestamptz NOT NULL,
  undone_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX study_review_undo_user_session_idx ON study_review_undo(user_id, session_id);
