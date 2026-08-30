'use strict';

const { createLauncherAccess } = require('./launcher-access');

const SUPABASE_URL = 'https://ddjhptkpndopbondgvlv.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_yTCUuFkmqnOSf3OmHYJZXA_FMnaPmpB';
const COMMUNITY_SCHEMA_VERSION = 3;
const POSITIVE_CACHE_MS = 30 * 60 * 1000;
const NEGATIVE_CACHE_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_COUNTER = 1_000_000_000;
const MAX_BROKE_SUM = Number.MAX_SAFE_INTEGER;
const MAX_HUNT_MS = 630_720_000_000;
const MAX_ACCOUNTS = 32;
const SPECIES_RE = /^[A-Z][A-Za-z0-9]{0,31}$/;
const TYPE_CODE_RE = /^[a-z][a-z0-9_]{1,31}$/;
const COMBAT_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MATCHUP_RELATIONS = new Set(['super_effective', 'neutral', 'resisted', 'immune']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{43,128}$/;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/;
const ACCOUNT_ID_RE = /^[0-9a-f]{64}$/;
const PERFORMANCE_SCHEMA_VERSION = 3;
const MAX_PERFORMANCE_RECORDS = 1000;
const COMMUNITY_SPECIES_ALIASES = Object.freeze({
  NidoranFemale: 'NidoranF',
  NidoranMale: 'NidoranM',
});

class CommunityHttpError extends Error {
  constructor(message, status, code, data) {
    super(message);
    this.name = 'CommunityHttpError';
    this.status = Number.isFinite(status) ? status : 0;
    this.code = code || 'request_failed';
    this.data = data || null;
  }
}

class CommunitySnapshotError extends Error {
  constructor(species = null) {
    super('invalid local community snapshot');
    this.name = 'CommunitySnapshotError';
    this.code = 'invalid_local_snapshot';
    this.species = typeof species === 'string' ? species : null;
  }
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function safeInteger(value, min, max) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}
function safeDecimal(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
function canonicalCommunitySpecies(species) {
  return COMMUNITY_SPECIES_ALIASES[species] || species;
}

function mergeAccountCommunityStats(left, right, species) {
  if (!left) return right;
  const merged = {};
  for (const key of ['kills', 'caught', 'shinies', 'shiny_caught', 'broke_sum', 'broke_count',
    'thrown_a', 'thrown_b', 'ms']) {
    merged[key] = safeInteger(Number(left[key]) + Number(right[key]), 0,
      key === 'broke_sum' ? MAX_BROKE_SUM : (key === 'ms' ? MAX_HUNT_MS : MAX_COUNTER));
  }
  for (const key of ['caught_a', 'caught_b']) {
    merged[key] = safeDecimal(Number(left[key]) + Number(right[key]), 0, MAX_COUNTER);
  }
  const maxima = [left.broke_max, right.broke_max].filter((value) => value != null).map(Number);
  const minima = [left.broke_min, right.broke_min].filter((value) => value != null).map(Number);
  merged.broke_max = maxima.length ? Math.max(...maxima) : null;
  merged.broke_min = minima.length ? Math.min(...minima) : null;
  if (Object.values(merged).some((value) => value === null)
    && [merged.kills, merged.caught, merged.shinies, merged.shiny_caught, merged.broke_sum,
      merged.broke_count, merged.thrown_a, merged.thrown_b, merged.caught_a, merged.caught_b, merged.ms]
      .some((value) => value === null)) throw new CommunitySnapshotError(species);
  return merged;
}

// Converte somente os campos comunitários. "shinies" vem de shinyKills (encontrados/derrotados),
// enquanto "caught" representa capturas; streaks, pendências e dados de conta nunca entram.
function huntLogToStats(huntLog) {
  const result = {};
  if (!isRecord(huntLog)) throw new CommunitySnapshotError();

  for (const species of Object.keys(huntLog).sort()) {
    if (!SPECIES_RE.test(species)) throw new CommunitySnapshotError(species);
    const entry = huntLog[species];
    if (!isRecord(entry)) throw new CommunitySnapshotError(species);

    const kills = safeInteger(entry.kills, 0, MAX_COUNTER);
    const caught = safeInteger(entry.caught, 0, MAX_COUNTER);
    const shinies = safeInteger(entry.shinies, 0, MAX_COUNTER);
    const thrownA = safeInteger(entry.thrownA, 0, MAX_COUNTER);
    const thrownB = safeInteger(entry.thrownB, 0, MAX_COUNTER);
    const caughtA = safeDecimal(entry.caughtA, 0, MAX_COUNTER);
    const caughtB = safeDecimal(entry.caughtB, 0, MAX_COUNTER);
    const ms = safeInteger(entry.ms, 0, MAX_HUNT_MS);

    if ([kills, caught, shinies, thrownA, thrownB, caughtA, caughtB, ms].some((value) => value === null)) {
      throw new CommunitySnapshotError(species);
    }
    if (caught > kills || shinies > kills || caught > thrownA + thrownB) throw new CommunitySnapshotError(species);
    if (caughtA > thrownA || caughtB > thrownB || caughtA + caughtB > caught + 0.000001) {
      throw new CommunitySnapshotError(species);
    }
    if (kills === 0) continue;

    result[species] = {
      kills,
      caught,
      shinies,
      thrown_a: thrownA,
      thrown_b: thrownB,
      caught_a: caughtA,
      caught_b: caughtB,
      ms,
    };
  }

  return result;
}

// O servidor recebe um snapshot de contadores por personagem. A callback transforma a chave
// local da conta num identificador opaco; esse fluxo não envia nome nem charId.
function huntLogToAccountStats(huntLog, accountIdForKey) {
  const result = {};
  if (!isRecord(huntLog) || typeof accountIdForKey !== 'function') throw new CommunitySnapshotError();

  for (const species of Object.keys(huntLog).sort()) {
    if (!SPECIES_RE.test(species)) throw new CommunitySnapshotError(species);
    const entry = huntLog[species];
    if (!isRecord(entry)) throw new CommunitySnapshotError(species);
    if (entry.accounts === undefined) continue;
    if (!isRecord(entry.accounts)) throw new CommunitySnapshotError(species);

    for (const accountKey of Object.keys(entry.accounts).sort()) {
      const account = entry.accounts[accountKey];
      if (!isRecord(account) || !isRecord(account.stats)) continue;
      const accountId = accountIdForKey(accountKey);
      if (typeof accountId !== 'string' || !ACCOUNT_ID_RE.test(accountId)) throw new CommunitySnapshotError(species);

      const source = account.stats;
      const kills = safeInteger(source.kills ?? 0, 0, MAX_COUNTER);
      const caught = safeInteger(source.caught ?? 0, 0, MAX_COUNTER);
      const shinies = safeInteger(source.shinies ?? 0, 0, MAX_COUNTER);
      const shinyCaught = safeInteger(source.shinyCaught ?? 0, 0, MAX_COUNTER);
      const thrownA = safeInteger(source.thrownA ?? 0, 0, MAX_COUNTER);
      const thrownB = safeInteger(source.thrownB ?? 0, 0, MAX_COUNTER);
      const caughtA = safeDecimal(source.caughtA ?? 0, 0, MAX_COUNTER);
      const caughtB = safeDecimal(source.caughtB ?? 0, 0, MAX_COUNTER);
      const ms = safeInteger(source.ms ?? 0, 0, MAX_HUNT_MS);

      if ([kills, caught, shinies, shinyCaught, thrownA, thrownB, caughtA, caughtB, ms].some((value) => value === null)) {
        throw new CommunitySnapshotError(species);
      }
      if (caught > kills || shinies > kills || shinyCaught > shinies || shinyCaught > caught || caught > thrownA + thrownB) {
        throw new CommunitySnapshotError(species);
      }
      if (caughtA > thrownA || caughtB > thrownB || caughtA + caughtB > caught + 0.000001) {
        throw new CommunitySnapshotError(species);
      }
      if (kills === 0) continue;

      const rawClosedMax = account.brokeMax == null ? null : safeInteger(account.brokeMax, 1, MAX_COUNTER);
      const rawMin = account.brokeMin == null ? null : safeInteger(account.brokeMin, 1, MAX_COUNTER);
      const streak = safeInteger(account.streak ?? 0, 0, MAX_COUNTER);
      if (streak === null) throw new CommunitySnapshotError(species);
      const rawMax = streak > 0 && rawClosedMax !== null
        ? Math.max(streak, rawClosedMax)
        : (streak > 0 ? streak : rawClosedMax);

      let brokeTotal = safeInteger(account.brokeTotal ?? 0, 0, MAX_BROKE_SUM);
      let brokeCount = safeInteger(account.brokeCount ?? 0, 0, MAX_COUNTER);
      if (brokeTotal === null || brokeCount === null) throw new CommunitySnapshotError(species);
      if (account.brokeTotal === undefined && account.brokeCount === undefined
        && shinyCaught === 1 && streak === 0 && rawMax !== null && rawMax === rawMin) {
        brokeTotal = rawMax;
        brokeCount = 1;
      }
      const validExtrema = (rawMax === null || rawMax <= shinies)
        && (rawMin === null || (rawMax !== null && rawMin <= rawMax));
      const validSamples = brokeCount === 0
        ? brokeTotal === 0
        : rawMax !== null
          && rawMin !== null
          && brokeCount <= shinyCaught
          && brokeTotal >= rawMin * brokeCount
          && brokeTotal <= rawMax * brokeCount;
      if (!validExtrema || !validSamples) throw new CommunitySnapshotError(species);

      if (!result[accountId]) result[accountId] = {};
      const communitySpecies = canonicalCommunitySpecies(species);
      const nextStats = {
        kills,
        caught,
        shinies,
        shiny_caught: shinyCaught,
        broke_max: rawMax,
        broke_min: rawMin,
        broke_sum: brokeTotal,
        broke_count: brokeCount,
        thrown_a: thrownA,
        thrown_b: thrownB,
        caught_a: caughtA,
        caught_b: caughtB,
        ms,
      };
      result[accountId][communitySpecies] = mergeAccountCommunityStats(
        result[accountId][communitySpecies], nextStats, communitySpecies);
    }
  }

  if (Object.keys(result).length > MAX_ACCOUNTS) throw new CommunitySnapshotError();

  return result;
}

function buildSubmitPayload({ appVersion, clientId, clientToken, revision, huntLog, stats, accountIdForKey }) {
  if (typeof appVersion !== 'string' || !VERSION_RE.test(appVersion)) throw new TypeError('invalid appVersion');
  if (typeof clientId !== 'string' || !UUID_RE.test(clientId)) throw new TypeError('invalid clientId');
  if (typeof clientToken !== 'string' || !TOKEN_RE.test(clientToken)) throw new TypeError('invalid clientToken');
  if (!Number.isSafeInteger(revision) || revision < 1) throw new TypeError('invalid revision');

  const normalizedStats = stats === undefined ? huntLogToAccountStats(huntLog, accountIdForKey) : stats;
  if (!isRecord(normalizedStats)) throw new TypeError('invalid stats');

  return {
    schema_version: COMMUNITY_SCHEMA_VERSION,
    app_version: appVersion,
    client_id: clientId,
    client_token: clientToken,
    revision,
    stats: normalizedStats,
  };
}

function buildPerformancePayload({ appVersion, clientId, clientToken, records }) {
  if (typeof appVersion !== 'string' || !VERSION_RE.test(appVersion)) throw new TypeError('invalid appVersion');
  if (typeof clientId !== 'string' || !UUID_RE.test(clientId)) throw new TypeError('invalid clientId');
  if (typeof clientToken !== 'string' || !TOKEN_RE.test(clientToken)) throw new TypeError('invalid clientToken');
  if (!Array.isArray(records) || records.length > MAX_PERFORMANCE_RECORDS) throw new TypeError('invalid performance records');
  return {
    schema_version: PERFORMANCE_SCHEMA_VERSION,
    app_version: appVersion,
    client_id: clientId,
    client_token: clientToken,
    records,
  };
}

function parsePerformanceLeaderboard(payload, huntSpecies) {
  const value = isRecord(payload) && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
  if (!isRecord(value)) throw new CommunityHttpError('invalid server response', 0, 'invalid_response');
  const result = { xpPerHour: [], mobsPerHour: [] };
  for (const [wireKey, outputKey] of [['xp_per_hour', 'xpPerHour'], ['mobs_per_hour', 'mobsPerHour']]) {
    const rows = value[wireKey];
    if (!Array.isArray(rows) || rows.length > 3) throw new CommunityHttpError('invalid server response', 0, 'invalid_response');
    result[outputKey] = rows.map((row, index) => {
      if (!isRecord(row)
        || row.hunt_species !== huntSpecies
        || row.metric !== wireKey
        || typeof row.pokemon_species !== 'string'
        || !SPECIES_RE.test(row.pokemon_species)
        || typeof row.pokemon_shiny !== 'boolean'
        || typeof row.vip !== 'boolean'
        || typeof row.xp_potion !== 'boolean') {
        throw new CommunityHttpError('invalid server response', 0, 'invalid_response');
      }
      const score = safeInteger(row.score, 1, Number.MAX_SAFE_INTEGER);
      const pokemonLevel = row.pokemon_level == null ? null : safeInteger(row.pokemon_level, 1, 1000);
      const trainerName = typeof row.trainer_name === 'string' ? row.trainer_name.trim() : '';
      // Durante uma atualização gradual, o endpoint v2 ainda pode omitir os dois
      // campos introduzidos no schema v3. Ausência significa que o recorde antigo
      // não tinha esses bônus; valores presentes continuam sendo validados.
      const completedTaskTypes = row.completed_task_types == null
        ? 0 : safeInteger(row.completed_task_types, 0, 100);
      const runeBonusPercent = row.rune_bonus_percent == null
        ? 0 : safeInteger(row.rune_bonus_percent, 0, 500);
      if (score == null || (row.pokemon_level != null && pokemonLevel == null)
        || completedTaskTypes == null || runeBonusPercent == null
        || !trainerName || trainerName.length > 40 || /[\u0000-\u001f\u007f]/.test(trainerName)) {
        throw new CommunityHttpError('invalid server response', 0, 'invalid_response');
      }
      return {
        rank: index + 1,
        huntSpecies,
        metric: outputKey,
        score,
        trainerName,
        pokemon: { species: row.pokemon_species, shiny: row.pokemon_shiny, level: pokemonLevel },
        xpBuffs: wireKey === 'xp_per_hour' ? {
          ...(row.vip ? { vip:0.2 } : {}),
          ...(row.xp_potion ? { xpPotion:0.5 } : {}),
          ...(completedTaskTypes > 0 ? { task:completedTaskTypes / 100 } : {}),
          ...(runeBonusPercent > 0 ? { rune:runeBonusPercent / 100 } : {}),
        } : {},
        achievedAt: safeInteger(row.achieved_at, 1, Number.MAX_SAFE_INTEGER),
      };
    });
  }
  return result;
}

function parseAggregate(payload, species) {
  let value = payload;
  if (isRecord(value) && Object.prototype.hasOwnProperty.call(value, 'data')) value = value.data;
  if (Array.isArray(value)) value = value[0] ?? null;
  if (value == null) return null;
  if (!isRecord(value) || value.species !== species) throw new CommunityHttpError('invalid server response', 0, 'invalid_response');

  const integerFields = ['contributors'];
  // Contagens agregadas podem ser fracionárias porque o servidor limita o peso de uma
  // instalação muito grande antes de somá-la à amostra.
  const numericFields = ['kills', 'caught', 'shinies', 'shiny_caught', 'thrown_a', 'thrown_b', 'caught_a', 'caught_b', 'ms'];
  const decimalFields = ['catch_pct', 'catch_pct_a', 'catch_pct_b', 'kills_per_shiny', 'broke_avg'];
  const nullableIntegerFields = ['broke_max', 'broke_min'];
  const result = { species };

  for (const key of integerFields) {
    const n = Number(value[key]);
    if (!Number.isSafeInteger(n) || n < 0) throw new CommunityHttpError('invalid server response', 0, 'invalid_response');
    result[key] = n;
  }
  for (const key of numericFields) {
    const n = Number(value[key]);
    if (!Number.isFinite(n) || n < 0) throw new CommunityHttpError('invalid server response', 0, 'invalid_response');
    result[key] = n;
  }
  for (const key of decimalFields) {
    if (value[key] == null) { result[key] = null; continue; }
    const n = Number(value[key]);
    if (!Number.isFinite(n) || n < 0) throw new CommunityHttpError('invalid server response', 0, 'invalid_response');
    result[key] = n;
  }
  for (const key of nullableIntegerFields) {
    if (value[key] == null) { result[key] = null; continue; }
    const n = Number(value[key]);
    if (!Number.isSafeInteger(n) || n < 1) throw new CommunityHttpError('invalid server response', 0, 'invalid_response');
    result[key] = n;
  }
  return result;
}

function parsePokemonCombatCatalog(value) {
  const empty = { types:{}, pokemon:{}, matchups:[] };
  if (value == null) return empty;
  if (!isRecord(value)) throw new CommunityHttpError('invalid server response', 0, 'invalid_response');

  const typeRows = value.types;
  const pokemonRows = value.pokemon;
  const speciesTypeRows = value.species_types;
  const matchupRows = value.matchups;
  if (!Array.isArray(typeRows) || typeRows.length > 32
    || !Array.isArray(pokemonRows) || pokemonRows.length > 1000
    || !Array.isArray(speciesTypeRows) || speciesTypeRows.length > 2000
    || !Array.isArray(matchupRows) || matchupRows.length > 1024) {
    throw new CommunityHttpError('invalid server response', 0, 'invalid_response');
  }

  const types = {};
  for (const row of typeRows) {
    const sortOrder = row && safeInteger(row.sort_order, 1, 32);
    if (!isRecord(row) || typeof row.code !== 'string' || !TYPE_CODE_RE.test(row.code)
      || typeof row.name_pt !== 'string' || !row.name_pt.trim() || row.name_pt.length > 32
      || sortOrder == null || types[row.code]) {
      throw new CommunityHttpError('invalid server response', 0, 'invalid_response');
    }
    types[row.code] = { code:row.code, namePt:row.name_pt.trim(), sortOrder };
  }

  const pokemon = {};
  for (const row of pokemonRows) {
    if (!isRecord(row) || typeof row.species !== 'string' || !SPECIES_RE.test(row.species)
      || typeof row.attack_type_code !== 'string' || !types[row.attack_type_code] || pokemon[row.species]) {
      throw new CommunityHttpError('invalid server response', 0, 'invalid_response');
    }
    pokemon[row.species] = { attackType:row.attack_type_code, types:[] };
  }

  for (const row of speciesTypeRows) {
    const slot = row && safeInteger(row.slot, 1, 2);
    const target = row && pokemon[row.species];
    if (!isRecord(row) || !target || typeof row.type_code !== 'string' || !types[row.type_code]
      || slot == null || target.types[slot - 1]) {
      throw new CommunityHttpError('invalid server response', 0, 'invalid_response');
    }
    target.types[slot - 1] = row.type_code;
  }
  if (Object.values(pokemon).some((row) => !row.types.length || row.types.some((type) => !type))) {
    throw new CommunityHttpError('invalid server response', 0, 'invalid_response');
  }

  const matchupKeys = new Set();
  const matchups = matchupRows.map((row) => {
    if (!isRecord(row) || typeof row.attack_type_code !== 'string' || !types[row.attack_type_code]
      || typeof row.defense_type_code !== 'string' || !types[row.defense_type_code]
      || !MATCHUP_RELATIONS.has(row.relation)) {
      throw new CommunityHttpError('invalid server response', 0, 'invalid_response');
    }
    const key = `${row.attack_type_code}:${row.defense_type_code}`;
    if (matchupKeys.has(key)) throw new CommunityHttpError('invalid server response', 0, 'invalid_response');
    matchupKeys.add(key);
    return { attackType:row.attack_type_code, defenseType:row.defense_type_code, relation:row.relation };
  });
  return { types, pokemon, matchups };
}

function parsePokemonCombatSnapshot(value) {
  if (!isRecord(value) || typeof value.version !== 'string' || !COMBAT_VERSION_RE.test(value.version)
    || !isRecord(value.combat)) {
    throw new CommunityHttpError('invalid server response', 0, 'invalid_response');
  }
  const combat = parsePokemonCombatCatalog(value.combat);
  if (!Object.keys(combat.types).length || !Object.keys(combat.pokemon).length || !combat.matchups.length) {
    throw new CommunityHttpError('invalid server response', 0, 'invalid_response');
  }
  return { version:value.version, combat, combatWire:value.combat };
}

function parsePokemonHubCatalog(payload) {
  const value = isRecord(payload) && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
  if (!Array.isArray(value) || value.length > 1000) {
    throw new CommunityHttpError('invalid server response', 0, 'invalid_response');
  }
  const seen = new Set();
  const rows = value.map((row) => {
    if (!isRecord(row) || typeof row.species !== 'string' || !SPECIES_RE.test(row.species) || seen.has(row.species)) {
      throw new CommunityHttpError('invalid server response', 0, 'invalid_response');
    }
    seen.add(row.species);
    const dexNumber = safeInteger(row.dex_number, 1, 999);
    if (dexNumber == null) throw new CommunityHttpError('invalid server response', 0, 'invalid_response');

    let capture = null;
    if (row.contributors != null) {
      const contributors = safeInteger(row.contributors, 1, Number.MAX_SAFE_INTEGER);
      const decimal = (key) => {
        if (row[key] == null) return null;
        const number = Number(row[key]);
        if (!Number.isFinite(number) || number < 0) throw new CommunityHttpError('invalid server response', 0, 'invalid_response');
        return number;
      };
      const integer = (key) => row[key] == null ? null : safeInteger(row[key], 1, Number.MAX_SAFE_INTEGER);
      const brokeMax = integer('broke_max');
      const brokeMin = integer('broke_min');
      if (contributors == null || (row.broke_max != null && brokeMax == null) || (row.broke_min != null && brokeMin == null)) {
        throw new CommunityHttpError('invalid server response', 0, 'invalid_response');
      }
      capture = {
        contributors,
        catchPct: decimal('catch_pct'),
        killsPerShiny: decimal('kills_per_shiny'),
        brokeAvg: decimal('broke_avg'),
        brokeMax,
        brokeMin,
      };
    }

    const performanceMetric = (key) => {
      if (row[key] == null) return null;
      const number = safeInteger(row[key], 1, Number.MAX_SAFE_INTEGER);
      if (number == null) throw new CommunityHttpError('invalid server response', 0, 'invalid_response');
      return number;
    };
    return {
      species: row.species,
      dexNumber,
      capture,
      performance: {
        xpPerHour: performanceMetric('best_xp_per_hour'),
        mobsPerHour: performanceMetric('best_mobs_per_hour'),
      },
    };
  });
  const combatWire = isRecord(payload) && isRecord(payload.combat) ? payload.combat : null;
  const combat = parsePokemonCombatCatalog(combatWire);
  return { rows, combat, combatWire };
}

function parsePokemonHub(payload, species) {
  const value = isRecord(payload) && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
  if (value == null) return null;
  if (!isRecord(value) || value.species !== species || safeInteger(value.dex_number, 1, 999) == null) {
    throw new CommunityHttpError('invalid server response', 0, 'invalid_response');
  }
  return {
    species,
    dexNumber: Number(value.dex_number),
    capture: value.capture == null ? null : parseAggregate({ data:value.capture }, species),
    performance: parsePerformanceLeaderboard({ data:value.performance }, species),
  };
}

function createCommunityClient(options = {}) {
  const appVersion = String(options.appVersion || require('./package.json').version);
  const access = options.access || createLauncherAccess({ appVersion, onBlocked:options.onUpdateRequired });
  const baseUrl = String(options.baseUrl || SUPABASE_URL).replace(/\/+$/, '');
  const publishableKey = String(options.publishableKey || SUPABASE_PUBLISHABLE_KEY);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1, options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch is not available');

  const cache = new Map();
  const inFlight = new Map();
  const activeSubmitControllers = new Set();
  let cacheGeneration = 0;

  async function requestJson(url, init, suppliedController) {
    access.assertAllowed();
    const controller = suppliedController || new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
    let response;
    try {
      response = await fetchImpl(url, {
        ...init,
        headers:{ ...init.headers, 'x-launcher-version':appVersion },
        cache:'no-store', signal:controller.signal,
      });
    } catch (error) {
      access.assertAllowed();
      const aborted = controller.signal.aborted || (error && error.name === 'AbortError');
      const code = timedOut ? 'timeout' : (aborted ? 'aborted' : 'network_error');
      const message = timedOut ? 'request timed out' : (aborted ? 'request aborted' : 'network request failed');
      throw new CommunityHttpError(message, 0, code);
    } finally {
      clearTimeout(timer);
    }

    let data = null;
    try { data = await response.json(); } catch {}
    if (response.status === 426) throw access.block(data);
    access.assertAllowed();
    if (!response.ok) {
      const code = isRecord(data) && typeof data.error === 'string' ? data.error : 'http_error';
      throw new CommunityHttpError(code, response.status, code, data);
    }
    return data;
  }

  async function submitStats(input) {
    access.assertAllowed();
    const payload = buildSubmitPayload(input);
    const controller = new AbortController();
    activeSubmitControllers.add(controller);
    try {
      const data = await requestJson(`${baseUrl}/functions/v1/submit-stats`, {
        method: 'POST',
        headers: {
          apikey: publishableKey,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      }, controller);
      if (!isRecord(data) || data.ok !== true) throw new CommunityHttpError('invalid server response', 0, 'invalid_response');
      return data;
    } finally {
      activeSubmitControllers.delete(controller);
    }
  }

  async function submitPerformance(input) {
    access.assertAllowed();
    const payload = buildPerformancePayload(input);
    if (!payload.records.length) return { ok:true, saved:0, skipped:true };
    const controller = new AbortController();
    activeSubmitControllers.add(controller);
    try {
      const data = await requestJson(`${baseUrl}/functions/v1/submit-performance`, {
        method: 'POST',
        headers: { apikey:publishableKey, accept:'application/json', 'content-type':'application/json' },
        body: JSON.stringify(payload),
      }, controller);
      if (!isRecord(data) || data.ok !== true) throw new CommunityHttpError('invalid server response', 0, 'invalid_response');
      return data;
    } finally {
      activeSubmitControllers.delete(controller);
    }
  }

  function getSpeciesStats(species) {
    if (access.error()) return Promise.reject(access.error());
    if (typeof species !== 'string' || !SPECIES_RE.test(species)) return Promise.reject(new TypeError('invalid species'));
    const cached = cache.get(species);
    const time = now();
    if (cached && cached.expiresAt > time) return Promise.resolve(cached.value);
    if (cached) cache.delete(species);
    const activeRequest = inFlight.get(species);
    if (activeRequest && activeRequest.generation === cacheGeneration) return activeRequest.promise;

    const requestGeneration = cacheGeneration;
    let request;
    request = requestJson(`${baseUrl}/functions/v1/species-stats?species=${encodeURIComponent(species)}&format=precise`, {
      method: 'GET',
      headers: { apikey: publishableKey, accept: 'application/json' },
    }).then((payload) => {
      const value = parseAggregate(payload, species);
      if (requestGeneration === cacheGeneration) {
        cache.set(species, {
          value,
          expiresAt: now() + (value ? POSITIVE_CACHE_MS : NEGATIVE_CACHE_MS),
        });
      }
      return value;
    }).finally(() => {
      const current = inFlight.get(species);
      if (current && current.promise === request) inFlight.delete(species);
    });

    inFlight.set(species, { generation: requestGeneration, promise: request });
    return request;
  }

  function getPerformanceLeaderboard(species) {
    if (access.error()) return Promise.reject(access.error());
    if (typeof species !== 'string' || !SPECIES_RE.test(species)) return Promise.reject(new TypeError('invalid species'));
    const cacheKey = `performance:${species}`;
    const cached = cache.get(cacheKey);
    const time = now();
    if (cached && cached.expiresAt > time) return Promise.resolve(cached.value);
    if (cached) cache.delete(cacheKey);
    const activeRequest = inFlight.get(cacheKey);
    if (activeRequest && activeRequest.generation === cacheGeneration) return activeRequest.promise;
    const requestGeneration = cacheGeneration;
    let request;
    request = requestJson(`${baseUrl}/functions/v1/performance-leaderboard?hunt=${encodeURIComponent(species)}`, {
      method: 'GET', headers: { apikey:publishableKey, accept:'application/json' },
    }).then((payload) => {
      const value = parsePerformanceLeaderboard(payload, species);
      if (requestGeneration === cacheGeneration) cache.set(cacheKey, { value, expiresAt:now() + POSITIVE_CACHE_MS });
      return value;
    }).finally(() => {
      const current = inFlight.get(cacheKey);
      if (current && current.promise === request) inFlight.delete(cacheKey);
    });
    inFlight.set(cacheKey, { generation:requestGeneration, promise:request });
    return request;
  }

  function getPokemonHubCatalog() {
    if (access.error()) return Promise.reject(access.error());
    const cacheKey = 'pokemon-hub:catalog';
    const cached = cache.get(cacheKey);
    const time = now();
    if (cached && cached.expiresAt > time) return Promise.resolve(cached.value);
    if (cached) cache.delete(cacheKey);
    const activeRequest = inFlight.get(cacheKey);
    if (activeRequest && activeRequest.generation === cacheGeneration) return activeRequest.promise;
    const requestGeneration = cacheGeneration;
    let request;
    request = requestJson(`${baseUrl}/functions/v1/pokemon-hub?scope=catalog`, {
      method:'GET', headers:{ apikey:publishableKey, accept:'application/json' },
    }).catch((error) => {
      // Compatibilidade com o endpoint anterior, que ainda não conhecia o parâmetro scope.
      if (!(error instanceof CommunityHttpError) || error.status !== 400 || error.code !== 'invalid_request') throw error;
      return requestJson(`${baseUrl}/functions/v1/pokemon-hub`, {
        method:'GET', headers:{ apikey:publishableKey, accept:'application/json' },
      });
    }).then((payload) => {
      const value = parsePokemonHubCatalog(payload);
      if (requestGeneration === cacheGeneration) cache.set(cacheKey, { value, expiresAt:now() + POSITIVE_CACHE_MS });
      return value;
    }).finally(() => {
      const current = inFlight.get(cacheKey);
      if (current && current.promise === request) inFlight.delete(cacheKey);
    });
    inFlight.set(cacheKey, { generation:requestGeneration, promise:request });
    return request;
  }

  function getPokemonCombatCatalog(cachedVersion) {
    if (access.error()) return Promise.reject(access.error());
    const version = typeof cachedVersion === 'string' && COMBAT_VERSION_RE.test(cachedVersion) ? cachedVersion : '';
    const cacheKey = `pokemon-combat:catalog:${version || 'empty'}`;
    const cached = cache.get(cacheKey);
    const time = now();
    if (cached && cached.expiresAt > time) return Promise.resolve(cached.value);
    if (cached) cache.delete(cacheKey);
    const activeRequest = inFlight.get(cacheKey);
    if (activeRequest && activeRequest.generation === cacheGeneration) return activeRequest.promise;
    const requestGeneration = cacheGeneration;
    const headers = { apikey:publishableKey, accept:'application/json' };
    if (version) headers['if-none-match'] = `"pokemon-combat-${version}"`;
    let request;
    request = requestJson(`${baseUrl}/functions/v1/pokemon-hub?scope=combat`, {
      method:'GET', headers,
    }).then((payload) => ({ ...parsePokemonCombatSnapshot(payload), notModified:false }))
      .catch((error) => {
        if (version && error instanceof CommunityHttpError && error.status === 304) {
          return { version, combat:null, combatWire:null, notModified:true };
        }
        throw error;
      }).then((value) => {
        if (requestGeneration === cacheGeneration) cache.set(cacheKey, { value, expiresAt:now() + POSITIVE_CACHE_MS });
        return value;
      }).finally(() => {
        const current = inFlight.get(cacheKey);
        if (current && current.promise === request) inFlight.delete(cacheKey);
      });
    inFlight.set(cacheKey, { generation:requestGeneration, promise:request });
    return request;
  }

  function getPokemonHub(species) {
    if (access.error()) return Promise.reject(access.error());
    if (typeof species !== 'string' || !SPECIES_RE.test(species)) return Promise.reject(new TypeError('invalid species'));
    const cacheKey = `pokemon-hub:${species}`;
    const cached = cache.get(cacheKey);
    const time = now();
    if (cached && cached.expiresAt > time) return Promise.resolve(cached.value);
    if (cached) cache.delete(cacheKey);
    const activeRequest = inFlight.get(cacheKey);
    if (activeRequest && activeRequest.generation === cacheGeneration) return activeRequest.promise;
    const requestGeneration = cacheGeneration;
    let request;
    request = requestJson(`${baseUrl}/functions/v1/pokemon-hub?species=${encodeURIComponent(species)}`, {
      method:'GET', headers:{ apikey:publishableKey, accept:'application/json' },
    }).then((payload) => {
      const value = parsePokemonHub(payload, species);
      if (requestGeneration === cacheGeneration) cache.set(cacheKey, {
        value, expiresAt:now() + (value ? POSITIVE_CACHE_MS : NEGATIVE_CACHE_MS),
      });
      return value;
    }).finally(() => {
      const current = inFlight.get(cacheKey);
      if (current && current.promise === request) inFlight.delete(cacheKey);
    });
    inFlight.set(cacheKey, { generation:requestGeneration, promise:request });
    return request;
  }

  function clearCache(species) {
    cacheGeneration++;
    if (species === undefined) { cache.clear(); inFlight.clear(); }
    else {
      for (const key of [species, `performance:${species}`, `pokemon-hub:${species}`, 'pokemon-hub:catalog']) {
        cache.delete(key); inFlight.delete(key);
      }
    }
  }

  function abortSubmissions() {
    for (const controller of activeSubmitControllers) controller.abort();
  }

  async function checkLauncherVersion() {
    const data = await requestJson(`${baseUrl}/functions/v1/launcher-status`, {
      method:'GET', headers:{ apikey:publishableKey, accept:'application/json' },
    });
    if (!isRecord(data) || data.ok !== true) throw new CommunityHttpError('invalid server response', 0, 'invalid_response');
    return data;
  }

  access.subscribe(() => { clearCache(); abortSubmissions(); });
  return { submitStats, submitPerformance, getSpeciesStats, getPerformanceLeaderboard, getPokemonHubCatalog, getPokemonCombatCatalog, getPokemonHub, clearCache, abortSubmissions, checkLauncherVersion };
}

module.exports = {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  COMMUNITY_SCHEMA_VERSION,
  PERFORMANCE_SCHEMA_VERSION,
  CommunityHttpError,
  CommunitySnapshotError,
  canonicalCommunitySpecies,
  huntLogToStats,
  huntLogToAccountStats,
  buildSubmitPayload,
  buildPerformancePayload,
  parsePerformanceLeaderboard,
  parsePokemonCombatCatalog,
  parsePokemonCombatSnapshot,
  parsePokemonHubCatalog,
  parsePokemonHub,
  createCommunityClient,
};
