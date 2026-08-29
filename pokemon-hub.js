'use strict';

const { describeBroke } = require('./hunt-metrics');
const { TASK_LEVEL_BY_SPECIES, TASK_TRACKS } = require('./task-catalog');

const TASK_SPECIES_ALIASES = Object.freeze({
  "Farfetch'd": 'Farfetchd',
  'Mr. Mime': 'MrMime',
});

function canonicalSpecies(value) {
  const species = typeof value === 'string' ? value.trim() : '';
  return TASK_SPECIES_ALIASES[species] || species;
}

function safeMetric(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function xpWithoutBuffs(record) {
  let value = record && safeMetric(record.xpPerHour);
  if (value == null) return null;
  for (const rate of Object.values(record.xpBuffs || {})) {
    const amount = Number(rate);
    if (Number.isFinite(amount) && amount > 0) value /= 1 + amount;
  }
  return Math.max(1, Math.round(value));
}

function buildTaskIndex() {
  const index = {};
  for (const track of Object.values(TASK_TRACKS)) {
    for (const task of track.tasks) {
      const species = canonicalSpecies(task.species);
      const rows = index[species] || (index[species] = []);
      rows.push({
        trackId: track.id,
        trackLabel: track.label,
        icon: track.icon,
        target: task.target,
        requiredLevel: task.requiredLevel == null ? null : Number(task.requiredLevel),
        huntId: task.huntId,
      });
    }
  }
  return index;
}

function buildTaskLevelIndex() {
  const result = {};
  for (const [species, level] of Object.entries(TASK_LEVEL_BY_SPECIES)) {
    result[canonicalSpecies(species)] = Number(level);
  }
  return result;
}

const TASKS_BY_SPECIES = buildTaskIndex();
const TASK_LEVELS_BY_SPECIES = buildTaskLevelIndex();

function pokemonTasks(species) {
  return (TASKS_BY_SPECIES[canonicalSpecies(species)] || []).map((task) => ({ ...task }));
}

function pokemonLoot(species, itemSources) {
  const target = canonicalSpecies(species);
  const sources = itemSources && typeof itemSources === 'object' ? itemSources : {};
  return Object.keys(sources).filter((itemId) => Array.isArray(sources[itemId])
    && sources[itemId].some((name) => canonicalSpecies(name) === target)).sort();
}

function localCapture(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const number = (key) => {
    const value = Number(entry[key]);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };
  const result = {
    ms: number('ms'),
    kills: number('kills'),
    caught: number('caught'),
    shinies: number('shinies'),
    shinyCaught: number('shinyCaught'),
    thrownA: number('thrownA'),
    thrownB: number('thrownB'),
    caughtA: number('caughtA'),
    caughtB: number('caughtB'),
    captureDryBalls: number('captureDryBalls'),
    shinyDryBalls: number('dryBalls'),
    shinyDryKills: number('dryKills'),
    updated: number('updated'),
    shinyBroke: describeBroke(entry),
  };
  const hasData = result.ms || result.kills || result.caught || result.shinies
    || result.thrownA || result.thrownB || result.captureDryBalls;
  return hasData ? result : null;
}

function localPerformance(entry) {
  const source = entry && typeof entry === 'object' ? entry : {};
  const result = {};
  for (const key of ['xpPerHour', 'mobsPerHour']) {
    const record = source[key];
    if (record && safeMetric(record[key])) result[key] = { ...record };
  }
  return result;
}

function buildPokemonCatalog({ huntLog, huntPerformance, itemSources, remoteRows } = {}) {
  const captures = huntLog && typeof huntLog === 'object' ? huntLog : {};
  const performance = huntPerformance && huntPerformance.data && typeof huntPerformance.data === 'object'
    ? huntPerformance.data : {};
  const remote = new Map((Array.isArray(remoteRows) ? remoteRows : [])
    .filter((row) => row && typeof row.species === 'string')
    .map((row) => [row.species, row]));
  const speciesNames = new Set([
    ...Object.keys(TASK_LEVELS_BY_SPECIES),
    ...Object.keys(TASKS_BY_SPECIES),
    ...Object.keys(captures),
    ...Object.keys(performance),
    ...remote.keys(),
  ]);

  return [...speciesNames].sort().map((species) => {
    const localPerf = localPerformance(performance[species]);
    const remoteRow = remote.get(species) || {};
    const communityPerformance = remoteRow.performance && typeof remoteRow.performance === 'object'
      ? remoteRow.performance : {};
    const localXp = xpWithoutBuffs(localPerf.xpPerHour);
    const localMobs = safeMetric(localPerf.mobsPerHour && localPerf.mobsPerHour.mobsPerHour);
    const communityXp = safeMetric(communityPerformance.xpPerHour);
    const communityMobs = safeMetric(communityPerformance.mobsPerHour);
    const loot = pokemonLoot(species, itemSources);
    return {
      species,
      dexNumber: Number.isSafeInteger(Number(remoteRow.dexNumber)) ? Number(remoteRow.dexNumber) : null,
      taskLevel: TASK_LEVELS_BY_SPECIES[species] || null,
      tasks: pokemonTasks(species),
      lootCount: loot.length,
      capture: localCapture(captures[species]),
      communityCapture: remoteRow.capture || null,
      performance: localPerf,
      communityPerformance,
      bestXpPerHour: localXp || communityXp,
      bestXpSource: localXp ? 'local' : (communityXp ? 'community' : null),
      bestMobsPerHour: localMobs || communityMobs,
      bestMobsSource: localMobs ? 'local' : (communityMobs ? 'community' : null),
    };
  });
}

function buildPokemonHub(species, { huntLog, huntPerformance, itemSources, remote, remoteError } = {}) {
  const key = canonicalSpecies(species);
  const captures = huntLog && typeof huntLog === 'object' ? huntLog : {};
  const performance = huntPerformance && huntPerformance.data && typeof huntPerformance.data === 'object'
    ? huntPerformance.data : {};
  return {
    species: key,
    taskLevel: TASK_LEVELS_BY_SPECIES[key] || null,
    tasks: pokemonTasks(key),
    loot: pokemonLoot(key, itemSources),
    capture: {
      local: localCapture(captures[key]),
      community: remote && remote.capture ? remote.capture : null,
    },
    performance: {
      local: localPerformance(performance[key]),
      community: remote && remote.performance ? remote.performance : { xpPerHour: [], mobsPerHour: [] },
    },
    remoteError: remoteError === true,
  };
}

module.exports = {
  buildPokemonCatalog,
  buildPokemonHub,
  canonicalSpecies,
  pokemonLoot,
  pokemonTasks,
};
