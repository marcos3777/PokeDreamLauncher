alter table public.hunt_performance_records
  add column completed_task_types smallint not null default 0,
  add column rune_bonus_percent smallint not null default 0;

alter table public.hunt_performance_records
  add constraint hunt_performance_completed_task_types check (completed_task_types between 0 and 100),
  add constraint hunt_performance_rune_bonus_percent check (rune_bonus_percent between 0 and 500);

comment on column public.hunt_performance_records.completed_task_types is
  'Number of fully completed elemental task tracks; each completed track grants 1% XP.';
comment on column public.hunt_performance_records.rune_bonus_percent is
  'Reserved XP rune bonus percentage; remains zero until rune detection is implemented.';
comment on column public.hunt_performance_records.base_score is
  'Server-derived XP score after removing VIP, XP potion, completed task-track, and rune multipliers.';

create function public.submit_hunt_performance_v3(
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
  v_sanitized jsonb;
  v_status text;
  v_saved integer;
  v_retry integer;
begin
  if p_records is null or jsonb_typeof(p_records) <> 'array' then
    raise exception using errcode = '22023', message = 'invalid_submission';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_records) as item(value)
    where jsonb_typeof(item.value) <> 'object'
      or not (item.value ?& array['completed_task_types', 'rune_bonus_percent'])
      or jsonb_typeof(item.value -> 'completed_task_types') <> 'number'
      or jsonb_typeof(item.value -> 'rune_bonus_percent') <> 'number'
  ) then
    raise exception using errcode = '22023', message = 'invalid_xp_bonus';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_records) as item(value)
    where (item.value ->> 'completed_task_types')::numeric <> trunc((item.value ->> 'completed_task_types')::numeric)
       or (item.value ->> 'completed_task_types')::numeric not between 0 and 100
       or (item.value ->> 'rune_bonus_percent')::numeric <> trunc((item.value ->> 'rune_bonus_percent')::numeric)
       or (item.value ->> 'rune_bonus_percent')::numeric not between 0 and 500
  ) then
    raise exception using errcode = '22023', message = 'invalid_xp_bonus';
  end if;

  select coalesce(jsonb_agg(item.value - 'completed_task_types' - 'rune_bonus_percent'), '[]'::jsonb)
  into v_sanitized
  from jsonb_array_elements(p_records) as item(value);

  select submission.status, submission.saved, submission.retry_after_seconds
  into v_status, v_saved, v_retry
  from public.submit_hunt_performance_v2(p_client_id, p_token_hash, p_app_version, v_sanitized) as submission;

  if v_status = 'saved' then
    update public.hunt_performance_records as record
    set completed_task_types = (item.value ->> 'completed_task_types')::smallint,
        rune_bonus_percent = (item.value ->> 'rune_bonus_percent')::smallint,
        base_score = case
          when record.metric = 'xp_per_hour' then round(
            record.score::numeric
            / (case when record.vip then 1.2 else 1 end)
            / (case when record.xp_potion then 1.5 else 1 end)
            / (1 + (item.value ->> 'completed_task_types')::numeric / 100)
            / (1 + (item.value ->> 'rune_bonus_percent')::numeric / 100)
          )::bigint
          else record.score
        end,
        updated_at = statement_timestamp()
    from jsonb_array_elements(p_records) as item(value)
    where record.client_id = p_client_id
      and record.account_id = item.value ->> 'account_id'
      and record.hunt_species = item.value ->> 'hunt_species'
      and record.pokemon_species = item.value ->> 'pokemon_species'
      and record.pokemon_shiny = (item.value ->> 'pokemon_shiny')::boolean
      and record.metric = item.value ->> 'metric'
      and record.achieved_at = to_timestamp((item.value ->> 'achieved_at')::numeric / 1000);
  end if;

  return query select v_status, v_saved, v_retry;
end;
$$;

revoke all privileges on function public.submit_hunt_performance_v3(uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_hunt_performance_v3(uuid, text, text, jsonb) to service_role;

create function public.get_hunt_performance_leaderboard_v3(p_hunt_species text)
returns table (
  rank bigint,
  hunt_species text,
  metric text,
  score bigint,
  trainer_name text,
  pokemon_species text,
  pokemon_shiny boolean,
  pokemon_level smallint,
  vip boolean,
  xp_potion boolean,
  completed_task_types smallint,
  rune_bonus_percent smallint,
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
      record.trainer_name,
      record.pokemon_species,
      record.pokemon_shiny,
      record.pokemon_level,
      record.vip,
      record.xp_potion,
      record.completed_task_types,
      record.rune_bonus_percent,
      (extract(epoch from record.achieved_at) * 1000)::bigint as achieved_at
    from public.hunt_performance_records as record
    join public.community_clients as client using (client_id)
    where record.hunt_species = p_hunt_species
      and record.trainer_name is not null
      and client.accepted_submissions >= 2
  )
  select ranked.rank, ranked.hunt_species, ranked.metric, ranked.score, ranked.trainer_name,
    ranked.pokemon_species, ranked.pokemon_shiny, ranked.pokemon_level, ranked.vip,
    ranked.xp_potion, ranked.completed_task_types, ranked.rune_bonus_percent, ranked.achieved_at
  from ranked
  where ranked.rank <= 3
  order by ranked.metric, ranked.rank;
$$;

revoke all privileges on function public.get_hunt_performance_leaderboard_v3(text)
  from public, anon, authenticated;
grant execute on function public.get_hunt_performance_leaderboard_v3(text) to service_role;

create or replace function public.get_pokemon_hub(p_species text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with catalog as (
    select allowed.species, allowed.dex_number
    from public.community_species as allowed
    where allowed.species = p_species
  ), capture as (
    select to_jsonb(stats) as value
    from public.get_species_stats_precise(p_species) as stats
  ), performance as (
    select leaderboard.*
    from public.get_hunt_performance_leaderboard_v3(p_species) as leaderboard
  )
  select jsonb_build_object(
    'species', catalog.species,
    'dex_number', catalog.dex_number,
    'capture', (select capture.value from capture),
    'performance', jsonb_build_object(
      'xp_per_hour', coalesce((
        select jsonb_agg(to_jsonb(row_data) order by row_data.rank)
        from performance as row_data
        where row_data.metric = 'xp_per_hour'
      ), '[]'::jsonb),
      'mobs_per_hour', coalesce((
        select jsonb_agg(to_jsonb(row_data) order by row_data.rank)
        from performance as row_data
        where row_data.metric = 'mobs_per_hour'
      ), '[]'::jsonb)
    )
  )
  from catalog;
$$;

revoke all privileges on function public.get_pokemon_hub(text)
  from public, anon, authenticated;
grant execute on function public.get_pokemon_hub(text) to service_role;

comment on function public.get_pokemon_hub_catalog() is
  'Compact Pokedex read model; XP/h is normalized to base_score without VIP, potion, completed task-track, or rune multipliers.';
