alter table public.community_species
  drop constraint community_species_attack_type_member_fkey;

alter table public.community_species
  add constraint community_species_attack_type_fkey
  foreign key (attack_type_code)
  references public.types(code)
  on delete restrict
  deferrable initially deferred;

comment on column public.community_species.attack_type_code is
  'Type used by this Pokemon when attacking; it is independent from its defensive type slots.';

drop index public.community_species_attack_type_member_idx;

create index community_species_attack_type_code_idx
  on public.community_species(attack_type_code);

create temporary table hunt_attack_types_seed (
  species text primary key,
  attack_type_code text not null
) on commit drop;

insert into hunt_attack_types_seed (species, attack_type_code)
values
  ('Abra', 'psychic'),
  ('Aerodactyl', 'rock'),
  ('Aipom', 'normal'),
  ('Alakazam', 'psychic'),
  ('Ampharos', 'electric'),
  ('Arbok', 'poison'),
  ('Arcanine', 'fire'),
  ('Ariados', 'bug'),
  ('Azumarill', 'water'),
  ('Bayleef', 'grass'),
  ('Beedrill', 'bug'),
  ('Bellossom', 'grass'),
  ('Bellsprout', 'grass'),
  ('Blastoise', 'water'),
  ('Blissey', 'normal'),
  ('Bulbasaur', 'grass'),
  ('Butterfree', 'bug'),
  ('Caterpie', 'bug'),
  ('Chansey', 'normal'),
  ('Charizard', 'fire'),
  ('Charmander', 'fire'),
  ('Charmeleon', 'fire'),
  ('Chikorita', 'grass'),
  ('Chinchou', 'water'),
  ('Clefable', 'fairy'),
  ('Clefairy', 'fairy'),
  ('Cleffa', 'fairy'),
  ('Cloyster', 'ice'),
  ('Corsola', 'water'),
  ('Crobat', 'poison'),
  ('Croconaw', 'water'),
  ('Cubone', 'ground'),
  ('Cyndaquil', 'fire'),
  ('Delibird', 'ice'),
  ('Dewgong', 'ice'),
  ('Diglett', 'ground'),
  ('Dodrio', 'flying'),
  ('Doduo', 'flying'),
  ('Donphan', 'ground'),
  ('Dragonair', 'dragon'),
  ('Dragonite', 'dragon'),
  ('Dratini', 'dragon'),
  ('Drowzee', 'psychic'),
  ('Dugtrio', 'ground'),
  ('Dunsparce', 'normal'),
  ('Eevee', 'normal'),
  ('Ekans', 'poison'),
  ('Electabuzz', 'electric'),
  ('Electrode', 'electric'),
  ('Elekid', 'electric'),
  ('Espeon', 'psychic'),
  ('Exeggcute', 'grass'),
  ('Exeggutor', 'grass'),
  ('Farfetchd', 'flying'),
  ('Fearow', 'flying'),
  ('Feraligatr', 'water'),
  ('Flaaffy', 'electric'),
  ('Flareon', 'fire'),
  ('Forretress', 'steel'),
  ('Furret', 'normal'),
  ('Gastly', 'ghost'),
  ('Gengar', 'ghost'),
  ('Geodude', 'rock'),
  ('Girafarig', 'normal'),
  ('Gligar', 'ground'),
  ('Gloom', 'grass'),
  ('Golbat', 'poison'),
  ('Goldeen', 'water'),
  ('Golduck', 'water'),
  ('Golem', 'rock'),
  ('Granbull', 'fairy'),
  ('Graveler', 'rock'),
  ('Grimer', 'poison'),
  ('Growlithe', 'fire'),
  ('Gyarados', 'water'),
  ('Haunter', 'ghost'),
  ('Heracross', 'bug'),
  ('Hitmonchan', 'fighting'),
  ('Hitmonlee', 'fighting'),
  ('Hitmontop', 'fighting'),
  ('Hoothoot', 'flying'),
  ('Hoppip', 'grass'),
  ('Horsea', 'water'),
  ('Houndoom', 'dark'),
  ('Houndour', 'dark'),
  ('Hypno', 'psychic'),
  ('Igglybuff', 'normal'),
  ('Ivysaur', 'grass'),
  ('Jigglypuff', 'normal'),
  ('Jolteon', 'electric'),
  ('Jumpluff', 'grass'),
  ('Jynx', 'ice'),
  ('Kabuto', 'rock'),
  ('Kabutops', 'rock'),
  ('Kadabra', 'psychic'),
  ('Kakuna', 'bug'),
  ('Kangaskhan', 'normal'),
  ('Kingdra', 'water'),
  ('Kingler', 'water'),
  ('Koffing', 'poison'),
  ('Krabby', 'water'),
  ('Lanturn', 'water'),
  ('Lapras', 'ice'),
  ('Larvitar', 'rock'),
  ('Ledian', 'bug'),
  ('Ledyba', 'bug'),
  ('Lickitung', 'normal'),
  ('Machamp', 'fighting'),
  ('Machoke', 'fighting'),
  ('Machop', 'fighting'),
  ('Magby', 'fire'),
  ('Magcargo', 'fire'),
  ('Magikarp', 'water'),
  ('Magmar', 'fire'),
  ('Magnemite', 'steel'),
  ('Magneton', 'steel'),
  ('Mankey', 'fighting'),
  ('Mantine', 'water'),
  ('Mareep', 'electric'),
  ('Marill', 'water'),
  ('Marowak', 'ground'),
  ('Meganium', 'grass'),
  ('Meowth', 'normal'),
  ('Metapod', 'bug'),
  ('Miltank', 'normal'),
  ('Misdreavus', 'ghost'),
  ('MrMime', 'fairy'),
  ('Muk', 'poison'),
  ('Murkrow', 'dark'),
  ('Natu', 'psychic'),
  ('Nidoking', 'poison'),
  ('Nidoqueen', 'ground'),
  ('NidoranF', 'poison'),
  ('NidoranM', 'poison'),
  ('Nidorina', 'poison'),
  ('Nidorino', 'poison'),
  ('Ninetales', 'fire'),
  ('Noctowl', 'flying'),
  ('Octillery', 'water'),
  ('Oddish', 'grass'),
  ('Omanyte', 'rock'),
  ('Omastar', 'rock'),
  ('Onix', 'ground'),
  ('Paras', 'bug'),
  ('Parasect', 'bug'),
  ('Persian', 'normal'),
  ('Phanpy', 'ground'),
  ('Pichu', 'electric'),
  ('Pidgeot', 'flying'),
  ('Pidgeotto', 'flying'),
  ('Pidgey', 'flying'),
  ('Pikachu', 'electric'),
  ('Piloswine', 'ice'),
  ('Pineco', 'bug'),
  ('Pinsir', 'bug'),
  ('Politoed', 'water'),
  ('Poliwag', 'water'),
  ('Poliwhirl', 'water'),
  ('Poliwrath', 'fighting'),
  ('Ponyta', 'fire'),
  ('Porygon', 'normal'),
  ('Porygon2', 'normal'),
  ('Primeape', 'fighting'),
  ('Psyduck', 'water'),
  ('Pupitar', 'rock'),
  ('Quagsire', 'water'),
  ('Quilava', 'fire'),
  ('Qwilfish', 'water'),
  ('Raichu', 'electric'),
  ('Rapidash', 'fire'),
  ('Raticate', 'normal'),
  ('Rattata', 'normal'),
  ('Remoraid', 'water'),
  ('Rhydon', 'ground'),
  ('Rhyhorn', 'ground'),
  ('Sandshrew', 'ground'),
  ('Sandslash', 'ground'),
  ('Scizor', 'steel'),
  ('Scyther', 'bug'),
  ('Seadra', 'water'),
  ('Seaking', 'water'),
  ('Seel', 'ice'),
  ('Sentret', 'normal'),
  ('Shellder', 'ice'),
  ('Shuckle', 'bug'),
  ('Skarmory', 'flying'),
  ('Skiploom', 'grass'),
  ('Slowbro', 'psychic'),
  ('Slowking', 'water'),
  ('Slowpoke', 'psychic'),
  ('Slugma', 'fire'),
  ('Smoochum', 'ice'),
  ('Sneasel', 'dark'),
  ('Snorlax', 'normal'),
  ('Snubbull', 'fairy'),
  ('Spearow', 'flying'),
  ('Spinarak', 'bug'),
  ('Squirtle', 'water'),
  ('Stantler', 'normal'),
  ('Starmie', 'water'),
  ('Staryu', 'water'),
  ('Steelix', 'ground'),
  ('Sudowoodo', 'rock'),
  ('Sunflora', 'grass'),
  ('Sunkern', 'grass'),
  ('Swinub', 'ice'),
  ('Tangela', 'grass'),
  ('Tauros', 'normal'),
  ('Teddiursa', 'normal'),
  ('Tentacool', 'water'),
  ('Tentacruel', 'poison'),
  ('Togepi', 'fairy'),
  ('Togetic', 'flying'),
  ('Totodile', 'water'),
  ('Typhlosion', 'fire'),
  ('Tyranitar', 'rock'),
  ('Tyrogue', 'fighting'),
  ('Umbreon', 'dark'),
  ('Ursaring', 'normal'),
  ('Vaporeon', 'water'),
  ('Venomoth', 'bug'),
  ('Venonat', 'bug'),
  ('Venusaur', 'grass'),
  ('Victreebel', 'grass'),
  ('Vileplume', 'grass'),
  ('Voltorb', 'electric'),
  ('Vulpix', 'fire'),
  ('Wartortle', 'water'),
  ('Weedle', 'bug'),
  ('Weepinbell', 'grass'),
  ('Weezing', 'poison'),
  ('Wigglytuff', 'fairy'),
  ('Wobbuffet', 'psychic'),
  ('Wooper', 'water'),
  ('Xatu', 'psychic'),
  ('Yanma', 'bug'),
  ('Zubat', 'poison');

do $$
begin
  if (select count(*) from hunt_attack_types_seed) <> 237 then
    raise exception 'Expected 237 unique hunt attack mappings';
  end if;

  if exists (
    select 1
    from hunt_attack_types_seed seed
    left join public.community_species pokemon using (species)
    where pokemon.species is null
  ) then
    raise exception 'A hunt attack mapping references an unknown Pokemon';
  end if;

  if exists (
    select 1
    from hunt_attack_types_seed seed
    left join public.types type_ref on type_ref.code = seed.attack_type_code
    where type_ref.code is null
  ) then
    raise exception 'A hunt attack mapping references an unknown type';
  end if;
end
$$;
update public.community_species pokemon
set attack_type_code = seed.attack_type_code
from hunt_attack_types_seed seed
where pokemon.species = seed.species
  and pokemon.attack_type_code is distinct from seed.attack_type_code;

do $$
begin
  if exists (
    select 1
    from hunt_attack_types_seed seed
    join public.community_species pokemon using (species)
    where pokemon.attack_type_code is distinct from seed.attack_type_code
  ) then
    raise exception 'Hunt attack types were not fully synchronized';
  end if;
end
$$;
