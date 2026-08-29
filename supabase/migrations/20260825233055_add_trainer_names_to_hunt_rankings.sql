alter table public.hunt_performance_records
  add column trainer_name text;

alter table public.hunt_performance_records
  add constraint hunt_performance_trainer_name check (
    trainer_name is null
    or (
      trainer_name = btrim(trainer_name)
      and char_length(trainer_name) between 1 and 40
      and trainer_name !~ '[[:cntrl:]]'
    )
  );

comment on column public.hunt_performance_records.trainer_name is
  'Public in-game trainer name shown with eligible leaderboard records; null belongs to legacy anonymous submissions.';
comment on column public.hunt_performance_records.account_id is
  'Installation-scoped HMAC used for ownership and deduplication; the raw character ID is never stored.';
comment on table public.hunt_performance_records is
  'Best validated result per installation account, hunt, Pokemon variant, and metric; trainer_name is the public ranking label.';

create function public.submit_hunt_performance_v2(
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
      or not (item.value ? 'trainer_name')
      or (
        (item.value -> 'trainer_name') <> 'null'::jsonb
        and (
          jsonb_typeof(item.value -> 'trainer_name') <> 'string'
          or (item.value ->> 'trainer_name') <> btrim(item.value ->> 'trainer_name')
          or char_length(item.value ->> 'trainer_name') not between 1 and 40
          or (item.value ->> 'trainer_name') ~ '[[:cntrl:]]'
        )
      )
  ) then
    raise exception using errcode = '22023', message = 'invalid_trainer_name';
  end if;

  select coalesce(jsonb_agg(item.value - 'trainer_name'), '[]'::jsonb)
  into v_sanitized
  from jsonb_array_elements(p_records) as item(value);

  select submission.status, submission.saved, submission.retry_after_seconds
  into v_status, v_saved, v_retry
  from public.submit_hunt_performance(p_client_id, p_token_hash, p_app_version, v_sanitized) as submission;

  if v_status = 'saved' then
    update public.hunt_performance_records as record
    set trainer_name = item.value ->> 'trainer_name',
        updated_at = statement_timestamp()
    from jsonb_array_elements(p_records) as item(value)
    where (item.value -> 'trainer_name') <> 'null'::jsonb
      and record.client_id = p_client_id
      and record.account_id = item.value ->> 'account_id'
      and record.hunt_species = item.value ->> 'hunt_species'
      and record.pokemon_species = item.value ->> 'pokemon_species'
      and record.pokemon_shiny = (item.value ->> 'pokemon_shiny')::boolean
      and record.metric = item.value ->> 'metric';
  end if;

  return query select v_status, v_saved, v_retry;
end;
$$;

revoke all privileges on function public.submit_hunt_performance_v2(uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_hunt_performance_v2(uuid, text, text, jsonb) to service_role;

create function public.get_hunt_performance_leaderboard_v2(p_hunt_species text)
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
      (extract(epoch from record.achieved_at) * 1000)::bigint as achieved_at
    from public.hunt_performance_records as record
    join public.community_clients as client using (client_id)
    where record.hunt_species = p_hunt_species
      and record.trainer_name is not null
      and client.accepted_submissions >= 2
  )
  select ranked.rank, ranked.hunt_species, ranked.metric, ranked.score, ranked.trainer_name,
    ranked.pokemon_species, ranked.pokemon_shiny, ranked.pokemon_level, ranked.vip,
    ranked.xp_potion, ranked.achieved_at
  from ranked
  where ranked.rank <= 3
  order by ranked.metric, ranked.rank;
$$;

revoke all privileges on function public.get_hunt_performance_leaderboard_v2(text)
  from public, anon, authenticated;
grant execute on function public.get_hunt_performance_leaderboard_v2(text) to service_role;
