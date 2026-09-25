-- Cover the reaction user foreign key for account cleanup and moderation paths.

create index if not exists dm_message_reactions_user_idx
  on public.dm_message_reactions (user_id, created_at);
