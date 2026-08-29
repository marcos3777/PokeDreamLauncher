'use strict';

const https = require('https');
const { rareItemName } = require('./rare-items');

const DEFAULT_DISCORD_NOTIFICATIONS = Object.freeze({
  enabled: true,
  rareDrops: true,
  mythicCaptures: true,
  shinyCaptures: true,
  taskCompletions: false,
  partyDeaths: false,
  repeatedStalls: false,
});

const COMMUNITY_CHANNEL_SETTINGS = new Set(['enabled', 'rareDrops', 'mythicCaptures', 'shinyCaptures']);

const EVENT_SETTING = Object.freeze({
  rare_drop: 'rareDrops',
  task_completed: 'taskCompletions',
  party_death: 'partyDeaths',
  repeated_stall: 'repeatedStalls',
});

const CRITICAL_EVENTS = new Set(['party_death', 'repeated_stall', 'task_completed']);

function isDiscordWebhookUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:'
      && ['discord.com', 'discordapp.com', 'canary.discord.com', 'ptb.discord.com'].includes(host)
      && /^\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/.test(url.pathname);
  } catch { return false; }
}

function normalizeDiscordNotifications(value, currentWebhookUrl = '', currentCriticalWebhookUrl = '') {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {};
  for (const [key, fallback] of Object.entries(DEFAULT_DISCORD_NOTIFICATIONS)) {
    result[key] = COMMUNITY_CHANNEL_SETTINGS.has(key)
      ? true
      : (Object.prototype.hasOwnProperty.call(source, key) ? source[key] === true : fallback);
  }
  const requestedUrl = typeof source.webhookUrl === 'string' ? source.webhookUrl.trim() : '';
  result.webhookUrl = isDiscordWebhookUrl(requestedUrl)
    ? requestedUrl
    : (isDiscordWebhookUrl(currentWebhookUrl) ? currentWebhookUrl : '');
  const requestedCriticalUrl = typeof source.criticalWebhookUrl === 'string' ? source.criticalWebhookUrl.trim() : '';
  result.criticalWebhookUrl = isDiscordWebhookUrl(requestedCriticalUrl)
    ? requestedCriticalUrl
    : (isDiscordWebhookUrl(currentCriticalWebhookUrl) ? currentCriticalWebhookUrl : '');
  if (!result.criticalWebhookUrl) {
    result.taskCompletions = false;
    result.partyDeaths = false;
    result.repeatedStalls = false;
  } else if (Object.prototype.hasOwnProperty.call(source, 'criticalAlertsEnabled') && source.criticalAlertsEnabled !== true) {
    // Migração do controle geral antigo: se ele estava desligado, os alertas
    // pessoais também começam desligados na nova tela.
    result.partyDeaths = false;
    result.repeatedStalls = false;
  }
  return result;
}

function samePosition(a, b) {
  return a && b && a.x != null && a.y != null && String(a.x) === String(b.x) && String(a.y) === String(b.y);
}

function collectRareDrops(events) {
  if (!Array.isArray(events)) return [];
  const kills = events.filter((event) => event && event.t === 'kill' && event.species);
  const result = [];
  for (const loot of events) {
    if (!loot || loot.t !== 'loot' || !Array.isArray(loot.items)) continue;
    const exact = kills.filter((kill) => samePosition(kill, loot));
    const kill = exact.length ? exact[exact.length - 1] : (kills.length === 1 ? kills[0] : null);
    for (const item of loot.items) {
      const name = rareItemName(item && item.id);
      if (!name) continue;
      result.push({
        kind: 'rare_drop',
        itemId: String(item.id),
        itemName: name,
        count: Math.max(1, Math.round(Number(item.count) || 1)),
        species: kill && kill.species ? String(kill.species) : null,
      });
    }
  }
  return result;
}

function isMythicPokemon(pokemon) {
  return !!pokemon && /^mythic$/i.test(String(pokemon.essence || pokemon.tier || '').trim());
}

function captureReasons(pokemon, settings) {
  const reasons = [];
  if (pokemon && pokemon.shiny === true && settings.shinyCaptures) reasons.push('Shiny');
  if (isMythicPokemon(pokemon) && settings.mythicCaptures) reasons.push('Mythic');
  return reasons;
}

function shortText(value, max = 1000) {
  const text = String(value == null ? '' : value).trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function accountLabel(event) {
  return shortText(event.characterName || (event.slot ? `Tela ${event.slot}` : 'Personagem não identificado'), 200);
}

function pokemonFields(pokemon) {
  const p = pokemon || {};
  const fields = [];
  if (p.level != null) fields.push({ name:'Nível', value:String(p.level), inline:true });
  if (p.potential != null) fields.push({ name:'Potência', value:`${p.potential}%`, inline:true });
  if (p.essence || p.tier) fields.push({ name:'Tier', value:shortText(p.essence || p.tier, 100), inline:true });
  if (p.caughtBall) fields.push({ name:'Capturado com', value:shortText(String(p.caughtBall).replace(/_/g, ' '), 100), inline:true });
  return fields;
}

function buildDiscordPayload(event, settings) {
  if (!event || typeof event !== 'object') return null;
  const who = accountLabel(event);
  let embed = null;
  if (event.kind === 'rare_drop') {
    embed = {
      title: '✨ Drop raro',
      color: 0xF5C85D,
      description: `**${shortText(event.itemName, 200)}**${Number(event.count) > 1 ? ` ×${Number(event.count)}` : ''}`,
      fields: [
        { name:'Personagem', value:who, inline:true },
        { name:'Drop de', value:shortText(event.species || 'Pokémon não identificado', 200), inline:true },
      ],
    };
  } else if (event.kind === 'pokemon_capture') {
    const reasons = captureReasons(event.pokemon, settings);
    if (!reasons.length) return null;
    const pokemon = event.pokemon || {};
    embed = {
      title: `${reasons.includes('Shiny') ? '✨' : '🌟'} Captura ${reasons.join(' + ')}`,
      color: reasons.includes('Shiny') ? 0xF5C85D : 0x9B6DFF,
      description: `**${shortText(pokemon.species || 'Pokémon', 200)}** foi capturado por **${who}**.`,
      fields: pokemonFields(pokemon),
    };
  } else if (event.kind === 'task_completed') {
    embed = {
      title: '✅ Task concluída',
      color: 0x61D692,
      description: `**${shortText(event.species || 'Task', 200)}** foi concluída por **${who}**.`,
      fields: [
        { name:'Trilha', value:shortText(event.trackLabel || event.trackId || 'Não identificada', 100), inline:true },
        { name:'Objetivo', value:`${Math.max(1, Math.round(Number(event.target) || 1)).toLocaleString('pt-BR')} abates`, inline:true },
      ],
    };
  } else if (event.kind === 'party_death') {
    const pokemon = event.pokemon || {};
    embed = {
      title: '💀 Pokémon da party morreu',
      color: 0xF06A73,
      description: `**${shortText(pokemon.species || 'Pokémon', 200)}** de **${who}** ficou sem HP.`,
      fields: pokemonFields(pokemon),
    };
  } else if (event.kind === 'repeated_stall') {
    embed = {
      title: '⚠️ Tela travou novamente',
      color: 0xF0AA5F,
      description: `A tela de **${who}** precisou do F5 automático pela **${Math.max(2, Number(event.attempts) || 2)}ª vez seguida**.`,
      fields: event.timeoutSeconds != null ? [{ name:'Tempo sem resposta', value:`${event.timeoutSeconds} segundos`, inline:true }] : [],
    };
  } else if (event.kind === 'test') {
    embed = {
      title: '✅ Webhook conectado',
      color: 0x61D692,
      description: 'As notificações do Poke Dream Launcher estão funcionando.',
    };
  }
  if (!embed) return null;
  embed.timestamp = new Date(event.at || Date.now()).toISOString();
  embed.footer = { text:'Poke Dream Launcher' };
  return {
    username:'Poke Dream Launcher',
    allowed_mentions:{ parse:[] },
    embeds:[embed],
  };
}

function eventEnabled(event, settings) {
  if (event.kind === 'test') return !!settings.webhookUrl;
  if (event.kind === 'task_completed') return settings.taskCompletions === true && !!settings.criticalWebhookUrl;
  if (CRITICAL_EVENTS.has(event.kind)) {
    const key = EVENT_SETTING[event.kind];
    return !!settings.criticalWebhookUrl
      && !!key
      && settings[key] === true;
  }
  if (!settings.enabled || !settings.webhookUrl) return false;
  if (event.kind === 'pokemon_capture') return captureReasons(event.pokemon, settings).length > 0;
  const key = EVENT_SETTING[event.kind];
  return !!key && settings[key] === true;
}

function webhookForEvent(event, settings) {
  return event && CRITICAL_EVENTS.has(event.kind) ? settings.criticalWebhookUrl : settings.webhookUrl;
}

function postDiscordWebhook(webhookUrl, payload, request = https.request) {
  return new Promise((resolve, reject) => {
    if (!isDiscordWebhookUrl(webhookUrl)) { reject(new Error('Webhook do Discord inválido.')); return; }
    const data = Buffer.from(JSON.stringify(payload));
    const req = request(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'User-Agent': 'Poke-Dream-Launcher',
      },
    }, (res) => {
      res.resume();
      res.on('end', () => {
        const status = Number(res.statusCode) || 0;
        if (status >= 200 && status < 300) resolve({ ok:true, status });
        else reject(new Error(`Discord respondeu com status ${status || 'desconhecido'}.`));
      });
    });
    req.setTimeout(10000, () => req.destroy(new Error('Tempo esgotado ao chamar o Discord.')));
    req.on('error', reject);
    req.end(data);
  });
}

function createDiscordNotifier(getSettings, options = {}) {
  let queue = Promise.resolve();
  let lastError = null;
  let lastSuccessAt = 0;
  const request = options.request || https.request;
  function notify(event) {
    const settings = normalizeDiscordNotifications(typeof getSettings === 'function' ? getSettings() : getSettings);
    if (!eventEnabled(event, settings)) return Promise.resolve({ ok:false, skipped:true });
    const payload = buildDiscordPayload(event, settings);
    if (!payload) return Promise.resolve({ ok:false, skipped:true });
    const job = () => postDiscordWebhook(webhookForEvent(event, settings), payload, request)
      .then((result) => { lastError = null; lastSuccessAt = Date.now(); return result; })
      .catch((error) => { lastError = error && error.message ? error.message : 'Falha ao enviar ao Discord.'; return { ok:false, error:lastError }; });
    queue = queue.then(job, job);
    return queue;
  }
  return {
    notify,
    status: () => ({ lastError, lastSuccessAt: lastSuccessAt || null }),
  };
}

module.exports = {
  DEFAULT_DISCORD_NOTIFICATIONS,
  buildDiscordPayload,
  collectRareDrops,
  createDiscordNotifier,
  eventEnabled,
  isDiscordWebhookUrl,
  isMythicPokemon,
  normalizeDiscordNotifications,
  postDiscordWebhook,
  webhookForEvent,
};
