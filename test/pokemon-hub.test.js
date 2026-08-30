'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildPokemonCatalog, buildPokemonHub, pokemonLoot, pokemonTasks } = require('../pokemon-hub');

test('hub relaciona task, loot, captura e recordes pela espécie canônica', () => {
  const huntLog = {
    MrMime: {
      kills: 800, caught: 8, shinies: 4, shinyCaught: 1, thrownA: 20, thrownB: 100,
      captureDryBalls: 17, dryBalls: 30, dryKills: 40,
      accounts: { account: { seen:4, caught:1, streak:0, brokeMax:4, brokeMin:4, brokeTotal:4, brokeCount:1 } },
    },
  };
  const huntPerformance = { data: { MrMime: {
    xpPerHour: { xpPerHour:123456, pokemon:{ species:'Alakazam', level:80, shiny:false } },
  } } };
  const hub = buildPokemonHub('MrMime', {
    huntLog,
    huntPerformance,
    itemSources:{ psychic_vest:['MrMime'], fairy_dust:['Clefable'] },
  });

  assert.equal(hub.taskLevel, 70);
  assert.equal(hub.tasks[0].trackLabel, 'Fada');
  assert.deepEqual(hub.loot, ['psychic_vest']);
  assert.equal(hub.capture.local.captureDryBalls, 17);
  assert.equal(hub.capture.local.shinyBroke.brokeAvg, 4);
  assert.equal(hub.performance.local.xpPerHour.xpPerHour, 123456);
});

test('catálogo prioriza o recorde pessoal e usa a comunidade como fallback', () => {
  const rows = buildPokemonCatalog({
    huntPerformance:{ data:{ Abra:{ xpPerHour:{ xpPerHour:180000, xpBuffs:{ vip:0.2, xpPotion:0.5 } } } } },
    remoteRows:[
      { species:'Abra', performance:{ xpPerHour:180000, mobsPerHour:500 } },
      { species:'Geodude', performance:{ xpPerHour:90000, mobsPerHour:400 } },
    ],
  });
  const abra = rows.find((row) => row.species === 'Abra');
  const geodude = rows.find((row) => row.species === 'Geodude');
  assert.equal(abra.bestXpPerHour, 100000);
  assert.equal(abra.bestXpSource, 'local');
  assert.equal(abra.bestMobsPerHour, 500);
  assert.equal(abra.bestMobsSource, 'community');
  assert.equal(geodude.bestXpPerHour, 90000);
});

test('aliases de task e fontes de loot convergem para o nome da Pokédex', () => {
  assert.equal(pokemonTasks('Farfetchd')[0].trackLabel, 'Voador');
  assert.deepEqual(pokemonLoot('Farfetchd', { leek:["Farfetch'd"] }), ['leek']);
});

test('read model do banco permanece privado e é servido por uma única Edge Function', () => {
  const root = path.join(__dirname, '..');
  const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260826040142_pokemon_hub.sql'), 'utf8');
  const normalizedXpMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260826151635_normalize_pokedex_xp.sql'), 'utf8');
  const taskBonusMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260829030524_add_task_xp_bonus_to_hunt_performance.sql'), 'utf8');
  const edge = fs.readFileSync(path.join(root, 'supabase', 'functions', 'pokemon-hub', 'index.ts'), 'utf8');
  const config = fs.readFileSync(path.join(root, 'supabase', 'config.toml'), 'utf8');
  assert.match(migration, /create function public\.get_pokemon_hub_catalog\(\)/i);
  assert.match(migration, /create function public\.get_pokemon_hub\(p_species text\)/i);
  assert.match(migration, /revoke all privileges on function public\.get_pokemon_hub_catalog\(\)[\s\S]*?from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.get_pokemon_hub\(text\) to service_role/i);
  assert.match(normalizedXpMigration, /record\.metric = 'xp_per_hour' then record\.base_score/i);
  assert.match(normalizedXpMigration, /revoke all privileges on function public\.get_pokemon_hub_catalog\(\)/i);
  assert.match(taskBonusMigration, /get_hunt_performance_leaderboard_v3\(p_species\)/i);
  assert.match(taskBonusMigration, /completed_task_types smallint not null default 0/i);
  assert.match(edge, /rpc\("get_pokemon_hub_catalog"\)/);
  assert.match(edge, /rpc\("get_pokemon_hub"/);
  assert.match(edge, /from\("types"\)\.select\("code,name_pt,sort_order"\)/);
  assert.match(edge, /from\("community_species_types"\)\.select\("species,type_code,slot"\)/);
  assert.match(edge, /from\("type_matchups"\)\.select\("attack_type_code,defense_type_code,relation"\)/);
  assert.match(edge, /combat:\s*\{[\s\S]*species_types:/);
  assert.match(config, /\[functions\.pokemon-hub\][\s\S]*?verify_jwt = false/);
});

test('PokéData prioriza espécies informadas e expõe o hub persistente', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.html'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  assert.match(app, /class="dex-mini xp"[\s\S]*?>XP\/h</);
  assert.match(app, /XP\/h base: não considera VIP, Poção, Tasks nem Runa/);
  assert.doesNotMatch(app, /dex-tag caught/);
  assert.doesNotMatch(app, /row\.lootCount[\s\S]{0,120}drops/);
  assert.match(app, /Broke normal/);
  assert.match(app, /Broke shiny · comunidade/);
  assert.match(app, /function dexCommunityBroke\(capture\)/);
  assert.match(app, /média comunitária de shinies até capturar/);
  assert.match(app, /nenhuma captura shiny na amostra/);
  assert.match(app, /Broke shiny <b>/);
  assert.match(app, /communityBrokeAvg != null \? huntDec\(communityBrokeAvg,1\) : '--'/);
  assert.doesNotMatch(app, /aparece ≈ 1\//);
  assert.match(app, />PokéData</);
  assert.match(app, /function dexHasInfo\(row\)/);
  assert.match(app, /hasInfo\?' has-info'/);
  assert.match(app, /Espécies com dados locais ou da comunidade/);
  assert.ok(app.indexOf('id="btn-dex"') < app.indexOf('id="btn-box"'), 'PokéData deve ser a primeira ferramenta');
  assert.doesNotMatch(app, /id="dex-summary"|id="dex-missing"|>capturados<|>faltando</);
  assert.match(app, /Drops observados/);
  assert.match(app, /getPokedexHubCatalog/);
  assert.match(app, /Meu Pokémon[\s\S]*id="dex-attacker"/);
  assert.match(app, /id="dex-combat-xp"[\s\S]*Dano \+ XP\/h/);
  assert.match(app, /id="dex-group-level"[\s\S]*Separar por nível/);
  assert.match(app, /Ataca: ['"]?\+esc\(dexTypeName\(combat\.attackType\)\)/);
  assert.match(app, /DEX_COMBAT\.groupByTaskLevel/);
  assert.match(app, /DEX_COMBAT\.effectivenessFor/);
  assert.match(preload, /getPokemonHub: \(species\) => ipcRenderer\.invoke\('getPokemonHub', species\)/);
});
