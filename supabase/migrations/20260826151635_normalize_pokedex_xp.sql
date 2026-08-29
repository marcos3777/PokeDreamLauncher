-- Pokédex cards compare hunt performance without temporary XP multipliers.
-- XP uses the server-validated base_score; mobs/h is already multiplier-free.
create or replace function public.get_pokemon_hub_catalog()
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
      case when record.metric = 'xp_per_hour' then record.base_score else record.score end as hub_score,
      row_number() over (
        partition by record.hunt_species, record.metric
        order by
          case when record.metric = 'xp_per_hour' then record.base_score else record.score end desc,
          record.achieved_at asc,
          record.client_id,
          record.account_id,
          record.pokemon_species,
          record.pokemon_shiny
      ) as metric_rank
    from public.hunt_performance_records as record
    join public.community_clients as client using (client_id)
    where record.trainer_name is not null
      and client.accepted_submissions >= 2
  ), performance_summary as (
    select
      ranked.hunt_species as species,
      max(ranked.hub_score) filter (where ranked.metric = 'xp_per_hour' and ranked.metric_rank = 1) as best_xp_per_hour,
      max(ranked.hub_score) filter (where ranked.metric = 'mobs_per_hour' and ranked.metric_rank = 1) as best_mobs_per_hour,
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
  'Compact Pokedex read model; XP/h is normalized to base_score without VIP or XP potion multipliers.';

revoke all privileges on function public.get_pokemon_hub_catalog()
  from public, anon, authenticated;
grant execute on function public.get_pokemon_hub_catalog() to service_role;
