-- Anonymous personal bests for the two hunt leaderboards. Player names and raw character IDs
-- never enter this table; account_id is the existing installation-scoped HMAC.
alter table public.community_clients
  add column if not exists last_performance_at timestamptz;

create table public.hunt_performance_records (
  client_id uuid not null references public.community_clients(client_id) on delete cascade,
  account_id text not null,
  hunt_species text not null references public.community_species(species),
  pokemon_species text not null references public.community_species(species),
  pokemon_shiny boolean not null,
  pokemon_level smallint,
  metric text not null,
  score bigint not null,
  base_score bigint not null,
  xp_gained bigint not null,
  xp_elapsed_ms bigint not null,
  kills bigint not null,
  hunt_elapsed_ms bigint not null,
  vip boolean not null,
  xp_potion boolean not null,
  app_version text not null,
  achieved_at timestamptz not null,
  updated_at timestamptz not null default statement_timestamp(),
  primary key (client_id, account_id, hunt_species, pokemon_species, pokemon_shiny, metric),
  constraint hunt_performance_account_format check (account_id ~ '^[0-9a-f]{64}$'),
  constraint hunt_performance_metric check (metric in ('xp_per_hour', 'mobs_per_hour')),
  constraint hunt_performance_level check (pokemon_level is null or pokemon_level between 1 and 1000),
  constraint hunt_performance_score check (score between 1 and 100000000 and base_score between 1 and 100000000),
  constraint hunt_performance_samples check (
    xp_gained between 0 and 1000000000000
    and xp_elapsed_ms between 0 and 604800000
    and kills between 0 and 1000000000
    and hunt_elapsed_ms between 0 and 604800000
    and (
      (metric = 'xp_per_hour' and xp_gained > 0 and xp_elapsed_ms >= 600000)
      or (metric = 'mobs_per_hour' and kills > 0 and hunt_elapsed_ms >= 600000)
    )
  ),
  constraint hunt_performance_app_version check (app_version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$')
);

comment on table public.hunt_performance_records is
  'Best validated result per anonymous installation account, hunt, Pokemon variant, and metric.';
comment on column public.hunt_performance_records.account_id is
  'Installation-scoped HMAC; neither player name nor raw character ID is stored.';
comment on column public.hunt_performance_records.base_score is
  'Server-derived score after removing the whitelisted VIP 20% and XP potion 50% multipliers.';

create index hunt_performance_top_idx
  on public.hunt_performance_records (hunt_species, metric, score desc, achieved_at asc);

alter table public.hunt_performance_records enable row level security;
alter table public.hunt_performance_records force row level security;
revoke all privileges on table public.hunt_performance_records from public, anon, authenticated;
grant select, insert, update, delete on table public.hunt_performance_records to service_role;

create function public.submit_hunt_performance(
  p_client_id uuid,
  p_token_hash text,
  p_app_version text,
  p_records jsonb
)
returns table (status text, saved integer, retry_after_seconds integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_client public.community_clients%rowtype;
  v_entry jsonb;
  v_now timestamptz := statement_timestamp();
  v_count integer;
  v_saved integer := 0;
  v_rows integer;
  v_account_id text;
  v_hunt text;
  v_pokemon text;
  v_metric text;
  v_level numeric;
  v_xp numeric;
  v_xp_ms numeric;
  v_kills numeric;
  v_hunt_ms numeric;
  v_achieved_ms numeric;
  v_vip boolean;
  v_potion boolean;
  v_score bigint;
  v_base_score bigint;
  v_retry integer;
  v_required_keys constant text[] := array[
    'account_id', 'hunt_species', 'pokemon_species', 'pokemon_shiny', 'pokemon_level',
    'metric', 'xp_gained', 'xp_elapsed_ms', 'kills', 'hunt_elapsed_ms',
    'vip', 'xp_potion', 'achieved_at'
  ];
begin
  if p_client_id is null
     or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_app_version is null or p_app_version !~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$'
     or p_records is null or jsonb_typeof(p_records) <> 'array' then
    raise exception using errcode = '22023', message = 'invalid_submission';
  end if;

  v_count := jsonb_array_length(p_records);
  if v_count > 1000 then
    raise exception using errcode = '22023', message = 'too_many_records';
  end if;

  select client.* into v_client
  from public.community_clients as client
  where client.client_id = p_client_id
  for update;
  if not found or v_client.token_hash <> p_token_hash then
    raise exception using errcode = '28000', message = 'invalid_client_token';
  end if;

  if v_client.last_performance_at is not null
     and v_now < v_client.last_performance_at + interval '5 minutes' then
    v_retry := greatest(1, ceil(extract(epoch from (v_client.last_performance_at + interval '5 minutes' - v_now)))::integer);
    return query select 'rate_limited'::text, 0, v_retry;
    return;
  end if;

  for v_entry in select value from jsonb_array_elements(p_records)
  loop
    if jsonb_typeof(v_entry) <> 'object'
       or not (v_entry ?& v_required_keys)
       or (v_entry - v_required_keys) <> '{}'::jsonb
       or jsonb_typeof(v_entry -> 'account_id') <> 'string'
       or jsonb_typeof(v_entry -> 'hunt_species') <> 'string'
       or jsonb_typeof(v_entry -> 'pokemon_species') <> 'string'
       or jsonb_typeof(v_entry -> 'pokemon_shiny') <> 'boolean'
       or ((v_entry -> 'pokemon_level') <> 'null'::jsonb and jsonb_typeof(v_entry -> 'pokemon_level') <> 'number')
       or jsonb_typeof(v_entry -> 'metric') <> 'string'
       or jsonb_typeof(v_entry -> 'xp_gained') <> 'number'
       or jsonb_typeof(v_entry -> 'xp_elapsed_ms') <> 'number'
       or jsonb_typeof(v_entry -> 'kills') <> 'number'
       or jsonb_typeof(v_entry -> 'hunt_elapsed_ms') <> 'number'
       or jsonb_typeof(v_entry -> 'vip') <> 'boolean'
       or jsonb_typeof(v_entry -> 'xp_potion') <> 'boolean'
       or jsonb_typeof(v_entry -> 'achieved_at') <> 'number' then
      raise exception using errcode = '22023', message = 'invalid_record_shape';
    end if;

    v_account_id := v_entry ->> 'account_id';
    v_hunt := v_entry ->> 'hunt_species';
    v_pokemon := v_entry ->> 'pokemon_species';
    v_metric := v_entry ->> 'metric';
    v_level := (v_entry ->> 'pokemon_level')::numeric;
    v_xp := (v_entry ->> 'xp_gained')::numeric;
    v_xp_ms := (v_entry ->> 'xp_elapsed_ms')::numeric;
    v_kills := (v_entry ->> 'kills')::numeric;
    v_hunt_ms := (v_entry ->> 'hunt_elapsed_ms')::numeric;
    v_achieved_ms := (v_entry ->> 'achieved_at')::numeric;
    v_vip := (v_entry ->> 'vip')::boolean;
    v_potion := (v_entry ->> 'xp_potion')::boolean;

    if v_account_id !~ '^[0-9a-f]{64}$'
       or v_hunt !~ '^[A-Z][A-Za-z0-9]{0,31}$'
       or v_pokemon !~ '^[A-Z][A-Za-z0-9]{0,31}$'
       or v_metric not in ('xp_per_hour', 'mobs_per_hour')
       or (v_level is not null and (v_level <> trunc(v_level) or v_level < 1 or v_level > 1000))
       or v_xp <> trunc(v_xp) or v_xp < 0 or v_xp > 1000000000000
       or v_xp_ms <> trunc(v_xp_ms) or v_xp_ms < 0 or v_xp_ms > 604800000
       or v_kills <> trunc(v_kills) or v_kills < 0 or v_kills > 1000000000
       or v_hunt_ms <> trunc(v_hunt_ms) or v_hunt_ms < 0 or v_hunt_ms > 604800000
       or v_achieved_ms <> trunc(v_achieved_ms)
       or v_achieved_ms < extract(epoch from (v_now - interval '180 days')) * 1000
       or v_achieved_ms > extract(epoch from (v_now + interval '10 minutes')) * 1000 then
      raise exception using errcode = '22023', message = 'invalid_record';
    end if;

    if not exists (
      select 1 from public.hunt_stats as stats
      where stats.client_id = p_client_id and stats.account_id = v_account_id and stats.species = v_hunt
    ) or not exists (
      select 1 from public.community_species as allowed where allowed.species = v_pokemon
    ) then
      raise exception using errcode = '22023', message = 'unknown_record_owner_or_species';
    end if;

    if v_metric = 'xp_per_hour' then
      if v_xp <= 0 or v_xp_ms < 600000 then
        raise exception using errcode = '22023', message = 'short_xp_sample';
      end if;
      v_score := round(v_xp * 3600000 / v_xp_ms)::bigint;
      v_base_score := round(v_score::numeric
        / (case when v_vip then 1.2 else 1 end)
        / (case when v_potion then 1.5 else 1 end))::bigint;
    else
      if v_kills <= 0 or v_hunt_ms < 600000 then
        raise exception using errcode = '22023', message = 'short_mob_sample';
      end if;
      v_score := round(v_kills * 3600000 / v_hunt_ms)::bigint;
      v_base_score := v_score;
    end if;
    if v_score < 1 or v_score > 100000000 or v_base_score < 1 or v_base_score > 100000000 then
      raise exception using errcode = '22023', message = 'implausible_score';
    end if;

    insert into public.hunt_performance_records (
      client_id, account_id, hunt_species, pokemon_species, pokemon_shiny, pokemon_level,
      metric, score, base_score, xp_gained, xp_elapsed_ms, kills, hunt_elapsed_ms,
      vip, xp_potion, app_version, achieved_at, updated_at
    ) values (
      p_client_id, v_account_id, v_hunt, v_pokemon, (v_entry ->> 'pokemon_shiny')::boolean,
      v_level::smallint, v_metric, v_score, v_base_score, v_xp::bigint, v_xp_ms::bigint,
      v_kills::bigint, v_hunt_ms::bigint, v_vip, v_potion, p_app_version,
      to_timestamp(v_achieved_ms / 1000), v_now
    )
    on conflict (client_id, account_id, hunt_species, pokemon_species, pokemon_shiny, metric)
    do update set
      pokemon_level = excluded.pokemon_level,
      score = excluded.score,
      base_score = excluded.base_score,
      xp_gained = excluded.xp_gained,
      xp_elapsed_ms = excluded.xp_elapsed_ms,
      kills = excluded.kills,
      hunt_elapsed_ms = excluded.hunt_elapsed_ms,
      vip = excluded.vip,
      xp_potion = excluded.xp_potion,
      app_version = excluded.app_version,
      achieved_at = excluded.achieved_at,
      updated_at = excluded.updated_at
    where excluded.score > public.hunt_performance_records.score;
    get diagnostics v_rows = row_count;
    v_saved := v_saved + v_rows;
  end loop;

  update public.community_clients
  set last_performance_at = v_now, updated_at = v_now
  where client_id = p_client_id;

  return query select 'saved'::text, v_saved, 0;
end;
$$;

revoke all privileges on function public.submit_hunt_performance(uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_hunt_performance(uuid, text, text, jsonb) to service_role;

create function public.get_hunt_performance_leaderboard(p_hunt_species text)
returns table (
  rank bigint,
  hunt_species text,
  metric text,
  score bigint,
  pokemon_species text,
  pokemon_shiny boolean,
  pokemon_level smallint,
  vip boolean,
  xp_potion boolean,
  achieved_at bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with ranked as (
    select
      row_number() over (
        partition by record.metric
        order by record.score desc, record.achieved_at asc, record.client_id, record.account_id,
          record.pokemon_species, record.pokemon_shiny
      ) as rank,
      record.hunt_species,
      record.metric,
      record.score,
      record.pokemon_species,
      record.pokemon_shiny,
      record.pokemon_level,
      record.vip,
      record.xp_potion,
      (extract(epoch from record.achieved_at) * 1000)::bigint as achieved_at
    from public.hunt_performance_records as record
    join public.community_clients as client using (client_id)
    where record.hunt_species = p_hunt_species
      and client.accepted_submissions >= 2
  )
  select ranked.rank, ranked.hunt_species, ranked.metric, ranked.score, ranked.pokemon_species,
    ranked.pokemon_shiny, ranked.pokemon_level, ranked.vip, ranked.xp_potion, ranked.achieved_at
  from ranked
  where ranked.rank <= 3
  order by ranked.metric, ranked.rank;
$$;

revoke all privileges on function public.get_hunt_performance_leaderboard(text)
  from public, anon, authenticated;
grant execute on function public.get_hunt_performance_leaderboard(text) to service_role;
