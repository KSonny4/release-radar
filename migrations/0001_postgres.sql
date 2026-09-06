CREATE TABLE IF NOT EXISTS shows (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT, language TEXT,
  genres TEXT NOT NULL DEFAULT '[]', status TEXT, premiered TEXT, ended TEXT,
  official_site TEXT, rating DOUBLE PRECISION, weight INTEGER, network TEXT,
  web_channel TEXT, image_medium TEXT, image_original TEXT, summary TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shows_name ON shows(name);
CREATE INDEX IF NOT EXISTS idx_shows_premiered ON shows(premiered);
CREATE INDEX IF NOT EXISTS idx_shows_rating ON shows(rating DESC);
CREATE INDEX IF NOT EXISTS idx_shows_status ON shows(status);

CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY, show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  name TEXT, season INTEGER, number INTEGER, airdate TEXT, airtime TEXT,
  airstamp TEXT, runtime INTEGER, rating DOUBLE PRECISION, summary TEXT,
  image_medium TEXT, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_episodes_show_airdate ON episodes(show_id, airdate);
CREATE INDEX IF NOT EXISTS idx_episodes_airdate ON episodes(airdate);

CREATE TABLE IF NOT EXISTS followed_shows (
  show_id INTEGER PRIMARY KEY REFERENCES shows(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS movies (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, original_title TEXT, overview TEXT,
  genres TEXT NOT NULL DEFAULT '[]', release_date TEXT, local_release_date TEXT,
  local_release_type TEXT, rating DOUBLE PRECISION, vote_count INTEGER,
  popularity DOUBLE PRECISION, original_language TEXT, poster_path TEXT,
  backdrop_path TEXT, region TEXT, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_movies_title ON movies(title);
CREATE INDEX IF NOT EXISTS idx_movies_release ON movies(local_release_date, release_date);
CREATE INDEX IF NOT EXISTS idx_movies_rating ON movies(rating DESC);
CREATE INDEX IF NOT EXISTS idx_movies_popularity ON movies(popularity DESC);
CREATE INDEX IF NOT EXISTS idx_movies_votes ON movies(vote_count DESC);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
);
