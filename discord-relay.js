'use strict';

const { buildDiscordPayload, normalizeDiscordNotifications, normalizeDiscordUserId } = require('./discord-notifications');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const CRITICAL_EVENTS = new Set(['party_death', 'repeated_stall']);

function captureReasons(pokemon, settings) {
  const reasons = [];
  if (pokemon && pokemon.shiny === true && settings.shinyCaptures) reasons.push('Shiny');
  if (pokemon && /^mythic$/i.test(String(pokemon.essence || pokemon.tier || '').trim()) && settings.mythicCaptures) reasons.push('Mythic');
  return reasons;
}

function relayEventEnabled(event, settings) {
  if (!event || typeof event !== 'object') return false;
  if (event.kind === 'test') return true;
  if (CRITICAL_EVENTS.has(event.kind)) {
    const setting = event.kind === 'party_death' ? 'partyDeaths' : 'repeatedStalls';
    return settings.criticalAlertsEnabled === true
      && settings[setting] === true
      && !!normalizeDiscordUserId(settings.discordUserId);
  }
  if (settings.enabled !== true) return false;
  if (event.kind === 'pokemon_capture') return captureReasons(event.pokemon, settings).length > 0;
  return event.kind === 'rare_drop' && settings.rareDrops === true;
}

function shortText(value, max) {
  const text = String(value == null ? '' : value).trim();
  return text.length > max ? text.slice(0, max) : text;
}

function safeNumber(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : null;
}

function relayPokemon(value) {
  const pokemon = value && typeof value === 'object' ? value : {};
  return {
    species: shortText(pokemon.species || 'Pokémon', 50),
    level: safeNumber(pokemon.level, 1, 100000),
    potential: safeNumber(pokemon.potential, 0, 100),
    essence: shortText(pokemon.essence || '', 30) || null,
    tier: shortText(pokemon.tier || '', 30) || null,
    caughtBall: shortText(pokemon.caughtBall || '', 50) || null,
    shiny: pokemon.shiny === true,
  };
}

function serializeRelayEvent(event, settings) {
  const common = {
    kind: event.kind,
    characterName: shortText(event.characterName || '', 40) || null,
    slot: Number.isInteger(Number(event.slot)) ? Math.max(1, Math.min(4, Number(event.slot))) : null,
    at: Number.isSafeInteger(Number(event.at)) ? Number(event.at) : Date.now(),
  };
  if (event.kind === 'rare_drop') return Object.assign(common, {
    itemId: shortText(event.itemId || '', 80),
    itemName: shortText(event.itemName || '', 100),
    count: Math.max(1, Math.min(100000, Math.round(Number(event.count) || 1))),
    species: shortText(event.species || '', 50) || null,
  });
  if (event.kind === 'pokemon_capture') return Object.assign(common, {
    pokemon: relayPokemon(event.pokemon),
    reasons: captureReasons(event.pokemon, settings),
  });
  if (event.kind === 'party_death') return Object.assign(common, { pokemon:relayPokemon(event.pokemon) });
  if (event.kind === 'repeated_stall') return Object.assign(common, {
    attempts: Math.max(2, Math.min(1000, Math.round(Number(event.attempts) || 2))),
    timeoutSeconds: safeNumber(event.timeoutSeconds, 1, 3600),
  });
  if (event.kind === 'test') return { kind:'test', at:common.at };
  return null;
}

function createDiscordRelayNotifier(getSettings, getIdentity, options = {}) {
  const baseUrl = String(options.baseUrl || '').replace(/\/+$/, '');
  const publishableKey = String(options.publishableKey || '');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1, options.timeoutMs) : 10000;
  let queue = Promise.resolve();
  let lastError = null;
  let lastSuccessAt = 0;

  async function post(event) {
    const settings = normalizeDiscordNotifications(typeof getSettings === 'function' ? getSettings() : getSettings);
    if (!relayEventEnabled(event, settings)) return { ok:false, skipped:true };
    const identity = typeof getIdentity === 'function' ? getIdentity() : getIdentity;
    if (!identity || !UUID_PATTERN.test(String(identity.clientId || '')) || !TOKEN_PATTERN.test(String(identity.clientToken || ''))) {
      throw new Error('Identidade comunitária ainda não está pronta.');
    }
    if (!baseUrl || !publishableKey || typeof fetchImpl !== 'function') throw new Error('Canal seguro de notificações indisponível.');
    const serialized = serializeRelayEvent(event, settings);
    if (!serialized || !buildDiscordPayload(event, settings)) return { ok:false, skipped:true };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/functions/v1/discord-notification`, {
        method:'POST',
        headers:{ apikey:publishableKey, accept:'application/json', 'content-type':'application/json' },
        body:JSON.stringify({
          schema_version:1,
          app_version:String(identity.appVersion || '0.0.0'),
          client_id:identity.clientId,
          client_token:identity.clientToken,
          discord_user_id:CRITICAL_EVENTS.has(event.kind) ? normalizeDiscordUserId(settings.discordUserId) : null,
          event:serialized,
        }),
        signal:controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Tempo esgotado ao enviar a notificação.');
      throw new Error('Não foi possível acessar o canal seguro de notificações.');
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response.ok || !data || data.ok !== true) {
      const code = data && typeof data.error === 'string' ? data.error : `status_${response.status}`;
      throw new Error(code === 'rate_limited' ? 'Muitas notificações em pouco tempo.' : 'Falha no canal seguro de notificações.');
    }
    return { ok:true, status:response.status };
  }

  function notify(event) {
    const job = () => post(event)
      .then((result) => { if (result.ok) { lastError = null; lastSuccessAt = Date.now(); } return result; })
      .catch((error) => { lastError = error && error.message ? error.message : 'Falha ao enviar ao Discord.'; return { ok:false, error:lastError }; });
    queue = queue.then(job, job);
    return queue;
  }

  return { notify, status:() => ({ lastError, lastSuccessAt:lastSuccessAt || null }) };
}

module.exports = { createDiscordRelayNotifier, relayEventEnabled, serializeRelayEvent };
