CREATE TABLE IF NOT EXISTS crowd_cache (
  place_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS summer_event_searches (
  outing_id TEXT NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
  search_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (outing_id, search_key)
);

CREATE INDEX IF NOT EXISTS summer_event_searches_outing_created_idx
  ON summer_event_searches(outing_id, created_at DESC);
