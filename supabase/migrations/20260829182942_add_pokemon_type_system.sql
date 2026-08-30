-- Static type reference data for PokéData. The tables remain private and are
-- intended to be read through the launcher's server-side Supabase functions.
create table public.types (
  code text primary key,
  name_pt text not null unique,
  sort_order smallint not null unique,
  constraint types_code_format
    check (code ~ '^[a-z][a-z0-9_]{1,31}$'),
  constraint types_name_pt_format
    check (btrim(name_pt) <> '' and char_length(name_pt) <= 32),
  constraint types_sort_order_range
    check (sort_order between 1 and 18)
);

comment on table public.types is
  'The 18 combat types, identified by stable language-independent codes.';
comment on column public.types.code is
  'Stable lowercase code used by the launcher, such as grass, poison, or fighting.';
comment on column public.types.name_pt is
  'Portuguese display name; combat rules never depend on this translated label.';

create table public.community_species_types (
  species text not null
    references public.community_species(species) on delete cascade,
  type_code text not null
    references public.types(code) on delete restrict,
  slot smallint not null,
  primary key (species, slot),
  constraint community_species_types_slot
    check (slot in (1, 2)),
  constraint community_species_types_species_type_unique
    unique (species, type_code)
);

comment on table public.community_species_types is
  'Complete defensive typing for each canonical species, with at most two ordered types.';
comment on column public.community_species_types.slot is
  'Type position: 1 for the first type and 2 for the optional second type.';

-- This is deliberately nullable until the species/type seed supplied in the
-- next step has been loaded and validated for complete coverage.
alter table public.community_species
  add column attack_type_code text;

comment on column public.community_species.attack_type_code is
  'Type used when the Pokemon attacks without a specific move; it must be one of the species types.';

-- The composite key guarantees that attack_type_code is not merely a valid
-- global type: it must belong to this exact species. Null values are accepted
-- temporarily while the reference data is being prepared.
alter table public.community_species
  add constraint community_species_attack_type_member_fkey
  foreign key (species, attack_type_code)
  references public.community_species_types(species, type_code)
  deferrable initially deferred;

create table public.type_matchups (
  attack_type_code text not null
    references public.types(code) on delete restrict,
  defense_type_code text not null
    references public.types(code) on delete restrict,
  relation text not null,
  primary key (attack_type_code, defense_type_code),
  constraint type_matchups_relation
    check (relation in ('super_effective', 'neutral', 'resisted', 'immune'))
);

comment on table public.type_matchups is
  'Base attack-type versus one defensive type relation; dual-type multipliers are calculated by the launcher.';
comment on column public.type_matchups.relation is
  'Base relation only: super_effective, neutral, resisted, or immune.';

-- PostgreSQL does not automatically index the non-leading side of foreign keys.
create index community_species_types_type_code_idx
  on public.community_species_types(type_code);
create index community_species_attack_type_code_idx
  on public.community_species(attack_type_code)
  where attack_type_code is not null;
create index type_matchups_defense_type_code_idx
  on public.type_matchups(defense_type_code);

alter table public.types enable row level security;
alter table public.types force row level security;
alter table public.community_species_types enable row level security;
alter table public.community_species_types force row level security;
alter table public.type_matchups enable row level security;
alter table public.type_matchups force row level security;

revoke all privileges on table public.types from public, anon, authenticated;
revoke all privileges on table public.community_species_types from public, anon, authenticated;
revoke all privileges on table public.type_matchups from public, anon, authenticated;

grant select on table public.types to service_role;
grant select on table public.community_species_types to service_role;
grant select on table public.type_matchups to service_role;
