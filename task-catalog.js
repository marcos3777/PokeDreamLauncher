'use strict';

const HUNT_OVERRIDES = Object.freeze({
  'Clefable': 'clefabe',
  "Farfetch'd": 'farfetchd',
  'Mr. Mime': 'mrmime',
  'NidoranF': 'nidoran_female',
  'NidoranM': 'nidoran_male',
  'Qwilfish': 'qwillfish',
});

const KILL_ALIASES = Object.freeze({
  NidoranF: Object.freeze(['Nidoran♀']),
  NidoranM: Object.freeze(['Nidoran♂']),
  Qwilfish: Object.freeze(['Qwillfish']),
});

function createTaskLevelMap(groups) {
  const levels = {};
  for (const [level, speciesList] of groups) {
    for (const species of speciesList) {
      if (levels[species]) throw new Error(`Nível duplicado para ${species}`);
      levels[species] = level;
    }
  }
  return Object.freeze(levels);
}

const TASK_LEVEL_BY_SPECIES = createTaskLevelMap([
  [1, [
    'Bellsprout','Caterpie','Geodude','Hoothoot','Hoppip','Magikarp','Oddish','Paras','Pidgey','Poliwag','Rattata',
    'Sunkern','Togepi','Weedle',
  ]],
  [10, [
    'Abra','Bulbasaur','Charmander','Chinchou','Diglett','Doduo','Ekans','Exeggcute','Goldeen','Grimer','Horsea','Kakuna',
    'Koffing','Krabby','Ledyba','Magnemite','Mankey','Metapod','NidoranF','NidoranM','Pineco','Remoraid','Sentret',
    'Shellder','Slowpoke','Slugma','Spearow','Spinarak','Squirtle','Swinub','Tentacool','Voltorb','Zubat',
  ]],
  [20, [
    'Chikorita','Cleffa','Cubone','Cyndaquil','Eevee','Gastly','Houndour','Igglybuff','Kabuto','Machop','Mareep','Marill',
    'Meowth','Omanyte','Phanpy','Pichu','Pidgeotto','Ponyta','Psyduck','Sandshrew','Seel','Staryu','Totodile','Venonat',
    'Vulpix','Wooper',
  ]],
  [30, [
    'Beedrill','Butterfree','Dratini','Drowzee','Dunsparce','Elekid','Gloom','Growlithe','Larvitar','Magby','Natu',
    'Nidorina','Nidorino','Poliwhirl','Raticate','Rhyhorn','Skiploom','Smoochum','Snubbull','Teddiursa','Tyrogue','Weepinbell',
  ]],
  [40, [
    'Aipom','Arbok','Ariados','Bayleef','Charmeleon','Clefairy','Croconaw','Dugtrio','Electrode','Flaaffy','Furret','Gligar',
    'Golbat','Graveler','Ivysaur','Jigglypuff','Ledian','Machoke','Porygon','Quilava','Shuckle','Sunflora','Wartortle',
  ]],
  [50, [
    'Corsola','Delibird',"Farfetch'd",'Fearow','Haunter','Jumpluff','Kadabra','Marowak','Murkrow','Parasect','Persian',
    'Primeape','Qwilfish','Seadra','Seaking','Sneasel','Stantler','Tangela','Yanma',
  ]],
  [60, [
    'Bellossom','Chansey','Cloyster','Dewgong','Dodrio','Hitmonchan','Hitmonlee','Hitmontop','Hypno','Kingler','Lickitung',
    'Noctowl','Octillery','Onix','Pikachu','Politoed','Pupitar','Quagsire','Rapidash','Sandslash','Slowbro','Tauros','Venomoth','Victreebel',
    'Vileplume','Weezing',
  ]],
  [70, [
    'Ampharos','Azumarill','Blastoise','Charizard','Clefable','Crobat','Donphan','Dragonair','Espeon','Feraligatr','Flareon',
    'Forretress','Girafarig','Golduck','Golem','Granbull','Jolteon','Jynx','Kabutops','Kangaskhan','Lanturn','Machamp',
    'Magcargo','Magneton','Meganium','Miltank','Mr. Mime','Muk','Nidoking','Nidoqueen','Omastar','Pidgeot','Piloswine',
    'Poliwrath','Raichu','Rhydon','Starmie','Tentacruel','Togetic','Typhlosion','Umbreon','Vaporeon','Venusaur','Wigglytuff','Xatu',
  ]],
  [80, [
    'Aerodactyl','Alakazam','Arcanine','Dragonite','Electabuzz','Exeggutor','Gengar','Gyarados','Heracross','Houndoom',
    'Kingdra','Lapras','Magmar','Mantine','Misdreavus','Ninetales','Pinsir','Scizor','Scyther','Skarmory','Slowking',
    'Snorlax','Steelix','Sudowoodo','Tyranitar','Ursaring','Wobbuffet',
  ]],
]);

function task(trackId, species, target) {
  const slug = species.toLowerCase().replace(/[^a-z0-9]/g, '');
  const huntId = HUNT_OVERRIDES[species] || species.toLowerCase();
  const aliases = KILL_ALIASES[species] || [];
  return Object.freeze({
    id: `${trackId}_${slug}`,
    species,
    huntId,
    target,
    requiredLevel: TASK_LEVEL_BY_SPECIES[species],
    killSpecies: Object.freeze([species, ...aliases]),
  });
}

function track(id, label, icon, entries) {
  return Object.freeze({ id, label, icon, tasks: Object.freeze(entries.map(([species, target]) => task(id, species, target))) });
}

const TASK_TRACKS = Object.freeze({
  poison: track('poison', 'Veneno', '🧪', [
    ['Ekans',750],['Grimer',750],['Koffing',750],['NidoranF',750],['NidoranM',750],['Tentacool',750],['Zubat',750],
    ['Nidorina',1250],['Nidorino',1250],['Arbok',1500],['Golbat',1500],['Qwilfish',1800],['Weezing',2500],
    ['Crobat',4000],['Muk',4000],['Nidoking',4000],['Tentacruel',4000],
  ]),
  bug: track('bug', 'Inseto', '🐛', [
    ['Caterpie',500],['Paras',500],['Weedle',500],['Kakuna',750],['Ledyba',750],['Metapod',750],['Pineco',750],
    ['Spinarak',750],['Venonat',1000],['Beedrill',1250],['Butterfree',1250],['Ariados',1500],['Ledian',1500],
    ['Shuckle',1500],['Parasect',1800],['Yanma',1800],['Venomoth',2500],['Heracross',5000],['Pinsir',5000],['Scyther',5000],
  ]),
  water: track('water', 'Água', '💧', [
    ['Magikarp',500],['Poliwag',500],['Goldeen',750],['Horsea',750],['Krabby',750],['Shellder',750],['Squirtle',750],
    ['Psyduck',1000],['Seel',1000],['Staryu',1000],['Totodile',1000],['Poliwhirl',1250],['Croconaw',1500],
    ['Wartortle',1500],['Seadra',1800],['Seaking',1800],['Kingler',2500],['Politoed',2500],['Blastoise',4000],
    ['Feraligatr',4000],['Golduck',4000],['Starmie',4000],['Vaporeon',4000],['Kingdra',5000],['Gyarados',5000],
  ]),
  flying: track('flying', 'Voador', '✈', [
    ['Hoothoot',500],['Pidgey',500],['Doduo',750],['Spearow',750],['Pidgeotto',1000],["Farfetch'd",1800],
    ['Fearow',1800],['Dodrio',2500],['Noctowl',2500],['Pidgeot',4000],['Mantine',5000],['Skarmory',5000],
  ]),
  normal: track('normal', 'Normal', '◉', [
    ['Rattata',500],['Sentret',750],['Meowth',1000],['Raticate',1250],['Teddiursa',1250],['Aipom',1500],['Furret',1500],
    ['Persian',1800],['Stantler',1800],['Chansey',2500],['Lickitung',2500],['Tauros',2500],['Girafarig',4000],
    ['Kangaskhan',4000],['Miltank',4000],['Ursaring',5000],['Snorlax',5000],
  ]),
  ground: track('ground', 'Terra', '⛰️', [
    ['Diglett',750],['Cubone',1000],['Phanpy',1000],['Sandshrew',1000],['Wooper',1000],['Rhyhorn',1250],['Dugtrio',1500],
    ['Gligar',1500],['Marowak',1800],['Onix',2500],['Quagsire',2500],['Sandslash',2500],['Donphan',4000],
    ['Nidoqueen',4000],['Rhydon',4000],['Steelix',5000],
  ]),
  grass: track('grass', 'Planta', '🌿', [
    ['Bellsprout',500],['Hoppip',500],['Oddish',500],['Sunkern',500],['Bulbasaur',750],['Exeggcute',750],['Chikorita',1000],
    ['Gloom',1250],['Skiploom',1250],['Weepinbell',1250],['Bayleef',1500],['Ivysaur',1500],['Sunflora',1500],
    ['Jumpluff',1800],['Tangela',1800],['Bellossom',2500],['Victreebel',2500],['Vileplume',2500],
    ['Meganium',4000],['Venusaur',4000],['Exeggutor',5000],
  ]),
  psychic: track('psychic', 'Psíquico', '🔮', [
    ['Abra',750],['Slowpoke',750],['Drowzee',1250],['Natu',1250],['Kadabra',1800],['Hypno',2500],
    ['Slowbro',2500],['Espeon',4000],['Xatu',4000],['Slowking',5000],['Wobbuffet',5000],['Alakazam',5000],
  ]),
  fire: track('fire', 'Fogo', '🔥', [
    ['Charmander',750],['Slugma',750],['Cyndaquil',1000],['Ponyta',1000],['Vulpix',1000],['Growlithe',1250],['Magby',1250],
    ['Charmeleon',1500],['Quilava',1500],['Charizard',4000],['Flareon',4000],['Magcargo',4000],['Rapidash',4000],
    ['Typhlosion',4000],['Arcanine',5000],['Ninetales',5000],['Magmar',5000],
  ]),
  rock: track('rock', 'Pedra', '◆', [
    ['Geodude',500],['Kabuto',1000],['Omanyte',1000],['Larvitar',1250],['Graveler',1500],['Corsola',1800],
    ['Pupitar',2500],['Golem',4000],['Kabutops',4000],['Omastar',4000],['Sudowoodo',5000],['Aerodactyl',5000],['Tyranitar',5000],
  ]),
  electric: track('electric', 'Elétrico', '⚡', [
    ['Chinchou',750],['Voltorb',750],['Mareep',1000],['Pichu',1000],['Elekid',1250],['Electrode',1500],['Flaaffy',1500],
    ['Pikachu',2500],['Ampharos',4000],['Jolteon',4000],['Lanturn',4000],['Raichu',4000],['Electabuzz',5000],
  ]),
  fairy: track('fairy', 'Fada', '✨', [
    ['Togepi',500],['Cleffa',1000],['Igglybuff',1000],['Marill',1000],['Snubbull',1250],['Clefairy',1500],['Jigglypuff',1500],
    ['Azumarill',4000],['Clefable',4000],['Granbull',4000],['Togetic',4000],['Wigglytuff',4000],['Mr. Mime',4000],
  ]),
  fighting: track('fighting', 'Lutador', '🥊', [
    ['Mankey',750],['Machop',1000],['Tyrogue',1250],['Machoke',1500],['Primeape',1800],
    ['Hitmonchan',2500],['Hitmonlee',2500],['Hitmontop',2500],['Machamp',4000],['Poliwrath',4000],
  ]),
  ice: track('ice', 'Gelo', '❄️', [
    ['Swinub',750],['Smoochum',1250],['Delibird',1800],['Cloyster',2500],['Dewgong',2500],['Jynx',4000],['Piloswine',4000],['Lapras',5000],
  ]),
  steel: track('steel', 'Metal', '⚙️', [
    ['Magnemite',750],['Forretress',4000],['Magneton',4000],['Scizor',5000],
  ]),
  dark: track('dark', 'Sombrio', '🌑', [
    ['Houndour',1000],['Murkrow',1800],['Sneasel',1800],['Umbreon',4000],['Houndoom',5000],
  ]),
  ghost: track('ghost', 'Fantasma', '👻', [
    ['Gastly',1000],['Haunter',1800],['Gengar',5000],['Misdreavus',5000],
  ]),
  dragon: track('dragon', 'Dragão', '🐉', [
    ['Dratini',1250],['Dragonair',4000],['Dragonite',5000],
  ]),
});

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

function normalizedTaskRecord(record, id) {
  const source = record && typeof record === 'object' ? record : {};
  const hasShortProgress = Object.prototype.hasOwnProperty.call(source, 'p');
  const hasProgress = hasShortProgress || Object.prototype.hasOwnProperty.call(source, 'progress');
  const rawProgress = hasShortProgress ? source.p : source.progress;
  const rawCompleted = Object.prototype.hasOwnProperty.call(source, 'c') ? source.c : source.completed;
  return {
    id,
    progress: hasProgress && rawProgress != null ? numberOr(rawProgress, null) : null,
    completed: numberOr(rawCompleted, 0),
  };
}

function taskMapFromState(value) {
  const result = {};
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!entry || typeof entry.id !== 'string' || !entry.id) continue;
      result[entry.id] = normalizedTaskRecord(entry, entry.id);
    }
    return result;
  }
  if (!value || typeof value !== 'object') return result;
  for (const [id, entry] of Object.entries(value)) result[id] = normalizedTaskRecord(entry, id);
  return result;
}

function applyTaskDelta(current, delta) {
  const tasks = current && typeof current === 'object' ? current : {};
  const completions = [];
  if (!delta || typeof delta !== 'object') return { tasks, completions, changed: false };
  let changed = false;
  for (const collection of [delta.a, delta.u]) {
    if (!Array.isArray(collection)) continue;
    for (const patch of collection) {
      if (!patch || typeof patch.id !== 'string' || !patch.id) continue;
      const previous = tasks[patch.id];
      const next = normalizedTaskRecord(Object.assign({}, previous || {}, patch), patch.id);
      tasks[patch.id] = next;
      changed = true;
      if (previous && next.completed > previous.completed) {
        completions.push({ id: patch.id, previousCompleted: previous.completed, completed: next.completed });
      }
    }
  }
  if (Array.isArray(delta.r)) {
    for (const entry of delta.r) {
      const id = typeof entry === 'string' ? entry : entry && entry.id;
      if (id && Object.prototype.hasOwnProperty.call(tasks, id)) { delete tasks[id]; changed = true; }
    }
  }
  return { tasks, completions, changed };
}

function completedTaskTrackCount(states) {
  const tasks = states && typeof states === 'object' ? states : {};
  return Object.values(TASK_TRACKS).filter((track) => track.tasks.every((definition) => {
    const state = tasks[definition.id];
    return state && Number(state.completed) > 0;
  })).length;
}

module.exports = {
  TASK_LEVEL_BY_SPECIES,
  TASK_TRACKS,
  applyTaskDelta,
  completedTaskTrackCount,
  normalizedTaskRecord,
  taskMapFromState,
};
