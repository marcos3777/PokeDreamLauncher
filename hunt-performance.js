'use strict';

const HUNT_PERFORMANCE_V = 5;
const HUNT_PERFORMANCE_FIRST_MS = 10 * 60 * 1000;
const HUNT_PERFORMANCE_INTERVAL_MS = 5 * 60 * 1000;
const METRICS = ['xpPerHour', 'mobsPerHour'];
const XP_BUFF_RATES = Object.freeze({ vip: 0.20, xpPotion: 0.50 });
const XP_BUFF_KEYS = Object.freeze(['vip', 'xpPotion', 'task', 'rune']);

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizePokemon(value) {
  if (!value || typeof value !== 'object' || typeof value.species !== 'string' || !value.species) return null;
  const level = safeNumber(value.level);
  return {
    species: value.species.slice(0, 40),
    level: level == null ? null : Math.round(level),
    shiny: value.shiny === true,
  };
}

function normalizeTrainerName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  return name && name.length <= 40 && !/[\u0000-\u001f\u007f]/.test(name) ? name : null;
}

function createPerformanceBaseline(value, now = Date.now()) {
  const source = value && typeof value === 'object' ? value : {};
  const startedAt = safeNumber(now);
  return {
    startedAt: startedAt == null ? Date.now() : startedAt,
    xp: safeNumber(source.xp) || 0,
    kills: safeNumber(source.kills),
  };
}

function performanceDelta(baseline, value, now = Date.now()) {
  if (!baseline || typeof baseline !== 'object') return null;
  const source = value && typeof value === 'object' ? value : {};
  const startedAt = safeNumber(baseline.startedAt);
  const baseXp = safeNumber(baseline.xp);
  const currentXp = safeNumber(source.xp);
  const baseKills = safeNumber(baseline.kills);
  const currentKills = safeNumber(source.kills);
  if (startedAt == null || baseXp == null || currentXp == null) return null;
  return {
    ms: Math.max(0, Number(now) - startedAt),
    xpGained: Math.max(0, currentXp - baseXp),
    kills: baseKills == null || currentKills == null ? 0 : Math.max(0, currentKills - baseKills),
  };
}

function normalizeXpBuffs(value) {
  const source = value && typeof value === 'object' ? value : {};
  const buffs = {};
  for (const key of XP_BUFF_KEYS) {
    const rate = safeNumber(source[key]);
    if (rate != null && rate > 0 && rate <= 5) buffs[key] = rate;
  }
  return buffs;
}

function activeXpBuffs(value, now = Date.now()) {
  const source = value && typeof value === 'object' ? value : {};
  const at = Number(now);
  const premiumUntilMs = Number(source.premiumUntilMs);
  const xpBoostEndsAtMs = Number(source.xpBoostEndsAtMs);
  const buffs = {};
  if (source.premiumActive === true && (!Number.isFinite(premiumUntilMs) || premiumUntilMs <= 0 || premiumUntilMs > at)) {
    buffs.vip = XP_BUFF_RATES.vip;
  }
  if (Number.isFinite(xpBoostEndsAtMs) && xpBoostEndsAtMs > at) buffs.xpPotion = XP_BUFF_RATES.xpPotion;
  const completedTaskTypes = Math.floor(Number(source.completedTaskTypes));
  if (Number.isFinite(completedTaskTypes) && completedTaskTypes > 0) buffs.task = Math.min(100, completedTaskTypes) / 100;
  // Preparado para a futura leitura de runas; nenhum chamador informa este valor ainda.
  const runeBonusRate = Number(source.runeBonusRate);
  if (Number.isFinite(runeBonusRate) && runeBonusRate > 0 && runeBonusRate <= 5) buffs.rune = runeBonusRate;
  return buffs;
}

function normalizeRecord(value, metric) {
  if (!value || typeof value !== 'object') return null;
  const primary = safeNumber(value[metric]);
  if (primary == null || primary <= 0) return null;
  return {
    xpPerHour: safeNumber(value.xpPerHour),
    mobsPerHour: safeNumber(value.mobsPerHour),
    kills: safeNumber(value.kills),
    ms: safeNumber(value.ms),
    xpGained: safeNumber(value.xpGained),
    xpElapsedMs: safeNumber(value.xpElapsedMs),
    savedAt: safeNumber(value.savedAt),
    trainerName: normalizeTrainerName(value.trainerName),
    communityPending: value.communityPending === true,
    pokemon: normalizePokemon(value.pokemon),
    xpBuffs: normalizeXpBuffs(value.xpBuffs),
  };
}

function normalizeHuntPerformance(value) {
  const validVersion = value && (value.v === 1 || value.v === 2 || value.v === 3 || value.v === 4 || value.v === HUNT_PERFORMANCE_V);
  const source = validVersion && value.data && typeof value.data === 'object' ? value.data : {};
  const data = {};
  for (const [species, entry] of Object.entries(source)) {
    if (!/^[A-Za-z0-9]{1,40}$/.test(species) || !entry || typeof entry !== 'object') continue;
    const next = {};
    for (const metric of METRICS) {
      const record = normalizeRecord(entry[metric], metric);
      if (record) next[metric] = record;
    }
    if (Object.keys(next).length) data[species] = next;
  }
  const accounts = {};
  const accountSource = value && (value.v === 2 || value.v === 3 || value.v === 4 || value.v === HUNT_PERFORMANCE_V) && value.accounts && typeof value.accounts === 'object' ? value.accounts : {};
  for (const [accountId, hunts] of Object.entries(accountSource)) {
    if (!/^[0-9a-f]{64}$/.test(accountId) || !hunts || typeof hunts !== 'object') continue;
    const nextHunts = {};
    for (const [species, pokemonRecords] of Object.entries(hunts)) {
      if (!/^[A-Za-z0-9]{1,40}$/.test(species) || !pokemonRecords || typeof pokemonRecords !== 'object') continue;
      const nextPokemon = {};
      for (const [pokemonKey, entry] of Object.entries(pokemonRecords)) {
        if (!entry || typeof entry !== 'object') continue;
        const next = {};
        for (const metric of METRICS) {
          const record = normalizeRecord(entry[metric], metric);
          if (record && record.pokemon && `${record.pokemon.species}:${record.pokemon.shiny ? 1 : 0}` === pokemonKey) next[metric] = record;
        }
        if (Object.keys(next).length) nextPokemon[pokemonKey] = next;
      }
      if (Object.keys(nextPokemon).length) nextHunts[species] = nextPokemon;
    }
    if (Object.keys(nextHunts).length) accounts[accountId] = nextHunts;
  }
  const trainerNameSync = {};
  const syncSource = value && (value.v === 4 || value.v === HUNT_PERFORMANCE_V) && value.trainerNameSync && typeof value.trainerNameSync === 'object'
    ? value.trainerNameSync : {};
  for (const [accountId, entry] of Object.entries(syncSource)) {
    if (!/^[0-9a-f]{64}$/.test(accountId) || !entry || typeof entry !== 'object') continue;
    const trainerName = normalizeTrainerName(entry.trainerName);
    if (!trainerName) continue;
    const completedAt = safeNumber(entry.completedAt);
    trainerNameSync[accountId] = { trainerName, completedAt:completedAt && completedAt > 0 ? completedAt : null };
  }
  return { v: HUNT_PERFORMANCE_V, data, accounts, trainerNameSync };
}

function performanceCandidate(sample) {
  const source = sample && typeof sample === 'object' ? sample : {};
  return {
    xpPerHour: safeNumber(source.xpPerHour),
    mobsPerHour: safeNumber(source.mobsPerHour),
    kills: safeNumber(source.kills),
    ms: safeNumber(source.ms),
    xpGained: safeNumber(source.xpGained),
    xpElapsedMs: safeNumber(source.xpElapsedMs),
    savedAt: safeNumber(source.savedAt) || Date.now(),
    trainerName: normalizeTrainerName(source.trainerName),
    communityPending: true,
    pokemon: normalizePokemon(source.pokemon),
    xpBuffs: normalizeXpBuffs(source.xpBuffs),
  };
}

function updatePerformanceRecords(store, species, sample) {
  if (!store || store.v !== HUNT_PERFORMANCE_V || !store.data || typeof store.data !== 'object') return { changed:false, metrics:[] };
  const key = typeof species === 'string' && /^[A-Za-z0-9]{1,40}$/.test(species) ? species : null;
  if (!key) return { changed:false, metrics:[] };
  const candidate = performanceCandidate(sample);
  const entry = store.data[key] || (store.data[key] = {});
  const changed = [];
  for (const metric of METRICS) {
    const value = candidate[metric];
    const previous = entry[metric] && safeNumber(entry[metric][metric]);
    if (value != null && value > 0 && (previous == null || value > previous)) {
      entry[metric] = Object.assign({}, candidate);
      changed.push(metric);
    }
  }
  const accountId = typeof sample.accountId === 'string' && /^[0-9a-f]{64}$/.test(sample.accountId) ? sample.accountId : null;
  if (accountId && candidate.pokemon) {
    if (!store.accounts || typeof store.accounts !== 'object') store.accounts = {};
    const account = store.accounts[accountId] || (store.accounts[accountId] = {});
    const hunt = account[key] || (account[key] = {});
    const pokemonKey = `${candidate.pokemon.species}:${candidate.pokemon.shiny ? 1 : 0}`;
    const pokemon = hunt[pokemonKey] || (hunt[pokemonKey] = {});
    for (const metric of METRICS) {
      const value = candidate[metric];
      const previous = pokemon[metric] && safeNumber(pokemon[metric][metric]);
      if (value != null && value > 0 && (previous == null || value > previous)) {
        pokemon[metric] = Object.assign({}, candidate);
        if (!changed.includes(metric)) changed.push(metric);
      } else if (pokemon[metric] && !pokemon[metric].trainerName && candidate.trainerName) {
        pokemon[metric].trainerName = candidate.trainerName;
        pokemon[metric].communityPending = true;
        if (!changed.includes(metric)) changed.push(metric);
      }
    }
  }
  if (!Object.keys(entry).length) delete store.data[key];
  return { changed:changed.length > 0, metrics:changed };
}

function communityEligibleRecord(record, metric) {
  if (!record || !record.pokemon || !record.trainerName) return false;
  return metric === 'xpPerHour'
    ? record.xpGained > 0 && record.xpElapsedMs >= HUNT_PERFORMANCE_FIRST_MS
    : record.kills > 0 && record.ms >= HUNT_PERFORMANCE_FIRST_MS;
}

function samePerformanceRecord(left, right, metric) {
  if (!left || !right || !left.pokemon || !right.pokemon) return false;
  return safeNumber(left[metric]) === safeNumber(right[metric])
    && safeNumber(left.savedAt) === safeNumber(right.savedAt)
    && left.pokemon.species === right.pokemon.species
    && left.pokemon.shiny === right.pokemon.shiny;
}

function backfillTrainerNameForAccount(store, accountId, trainerName, now = Date.now()) {
  if (!store || store.v !== HUNT_PERFORMANCE_V || !store.accounts || typeof store.accounts !== 'object') {
    return { changed:false, pending:false, records:0 };
  }
  const key = typeof accountId === 'string' && /^[0-9a-f]{64}$/.test(accountId) ? accountId : null;
  const name = normalizeTrainerName(trainerName);
  if (!key || !name) return { changed:false, pending:false, records:0 };
  if (!store.trainerNameSync || typeof store.trainerNameSync !== 'object') store.trainerNameSync = {};
  const previous = store.trainerNameSync[key];
  if (previous && safeNumber(previous.completedAt) > 0) return { changed:false, pending:false, records:0 };

  let changed = !previous || previous.trainerName !== name;
  let records = 0;
  store.trainerNameSync[key] = { trainerName:name, completedAt:null };
  const hunts = store.accounts[key] || {};
  for (const [huntSpecies, pokemonRecords] of Object.entries(hunts)) {
    for (const entry of Object.values(pokemonRecords || {})) {
      for (const metric of METRICS) {
        const record = entry && entry[metric];
        if (!record || !communityEligibleRecord(Object.assign({}, record, { trainerName:name }), metric)) continue;
        records++;
        if (record.trainerName !== name || record.communityPending !== true) changed = true;
        record.trainerName = name;
        record.communityPending = true;
        const local = store.data && store.data[huntSpecies] && store.data[huntSpecies][metric];
        if (samePerformanceRecord(local, record, metric) && local.trainerName !== name) {
          local.trainerName = name;
          changed = true;
        }
      }
    }
  }
  if (!records) {
    store.trainerNameSync[key].completedAt = Math.max(1, Number(now) || Date.now());
    changed = true;
  }
  return { changed, pending:records > 0, records };
}

function recordWireKey(record) {
  if (!record || typeof record !== 'object') return null;
  return [record.account_id, record.hunt_species, record.pokemon_species, record.pokemon_shiny ? 1 : 0, record.metric].join('|');
}

function markCommunityPerformanceRecordsSynced(store, submittedRecords, now = Date.now()) {
  if (!store || store.v !== HUNT_PERFORMANCE_V || !Array.isArray(submittedRecords)) return false;
  const submitted = new Map();
  for (const record of submittedRecords) {
    const key = recordWireKey(record);
    if (key) submitted.set(key, Math.round(Number(record.achieved_at) || 0));
  }
  let changed = false;
  for (const [accountId, hunts] of Object.entries(store.accounts || {})) {
    for (const [huntSpecies, pokemonRecords] of Object.entries(hunts || {})) {
      for (const entry of Object.values(pokemonRecords || {})) {
        for (const metric of METRICS) {
          const record = entry && entry[metric];
          if (!record || record.communityPending !== true || !record.pokemon) continue;
          const wireKey = [accountId, huntSpecies, record.pokemon.species, record.pokemon.shiny ? 1 : 0,
            metric === 'xpPerHour' ? 'xp_per_hour' : 'mobs_per_hour'].join('|');
          if (submitted.get(wireKey) !== Math.round(Number(record.savedAt) || 0)) continue;
          record.communityPending = false;
          changed = true;
        }
      }
    }
    const sync = store.trainerNameSync && store.trainerNameSync[accountId];
    if (sync && !safeNumber(sync.completedAt)) {
      const stillPending = Object.values(hunts || {}).some((pokemonRecords) => Object.values(pokemonRecords || {}).some((entry) =>
        METRICS.some((metric) => entry && entry[metric] && entry[metric].communityPending === true)));
      if (!stillPending) {
        sync.completedAt = Math.max(1, Number(now) || Date.now());
        changed = true;
      }
    }
  }
  return changed;
}

function communityPerformanceRecords(store) {
  const normalized = normalizeHuntPerformance(store);
  const records = [];
  for (const [accountId, hunts] of Object.entries(normalized.accounts)) {
    for (const [huntSpecies, pokemonRecords] of Object.entries(hunts)) {
      for (const entry of Object.values(pokemonRecords)) {
        for (const metric of METRICS) {
          const record = entry[metric];
          if (!record || record.communityPending !== true || !communityEligibleRecord(record, metric)) continue;
          records.push({
            account_id: accountId,
            trainer_name: record.trainerName,
            hunt_species: huntSpecies,
            pokemon_species: record.pokemon.species,
            pokemon_shiny: record.pokemon.shiny === true,
            pokemon_level: record.pokemon.level,
            metric: metric === 'xpPerHour' ? 'xp_per_hour' : 'mobs_per_hour',
            xp_gained: Math.round(record.xpGained || 0),
            xp_elapsed_ms: Math.round(record.xpElapsedMs || 0),
            kills: Math.round(record.kills || 0),
            hunt_elapsed_ms: Math.round(record.ms || 0),
            vip: Number(record.xpBuffs && record.xpBuffs.vip) > 0,
            xp_potion: Number(record.xpBuffs && record.xpBuffs.xpPotion) > 0,
            completed_task_types: Math.max(0, Math.min(100, Math.round(Number(record.xpBuffs && record.xpBuffs.task) * 100) || 0)),
            rune_bonus_percent: Math.max(0, Math.min(500, Math.round(Number(record.xpBuffs && record.xpBuffs.rune) * 100) || 0)),
            achieved_at: Math.round(record.savedAt || Date.now()),
          });
        }
      }
    }
  }
  return records;
}

module.exports = {
  HUNT_PERFORMANCE_FIRST_MS,
  HUNT_PERFORMANCE_INTERVAL_MS,
  HUNT_PERFORMANCE_V,
  XP_BUFF_RATES,
  activeXpBuffs,
  backfillTrainerNameForAccount,
  communityPerformanceRecords,
  createPerformanceBaseline,
  normalizeHuntPerformance,
  normalizeTrainerName,
  normalizeXpBuffs,
  markCommunityPerformanceRecordsSynced,
  performanceDelta,
  updatePerformanceRecords,
};
