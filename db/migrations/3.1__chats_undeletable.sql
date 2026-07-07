-- 3.1: Add is_undeletable flag to chats
-- Chats marked is_undeletable=true cannot be deleted (e.g. system admin chat)
ALTER TABLE public.chats
  ADD COLUMN IF NOT EXISTS is_undeletable boolean NOT NULL DEFAULT false;
