-- Authoritative Stripe subscription sync. Only the service role can invoke the
-- write function; signed-in members retain read-only access to their own row.

alter table public.subscriptions
  add column if not exists stripe_event_created timestamptz,
  add column if not exists stripe_event_id text;

alter table public.subscriptions
  drop constraint if exists subscriptions_status_check;

alter table public.subscriptions
  add constraint subscriptions_status_check
  check (status in (
    'incomplete',
    'incomplete_expired',
    'trialing',
    'active',
    'past_due',
    'canceled',
    'unpaid',
    'paused'
  ));

create index if not exists subscriptions_status_period_end_idx
  on public.subscriptions (status, current_period_end);

create or replace function public.sync_stripe_subscription(
  p_user_id uuid,
  p_tier text,
  p_billing_interval text,
  p_status text,
  p_customer_id text,
  p_subscription_id text,
  p_price_id text,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_event_created timestamptz,
  p_event_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_rows integer;
begin
  if p_user_id is null
     or p_tier not in ('basic', 'premium', 'buddy')
     or p_billing_interval not in ('week', 'month', 'year')
     or p_status not in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')
     or nullif(trim(p_customer_id), '') is null
     or nullif(trim(p_subscription_id), '') is null
     or nullif(trim(p_price_id), '') is null
     or p_event_created is null
     or nullif(trim(p_event_id), '') is null then
    raise exception 'Invalid Stripe subscription payload';
  end if;

  insert into public.subscriptions (
    user_id,
    tier,
    billing_interval,
    status,
    stripe_customer_id,
    stripe_subscription_id,
    stripe_price_id,
    current_period_end,
    cancel_at_period_end,
    stripe_event_created,
    stripe_event_id,
    updated_at
  ) values (
    p_user_id,
    p_tier,
    p_billing_interval,
    p_status,
    trim(p_customer_id),
    trim(p_subscription_id),
    trim(p_price_id),
    p_current_period_end,
    coalesce(p_cancel_at_period_end, false),
    p_event_created,
    trim(p_event_id),
    now()
  )
  on conflict (user_id) do update set
    tier = excluded.tier,
    billing_interval = excluded.billing_interval,
    status = excluded.status,
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    stripe_price_id = excluded.stripe_price_id,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    stripe_event_created = excluded.stripe_event_created,
    stripe_event_id = excluded.stripe_event_id,
    updated_at = now()
  where public.subscriptions.stripe_event_created is null
     or public.subscriptions.stripe_event_created <= excluded.stripe_event_created;

  get diagnostics changed_rows = row_count;
  return changed_rows > 0;
end;
$$;

revoke all on function public.sync_stripe_subscription(uuid, text, text, text, text, text, text, timestamptz, boolean, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.sync_stripe_subscription(uuid, text, text, text, text, text, text, timestamptz, boolean, timestamptz, text)
  to service_role;

comment on function public.sync_stripe_subscription(uuid, text, text, text, text, text, text, timestamptz, boolean, timestamptz, text)
  is 'Upserts a Stripe-verified subscription without allowing older webhook events to overwrite newer state.';
