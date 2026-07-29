ALTER TABLE participants ADD COLUMN anonymous_user_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS participants_outing_anonymous_idx
  ON participants(outing_id, anonymous_user_hash)
  WHERE anonymous_user_hash IS NOT NULL;
