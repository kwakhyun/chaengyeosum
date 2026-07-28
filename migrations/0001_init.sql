PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS outings (
  id TEXT PRIMARY KEY,
  invite_code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  place_id TEXT NOT NULL,
  place_name TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  starts_at TEXT NOT NULL,
  activity_type TEXT NOT NULL DEFAULT 'picnic',
  expected_people INTEGER NOT NULL DEFAULT 2,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  outing_id TEXT NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  avatar_key TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  joined_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS participants_outing_idx
  ON participants(outing_id);

CREATE TABLE IF NOT EXISTS checklist_items (
  id TEXT PRIMARY KEY,
  outing_id TEXT NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  label TEXT NOT NULL,
  image TEXT NOT NULL,
  owner_id TEXT REFERENCES participants(id) ON DELETE SET NULL,
  done INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS checklist_outing_idx
  ON checklist_items(outing_id, sort_order);

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  outing_id TEXT NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
  participant_id TEXT REFERENCES participants(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  item_label TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS activity_events_outing_idx
  ON activity_events(outing_id, created_at DESC);

CREATE TABLE IF NOT EXISTS weather_cache (
  outing_id TEXT PRIMARY KEY REFERENCES outings(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS event_reactions (
  event_id TEXT NOT NULL REFERENCES activity_events(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  reaction_type TEXT NOT NULL CHECK (reaction_type IN ('heart', 'cheer')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id, participant_id)
);

CREATE INDEX IF NOT EXISTS event_reactions_event_idx
  ON event_reactions(event_id);
