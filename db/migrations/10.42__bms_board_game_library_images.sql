ALTER TABLE bms_board_game_titles
  ADD COLUMN IF NOT EXISTS image_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL;

COMMENT ON COLUMN bms_board_game_titles.image_file_id IS
  'Public, normalized catalogue image owned by this tenant; shared by all playable copies, never a sale SKU.';
