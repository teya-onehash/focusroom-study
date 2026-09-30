-- Extend the existing study-buddy posts into a lightweight, major-based
-- study forum. Existing posts remain valid as group posts; new interactions
-- stay behind authenticated RPCs so blocking and profile privacy are enforced
-- consistently.

alter table public.focus_buddy_posts
  add column if not exists post_kind text not null default 'group',
  add column if not exists topic text not null default '',
  add column if not exists solved boolean not null default false;

alter table public.focus_buddy_posts
  drop constraint if exists focus_buddy_posts_post_kind_check;

alter table public.focus_buddy_posts
  add constraint focus_buddy_posts_post_kind_check
  check (post_kind in ('group', 'question', 'tip'));

alter table public.focus_buddy_posts
  drop constraint if exists focus_buddy_posts_topic_check;

alter table public.focus_buddy_posts
  add constraint focus_buddy_posts_topic_check
  check (char_length(topic) <= 80);

create index if not exists focus_buddy_posts_active_kind_created_idx
  on public.focus_buddy_posts (post_kind, created_at desc)
  where active;

create index if not exists focus_buddy_posts_subject_created_idx
  on public.focus_buddy_posts (subject, created_at desc)
  where active;

create table if not exists public.study_post_votes (
  post_id uuid not null references public.focus_buddy_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists study_post_votes_user_created_idx
  on public.study_post_votes (user_id, created_at desc);

create table if not exists public.study_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.focus_buddy_posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 2 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists study_post_comments_post_created_idx
  on public.study_post_comments (post_id, created_at);

create index if not exists study_post_comments_author_created_idx
  on public.study_post_comments (author_id, created_at desc);

create table if not exists public.study_group_members (
  post_id uuid not null references public.focus_buddy_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists study_group_members_user_created_idx
  on public.study_group_members (user_id, created_at desc);

alter table public.study_post_votes enable row level security;
alter table public.study_post_comments enable row level security;
alter table public.study_group_members enable row level security;

revoke all on table public.study_post_votes from public, anon, authenticated;
revoke all on table public.study_post_comments from public, anon, authenticated;
revoke all on table public.study_group_members from public, anon, authenticated;

create or replace function private.can_view_study_post(
  check_post_id uuid,
  check_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select check_user_id is not null and exists (
    select 1
    from public.focus_buddy_posts b
    join public.profiles p on p.id = b.author_id
    where b.id = check_post_id
      and (
        b.author_id = check_user_id
        or (b.active and b.expires_at > now() and p.show_profile)
      )
      and not exists (
        select 1
        from public.user_blocks x
        where (x.blocker_id = check_user_id and x.blocked_id = b.author_id)
           or (x.blocker_id = b.author_id and x.blocked_id = check_user_id)
      )
  );
$$;

revoke all on function private.can_view_study_post(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.create_study_group_post(
  p_title text,
  p_body text,
  p_major text,
  p_topic text,
  p_post_kind text,
  p_timezone text,
  p_study_mode text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  clean_title text := btrim(coalesce(p_title, ''));
  clean_body text := btrim(coalesce(p_body, ''));
  clean_major text := btrim(coalesce(p_major, ''));
  clean_topic text := btrim(coalesce(p_topic, ''));
  clean_kind text := lower(btrim(coalesce(p_post_kind, 'group')));
  clean_timezone text := btrim(coalesce(p_timezone, ''));
  clean_mode text := lower(btrim(coalesce(p_study_mode, 'flexible')));
  new_id uuid;
begin
  if caller_id is null then raise exception 'Authentication required'; end if;

  if char_length(clean_title) < 4 or char_length(clean_title) > 100 then
    raise exception 'Title must contain 4 to 100 characters';
  end if;
  if char_length(clean_body) < 10 or char_length(clean_body) > 1200 then
    raise exception 'Post must contain 10 to 1200 characters';
  end if;
  if char_length(clean_major) > 80 or char_length(clean_topic) > 80
     or char_length(clean_timezone) > 60 then
    raise exception 'Major, topic, or timezone is too long';
  end if;
  if clean_kind not in ('group', 'question', 'tip') then
    raise exception 'Choose a valid post type';
  end if;

  if clean_major = '' then
    select btrim(coalesce(p.subject, ''))
    into clean_major
    from public.profiles p
    where p.id = caller_id;
  end if;
  if clean_major = '' then clean_major := 'General studies'; end if;

  clean_mode := case clean_mode
    when 'quiet body doubling' then 'quiet'
    when 'short check-ins' then 'check-ins'
    when 'pomodoro blocks' then 'pomodoro'
    else clean_mode
  end;
  if clean_mode not in ('quiet', 'check-ins', 'pomodoro', 'discussion', 'flexible') then
    raise exception 'Choose a valid study style';
  end if;

  if clean_kind <> 'group' then
    clean_timezone := '';
    clean_mode := 'discussion';
  end if;

  if (
    select count(*)
    from public.focus_buddy_posts b
    where b.author_id = caller_id and b.created_at > now() - interval '1 hour'
  ) >= 5 then
    raise exception 'You can publish up to 5 study posts per hour';
  end if;

  if (
    select count(*)
    from public.focus_buddy_posts b
    where b.author_id = caller_id and b.active and b.expires_at > now()
  ) >= 20 then
    raise exception 'Close an older study post before creating another';
  end if;

  insert into public.focus_buddy_posts (
    author_id, title, body, subject, topic, post_kind, timezone,
    study_mode, solved, expires_at
  ) values (
    caller_id, clean_title, clean_body, clean_major, clean_topic, clean_kind,
    clean_timezone, clean_mode, false,
    now() + case when clean_kind = 'group' then interval '45 days' else interval '180 days' end
  )
  returning id into new_id;

  if clean_kind = 'group' then
    insert into public.study_group_members (post_id, user_id)
    values (new_id, caller_id)
    on conflict do nothing;
  end if;

  return new_id;
end;
$$;

create or replace function public.list_study_group_posts(
  p_major text default '',
  p_topic text default '',
  p_sort text default 'for-you',
  p_limit integer default 60
)
returns table (
  id uuid,
  author_id uuid,
  title text,
  body text,
  major text,
  topic text,
  post_kind text,
  timezone text,
  study_mode text,
  solved boolean,
  created_at timestamptz,
  author_display_name text,
  author_avatar_color text,
  author_avatar_path text,
  author_profile_frame text,
  author_profile_sticker text,
  votes_count bigint,
  comments_count bigint,
  members_count bigint,
  viewer_voted boolean,
  viewer_joined boolean,
  is_own boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  safe_major text := btrim(coalesce(p_major, ''));
  safe_topic text := btrim(coalesce(p_topic, ''));
  safe_sort text := lower(btrim(coalesce(p_sort, 'for-you')));
  viewer_major text := '';
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  if safe_sort not in ('for-you', 'new', 'top', 'unanswered') then safe_sort := 'for-you'; end if;

  select btrim(coalesce(p.subject, ''))
  into viewer_major
  from public.profiles p
  where p.id = caller_id;

  return query
  select b.id, b.author_id, b.title, b.body, b.subject, b.topic, b.post_kind,
         b.timezone, b.study_mode, b.solved, b.created_at,
         p.display_name, p.avatar_color, p.avatar_path,
         p.profile_frame, p.profile_sticker,
         stats.votes_count, stats.comments_count, stats.members_count,
         stats.viewer_voted, stats.viewer_joined,
         b.author_id = caller_id
  from public.focus_buddy_posts b
  join public.profiles p on p.id = b.author_id
  cross join lateral (
    select
      (select count(*) from public.study_post_votes v where v.post_id = b.id) as votes_count,
      (select count(*) from public.study_post_comments c where c.post_id = b.id) as comments_count,
      (select count(*) from public.study_group_members m where m.post_id = b.id) as members_count,
      exists(select 1 from public.study_post_votes v where v.post_id = b.id and v.user_id = caller_id) as viewer_voted,
      exists(select 1 from public.study_group_members m where m.post_id = b.id and m.user_id = caller_id) as viewer_joined
  ) stats
  where b.active and b.expires_at > now()
    and (p.show_profile or b.author_id = caller_id)
    and (safe_major = '' or b.subject ilike '%' || safe_major || '%')
    and (safe_topic = '' or b.topic ilike '%' || safe_topic || '%' or b.title ilike '%' || safe_topic || '%')
    and (safe_sort <> 'unanswered' or (b.post_kind = 'question' and not b.solved))
    and not exists (
      select 1 from public.user_blocks x
      where (x.blocker_id = caller_id and x.blocked_id = b.author_id)
         or (x.blocker_id = b.author_id and x.blocked_id = caller_id)
    )
  order by
    case when safe_sort = 'for-you' then
      case
        when viewer_major <> '' and lower(b.subject) = lower(viewer_major) then 3
        when viewer_major <> '' and (b.subject ilike '%' || viewer_major || '%' or viewer_major ilike '%' || b.subject || '%') then 2
        else 1
      end
    end desc,
    case when safe_sort in ('for-you', 'top') then stats.votes_count end desc,
    case when safe_sort = 'top' then stats.comments_count end desc,
    b.created_at desc
  limit least(greatest(coalesce(p_limit, 60), 1), 100);
end;
$$;

create or replace function public.toggle_study_post_vote(p_post_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare caller_id uuid := (select auth.uid());
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  if not private.can_view_study_post(p_post_id, caller_id) then
    raise exception 'Study post not found';
  end if;

  delete from public.study_post_votes
  where post_id = p_post_id and user_id = caller_id;
  if found then return false; end if;

  insert into public.study_post_votes (post_id, user_id)
  values (p_post_id, caller_id)
  on conflict do nothing;
  return true;
end;
$$;

create or replace function public.toggle_study_group_membership(p_post_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare caller_id uuid := (select auth.uid());
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  if not private.can_view_study_post(p_post_id, caller_id)
     or not exists (
       select 1 from public.focus_buddy_posts b
       where b.id = p_post_id and b.post_kind = 'group' and b.active and b.expires_at > now()
     ) then
    raise exception 'Study group not found';
  end if;

  delete from public.study_group_members
  where post_id = p_post_id and user_id = caller_id;
  if found then return false; end if;

  insert into public.study_group_members (post_id, user_id)
  values (p_post_id, caller_id)
  on conflict do nothing;
  return true;
end;
$$;

create or replace function public.list_study_post_comments(
  p_post_id uuid,
  p_limit integer default 100
)
returns table (
  id uuid,
  post_id uuid,
  author_id uuid,
  body text,
  created_at timestamptz,
  author_display_name text,
  author_avatar_color text,
  author_avatar_path text,
  author_profile_frame text,
  author_profile_sticker text,
  is_own boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare caller_id uuid := (select auth.uid());
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  if not private.can_view_study_post(p_post_id, caller_id) then
    raise exception 'Study post not found';
  end if;

  return query
  select recent_comments.id, recent_comments.post_id, recent_comments.author_id,
         recent_comments.body, recent_comments.created_at,
         recent_comments.display_name, recent_comments.avatar_color,
         recent_comments.avatar_path, recent_comments.profile_frame,
         recent_comments.profile_sticker,
         recent_comments.author_id = caller_id
  from (
    select c.id, c.post_id, c.author_id, c.body, c.created_at,
           p.display_name, p.avatar_color, p.avatar_path,
           p.profile_frame, p.profile_sticker
    from public.study_post_comments c
    join public.profiles p on p.id = c.author_id
    where c.post_id = p_post_id
      and (p.show_profile or c.author_id = caller_id)
      and not exists (
        select 1 from public.user_blocks x
        where (x.blocker_id = caller_id and x.blocked_id = c.author_id)
           or (x.blocker_id = c.author_id and x.blocked_id = caller_id)
      )
    order by c.created_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 200)
  ) recent_comments
  order by recent_comments.created_at;
end;
$$;

create or replace function public.create_study_post_comment(
  p_post_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  clean_body text := btrim(coalesce(p_body, ''));
  new_id uuid;
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  if not private.can_view_study_post(p_post_id, caller_id) then
    raise exception 'Study post not found';
  end if;
  if char_length(clean_body) < 2 or char_length(clean_body) > 1000 then
    raise exception 'Reply must contain 2 to 1000 characters';
  end if;
  if (
    select count(*) from public.study_post_comments c
    where c.author_id = caller_id and c.created_at > now() - interval '5 minutes'
  ) >= 12 then
    raise exception 'Please wait before posting more replies';
  end if;

  insert into public.study_post_comments (post_id, author_id, body)
  values (p_post_id, caller_id, clean_body)
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.delete_study_post_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare caller_id uuid := (select auth.uid());
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  delete from public.study_post_comments c
  where c.id = p_comment_id
    and (c.author_id = caller_id or private.is_admin(caller_id));
  if not found then raise exception 'Reply not found'; end if;
end;
$$;

create or replace function public.set_study_question_solved(
  p_post_id uuid,
  p_solved boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare caller_id uuid := (select auth.uid());
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  update public.focus_buddy_posts b
  set solved = coalesce(p_solved, false), updated_at = now()
  where b.id = p_post_id and b.author_id = caller_id and b.post_kind = 'question';
  if not found then raise exception 'Question not found'; end if;
end;
$$;

revoke all on function public.create_study_group_post(text, text, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.list_study_group_posts(text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.toggle_study_post_vote(uuid)
  from public, anon, authenticated;
revoke all on function public.toggle_study_group_membership(uuid)
  from public, anon, authenticated;
revoke all on function public.list_study_post_comments(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.create_study_post_comment(uuid, text)
  from public, anon, authenticated;
revoke all on function public.delete_study_post_comment(uuid)
  from public, anon, authenticated;
revoke all on function public.set_study_question_solved(uuid, boolean)
  from public, anon, authenticated;

grant execute on function public.create_study_group_post(text, text, text, text, text, text, text)
  to authenticated;
grant execute on function public.list_study_group_posts(text, text, text, integer)
  to authenticated;
grant execute on function public.toggle_study_post_vote(uuid)
  to authenticated;
grant execute on function public.toggle_study_group_membership(uuid)
  to authenticated;
grant execute on function public.list_study_post_comments(uuid, integer)
  to authenticated;
grant execute on function public.create_study_post_comment(uuid, text)
  to authenticated;
grant execute on function public.delete_study_post_comment(uuid)
  to authenticated;
grant execute on function public.set_study_question_solved(uuid, boolean)
  to authenticated;

notify pgrst, 'reload schema';
