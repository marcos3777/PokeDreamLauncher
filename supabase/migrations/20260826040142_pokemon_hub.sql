-- Read model for the Pokédex. Source tables remain private; only the Edge Function's
-- service role can execute these functions. This keeps capture and performance data
-- linked by the canonical species without exposing raw installation/account rows.
create function public.get_pokemon_hub_catalog()
returns table (
  species text,
  dex_number smallint,
  contributors bigint,
  catch_pct numeric,
  kills_per_shiny numeric,
  broke_avg numeric,
  broke_max numeric,
  broke_min numeric,
  best_xp_per_hour bigint,
  best_mobs_per_hour bigint,
  xp_pokemon_species text,
  xp_pokemon_shiny boolean,
  xp_pokemon_level smallint,
  mobs_pokemon_species text,
  mobs_pokemon_shiny boolean,
  mobs_pokemon_level smallint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with capture_eligible as (
    select
      stats.*,
      least(1::numeric, 10000::numeric / nullif(stats.kills, 0)) as sample_weight
    from public.hunt_stats as stats
    join public.community_clients as client using (client_id)
    where client.accepted_submissions >= 2
  ), capture_totals as (
    select
      eligible.species,
      count(distinct (eligible.client_id, eligible.account_id)) as contributors,
      sum(eligible.kills * eligible.sample_weight) as kills,
      sum(eligible.caught * eligible.sample_weight) as caught,
      sum(eligible.shinies * eligible.sample_weight) as shinies,
      round(
        sum(eligible.broke_sum * eligible.sample_weight)
          / nullif(sum(eligible.broke_count * eligible.sample_weight), 0),
        2
      ) as broke_avg,
      max(eligible.broke_max)::numeric as broke_max,
      (min(eligible.broke_min) filter (where eligible.broke_min is not null))::numeric as broke_min
    from capture_eligible as eligible
    group by eligible.species
  ), capture_summary as (
    select
      totals.species,
      totals.contributors,
      round(totals.caught * 100 / nullif(totals.kills, 0), 2) as catch_pct,
      round(totals.kills / nullif(totals.shinies, 0), 0) as kills_per_shiny,
      totals.broke_avg,
      totals.broke_max,
      totals.broke_min
    from capture_totals as totals
    where totals.kills >= 500
      and totals.contributors >= 1
  ), performance_ranked as (
    select
      record.*,
      row_number() over (
        partition by record.hunt_species, record.metric
        order by record.score desc, record.achieved_at asc, record.client_id, record.account_id,
          record.pokemon_species, record.pokemon_shiny
      ) as metric_rank
    from public.hunt_performance_records as record
    join public.community_clients as client using (client_id)
    where record.trainer_name is not null
      and client.accepted_submissions >= 2
  ), performance_summary as (
    select
      ranked.hunt_species as species,
      max(ranked.score) filter (where ranked.metric = 'xp_per_hour' and ranked.metric_rank = 1) as best_xp_per_hour,
      max(ranked.score) filter (where ranked.metric = 'mobs_per_hour' and ranked.metric_rank = 1) as best_mobs_per_hour,
      max(ranked.pokemon_species) filter (where ranked.metric = 'xp_per_hour' and ranked.metric_rank = 1) as xp_pokemon_species,
      bool_or(ranked.pokemon_shiny) filter (where ranked.metric = 'xp_per_hour' and ranked.metric_rank = 1) as xp_pokemon_shiny,
      max(ranked.pokemon_level) filter (where ranked.metric = 'xp_per_hour' and ranked.metric_rank = 1) as xp_pokemon_level,
      max(ranked.pokemon_species) filter (where ranked.metric = 'mobs_per_hour' and ranked.metric_rank = 1) as mobs_pokemon_species,
      bool_or(ranked.pokemon_shiny) filter (where ranked.metric = 'mobs_per_hour' and ranked.metric_rank = 1) as mobs_pokemon_shiny,
      max(ranked.pokemon_level) filter (where ranked.metric = 'mobs_per_hour' and ranked.metric_rank = 1) as mobs_pokemon_level
    from performance_ranked as ranked
    where ranked.metric_rank = 1
    group by ranked.hunt_species
  )
  select
    catalog.species,
    catalog.dex_number,
    capture.contributors,
    capture.catch_pct,
    capture.kills_per_shiny,
    capture.broke_avg,
    capture.broke_max,
    capture.broke_min,
    performance.best_xp_per_hour,
    performance.best_mobs_per_hour,
    performance.xp_pokemon_species,
    performance.xp_pokemon_shiny,
    performance.xp_pokemon_level,
    performance.mobs_pokemon_species,
    performance.mobs_pokemon_shiny,
    performance.mobs_pokemon_level
  from public.community_species as catalog
  left join capture_summary as capture using (species)
  left join performance_summary as performance using (species)
  order by catalog.dex_number;
$$;

comment on function public.get_pokemon_hub_catalog() is
  'Compact Pokédex read model with trusted capture aggregates and the best hunt performance per species.';

create function public.get_pokemon_hub(p_species text)
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
    from public.get_hunt_performance_leaderboard_v2(p_species) as leaderboard
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

comment on function public.get_pokemon_hub(text) is
  'One canonical species hub: capture sample plus XP/h and mobs/h community records.';

revoke all privileges on function public.get_pokemon_hub_catalog()
  from public, anon, authenticated;
revoke all privileges on function public.get_pokemon_hub(text)
  from public, anon, authenticated;
grant execute on function public.get_pokemon_hub_catalog() to service_role;
grant execute on function public.get_pokemon_hub(text) to service_role;
