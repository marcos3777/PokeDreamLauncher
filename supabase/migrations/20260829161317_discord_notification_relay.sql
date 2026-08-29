create table public.discord_notification_limits (
  scope text not null,
  scope_key text not null,
  window_started_at timestamptz not null default statement_timestamp(),
  event_count integer not null default 0,
  updated_at timestamptz not null default statement_timestamp(),

  primary key (scope, scope_key),
  constraint discord_notification_limits_scope
    check (scope in ('client', 'source')),
  constraint discord_notification_limits_key
    check (scope_key ~ '^[A-Za-z0-9:_-]{1,128}$'),
  constraint discord_notification_limits_count
    check (event_count between 0 and 1000000)
);

comment on table public.discord_notification_limits is
  'Server-only rolling limits for Discord notification relay calls.';

alter table public.discord_notification_limits enable row level security;
alter table public.discord_notification_limits force row level security;
revoke all privileges on table public.discord_notification_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.discord_notification_limits to service_role;

create function public.authorize_discord_notification(
  p_client_id uuid,
  p_token_hash text,
  p_source_hash text
)
returns table (status text, retry_after_seconds integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_client public.community_clients%rowtype;
  v_now timestamptz := statement_timestamp();
  v_window constant interval := interval '10 minutes';
  v_client_started timestamptz;
  v_client_count integer;
  v_source_started timestamptz;
  v_source_count integer;
  v_retry integer;
begin
  if p_client_id is null
     or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_source_hash is null or p_source_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_notification_identity';
  end if;

  select client.* into v_client
  from public.community_clients as client
  where client.client_id = p_client_id;

  if not found or v_client.token_hash <> p_token_hash then
    raise exception using errcode = '28000', message = 'invalid_client_token';
  end if;

  insert into public.discord_notification_limits (scope, scope_key)
  values
    ('client', p_client_id::text),
    ('source', p_source_hash)
  on conflict (scope, scope_key) do nothing;

  perform 1
  from public.discord_notification_limits as limits
  where (limits.scope = 'client' and limits.scope_key = p_client_id::text)
     or (limits.scope = 'source' and limits.scope_key = p_source_hash)
  order by limits.scope, limits.scope_key
  for update;

  select limits.window_started_at, limits.event_count
  into v_client_started, v_client_count
  from public.discord_notification_limits as limits
  where limits.scope = 'client' and limits.scope_key = p_client_id::text;

  select limits.window_started_at, limits.event_count
  into v_source_started, v_source_count
  from public.discord_notification_limits as limits
  where limits.scope = 'source' and limits.scope_key = p_source_hash;

  if v_now >= v_client_started + v_window then
    v_client_started := v_now;
    v_client_count := 0;
  end if;
  if v_now >= v_source_started + v_window then
    v_source_started := v_now;
    v_source_count := 0;
  end if;

  if v_client_count >= 30 or v_source_count >= 60 then
    v_retry := greatest(
      1,
      ceil(extract(epoch from least(v_client_started + v_window, v_source_started + v_window) - v_now))::integer
    );
    return query select 'rate_limited'::text, v_retry;
    return;
  end if;

  update public.discord_notification_limits as limits
  set window_started_at = v_client_started,
      event_count = v_client_count + 1,
      updated_at = v_now
  where limits.scope = 'client' and limits.scope_key = p_client_id::text;

  update public.discord_notification_limits as limits
  set window_started_at = v_source_started,
      event_count = v_source_count + 1,
      updated_at = v_now
  where limits.scope = 'source' and limits.scope_key = p_source_hash;

  return query select 'allowed'::text, 0;
end;
$$;

revoke all on function public.authorize_discord_notification(uuid, text, text) from public, anon, authenticated;
grant execute on function public.authorize_discord_notification(uuid, text, text) to service_role;
