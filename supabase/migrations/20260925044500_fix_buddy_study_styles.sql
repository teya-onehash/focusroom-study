-- Keep study-buddy style values stable between the UI and RPC. Normalize the
-- labels sent by older cached clients so their posts no longer fail validation.

alter table public.focus_buddy_posts
  drop constraint if exists focus_buddy_posts_study_mode_check;

alter table public.focus_buddy_posts
  add constraint focus_buddy_posts_study_mode_check
  check (study_mode in ('quiet', 'check-ins', 'pomodoro', 'discussion', 'flexible'));

create or replace function public.create_focus_buddy_post(
  p_title text,
  p_body text,
  p_subject text,
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
  clean_subject text := btrim(coalesce(p_subject, ''));
  clean_timezone text := btrim(coalesce(p_timezone, ''));
  clean_mode text := lower(btrim(coalesce(p_study_mode, '')));
  new_id uuid;
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  if char_length(clean_title) < 4 or char_length(clean_title) > 100 then
    raise exception 'Title must contain 4 to 100 characters';
  end if;
  if char_length(clean_body) < 10 or char_length(clean_body) > 1200 then
    raise exception 'Post must contain 10 to 1200 characters';
  end if;
  if char_length(clean_subject) > 80 or char_length(clean_timezone) > 60 then
    raise exception 'Subject or timezone is too long';
  end if;

  clean_mode := case clean_mode
    when 'quiet body doubling' then 'quiet'
    when 'short check-ins' then 'check-ins'
    when 'pomodoro blocks' then 'pomodoro'
    else clean_mode
  end;
  if clean_mode not in ('quiet', 'check-ins', 'pomodoro', 'discussion', 'flexible') then
    raise exception 'Choose a valid study style';
  end if;

  if (
    select count(*)
    from public.focus_buddy_posts b
    where b.author_id = caller_id and b.active and b.expires_at > now()
  ) >= 2 then
    raise exception 'Close an existing buddy post before creating another';
  end if;

  insert into public.focus_buddy_posts (
    author_id, title, body, subject, timezone, study_mode
  ) values (
    caller_id, clean_title, clean_body, clean_subject, clean_timezone, clean_mode
  )
  returning focus_buddy_posts.id into new_id;
  return new_id;
end;
$$;

revoke all on function public.create_focus_buddy_post(text, text, text, text, text)
  from public, anon;
grant execute on function public.create_focus_buddy_post(text, text, text, text, text)
  to authenticated;

notify pgrst, 'reload schema';
