DROP TABLE IF EXISTS post_images CASCADE;

CREATE TABLE IF NOT EXISTS post_images (
  id SERIAL PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  -- files.id has been INTEGER since 1.6; UUID made a pristine database fail
  -- before any BMS migration could run.
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
