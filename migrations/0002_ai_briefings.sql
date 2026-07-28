CREATE TABLE IF NOT EXISTS ai_briefings (
  outing_id TEXT NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
  state_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (outing_id, state_hash)
);

CREATE INDEX IF NOT EXISTS ai_briefings_outing_created_idx
  ON ai_briefings(outing_id, created_at DESC);
