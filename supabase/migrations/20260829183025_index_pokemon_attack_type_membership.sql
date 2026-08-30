drop index public.community_species_attack_type_code_idx;

create index community_species_attack_type_member_idx
  on public.community_species(species, attack_type_code);
