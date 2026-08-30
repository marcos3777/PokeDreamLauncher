'use strict';

const { app, BaseWindow, WebContentsView, ipcMain, safeStorage, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');
const { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, createCommunityClient, huntLogToAccountStats } = require('./community');
const { describeBroke, describeSequences, huntBaseline, huntDelta, huntSpeciesFromId, recordObservation } = require('./hunt-metrics');
const { acceptWorldFrame, activeUidFromParty, applyActiveProgress, applyKeyedDelta, applyObjectDelta, applyPartyDelta, parseWorldFrame, parseWorldMessage } = require('./world-frame');
const { collectRareDrops, createDiscordNotifier, isDiscordWebhookUrl, normalizeDiscordNotifications } = require('./discord-notifications');
const { createDiscordRelayNotifier } = require('./discord-relay');
const { KILL_STALL_MAX_SECONDS, KILL_STALL_MIN_SECONDS, KILL_STALL_TIMEOUT_MS, createKillWatchState, normalizeKillStallTimeoutSeconds, observeKill, resetKillWatch, shouldReloadForKillStall } = require('./kill-watch');
const { learnLootSourcesFromDump, normalizeLootSources, observeLootSources } = require('./loot-sources');
const { buildPokemonCatalog, buildPokemonHub } = require('./pokemon-hub');
const { isRareItem } = require('./rare-items');
const { DREAM_TAB_ID, MAX_TABS, MAX_VIEWS_PER_TAB, normalizeSiteUrl, restoreWorkspaceState, sitePartition } = require('./site-tabs');
const { buildXpOverlayScript, createXpRate, observeKillXp, resetXpRate, xpPerHour } = require('./xp-rate');
const { HUNT_PERFORMANCE_FIRST_MS, HUNT_PERFORMANCE_INTERVAL_MS, HUNT_PERFORMANCE_V, activeXpBuffs, backfillTrainerNameForAccount, communityPerformanceRecords, createPerformanceBaseline, markCommunityPerformanceRecordsSynced, normalizeHuntPerformance, performanceDelta, updatePerformanceRecords, xpRuneBonusRate } = require('./hunt-performance');
const { TASK_TRACKS, applyTaskDelta, completedTaskTrackCount, taskEntriesForTrack, taskMapFromState } = require('./task-catalog');

const GAME_URL = 'https://pokedream.com.br/';
const GAME_DOMAIN = 'pokedream.com.br';
const DISCORD_URL = 'https://discord.gg/2arUMCJJm';
const MAXV = MAX_VIEWS_PER_TAB;
const FUTURE_ACCOUNT_LIMIT = 2;
const TAB_BAR = 36;
const TOOL_BAR = 46;
const BAR = TAB_BAR + TOOL_BAR;
const SIDE_W = 220;
const GAP = 3;
const COMMUNITY_SEND_INTERVAL_MS = 5 * 60 * 1000 + 5000;
const COMMUNITY_QUIT_TIMEOUT_MS = 3000;
const COMMUNITY_HUB_WAIT_MS = 1500;
const XP_PANEL_WIDTH = 430;
const CRITICAL_DISCORD_EVENTS = new Set(['party_death', 'repeated_stall', 'task_completed']);
const TASK_DEFINITION_BY_ID = new Map(Object.values(TASK_TRACKS).flatMap((track) => track.tasks.map((definition) => [definition.id, { track, definition }])));

// userData persistente (nao some ao fechar)
app.setPath('userData', path.join(app.getPath('appData'), 'poke-dream-launcher'));

let win = null;
let launcherMinimized = false;
let launcherRepaintTimer = null;
let launcherRecomposeTimer = null;
let launcherRecomposePending = false;
let dashView = null;
const games = [];
const siteTabs = [];
let activeTabId = DREAM_TAB_ID;
let restoringWorkspace = false;
let selectedSlot = null;
let gameMode = 'grid';
let storageDir = null;
let cfgView = null;      // overlay do menu de config (view própria, por cima das telas do jogo)
let cfgOpen = false;
let xpView = null;       // resumo flutuante e movível de XP/h de todas as telas
let xpPanelOpen = false;
let xpPanelPosition = null;
let xpPanelSize = null;
let xpPanelSizeCustomized = false;
let tabDialogOpen = false;
let sidebarHidden = false;   // barra da esquerda escondida -> telas do jogo ocupam a largura toda
let boxOpen = false;         // Box unificada aberta -> esconde as telas do jogo pra mostrar o painel
let diagOn = false;      // modo diagnóstico: grava frames WS + respostas REST num dump (pra ver o que o jogo manda)
let DUMP_FILE = null;
let SESSION_FILE = null;   // guarda quantas telas estavam abertas, pra reabrir na próxima vez
let SETTINGS_FILE = null;  // preferências (som)
let COMMUNITY_FILE = null; // identidade/revisão comunitária, redundante às preferências
let HUNTLOG_FILE = null;   // histórico acumulado de caçada por espécie
let HUNT_PERFORMANCE_FILE = null; // melhores ritmos observados localmente por espécie
let ITEM_SOURCES_FILE = null; // fontes de drop observadas localmente nos eventos de kill + loot
let DISCORD_FILE = null; // webhook e preferências ficam só neste computador, fora do código do launcher
let soundEnabled = true;   // tocar som ao capturar shiny
let soundVolume = 0.8;     // 0..1
let soundPath = null;      // caminho de um áudio do PC do usuário; null = som padrão embutido
let itemVis = { poke_ball: true, ultra_ball: true, premier_ball: true, potion: true, revive: true };  // quais itens aparecem na barra
let itemAlert = { poke_ball: 2000, ultra_ball: 2000, premier_ball: 2000, potion: 2000, revive: 500 };  // limite p/ borda vermelha (0 = sem alerta)
let xpHudEnabled = true; // selo XP/h por tela + painel conjunto
let killWatchTimer = null;
let killStallTimeoutSeconds = KILL_STALL_TIMEOUT_MS / 1000;
let discordNotifications = normalizeDiscordNotifications(null);
let clientId = null;        // id anônimo e aleatório; só serve pra deduplicar o envio ao banco comunitário
let communityToken = null;  // segredo aleatório desta instalação; nunca é exposto à interface
let communityRevision = 0;  // ordem monotônica dos snapshots (evita um envio antigo sobrescrever o novo)
let communityLastSuccessAt = 0;
let communityLastError = null;
let communitySubmitInFlight = null;
let communitySyncInFlight = null;
let communityTimer = null;
let communityNextSyncAt = 0;
let huntLogSaveTimer = null;
let itemSourcesSaveTimer = null;
let itemDropSources = {};
let huntPerformance = { v: HUNT_PERFORMANCE_V, data: {} };
let huntPerformanceTimer = null;
let persistentStateLoaded = false;
let communityQuitPending = false;
let communityQuitFlushed = false;
const communityClient = createCommunityClient();
const discordRelayNotifier = createDiscordRelayNotifier(
  () => discordNotifications,
  () => ({ clientId, clientToken:communityToken, appVersion:app.getVersion() }),
  { baseUrl:SUPABASE_URL, publishableKey:SUPABASE_PUBLISHABLE_KEY },
);
const criticalDiscordNotifier = createDiscordNotifier(() => discordNotifications);
let diagLines = 0;

// ---- diagnóstico: captura de rede (só grava quando diagOn) ----
function diagWrite(obj) {
  if (!DUMP_FILE || diagLines > 40000) return;   // teto pra não virar GB
  try { fs.appendFileSync(DUMP_FILE, JSON.stringify(obj) + '\n'); diagLines++; } catch {}
}
// as 4 telas mandam praticamente a mesma coisa -> grava só a PRIMEIRA tela (1º card da lista) pra não poluir o dump
function isDumpSlot(slot) { return games.length > 0 && games[0].slot === slot; }
function dumpWs(slot, dir, payload, isBinary) {
  if (isBinary) {   // frames binários podem conter credenciais e não são gravados em claro
    const size = Math.floor(String(payload || '').length * 3 / 4);
    diagWrite({ slot, ts: Date.now(), kind: 'ws', dir, type: 'binary', raw: '<binary omitted>', size });
    return;
  }
  let type = 'unknown';
  try {
    const s = String(payload);
    // Socket.IO: "42/namespace,[\"evento\",...]" ou "42[\"evento\",...]"; Engine.IO: só dígitos ("2","3")
    const m = s.match(/^\d+(\/[^,[]+)?,?(\[[\s\S]*)$/);
    if (m && m[2]) {
      const arr = JSON.parse(m[2]);
      if (Array.isArray(arr) && typeof arr[0] === 'string') type = (m[1] ? m[1].slice(1) + ' ' : '') + arr[0];
    } else if (/^\d+$/.test(s)) {
      type = 'engineio/' + s;   // ping/pong/handshake — ruído
    } else {
      const j = JSON.parse(s); if (j && j.type) type = j.type;
    }
  } catch {}
  diagWrite({ slot, ts: Date.now(), kind: 'ws', dir, type, raw: diagWsPayload(payload) });
}
const REDACT = /([?&](?:token|access_token|jwt|auth|refresh(?:Token)?|password)=)[^&]*/gi;
const SENSITIVE_DIAG_KEY = /^(?:(?:access|refresh|auth|id)?_?token|jwt|password|authorization|secret|email|api_?key|character_?id|user_?id|account_?id|run_?id)$/i;
const IDENTITY_DIAG_KEY = /^(?:id|name|display_?name|username)$/i;
function diagUrl(url) {
  return String(url)
    .replace(REDACT, '$1<redacted>')
    .replace(/(\/characters\/)[^/?]+/gi, '$1<redacted>')
    .replace(/(\/(?:world\/route|chat\/dm)\/)[^/?]+/gi, '$1<redacted>');
}
function redactDiagValue(value, depth = 0, redactIdentity = false) {
  if (depth > 12 || value == null) return value;
  if (Array.isArray(value)) return value.map((entry) => redactDiagValue(entry, depth + 1, redactIdentity));
  if (typeof value === 'object') {
    const clean = {};
    for (const [key, entry] of Object.entries(value)) {
      clean[key] = (SENSITIVE_DIAG_KEY.test(key) || (redactIdentity && IDENTITY_DIAG_KEY.test(key)))
        ? '<redacted>'
        : redactDiagValue(entry, depth + 1, redactIdentity);
    }
    return clean;
  }
  if (typeof value === 'string' && /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return '<redacted-jwt>';
  return value;
}
function isIdentityDiagUrl(url) {
  return /\/auth(?:\/|\?|$)|\/characters(?:\?|$)/i.test(String(url || ''));
}
function diagBody(body, url) {
  const redactIdentity = isIdentityDiagUrl(url);
  try { return JSON.stringify(redactDiagValue(JSON.parse(body), 0, redactIdentity)); }
  catch {
    let text = String(body || '')
      .replace(REDACT, '$1<redacted>')
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<redacted-jwt>')
      .replace(/("(?:accessToken|refreshToken|token|password|email)"\s*:\s*")[^"]*(")/gi, '$1<redacted>$2');
    if (redactIdentity) text = text.replace(/("(?:id|name|displayName|username)"\s*:\s*)(?:"[^"]*"|[0-9]+)/gi, '$1"<redacted>"');
    return text;
  }
}
function diagWsPayload(payload) {
  const text = String(payload || '');
  const socket = text.match(/^(\d+(?:\/[^,[]+)?,?)(\[[\s\S]*)$/);
  if (socket) {
    try { return socket[1] + JSON.stringify(redactDiagValue(JSON.parse(socket[2]))); }
    catch {}
  }
  return diagBody(text);
}
function dumpHttp(slot, url, body, b64) {
  let raw = body; if (b64) { try { raw = Buffer.from(body, 'base64').toString('utf8'); } catch {} }
  raw = diagBody(raw, url);
  if (raw && raw.length > 1000000) raw = raw.slice(0, 1000000) + '…[truncado]';
  diagWrite({ slot, ts: Date.now(), kind: 'http', url: diagUrl(url), raw });
}
function dumpHttpReq(slot, url, body) {   // corpo do REQUEST (ex.: compra ou venda em /actions)
  let raw = diagBody(body, url); if (raw && raw.length > 1000000) raw = raw.slice(0, 1000000) + '…[truncado]';
  diagWrite({ slot, ts: Date.now(), kind: 'http-req', url: diagUrl(url), raw });
}

// ---- extrai nome / hunt / pokémon ATIVO do estado pra alimentar a sidebar ----
// progress.activeUid = uid do pokémon ativo na hunt (muda quando você troca). Casa com o box pelo uid.
// shiny = a entrada do box tem `shiny:true`.
// XP por nível (fórmula do jogo: floor(xpBase * level^xpExp), xpBase=20, xpExp=1.5)
function xpNeeded(level) { return Math.floor(20 * Math.pow(Math.max(1, level || 1), 1.5)); }
function xpPct(p) { if (!p || p.xp == null || p.level == null) return null; const n = xpNeeded(p.level); if (!n) return 0; return Math.max(0, Math.min(100, Math.round(p.xp / n * 100))); }
function pokeView(g, uid) { const p = g._box && g._box[uid]; if (!p) return null; return { species: p.species, level: p.level, shiny: !!p.shiny, xpPct: xpPct(p) }; }

// recomputa g.active (pokémon ativo na hunt) + g.party2 (2º da party) -> devolve true se algo mudou
function refreshActive(g) {
  const active = g._activeUid != null ? pokeView(g, g._activeUid) : null;
  const p2uid = (Array.isArray(g._party) && g._party.length > 1) ? g._party[1] : null;
  const party2 = p2uid != null ? pokeView(g, p2uid) : null;
  const sig = JSON.stringify([active, party2]);
  if (sig === g._sig) return false;
  g._sig = sig; g.active = active; g.party2 = party2;
  return true;
}
// reconstrói a Box a partir do estado completo de /offline
// e detecta shiny NOVO -> dispara o som. Baseline: o 1º box visto (carga) não toca nada.
function rebuildBox(g, boxArr) {
  g._box = {};
  for (const p of boxArr) if (p && p.uid != null) g._box[p.uid] = { uid: p.uid, species: p.species, level: p.level, xp: p.xp, hp: p.hp, shiny: !!p.shiny, potential: p.potential, essence: p.essence, caughtBall: p.caughtBall, stored: p.stored };
  g._freshShinyBatch = checkShinyCaptures(g);
}
function discordEvent(g, event) {
  const notification = Object.assign({
    characterName: g && g.charName,
    slot: g && g.slot,
    at: Date.now(),
  }, event);
  const notifier = CRITICAL_DISCORD_EVENTS.has(notification.kind) ? criticalDiscordNotifier : discordRelayNotifier;
  notifier.notify(notification);
}
function checkShinyCaptures(g) {
  const known = g._boxUids || (g._boxUids = new Set());
  const first = !g._baselineDone;
  const fresh = [];
  for (const uid in g._box) {
    const p = g._box[uid];
    if (!p || known.has(String(uid))) continue;
    known.add(String(uid));
    if (!first) fresh.push(p);
  }
  g._baselineDone = true;
  if (!first) for (const p of fresh) {
    if (p.shiny && dashView) send(dashView, 'shiny-caught', { slot: g.slot, species: p.species });
    discordEvent(g, { kind:'pokemon_capture', pokemon:Object.assign({}, p) });
  }
  const shinies = fresh.filter((p) => p.shiny);
  if (shinies.length) g._freshShinyAt = Date.now();
  return shinies.map((p) => p.species);
}

function partyHpSnapshot(g) {
  const result = new Map();
  for (const uid of (Array.isArray(g && g._party) ? g._party : [])) {
    const pokemon = g._box && g._box[uid];
    if (pokemon && Number.isFinite(Number(pokemon.hp))) result.set(String(uid), Number(pokemon.hp));
  }
  return result;
}

function observePartyDeaths(g, before) {
  if (!(before instanceof Map)) return;
  for (const uid of (Array.isArray(g._party) ? g._party : [])) {
    const previousHp = before.get(String(uid));
    const pokemon = g._box && g._box[uid];
    const hp = Number(pokemon && pokemon.hp);
    if (Number.isFinite(previousHp) && previousHp > 0 && Number.isFinite(hp) && hp <= 0) {
      discordEvent(g, { kind:'party_death', pokemon:Object.assign({}, pokemon) });
    }
  }
}

function notifyTaskCompletions(g, completions) {
  for (const completion of (Array.isArray(completions) ? completions : [])) {
    const found = TASK_DEFINITION_BY_ID.get(completion.id);
    if (!found) continue;
    discordEvent(g, {
      kind:'task_completed',
      taskId:found.definition.id,
      species:found.definition.species,
      trackId:found.track.id,
      trackLabel:found.track.label,
      target:found.definition.target,
      completed:completion.completed,
    });
  }
}

function taskOverviewPayload() {
  return {
    notificationsEnabled: discordNotifications.taskCompletions === true,
    notificationsConfigured: !!discordNotifications.criticalWebhookUrl,
    accounts:games.map((g) => ({
      slot:g.slot,
      name:g.charName || ('Tela ' + g.slot),
      hunt:g.hunt == null ? null : String(g.hunt),
      ready:!!g._charId && Object.keys(g._tasks || {}).length > 0,
      tracks:Object.fromEntries(Object.values(TASK_TRACKS).map((track) => [track.id, {
        id:track.id,
        label:track.label,
        icon:track.icon,
        tasks:taskEntriesForTrack(track.id, g._tasks),
      }])),
    })),
  };
}

function pushTaskOverview() {
  if (dashView) send(dashView, 'task-overview', taskOverviewPayload());
}
// estatísticas: guarda o estado-base de /offline e os deltas recebidos em world:frame
// + um baseline com timestamp, pra calcular as taxas da sessão (por hora).
const STAT_NUMS = ['totalCaught', 'kills', 'shinyKills', 'money', 'trainerLevel', 'trainerXp', 'level'];
function grabStats(g, prog) {
  if (!prog) return;
  const s = g._stats || (g._stats = {});
  for (const k of STAT_NUMS) if (typeof prog[k] === 'number') s[k] = prog[k];
  // espécie da hunt atual: o wilds traz a grafia exata (ex. "MrMime"), melhor que derivar do huntId
  if (Array.isArray(prog.wilds)) {
    const species = [...new Set(prog.wilds.map(x => x && (x.spawnSpecies || x.species)).filter(Boolean))];
    s.huntSpeciesList = species;
    s.huntSpecies = species[0] || null;
  }
  // baseline da sessão: 1ª leitura vira a referência pras taxas /h
  if (!g._statBase && s.kills != null) g._statBase = { ts: Date.now(), totalCaught: s.totalCaught, kills: s.kills, shinyKills: s.shinyKills, money: s.money };
  if (g._statBase) {
    for (const k of ['totalCaught', 'kills', 'shinyKills', 'money']) {
      if (g._statBase[k] == null && s[k] != null) g._statBase[k] = s[k];
    }
  }
  // baseline da HUNT: zera sempre que a hunt muda, pra medir só a caçada atual
  if (s.kills != null && (!g._huntBase || g._huntBase.huntId !== g.hunt)) {
    g._huntBase = huntBaseline(g.hunt, s);
  }
  if (g._huntBase) {
    for (const k of ['totalCaught', 'kills', 'shinyKills']) {
      if (g._huntBase[k] == null && s[k] != null) g._huntBase[k] = s[k];
    }
  }
  accumulateHuntLog(g, prog, s);
}

// ---- histórico acumulado por espécie (persiste em disco; soma todas as contas) ----
// As bolas são agrupadas por chance de captura: Poke de um lado, Ultra+Premier do outro.
const BALL_A = ['poke_ball'], BALL_B = ['ultra_ball', 'premier_ball'];
const MAX_GAP_MS = 60000;   // pausa maior que isso não conta como tempo de caçada
let huntLog = {}, huntLogDirty = false, legacyHuntLog = null;

function sumBalls(bag, keys) { let n = 0; for (const k of keys) n += (bag && bag[k]) || 0; return n; }
function huntEntry(sp) {
  return huntLog[sp] || (huntLog[sp] = { ms: 0, kills: 0, caught: 0, shinies: 0, shinyCaught: 0, thrownA: 0, thrownB: 0, caughtA: 0, caughtB: 0, captureDryBalls: 0, dryBalls: 0, dryKills: 0, updated: 0 });
}
function accumulateHuntLog(g, prog, s) {
  const sp = s.huntSpecies;
  const speciesList = Array.isArray(s.huntSpeciesList) && s.huntSpeciesList.length ? s.huntSpeciesList : (sp ? [sp] : []);
  const prev = g._accPrev;
  const now = Date.now();
  // nos frames a bag é incremental; conserva o último estado completo para calcular as quedas
  const bag = prog.bag || g._bag;
  // shinyKills conta shinies encontrados/derrotados; capturas continuam separadas em totalCaught.
  const cur = { ts: now, huntId: g.hunt, species: sp, speciesCount: speciesList.length, kills: s.kills, caught: s.totalCaught, shinies: s.shinyKills,
                ballA: bag ? sumBalls(bag, BALL_A) : null, ballB: bag ? sumBalls(bag, BALL_B) : null };
  g._accPrev = cur;
  const primaryObserver = g._charId ? games.find((other) => other._charId === g._charId) : null;
  if (primaryObserver && primaryObserver !== g) return;
  // Os contadores globais não dizem qual espécie mudou. Em hunts com várias espécies, o
  // launcher não inventa uma atribuição por espécie.
  if (!sp || speciesList.length !== 1 || !prev || prev.speciesCount !== 1 || prev.huntId !== g.hunt || prev.species !== sp) return;

  const e = huntEntry(sp);
  const gap = now - prev.ts;
  const timeAdvanced = gap > 0 && gap < MAX_GAP_MS;

  const dKills = (cur.kills != null && prev.kills != null) ? Math.max(cur.kills - prev.kills, 0) : 0;
  const dCaught = (cur.caught != null && prev.caught != null) ? Math.max(cur.caught - prev.caught, 0) : 0;
  const dShiny = (cur.shinies != null && prev.shinies != null) ? Math.max(cur.shinies - prev.shinies, 0) : 0;
  // bolas: só QUEDA conta como lançamento (aumento é drop/compra)
  const tA = (cur.ballA != null && prev.ballA != null) ? Math.max(prev.ballA - cur.ballA, 0) : 0;
  const tB = (cur.ballB != null && prev.ballB != null) ? Math.max(prev.ballB - cur.ballB, 0) : 0;
  const freshShinyIsRecent = g._freshShinyAt && now - g._freshShinyAt < 5000;
  const confirmedShinyCaught = dCaught && freshShinyIsRecent && Array.isArray(g._freshShinyBatch)
    ? g._freshShinyBatch.filter((species) => species === sp).length
    : 0;
  if (dCaught) { g._freshShinyBatch = []; g._freshShinyAt = 0; }
  if (recordObservation(e, {
    ms: timeAdvanced ? gap : 0,
    kills: dKills,
    caught: dCaught,
    shinies: dShiny,
    shinyCaught: confirmedShinyCaught,
    thrownA: tA,
    thrownB: tB,
    // o broke é uma sequência por personagem — nunca soma entre contas
    account: { key: g._charId ? 'id:' + g._charId : 'slot:' + g.slot, name: g.charName || ('Tela ' + g.slot) },
    now,
  })) huntLogDirty = true;
}
// v4: reinício da amostra após a atualização do protocolo do jogo em 22/08/2026.
// O histórico anterior continua recuperável no backup local, mas não volta para a comunidade.
const HUNTLOG_V = 4;
function loadHuntLog() {
  const j = readJsonWithBackup(HUNTLOG_FILE);
  const valid = !!(j && j.v === HUNTLOG_V && j.data && typeof j.data === 'object');
  huntLog = valid ? j.data : {};
  legacyHuntLog = j && !valid ? j : null;
  if (legacyHuntLog) huntLogDirty = true;
}
function preserveLegacyHuntLog() {
  if (!legacyHuntLog) return true;
  const version = Number.isSafeInteger(legacyHuntLog.v) && legacyHuntLog.v >= 0 ? `v${legacyHuntLog.v}` : 'legacy';
  const file = `${HUNTLOG_FILE}.${version}.bak`;
  try {
    const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (existing && existing.v === legacyHuntLog.v) { legacyHuntLog = null; return true; }
  } catch {}
  if (!writeJsonAtomic(file, legacyHuntLog)) return false;
  legacyHuntLog = null;
  return true;
}
function saveHuntLog() {
  if (!huntLogDirty || !HUNTLOG_FILE) return;
  if (!preserveLegacyHuntLog()) return;
  if (writeJsonAtomic(HUNTLOG_FILE, { v: HUNTLOG_V, data: huntLog })) huntLogDirty = false;
}
function updateHunt(g, huntId) {
  if (huntId == null || huntId === g.hunt) return false;
  const previousStats = g._stats || {};
  g.hunt = huntId;
  g._xpRate = resetXpRate(g._xpRate, Date.now());
  scheduleXpOverlay(g);
  // O analyzer do jogo continua acumulado. A nossa sessão nasce com a última leitura
  // conhecida como ponto zero, antes de aplicar os contadores do primeiro frame da nova hunt.
  g._huntBase = huntBaseline(huntId, previousStats);
  resetPerformanceSchedule(g);
  const remembered = g._huntSpeciesById && g._huntSpeciesById.get(String(huntId));
  const inferred = huntSpeciesFromId(huntId);
  setHuntSpecies(g, remembered || (inferred ? [inferred] : []));
  g._accPrev = accumulatorSnapshot(g, g._stats.huntSpeciesList);
  return true;
}
function accumulatorSnapshot(g, speciesList) {
  const s = g._stats || {};
  const bag = g._bag;
  return {
    ts: Date.now(), huntId: g.hunt,
    species: speciesList[0] || null, speciesCount: speciesList.length,
    kills: s.kills, caught: s.totalCaught, shinies: s.shinyKills,
    ballA: bag ? sumBalls(bag, BALL_A) : null,
    ballB: bag ? sumBalls(bag, BALL_B) : null,
  };
}
function setHuntSpecies(g, species, remember = false) {
  const values = Array.isArray(species) ? species : [species];
  const list = [...new Set(values.filter(Boolean).map(String))];
  const s = g._stats || (g._stats = {});
  const previous = Array.isArray(s.huntSpeciesList) ? s.huntSpeciesList.join('|') : '';
  s.huntSpeciesList = list;
  s.huntSpecies = list[0] || null;
  if (remember && g.hunt != null && list.length) {
    const known = g._huntSpeciesById || (g._huntSpeciesById = new Map());
    known.set(String(g.hunt), list);
  }
  if (previous !== list.join('|')) syncXpBuffWindow(g);
  return list;
}

function runeMap(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function replaceRuneMap(g, key, value) {
  const next = Object.assign({}, runeMap(value));
  const changed = JSON.stringify(g[key] || {}) !== JSON.stringify(next);
  g[key] = next;
  return changed;
}
function patchRuneMap(g, key, value) {
  const patch = runeMap(value);
  const target = g[key] || (g[key] = {});
  if (patch.u || patch.r) return applyObjectDelta(target, patch);
  let changed = false;
  for (const [name, next] of Object.entries(patch)) {
    if (target[name] !== next) { target[name] = next; changed = true; }
  }
  return changed;
}
function readRuneState(g, source, delta = false, statusAt = estimatedServerNow(g)) {
  if (!g || !source || typeof source !== 'object') return false;
  let changed = false;
  if (Object.prototype.hasOwnProperty.call(source, 'runeStages')) {
    changed = replaceRuneMap(g, '_runeStages', source.runeStages) || changed;
  } else if (Object.prototype.hasOwnProperty.call(source, 'rs')) {
    changed = (delta ? patchRuneMap(g, '_runeStages', source.rs) : replaceRuneMap(g, '_runeStages', source.rs)) || changed;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'runeAssign')) {
    changed = replaceRuneMap(g, '_runeAssign', source.runeAssign) || changed;
  } else if (Object.prototype.hasOwnProperty.call(source, 'ra')) {
    changed = (delta ? patchRuneMap(g, '_runeAssign', source.ra) : replaceRuneMap(g, '_runeAssign', source.ra)) || changed;
  }
  if (changed) syncXpBuffWindow(g, statusAt);
  return changed;
}
function xpRuneBonusForGame(g) {
  const speciesList = g && g._stats && Array.isArray(g._stats.huntSpeciesList) ? g._stats.huntSpeciesList : [];
  const species = speciesList.length === 1 ? speciesList[0] : (speciesList.length ? null : huntSpeciesFromId(g && g.hunt));
  return xpRuneBonusRate(species, g && g._runeAssign, g && g._runeStages);
}
function applyState(g, state) {   // estado completo do /offline: base para os deltas recebidos pelo WebSocket
  if (!state) return false;
  const prog = state.progress || state;
  let changed = false;
  g._freshShinyBatch = [];
  const huntChanged = updateHunt(g, state.huntId);
  if (huntChanged) changed = true;
  if (Array.isArray(prog.box)) rebuildBox(g, prog.box);
  if (prog.bag && typeof prog.bag === 'object') g._bag = prog.bag;   // mochila (item -> qtd); vem cheia
  if (Array.isArray(prog.bagLocks)) g._bagLocks = new Set(prog.bagLocks.map(String));
  if (prog.money != null) g._money = prog.money;
  if (prog.stepCount != null) g._worldStep = prog.stepCount;
  if (prog.tasks && typeof prog.tasks === 'object') {
    g._tasks = taskMapFromState(prog.tasks);
    syncXpBuffWindow(g);
  }
  if (Array.isArray(prog.party)) {
    g._party = prog.party.map((entry) => entry && typeof entry === 'object' ? entry.uid : entry).filter((uid) => uid != null);
  }
  const activeUid = prog.activeUid != null ? prog.activeUid : activeUidFromParty(prog.party);
  const activeChanged = activeUid != null && activeUid !== g._activeUid;
  if (activeUid != null) g._activeUid = activeUid;
  if (Array.isArray(prog.wilds)) {
    const species = setHuntSpecies(g, prog.wilds.map((wild) => wild && (wild.spawnSpecies || wild.species)), true);
    g._accPrev = accumulatorSnapshot(g, species);
  }
  grabStats(g, prog);
  if (refreshActive(g)) changed = true;
  if (activeChanged || huntChanged) resetPerformanceSchedule(g);
  return changed;
}
function resetCurrentHuntSequences(g) {
  const s = g._stats || {};
  const species = Array.isArray(s.huntSpeciesList) && s.huntSpeciesList.length === 1 ? s.huntSpeciesList[0] : null;
  const entry = species && huntLog[species];
  if (!entry) return;
  entry.captureDryBalls = 0;
  entry.dryBalls = 0;
  entry.dryKills = 0;
  entry.pend = 0;
  const accountKey = g._charId ? 'id:' + g._charId : 'slot:' + g.slot;
  const account = entry.accounts && entry.accounts[accountKey];
  if (account) {
    account.captureDryBalls = 0;
    account.dryKills = 0;
  }
  huntLogDirty = true;
}
function resetUncertainHuntWindow(g) {
  g._accPrev = null;
  resetCurrentHuntSequences(g);
}
function estimatedServerNow(g, localNow = Date.now()) {
  const offset = Number(g && g._serverClockOffsetMs);
  return Number(localNow) + (Number.isFinite(offset) ? offset : 0);
}
function xpBuffsForGame(g, at = estimatedServerNow(g)) {
  return activeXpBuffs({
    premiumActive: g && g._premiumActive,
    premiumUntilMs: g && g._premiumUntilMs,
    xpBoostEndsAtMs: g && g._xpBoostEndsAtMs,
    completedTaskTypes: completedTaskTrackCount(g && g._tasks),
    runeBonusRate: xpRuneBonusForGame(g),
  }, at);
}
function xpBuffSignature(buffs) {
  return Object.keys(buffs || {}).sort().map((key) => `${key}:${buffs[key]}`).join('|');
}
function syncXpBuffWindow(g, statusAt = estimatedServerNow(g)) {
  if (!g) return {};
  const buffs = xpBuffsForGame(g, statusAt);
  const signature = xpBuffSignature(buffs);
  if (g._xpBuffSignature == null) { g._xpBuffSignature = signature; return buffs; }
  if (signature === g._xpBuffSignature) return buffs;
  g._xpBuffSignature = signature;
  const now = Date.now();
  g._xpRate = resetXpRate(g._xpRate, now);
  resetPerformanceSchedule(g, now);
  scheduleXpOverlay(g);
  pushXpPanel();
  return buffs;
}
function readXpBoostState(g, progress, events, statusAt) {
  const source = progress && typeof progress === 'object' ? progress : {};
  let found = Object.prototype.hasOwnProperty.call(source, 'xpBoostEndsAtMs');
  let endsAt = found ? Number(source.xpBoostEndsAtMs) : NaN;
  for (const event of (Array.isArray(events) ? events : [])) {
    if (event && event.t === 'xpBoostUsed' && event.endsAtMs != null) {
      found = true;
      endsAt = Number(event.endsAtMs);
    }
  }
  if (found) g._xpBoostEndsAtMs = Number.isFinite(endsAt) && endsAt > 0 ? endsAt : 0;
  return syncXpBuffWindow(g, statusAt);
}
function resetCharacterState(g) {
  g._stats = null; g._statBase = null; g._huntBase = null; g._accPrev = null;
  g._box = {}; g._party = []; g._activeUid = null; g._bag = null; g._bagLocks = new Set(); g._money = null;
  g._sig = null; g.active = null; g.party2 = null; g.hunt = null;
  g._shinyUids = new Set(); g._boxUids = new Set(); g._baselineDone = false; g._freshShinyBatch = []; g._freshShinyAt = 0;
  g._worldFrameOrder = null; g._serverClockOffsetMs = null; g._xpBoostEndsAtMs = 0; g._tasks = {};
  g._runeStages = {}; g._runeAssign = {};
  g._xpBuffSignature = xpBuffSignature(xpBuffsForGame(g, Date.now()));
  g._huntSpeciesById = new Map(); g.charName = null;
  g._xpRate = resetXpRate(g._xpRate, Date.now()); scheduleXpOverlay(g);
  resetPerformanceSchedule(g);
  g._worldStep = null; resetKillWatch(g._killWatch || (g._killWatch = createKillWatchState())); resetStallRecovery(g);
}
function applyOfflineState(g, url, body) {
  const m = url.match(/\/characters\/([^/]+)\//);
  let j; try { j = JSON.parse(body); } catch { return; }
  if (m && g._charId && g._charId !== m[1]) resetCharacterState(g);
  if (m) g._charId = m[1];
  const state = j && j.state && typeof j.state === 'object' ? j.state : (j && j.progress ? j : null);
  if (!state) return;
  g._worldFrameOrder = null;
  const progress = state.progress || state;
  readRuneState(g, progress, false, estimatedServerNow(g));
  readXpBoostState(g, progress, null, estimatedServerNow(g));
  const changed = applyState(g, state);
  resolveName(g);
  if (changed || m) pushAccounts();
}
function applyWorldFrame(g, frame) {
  const order = g._worldFrameOrder || (g._worldFrameOrder = {});
  if (!acceptWorldFrame(order, frame)) return false;
  if (frame.k != null) g._worldStep = frame.k;
  if (Number.isFinite(Number(frame.t))) g._serverClockOffsetMs = Number(frame.t) - Date.now();
  const body = frame.f && typeof frame.f === 'object' ? frame.f : {};
  const player = body.p && typeof body.p === 'object' ? body.p : {};
  const esc = player.esc && typeof player.esc === 'object' ? player.esc : {};
  readXpBoostState(g, esc, body.v, Number(frame.t));
  let changed = false;

  const nextHunt = esc.huntId != null ? esc.huntId : (player.huntId != null ? player.huntId : body.huntId);
  if (updateHunt(g, nextHunt)) changed = true;

  const gameDelta = body.g && typeof body.g === 'object' ? body.g : {};
  readRuneState(g, gameDelta, true, Number(frame.t));
  const taskResult = applyTaskDelta(g._tasks || (g._tasks = {}), gameDelta.t);
  if (taskResult.changed) {
    syncXpBuffWindow(g, Number(frame.t));
    notifyTaskCompletions(g, taskResult.completions);
    changed = true;
  }
  const partyHpBefore = partyHpSnapshot(g);

  if (player.bag && !g._bag) g._bag = {};
  const bagChanged = applyObjectDelta(g._bag, player.bag);
  if (bagChanged) changed = true;

  if (Array.isArray(player.bagLocks)) {
    const nextLocks = new Set(player.bagLocks.map(String));
    if (!g._bagLocks || nextLocks.size !== g._bagLocks.size || [...nextLocks].some((itemId) => !g._bagLocks.has(itemId))) {
      g._bagLocks = nextLocks;
      changed = true;
    }
  } else if (player.bagLocks && typeof player.bagLocks === 'object') {
    const locks = g._bagLocks || (g._bagLocks = new Set());
    for (const itemId of (Array.isArray(player.bagLocks.a) ? player.bagLocks.a : [])) { if (!locks.has(String(itemId))) { locks.add(String(itemId)); changed = true; } }
    for (const itemId of (Array.isArray(player.bagLocks.r) ? player.bagLocks.r : [])) { if (locks.delete(String(itemId))) changed = true; }
  }

  if (player.box && !g._box) g._box = {};
  const boxDelta = applyKeyedDelta(g._box, player.box, 'uid');
  if (boxDelta.changed) {
    g._freshShinyBatch = checkShinyCaptures(g);
    changed = true;
  }
  if (player.party && !Array.isArray(g._party)) g._party = [];
  if (applyPartyDelta(g._party, player.party)) changed = true;

  if (esc.money != null && esc.money !== g._money) { g._money = esc.money; changed = true; }
  const deltaActiveUid = esc.activeUid != null
    ? esc.activeUid
    : (activeUidFromParty(player.party) ?? activeUidFromParty(player.box));
  if (deltaActiveUid != null && deltaActiveUid !== g._activeUid) {
    g._activeUid = deltaActiveUid;
    resetPerformanceSchedule(g);
    changed = true;
  }
  if (applyActiveProgress(g._box, g._activeUid, esc)) changed = true;
  observePartyDeaths(g, partyHpBefore);

  const hasEvents = Array.isArray(body.v) && body.v.length > 0;
  if (hasEvents && observeLootSources(body.v, itemDropSources)) scheduleItemSourcesSave();
  if (hasEvents) for (const drop of collectRareDrops(body.v)) discordEvent(g, drop);
  if (hasEvents && observeKillXp(g._xpRate, body.v) > 0) { scheduleXpOverlay(g); pushXpPanel(); }
  if (hasEvents && body.v.some((event) => event && event.t === 'kill')) {
    const killAt = Date.now();
    observeKill(g._killWatch || (g._killWatch = createKillWatchState()), killAt);
    if (g._stallRecovery && g._stallRecovery.attempts > 0 && killAt >= g._stallRecovery.lastReloadAt) {
      g._stallRecovery.recoveredAt = killAt;
    }
  }
  const hasProgress = Object.keys(esc).length > 0 || bagChanged || boxDelta.changed || hasEvents;
  if (hasProgress) {
    const progress = Object.assign({}, esc);
    if (g._bag) progress.bag = g._bag;
    grabStats(g, progress);
  }
  if (refreshActive(g)) changed = true;
  if (g._stats && g.active && g.active.level != null) g._stats.level = g.active.level;
  if (changed) pushAccounts();
  return changed;
}
function applyWorldSnapshot(g, snapshot) {
  const order = g._worldFrameOrder || (g._worldFrameOrder = {});
  if (!acceptWorldFrame(order, snapshot)) return false;
  if (snapshot.k != null) g._worldStep = snapshot.k;
  if (Number.isFinite(Number(snapshot.t))) g._serverClockOffsetMs = Number(snapshot.t) - Date.now();
  const state = snapshot.s && typeof snapshot.s === 'object' ? snapshot.s : {};
  const game = state.g && typeof state.g === 'object' ? state.g : {};
  readRuneState(g, game, false, Number(snapshot.t));
  if (game.tasks && typeof game.tasks === 'object') {
    g._tasks = taskMapFromState(game.tasks);
    syncXpBuffWindow(g, Number(snapshot.t));
  }
  const player = state.p && typeof state.p === 'object' ? state.p : {};
  const esc = player.esc && typeof player.esc === 'object' ? player.esc : {};
  readXpBoostState(g, esc, null, Number(snapshot.t));
  const progress = Object.assign({}, esc);
  for (const key of ['box', 'bag', 'bagLocks', 'party']) {
    if (player[key] != null) progress[key] = player[key];
  }
  const activeUid = activeUidFromParty(player.party) ?? activeUidFromParty(player.box);
  if (activeUid != null) progress.activeUid = activeUid;
  if (Array.isArray(state.e)) {
    progress.wilds = state.e
      .filter((entity) => entity && entity.kind === 'wild' && entity.species)
      .map((entity) => ({ species: entity.species }));
  }
  applyState(g, { huntId: state.h != null ? state.h : state.huntId, progress });
  pushAccounts();
  return true;
}
function isInfoUrl(url) { return /\/characters(\?|$)/.test(url) || /\/characters\/[^/]+\/offline$/.test(url); }
function isPremiumAccountUrl(url) { return /\/shop\/account(?:\?|$)/.test(String(url || '')); }
function isActionReqUrl(url) { return /\/characters\/[^/]+\/actions$/.test(url); }
function parseInfo(g, url, body) {
  let j; try { j = JSON.parse(body); } catch { return; }
  if (Array.isArray(j) && j[0] && j[0].id && j[0].name) {   // GET /characters -> lista de personagens
    g._charNames = {}; for (const c of j) if (c && c.id) g._charNames[c.id] = c.name;
    resolveName(g); pushAccounts(); return;
  }
  applyOfflineState(g, url, body);   // GET /characters/<id>/offline -> estado completo
}
function parsePremiumAccount(g, body) {
  let account; try { account = JSON.parse(body); } catch { return; }
  if (!account || typeof account !== 'object' || typeof account.premiumActive !== 'boolean') return;
  g._premiumActive = account.premiumActive;
  const until = Number(account.premiumUntilMs);
  g._premiumUntilMs = Number.isFinite(until) && until > 0 ? until : 0;
  syncXpBuffWindow(g);
}
function resolveName(g) {
  if (!g._charNames || !g._charId || !g._charNames[g._charId]) return;
  g.charName = g._charNames[g._charId];
  prepareTrainerNameBackfill(g);
}
function prepareTrainerNameBackfill(g) {
  if (!persistentStateLoaded || !communityToken || !g || !g._charId || !g.charName) return false;
  const result = backfillTrainerNameForAccount(huntPerformance, communityAccountId('id:' + g._charId), g.charName);
  if (result.changed) saveHuntPerformance();
  if (result.pending) scheduleCommunitySync(0);
  return result.changed;
}
function pushAccounts() {
  if (dashView) send(dashView, 'accounts', buildAccountsPayload());
  pushTaskOverview();
  pushXpPanel();
}

const STALL_RECOVERY_STABLE_MS = 5 * 60 * 1000;

function resetStallRecovery(g) {
  if (g) g._stallRecovery = null;
}

function reloadForKillStall(g, now) {
  const wc = g && g.view && g.view.webContents;
  if (!wc || wc.isDestroyed()) return false;
  let recovery = g._stallRecovery;
  if (!recovery || (recovery.recoveredAt && now - recovery.recoveredAt >= STALL_RECOVERY_STABLE_MS)) {
    recovery = g._stallRecovery = { attempts:0, lastReloadAt:0, recoveredAt:0, notified:false };
  }
  recovery.attempts += 1;
  recovery.lastReloadAt = now;
  recovery.recoveredAt = 0;
  console.log(`[kill-watch] acc${g.slot}: no-kill-for=${killStallTimeoutSeconds}s recovery=${recovery.attempts} action=reload`);
  if (recovery.attempts >= 2 && !recovery.notified) {
    recovery.notified = true;
    discordEvent(g, { kind:'repeated_stall', attempts:recovery.attempts, timeoutSeconds:killStallTimeoutSeconds });
  }
  try { wc.reload(); return true; } catch { return false; }
}

function checkKillStalls() {
  const now = Date.now();
  const timeoutMs = killStallTimeoutSeconds * 1000;
  for (const g of games) {
    const recovery = g._stallRecovery;
    if (recovery && recovery.recoveredAt && now - recovery.recoveredAt >= STALL_RECOVERY_STABLE_MS) resetStallRecovery(g);
    const stalledAfterKill = shouldReloadForKillStall(g._killWatch, now, timeoutMs);
    const stillStalledAfterReload = recovery && recovery.attempts === 1 && !recovery.recoveredAt
      && now - recovery.lastReloadAt >= timeoutMs;
    if (stalledAfterKill || stillStalledAfterReload) reloadForKillStall(g, now);
  }
}

function startKillWatch() {
  if (killWatchTimer) clearInterval(killWatchTimer);
  killWatchTimer = setInterval(checkKillStalls, 1000);
}

// anexa o CDP na tela do jogo. SEMPRE lê personagem/estado e /shop/account (VIP); só grava o dump quando diagOn.
function attachCapture(g) {
  const wc = g.view.webContents;
  const reqs = new Map();   // requestId -> url (das chamadas AJAX que interessam)
  const worldSockets = new Set();
  try { wc.debugger.attach('1.3'); } catch (e) { console.error('[diag] attach', g.slot, e && e.message); return Promise.resolve(false); }
  const ready = wc.debugger.sendCommand('Network.enable').then(() => true).catch(() => false);
  wc.debugger.on('message', (_e, method, params) => {
    try {
      if (method === 'Network.requestWillBeSent') {
        // /actions é mantido apenas no diagnóstico; o estado ao vivo vem do WebSocket.
        const req = params.request, url = req && req.url;
        if (!url || !isActionReqUrl(url) || !diagOn || !isDumpSlot(g.slot)) return;
        const handle = (pd) => { if (pd != null) dumpHttpReq(g.slot, url, pd); };
        if (req.postData != null) handle(req.postData);
        else if (req.hasPostData) wc.debugger.sendCommand('Network.getRequestPostData', { requestId: params.requestId }).then((r) => handle(r && r.postData)).catch(() => {});
      } else if (method === 'Network.webSocketCreated') {
        if (/\/ws\/world-/i.test(String(params.url || ''))) {
          worldSockets.add(params.requestId);
          if (g._worldFrameOrder) resetUncertainHuntWindow(g);
          g._worldFrameOrder = null;
        }
        if (diagOn && isDumpSlot(g.slot)) diagWrite({ slot: g.slot, ts: Date.now(), kind: 'ws-open', url: String(params.url || '').split('?')[0] });
      } else if (method === 'Network.webSocketFrameReceived' || method === 'Network.webSocketFrameSent') {
        const r = params.response, dir = method === 'Network.webSocketFrameSent' ? 'sent' : 'recv';
        if (!r || r.payloadData == null || (r.opcode !== 1 && r.opcode !== 2)) return;
        if (method === 'Network.webSocketFrameReceived' && r.opcode === 1) {
          const frame = parseWorldFrame(r.payloadData);
          if (frame) applyWorldFrame(g, frame);
          else {
            const message = parseWorldMessage(r.payloadData);
            if (message && message.name === 'world:snapshot') applyWorldSnapshot(g, message.data);
          }
        }
        if (diagOn && isDumpSlot(g.slot)) dumpWs(g.slot, dir, r.payloadData, r.opcode === 2);
      } else if (method === 'Network.webSocketClosed') {
        if (worldSockets.delete(params.requestId)) {
          if (g._worldFrameOrder) resetUncertainHuntWindow(g);
          g._worldFrameOrder = null;
        }
      } else if (method === 'Network.responseReceived') {
        const t = params.type, url = params.response && params.response.url;
        if (url && (t === 'XHR' || t === 'Fetch')) reqs.set(params.requestId, url);
      } else if (method === 'Network.loadingFinished') {
        const url = reqs.get(params.requestId); if (url == null) return; reqs.delete(params.requestId);
        const info = isInfoUrl(url), premium = isPremiumAccountUrl(url), dump = diagOn && isDumpSlot(g.slot);
        if (!info && !premium && !dump) return;
        wc.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId }).then((res) => {
          if (!res || res.body == null) return;
          const text = res.base64Encoded ? Buffer.from(res.body, 'base64').toString('utf8') : res.body;
          if (dump) dumpHttp(g.slot, url, res.body, res.base64Encoded);
          if (info) try { parseInfo(g, url, text); } catch {}
          if (premium) try { parsePremiumAccount(g, text); } catch {}
        }).catch(() => {});
      }
    } catch {}
  });
  return ready;
}

async function loadGameWithCapture(g) {
  const wc = g && g.view && g.view.webContents;
  if (!wc || wc.isDestroyed()) return;

  // Um load explícito cria o renderer. Só então os comandos Network/Fetch do CDP
  // respondem; esperar esses comandos numa tela ainda vazia causava o deadlock cinza.
  try {
    await wc.loadURL('about:blank');
  } catch {}

  let timeoutId;
  try {
    await Promise.race([
      Promise.resolve(attachCapture(g)),
      new Promise(resolve => { timeoutId = setTimeout(() => resolve(false), 3000); }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  if (!wc.isDestroyed()) {
    await wc.loadURL(GAME_URL);
  }
}

function activeSlots() { return games.map(g => g.slot); }
function nextFreeSlot() { for (let s = 1; s <= MAXV; s++) if (!activeSlots().includes(s)) return s; return null; }

function activeSiteTab() { return siteTabs.find(tab => tab.id === activeTabId) || null; }
function isDreamActive() { return activeTabId === DREAM_TAB_ID; }
function siteSlots(tab) { return tab ? tab.views.map(screen => screen.slot) : []; }
function nextFreeSiteSlot(tab) { for (let s = 1; s <= MAXV; s++) if (!siteSlots(tab).includes(s)) return s; return null; }
function allTabs() {
  return [{ id: DREAM_TAB_ID, kind: 'dream', title: 'PokeDream', url: GAME_URL, fixed: true, count: games.length }]
    .concat(siteTabs.map(tab => ({ id: tab.id, kind: 'site', title: tab.title, url: tab.url, favicon: tab.favicon || '', fixed: false, count: tab.views.length })));
}
function canNavigate(wc, direction) {
  try {
    const history = wc && wc.navigationHistory;
    if (history && typeof history[direction] === 'function') return history[direction]();
    const legacy = direction === 'canGoBack' ? wc.canGoBack : wc.canGoForward;
    return typeof legacy === 'function' ? legacy.call(wc) : false;
  } catch { return false; }
}
function selectedSiteScreen(tab) {
  if (!tab || !tab.views.length) return null;
  return tab.views.find(screen => screen.slot === tab.selectedSlot) || tab.views[0];
}
function buildBrowserState() {
  const tab = activeSiteTab();
  const activeScreen = selectedSiteScreen(tab);
  const info = {};
  if (tab) for (const screen of tab.views) {
    const wc = screen.view.webContents;
    info[screen.slot] = {
      title: screen.title || `Tela ${screen.slot}`,
      url: screen.url || tab.url,
      loading: !!screen.loading,
      canGoBack: canNavigate(wc, 'canGoBack'),
      canGoForward: canNavigate(wc, 'canGoForward'),
    };
  }
  return {
    tabs: allTabs(),
    activeTabId,
    maxTabs: MAX_TABS,
    active: tab ? {
      kind: 'site', id: tab.id, title: tab.title, homeUrl: tab.url,
      slots: siteSlots(tab), selected: tab.selectedSlot, mode: tab.mode, info,
      address: activeScreen ? (activeScreen.url || tab.url) : tab.url,
      canGoBack: activeScreen ? canNavigate(activeScreen.view.webContents, 'canGoBack') : false,
      canGoForward: activeScreen ? canNavigate(activeScreen.view.webContents, 'canGoForward') : false,
    } : { kind: 'dream', id: DREAM_TAB_ID },
  };
}
function buildConfigContext() {
  const tab = activeSiteTab();
  return tab
    ? { mode: 'generic', title: tab.title, url: tab.url, views: tab.views.length }
    : { mode: 'dream', title: 'PokeDream', url: GAME_URL, views: games.length };
}
function pushBrowserState() {
  if (dashView) send(dashView, 'browser-state', buildBrowserState());
  if (cfgView) send(cfgView, 'config-context', buildConfigContext());
}
function makeSiteTabId() {
  let id;
  do { id = `site-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`; }
  while (siteTabs.some(tab => tab.id === id));
  return id;
}
function updateSiteScreenState(tab, screen) {
  if (!tab || !screen) return;
  const wc = screen.view.webContents;
  try { screen.url = wc.getURL() || screen.url || tab.url; } catch {}
  screen.loading = !!(wc && wc.isLoading && wc.isLoading());
  if (screen.slot === 1 && !tab.favicon && screen.favicon) tab.favicon = screen.favicon;
  pushBrowserState();
}
function handleSitePopup(screen, details) {
  const target = normalizeSiteUrl(details && details.url);
  if (target.ok) {
    setTimeout(() => screen.view.webContents.loadURL(target.url).catch(() => {}), 0);
  }
  return { action: 'deny' };
}
function createSiteScreen(tab, slot) {
  if (!win || !tab || tab.views.length >= MAXV) return null;
  const screenSlot = slot || nextFreeSiteSlot(tab);
  if (!screenSlot || tab.views.some(screen => screen.slot === screenSlot)) return null;
  const view = new WebContentsView({
    webPreferences: {
      partition: sitePartition(tab.id, screenSlot),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  const screen = { view, slot: screenSlot, title: `Tela ${screenSlot}`, url: tab.url, favicon: '', loading: true, _shown: false };
  const wc = view.webContents;
  wc.setWindowOpenHandler(details => handleSitePopup(screen, details));
  wc.on('page-title-updated', (_event, title) => { screen.title = String(title || `Tela ${screen.slot}`).slice(0, 100); updateSiteScreenState(tab, screen); });
  wc.on('page-favicon-updated', (_event, favicons) => {
    screen.favicon = Array.isArray(favicons) && favicons[0] ? String(favicons[0]) : '';
    if (screen.slot === 1) tab.favicon = screen.favicon;
    updateSiteScreenState(tab, screen);
  });
  wc.on('did-start-loading', () => { screen.loading = true; updateSiteScreenState(tab, screen); });
  wc.on('did-stop-loading', () => { screen.loading = false; updateSiteScreenState(tab, screen); });
  wc.on('did-navigate', () => updateSiteScreenState(tab, screen));
  wc.on('did-navigate-in-page', () => updateSiteScreenState(tab, screen));
  win.contentView.addChildView(view);
  view.setVisible(false);
  tab.views.push(screen);
  if (!tab.selectedSlot) tab.selectedSlot = screen.slot;
  wc.loadURL(tab.url).catch(error => {
    screen.loading = false;
    screen.title = 'Não foi possível abrir';
    console.error('[launcher] site loadURL', tab.id, screen.slot, error && error.message);
    pushBrowserState();
  });
  layout();
  pushBrowserState();
  saveSession();
  return screen;
}
function addSiteTab(value, restored) {
  if (siteTabs.length + 1 >= MAX_TABS) return { ok: false, error: 'O limite é de 4 abas.' };
  const normalized = normalizeSiteUrl(value && value.url ? value.url : value);
  if (!normalized.ok) return normalized;
  const id = restored && restored.id ? restored.id : makeSiteTabId();
  if (siteTabs.some(tab => tab.id === id)) return { ok: false, error: 'Essa aba já existe.' };
  const tab = {
    id,
    kind: 'site',
    title: String(restored && restored.title || normalized.title).slice(0, 80),
    url: normalized.url,
    favicon: '',
    views: [],
    selectedSlot: null,
    mode: 'grid',
  };
  siteTabs.push(tab);
  if (!restored) activeTabId = tab.id;
  const count = restored ? Math.max(1, Math.min(MAXV, restored.views || 1)) : 1;
  for (let slot = 1; slot <= count; slot++) createSiteScreen(tab, slot);
  layout();
  pushBrowserState();
  saveSession();
  return { ok: true, id: tab.id };
}
function removeSiteScreen(tab, slot) {
  if (!tab) return [];
  const index = tab.views.findIndex(screen => screen.slot === +slot);
  if (index < 0) return siteSlots(tab);
  const screen = tab.views[index];
  try { win.contentView.removeChildView(screen.view); } catch {}
  try { screen.view.webContents.close(); } catch {}
  tab.views.splice(index, 1);
  if (tab.selectedSlot === screen.slot) tab.selectedSlot = tab.views.length ? tab.views[0].slot : null;
  if (tab.mode === 'single' && !tab.selectedSlot) tab.mode = 'grid';
  layout(); pushBrowserState(); saveSession();
  return siteSlots(tab);
}
function closeSiteTab(tabId) {
  const index = siteTabs.findIndex(tab => tab.id === tabId);
  if (index < 0) return false;
  const tab = siteTabs[index];
  for (const screen of [...tab.views]) removeSiteScreen(tab, screen.slot);
  siteTabs.splice(index, 1);
  if (activeTabId === tabId) activeTabId = DREAM_TAB_ID;
  setConfigOpen(false);
  layout(); pushBrowserState(); saveSession();
  return true;
}

// ---- persistencia de cookies (sessao -> persistentes 60 dias) ----
async function persistCookies(g) {
  try {
    const ses = g.view.webContents.session;
    const cookies = await ses.cookies.get({ domain: GAME_DOMAIN });
    const far = Math.floor(Date.now() / 1000) + 60 * 24 * 3600; // 60 dias
    for (const c of cookies) {
      if (!c.session) continue;
      const host = String(c.domain || '').replace(/^\./, '');
      if (!host) continue;
      const url = (c.secure ? 'https://' : 'http://') + host + (c.path || '/');
      // preserva o sameSite ORIGINAL do cookie (forçar 'lax' quebrava cookies cross-site que
      // precisam de 'no_restriction'); só cai pra 'lax' quando o valor vem indefinido.
      const sameSite = ['no_restriction', 'lax', 'strict'].includes(c.sameSite) ? c.sameSite : 'lax';
      try {
        await ses.cookies.set({ url, name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite, expirationDate: far });
      } catch {}
    }
    await ses.cookies.flushStore();
  } catch {}
}

// ---- backup/restore de localStorage e sessionStorage ----
// SEGURANÇA: o storage do jogo costuma guardar o TOKEN de login. Antes isso ia pro disco em
// TEXTO PURO (storage-accN.json) — qualquer um que lesse o arquivo roubava a sessão. Agora
// criptografamos com safeStorage (DPAPI no Windows / Keychain no macOS / libsecret no Linux).
function storageFile(slot) { return path.join(storageDir, `storage-acc${slot}.bin`); }
function legacyStorageFile(slot) { return path.join(storageDir, `storage-acc${slot}.json`); }

function writeStorageEncrypted(slot, json) {
  try {
    const buf = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(json)                 // criptografado pelo SO
      : Buffer.from('PLAIN:' + json, 'utf8');           // fallback raro (SO sem cripto disponível)
    fs.writeFileSync(storageFile(slot), buf);
  } catch {}
}
function readStorageDecrypted(slot) {
  // formato novo (.bin criptografado)
  try {
    if (fs.existsSync(storageFile(slot))) {
      const buf = fs.readFileSync(storageFile(slot));
      const json = buf.slice(0, 6).toString('utf8') === 'PLAIN:' ? buf.slice(6).toString('utf8') : safeStorage.decryptString(buf);
      return JSON.parse(json);
    }
  } catch {}
  // migração: lê o .json antigo (texto puro), re-salva criptografado e apaga o antigo
  try {
    const old = legacyStorageFile(slot);
    if (fs.existsSync(old)) {
      const raw = fs.readFileSync(old, 'utf8');
      writeStorageEncrypted(slot, raw);
      try { fs.unlinkSync(old); } catch {}
      return JSON.parse(raw);
    }
  } catch {}
  return null;
}

async function saveStorage(g) {
  try {
    const wc = g.view.webContents;
    if (!wc || wc.isDestroyed()) return;
    const data = await wc.executeJavaScript('({ls:JSON.parse(JSON.stringify(localStorage)),ss:JSON.parse(JSON.stringify(sessionStorage))})', true);
    const json = JSON.stringify(data);
    const hash = crypto.createHash('sha1').update(json).digest('hex');
    if (g._storageHash === hash) return;   // nada mudou desde o último save → não regrava (economiza I/O)
    g._storageHash = hash;
    writeStorageEncrypted(g.slot, json);
  } catch {}
}

async function restoreStorage(g) {
  const data = readStorageDecrypted(g.slot);
  if (!data) return;
  try {
    const wc = g.view.webContents;
    if (data.ls) {
      await wc.executeJavaScript(`Object.entries(${JSON.stringify(data.ls)}).forEach(function(e){try{localStorage.setItem(e[0],e[1])}catch(_){}})`, true);
    }
    if (data.ss) {
      await wc.executeJavaScript(`Object.entries(${JSON.stringify(data.ss)}).forEach(function(e){try{sessionStorage.setItem(e[0],e[1])}catch(_){}})`, true);
    }
  } catch {}
}

// ---- layout (grid / foco) ----
function _tiles(count, x, y, w, h) {
  if (count <= 1) return [{ x, y, width: w, height: h }];
  const hw = Math.floor(w / 2), hh = Math.floor(h / 2);
  if (count === 2) return [{ x, y, width: hw, height: h }, { x: x + hw, y, width: w - hw, height: h }];
  if (count === 3) return [{ x, y, width: hw, height: hh }, { x: x + hw, y, width: w - hw, height: hh }, { x, y: y + hh, width: w, height: h - hh }];
  return [{ x, y, width: hw, height: hh }, { x: x + hw, y, width: w - hw, height: hh }, { x, y: y + hh, width: hw, height: h - hh }, { x: x + hw, y: y + hh, width: w - hw, height: h - hh }];
}

function tileRects(count, x, y, w, h) {
  return _tiles(count, x, y, w, h).map(r => ({ x: r.x + GAP, y: r.y + GAP, width: Math.max(r.width - GAP * 2, 20), height: Math.max(r.height - GAP * 2, 20) }));
}

function setViewBounds(v, r, force = false) {
  if (!force) {
    try { const c = v.getBounds(); if (c.x === r.x && c.y === r.y && c.width === r.width && c.height === r.height) return; } catch {}
  }
  v.setBounds(r);
}

// O atalho vive dentro da própria página do jogo. Assim acompanha grade/foco,
// recebe somente o clique nele e fica acima do canvas sem cobrir o restante da tela.
function updateXpOverlay(g) {
  if (!g || !g.view || g.view.webContents.isDestroyed()) return;
  const url = g.view.webContents.getURL();
  if (!/^https:\/\/(?:www\.)?pokedream\.com\.br(?:\/|$)/i.test(url)) return;
  g.view.webContents.executeJavaScript(buildXpOverlayScript(g._xpRate, { visible: xpHudEnabled && !xpPanelOpen }), true).catch(() => {});
}

function scheduleXpOverlay(g) {
  if (!g || g._xpOverlayTimer) return;
  g._xpOverlayTimer = setTimeout(() => {
    g._xpOverlayTimer = null;
    updateXpOverlay(g);
  }, 80);
}

function refreshXpOverlays() { games.forEach(scheduleXpOverlay); }

function xpPanelPayload() {
  const now = Date.now();
  return {
    accounts: games.map((g) => {
      const hunt = huntStats(g);
      const huntName = hunt
        ? (hunt.mixed ? `Hunt com ${hunt.speciesCount} espécies` : (hunt.species || hunt.id || 'Hunt atual'))
        : (g.hunt || null);
      return {
        slot: g.slot,
        name: g.charName || `Tela ${g.slot}`,
        hunt: huntName,
        species: hunt && hunt.species ? hunt.species : null,
        kills: hunt ? hunt.kills : 0,
        huntStartedAt: hunt ? Math.max(0, now - hunt.ms) : null,
        xp: Math.max(0, Number(g._xpRate && g._xpRate.xp) || 0),
        startedAt: Number(g._xpRate && g._xpRate.startedAt) || now,
      };
    }),
  };
}

function pushXpPanel() {
  if (xpView && xpPanelOpen) send(xpView, 'xp-panel-data', xpPanelPayload());
}

function xpPanelHeight() {
  return Math.min(390, 63 + Math.max(1, games.length) * 73);
}

function positionXpPanel() {
  if (!win || !xpView) return;
  const bounds = win.getContentBounds();
  const availableWidth = Math.max(300, bounds.width - 8);
  const availableHeight = Math.max(130, bounds.height - BAR);
  const desiredSize = xpPanelSizeCustomized && xpPanelSize
    ? xpPanelSize
    : { width: XP_PANEL_WIDTH, height: xpPanelHeight() };
  const width = Math.max(300, Math.min(Math.round(desiredSize.width), availableWidth));
  const height = Math.max(130, Math.min(Math.round(desiredSize.height), availableHeight));
  xpPanelSize = { width, height };
  const fallback = { x: Math.max(8, bounds.width - width - 14), y: BAR + 12 };
  const desired = xpPanelPosition || fallback;
  const x = Math.max(0, Math.min(Math.round(desired.x), Math.max(0, bounds.width - width)));
  const y = Math.max(BAR, Math.min(Math.round(desired.y), Math.max(BAR, bounds.height - height)));
  xpPanelPosition = { x, y };
  setViewBounds(xpView, { x, y, width, height });
}

function setXpPanelOpen(open) {
  const next = !!open && xpHudEnabled && games.length > 0 && isDreamActive() && !boxOpen && !tabDialogOpen;
  xpPanelOpen = next;
  if (xpView) {
    if (next) {
      if (cfgOpen) setConfigOpen(false);
      try { win.contentView.addChildView(xpView); } catch {}
      positionXpPanel();
      xpView.setVisible(true);
      pushXpPanel();
      try { xpView.webContents.focus(); } catch {}
    } else {
      xpView.setVisible(false);
    }
  }
  refreshXpOverlays();
  if (dashView) send(dashView, 'xp-panel-state', { open: xpPanelOpen, enabled: xpHudEnabled });
  return { open: xpPanelOpen, enabled: xpHudEnabled };
}

function moveXpPanel(dx, dy) {
  if (!xpPanelOpen || !xpView) return;
  const current = xpView.getBounds();
  const mx = Math.max(-120, Math.min(120, Number(dx) || 0));
  const my = Math.max(-120, Math.min(120, Number(dy) || 0));
  xpPanelPosition = { x: current.x + mx, y: current.y + my };
  positionXpPanel();
}

function resizeXpPanel(dw, dh) {
  if (!xpPanelOpen || !xpView) return;
  const current = xpView.getBounds();
  const widthDelta = Math.max(-160, Math.min(160, Number(dw) || 0));
  const heightDelta = Math.max(-160, Math.min(160, Number(dh) || 0));
  xpPanelSizeCustomized = true;
  xpPanelSize = { width: current.width + widthDelta, height: current.height + heightDelta };
  positionXpPanel();
}

function resetXpPanelStats() {
  const now = Date.now();
  for (const g of games) {
    g._xpRate = resetXpRate(g._xpRate, now);
    g._huntBase = huntBaseline(g.hunt, g._stats || {}, now);
    resetPerformanceSchedule(g, now);
    scheduleXpOverlay(g);
  }
  pushAccounts();
}

function layout(forceBounds = false) {
  // No Windows, minimizar uma BaseWindow pode emitir resize com dimensões
  // transitórias. Não repassa esses bounds às WebContentsView, senão todas
  // as telas podem ser reposicionadas perto da origem durante a minimização.
  if (!win || launcherMinimized || win.isMinimized()) return;
  const b = win.getContentBounds();
  setViewBounds(dashView, { x: 0, y: 0, width: b.width, height: b.height }, forceBounds);

  const x0 = sidebarHidden ? 0 : SIDE_W, y0 = BAR, w = Math.max(b.width - x0, 100), h = Math.max(b.height - y0, 100);
  const dreamTarget = new Map();

  // Box aberta: nenhuma tela do jogo visível, pra o painel da Box (no dashView) aparecer
  if (isDreamActive() && !boxOpen && !tabDialogOpen) {
    if (gameMode === 'grid') {
      const rects = tileRects(games.length, x0, y0, w, h);
      games.forEach((g, i) => { if (rects[i]) dreamTarget.set(g.slot, rects[i]); });
    } else if (gameMode === 'single' && selectedSlot != null) {
      if (games.some(x => x.slot === selectedSlot)) {
        dreamTarget.set(selectedSlot, { x: x0, y: y0, width: w, height: h });
      }
    }
  }

  games.forEach(g => {
    const r = dreamTarget.get(g.slot);
    if (r) { setViewBounds(g.view, r, forceBounds); if (!g._shown) { g.view.setVisible(true); g._shown = true; } }
    else if (g._shown) { g.view.setVisible(false); g._shown = false; }
  });

  for (const tab of siteTabs) {
    const target = new Map();
    if (tab.id === activeTabId && !tabDialogOpen) {
      if (tab.mode === 'grid') {
        const rects = tileRects(tab.views.length, x0, y0, w, h);
        tab.views.forEach((screen, index) => { if (rects[index]) target.set(screen.slot, rects[index]); });
      } else if (tab.mode === 'single' && tab.selectedSlot != null) {
        if (tab.views.some(screen => screen.slot === tab.selectedSlot)) target.set(tab.selectedSlot, { x: x0, y: y0, width: w, height: h });
      }
    }
    for (const screen of tab.views) {
      const rect = target.get(screen.slot);
      if (rect) { setViewBounds(screen.view, rect, forceBounds); if (!screen._shown) { screen.view.setVisible(true); screen._shown = true; } }
      else if (screen._shown) { screen.view.setVisible(false); screen._shown = false; }
    }
  }

  const showXpPanel = xpPanelOpen && xpHudEnabled && isDreamActive() && !boxOpen && !tabDialogOpen;
  if (xpView) {
    xpView.setVisible(showXpPanel);
    if (showXpPanel) { try { win.contentView.addChildView(xpView); } catch {} positionXpPanel(); }
  }
  if (cfgOpen && cfgView) { try { win.contentView.addChildView(cfgView); } catch {} positionCfg(); }   // mantém os overlays no topo ao redimensionar
}

function launcherViews() {
  // A ordem também é a ordem de composição nativa: dashboard no fundo,
  // conteúdo no meio e overlays por último.
  return [dashView]
    .concat(games.map((game) => game.view))
    .concat(siteTabs.flatMap((tab) => tab.views.map((screen) => screen.view)))
    .concat([xpView, cfgView])
    .filter(Boolean);
}

function repaintLauncherViews() {
  if (!win || launcherMinimized || win.isMinimized()) return;
  // O Windows pode restaurar a superfície nativa sem invalidar o conteúdo das
  // WebContentsView. Reaplicar os bounds e invalidar força uma nova composição.
  layout(true);
  for (const view of launcherViews()) {
    try {
      if (!view.webContents.isDestroyed()) view.webContents.invalidate();
    } catch {}
  }
}

function launcherViewIsVisible(view) {
  if (view === dashView) return true;
  if (view === cfgView) return cfgOpen;
  if (view === xpView) return xpPanelOpen && xpHudEnabled && isDreamActive() && !boxOpen && !tabDialogOpen;
  const game = games.find((entry) => entry.view === view);
  if (game) return !!game._shown;
  for (const tab of siteTabs) {
    const screen = tab.views.find((entry) => entry.view === view);
    if (screen) return !!screen._shown;
  }
  return false;
}

function recomposeLauncherViews() {
  if (!win || launcherMinimized || win.isMinimized()) return;
  const views = launcherViews().filter((view) => {
    try { return !view.webContents.isDestroyed(); } catch { return false; }
  });
  const visibility = new Map();

  // Recria a árvore de composição nativa perdida pelo Windows sem recarregar
  // páginas, processos, sessões ou logins.
  for (const view of views) {
    try {
      const visible = launcherViewIsVisible(view);
      visibility.set(view, visible);
      if (visible) view.setVisible(false);
    } catch {}
  }
  for (const view of views.slice().reverse()) {
    try { win.contentView.removeChildView(view); } catch {}
  }
  for (const view of views) {
    try {
      win.contentView.addChildView(view);
      if (visibility.has(view)) view.setVisible(visibility.get(view));
    } catch {}
  }
  repaintLauncherViews();
}

function scheduleLauncherRepaint(recompose = false) {
  if (!win || launcherMinimized || win.isMinimized()) return;
  launcherRecomposePending = launcherRecomposePending || recompose;
  if (launcherRepaintTimer) clearTimeout(launcherRepaintTimer);
  if (launcherRecomposeTimer) clearTimeout(launcherRecomposeTimer);

  if (launcherRecomposePending) recomposeLauncherViews();
  else repaintLauncherViews();

  launcherRepaintTimer = setTimeout(() => {
    launcherRepaintTimer = null;
    if (launcherRecomposePending) recomposeLauncherViews();
    else repaintLauncherViews();
  }, 160);

  if (launcherRecomposePending) {
    launcherRecomposeTimer = setTimeout(() => {
      launcherRecomposeTimer = null;
      recomposeLauncherViews();
      launcherRecomposePending = false;
    }, 500);
  }
}

// A central de configurações ocupa uma área útil de verdade, sem cobrir a navegação principal.
function positionCfg() {
  if (!win || !cfgView) return;
  const b = win.getContentBounds();
  const margin = 12;
  const availableWidth = Math.max(360, b.width - margin * 2);
  const availableHeight = Math.max(280, b.height - BAR - margin * 2);
  const width = Math.min(860, availableWidth);
  const height = Math.min(720, availableHeight);
  const x = Math.max(margin, b.width - width - margin);
  setViewBounds(cfgView, { x, y: BAR + margin, width, height });
}

// abre/fecha o menu de config (traz a view pro TOPO da ordem z, por cima das telas do jogo)
function setConfigOpen(open) {
  if (!cfgView) return cfgOpen;
  if (open && xpPanelOpen) setXpPanelOpen(false);
  cfgOpen = !!open;
  if (cfgOpen) {
    try { win.contentView.addChildView(cfgView); } catch {}   // re-adiciona = vai pro topo
    positionCfg();
    cfgView.setVisible(true);
    send(cfgView, 'config-context', buildConfigContext());
    try { cfgView.webContents.focus(); } catch {}
  } else {
    cfgView.setVisible(false);
  }
  return cfgOpen;
}

// ---- criar/fechar telas ----
function createGame(slot) {
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'game-preload.js'),
      partition: `persist:acc${slot}`,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  const g = { view, slot, _shown: false, _persistTimer: null, _restored: false, _loopGuard: false, _loads: [], _bagLocks: new Set(), _tasks: {}, _runeStages: {}, _runeAssign: {}, _premiumActive: false, _premiumUntilMs: 0, _xpBoostEndsAtMs: 0, _xpBuffSignature: '', _serverClockOffsetMs: null, _killWatch: createKillWatchState(), _xpRate: createXpRate() };
  const wc = view.webContents;

  // persiste cookies+storage de forma DEBOUNCED (agrupa rajadas de navegação num único save)
  const persistSoon = () => {
    if (g._persistTimer) clearTimeout(g._persistTimer);
    g._persistTimer = setTimeout(() => { persistCookies(g).catch(() => {}); saveStorage(g).catch(() => {}); }, 1200);
  };

  wc.on('did-navigate', persistSoon);
  wc.on('did-navigate-in-page', persistSoon);
  wc.on('did-start-navigation', (_event, url, _isInPlace, isMainFrame) => {
    if (isMainFrame && /^https:\/\/(?:www\.)?pokedream\.com\.br(?:\/|$)/i.test(String(url || ''))) {
      resetKillWatch(g._killWatch);
    }
  });

  wc.on('did-finish-load', () => {
    if (!/^https:\/\/(?:www\.)?pokedream\.com\.br(?:\/|$)/i.test(wc.getURL())) return;
    scheduleXpOverlay(g);
    const now = Date.now();
    g._loads = g._loads.filter(t => now - t < 12000); g._loads.push(now);

    // DETECTOR DE LOOP: 5+ carregamentos em 12s = a pagina esta recarregando sozinha.
    // Suspeito nº1 e a injecao de storage do restoreStorage -> paramos de injetar pra quebrar o ciclo.
    if (g._loads.length >= 5) {
      if (!g._loopGuard) { g._loopGuard = true; console.warn(`[launcher] acc${slot}: loop de reload detectado — restauracao de storage suspensa pra quebrar o ciclo`); }
      return;
    }
    if (g._loopGuard) return;
    // restaura o storage UMA VEZ so (se injetar a cada load e o jogo reagir recarregando, vira loop)
    if (g._restored) return;
    g._restored = true;
    restoreStorage(g).catch(() => {});
  });

  // rede de segurança periódica (o saveStorage só grava de fato quando algo mudou)
  g._saveInterval = setInterval(() => { if (!g._loopGuard) { persistCookies(g).catch(() => {}); saveStorage(g).catch(() => {}); } }, 30000);

  // A tela precisa estar anexada à janela antes de habilitar o CDP. Sem isso, alguns
  // comandos podem ficar pendentes e o primeiro loadURL nunca acontece (tela cinza).
  win.contentView.addChildView(view);
  view.setVisible(false);
  games.push(g);

  loadGameWithCapture(g).catch(error => console.error('[launcher] loadURL', slot, error && error.message));
  return g;
}

function addGame() {
  if (games.length >= MAXV) return activeSlots();
  const slot = nextFreeSlot(); if (!slot) return activeSlots();
  createGame(slot);
  layout();
  send(dashView, 'accounts', buildAccountsPayload());
  pushBrowserState();
  saveSession();
  return activeSlots();
}

async function requestAddGame() {
  if (games.length >= MAXV) return activeSlots();
  if (games.length >= FUTURE_ACCOUNT_LIMIT && win) {
    const choice = await dialog.showMessageBox(win, {
      type: 'warning',
      title: 'Mais de 2 contas',
      message: 'O servidor ainda não limita a quantidade de contas, mas, no futuro, o máximo previsto será de 2 contas.',
      detail: 'Você pode adicionar esta tela agora. Quando o limite mudar, será necessário usar no máximo 2 contas.',
      buttons: ['Adicionar mesmo assim', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (choice.response !== 0) return activeSlots();
  }
  return addGame();
}

function removeGame(slot) {
  const i = games.findIndex(g => g.slot === slot);
  if (i < 0) return activeSlots();
  const g = games[i];
  if (g._saveInterval) clearInterval(g._saveInterval);
  if (g._persistTimer) clearTimeout(g._persistTimer);
  if (g._xpOverlayTimer) clearTimeout(g._xpOverlayTimer);
  saveStorage(g).catch(() => {});   // salva antes de fechar
  try { win.contentView.removeChildView(g.view); } catch {}
  games.splice(i, 1);
  if (!games.length && xpPanelOpen) setXpPanelOpen(false);
  if (selectedSlot === slot) {
    selectedSlot = games.length ? games[0].slot : null;
    if (selectedSlot) gameMode = 'single';
    else gameMode = 'grid';
  }
  layout();
  send(dashView, 'accounts', buildAccountsPayload());
  pushBrowserState();
  saveSession();
  return activeSlots();
}

// resumo de itens da conta pra sidebar: 3 balls + potion/revive agregados (+ money)
function sumBag(bag, re) { if (!bag) return 0; let s = 0; for (const k in bag) if (re.test(k)) s += (bag[k] || 0); return s; }
function itemSummary(g) {
  const bag = g._bag || {};
  return {
    money: g._money || 0,
    poke_ball: bag.poke_ball || 0,
    ultra_ball: bag.ultra_ball || 0,
    premier_ball: bag.premier_ball || 0,
    potion: sumBag(bag, /potion/i),   // agrega qualquer *_potion
    revive: sumBag(bag, /revive/i),   // agrega revive + max_revive etc.
  };
}
function buildAccountsPayload() {
  const info = {};
  for (const g of games) info[g.slot] = { name: g.charName || null, hunt: g.hunt || null, active: g.active || null, party2: g.party2 || null, items: itemSummary(g) };
  return { slots: activeSlots(), selected: selectedSlot, mode: gameMode, info };
}

function send(target, ch, payload) {
  try { if (target && !target.webContents.isDestroyed()) target.webContents.send(ch, payload); } catch {}
}

// ---- lembra abas e telas abertas, pra reabrir na próxima vez ----
function saveSession() {
  try {
    if (!SESSION_FILE || restoringWorkspace) return;
    const state = {
      views: games.length,
      activeTabId,
      tabs: siteTabs.map(tab => ({ id: tab.id, title: tab.title, url: tab.url, views: tab.views.length })),
    };
    fs.writeFileSync(SESSION_FILE, JSON.stringify(state));
  } catch {}
}
function loadWorkspaceSession() {
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch {}
  const restored = restoreWorkspaceState(raw, FUTURE_ACCOUNT_LIMIT);
  restored.dreamViews = Math.max(FUTURE_ACCOUNT_LIMIT, restored.dreamViews);
  return restored;
}

// ---- preferências (som) ----
function readJsonWithBackup(file) {
  if (!file) return null;
  for (const candidate of [file, file + '.bak']) {
    try { return JSON.parse(fs.readFileSync(candidate, 'utf8')); } catch {}
  }
  return null;
}
function writeJsonAtomic(file, value) {
  if (!file) return false;
  const temp = file + '.tmp';
  const backup = file + '.bak';
  try {
    fs.writeFileSync(temp, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
    try {
      JSON.parse(fs.readFileSync(file, 'utf8'));
      fs.copyFileSync(file, backup);
    } catch {}
    fs.renameSync(temp, file);
    return true;
  } catch {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {}
    return false;
  }
}
function encodeDiscordWebhook(value) {
  if (!isDiscordWebhookUrl(value)) return null;
  try {
    if (safeStorage.isEncryptionAvailable()) return 'safe:' + safeStorage.encryptString(value).toString('base64');
  } catch {}
  return 'plain:' + Buffer.from(value, 'utf8').toString('base64');
}
function decodeDiscordWebhook(value) {
  if (typeof value !== 'string' || !value) return '';
  try {
    if (value.startsWith('safe:')) return safeStorage.decryptString(Buffer.from(value.slice(5), 'base64'));
    if (value.startsWith('plain:')) return Buffer.from(value.slice(6), 'base64').toString('utf8');
  } catch {}
  return '';
}
function fixedDiscordSettings(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const currentCriticalWebhook = discordNotifications && discordNotifications.criticalWebhookUrl || '';
  let criticalWebhookUrl = currentCriticalWebhook;
  if (source.clearCriticalWebhook === true) criticalWebhookUrl = '';
  else if (isDiscordWebhookUrl(source.criticalWebhookUrl)) criticalWebhookUrl = String(source.criticalWebhookUrl).trim();
  const { webhookUrl: _ignoredWebhook, criticalWebhookUrl: _submittedCriticalWebhook, clearCriticalWebhook: _ignoredClear, ...preferences } = source;
  if (!Object.prototype.hasOwnProperty.call(preferences, 'taskCompletions')) preferences.taskCompletions = discordNotifications.taskCompletions === true;
  if (!Object.prototype.hasOwnProperty.call(preferences, 'discordUserId')) preferences.discordUserId = discordNotifications.discordUserId || '';
  return normalizeDiscordNotifications(Object.assign(preferences, { criticalWebhookUrl }), '', criticalWebhookUrl);
}
function loadHuntPerformance() {
  huntPerformance = normalizeHuntPerformance(readJsonWithBackup(HUNT_PERFORMANCE_FILE));
}
function saveHuntPerformance() {
  return writeJsonAtomic(HUNT_PERFORMANCE_FILE, huntPerformance);
}
function resetPerformanceSchedule(g, now = Date.now()) {
  if (!g) return;
  g._performanceHuntId = g.hunt == null ? null : String(g.hunt);
  g._performanceBaseline = createPerformanceBaseline({
    xp: g._xpRate && g._xpRate.xp,
    kills: g._stats && g._stats.kills,
  }, now);
  g._performanceNextAt = Number(now) + HUNT_PERFORMANCE_FIRST_MS;
}
function maybeRecordHuntPerformance(g, now = Date.now()) {
  if (!g || g.hunt == null) return false;
  const xpBuffs = syncXpBuffWindow(g, estimatedServerNow(g, now));
  const huntId = String(g.hunt);
  if (g._performanceHuntId !== huntId || !Number.isFinite(Number(g._performanceNextAt))) {
    resetPerformanceSchedule(g, now);
    return false;
  }
  if (now < g._performanceNextAt) return false;
  do { g._performanceNextAt += HUNT_PERFORMANCE_INTERVAL_MS; } while (g._performanceNextAt <= now);

  const hunt = huntStats(g);
  const measured = performanceDelta(g._performanceBaseline, {
    xp: g._xpRate && g._xpRate.xp,
    kills: g._stats && g._stats.kills,
  }, now);
  if (!hunt || hunt.mixed || !hunt.species || !measured || measured.ms < HUNT_PERFORMANCE_FIRST_MS) return false;
  if (!g.active || !g.active.species || !g.charName) return false;
  const xpRate = xpPerHour({ startedAt:now - measured.ms, xp:measured.xpGained }, now, HUNT_PERFORMANCE_FIRST_MS);
  const mobsPerHour = measured.kills > 0 ? Math.max(0, Math.round(measured.kills * 3600000 / measured.ms)) : null;
  const result = updatePerformanceRecords(huntPerformance, hunt.species, {
    xpPerHour: xpRate,
    mobsPerHour,
    kills: measured.kills,
    ms: measured.ms,
    xpGained: Math.max(0, Math.round(measured.xpGained)),
    xpElapsedMs: measured.ms,
    savedAt: now,
    trainerName: g.charName,
    pokemon: { species: g.active.species, level: g.active.level, shiny: g.active.shiny },
    xpBuffs,
    accountId: g._charId && communityToken ? communityAccountId('id:' + g._charId) : null,
  });
  if (result.changed) saveHuntPerformance();
  return result.changed;
}
function saveItemSources() {
  if (itemSourcesSaveTimer) { clearTimeout(itemSourcesSaveTimer); itemSourcesSaveTimer = null; }
  return writeJsonAtomic(ITEM_SOURCES_FILE, itemDropSources);
}
function scheduleItemSourcesSave() {
  if (itemSourcesSaveTimer) return;
  itemSourcesSaveTimer = setTimeout(saveItemSources, 1500);
}
function loadItemSources() {
  itemDropSources = normalizeLootSources(readJsonWithBackup(ITEM_SOURCES_FILE));
  try {
    if (DUMP_FILE && fs.existsSync(DUMP_FILE)) {
      const learned = learnLootSourcesFromDump(fs.readFileSync(DUMP_FILE, 'utf8'), itemDropSources);
      if (learned) saveItemSources();
    }
  } catch {}
}
function validCommunityIdentity(value) {
  return !!value
    && typeof value.clientId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.clientId)
    && typeof value.communityToken === 'string'
    && /^[A-Za-z0-9_-]{43}$/.test(value.communityToken);
}
function saveCommunityState() {
  return writeJsonAtomic(COMMUNITY_FILE, { clientId, communityToken, communityRevision, communityLastSuccessAt });
}
function loadSettings() {
  const j = readJsonWithBackup(SETTINGS_FILE) || {};
  try {
    soundEnabled = j.soundEnabled !== false;
    xpHudEnabled = j.xpHudEnabled !== false;
    if (typeof j.soundVolume === 'number') soundVolume = Math.max(0, Math.min(1, j.soundVolume));
    soundPath = (typeof j.soundPath === 'string' && j.soundPath) ? j.soundPath : null;
    if (j.itemVis && typeof j.itemVis === 'object') for (const k in itemVis) itemVis[k] = j.itemVis[k] !== false;
    if (j.itemAlert && typeof j.itemAlert === 'object') for (const k in itemAlert) { const n = Number(j.itemAlert[k]); if (Number.isFinite(n) && n >= 0) itemAlert[k] = Math.round(n); }
    killStallTimeoutSeconds = normalizeKillStallTimeoutSeconds(j.killStallTimeoutSeconds);
    const storedDiscord = readJsonWithBackup(DISCORD_FILE) || j.discordNotifications || {};
    const storedCriticalWebhook = decodeDiscordWebhook(storedDiscord.criticalWebhookSecret) || storedDiscord.criticalWebhookUrl || '';
    discordNotifications = fixedDiscordSettings(Object.assign({}, storedDiscord, { criticalWebhookUrl:storedCriticalWebhook }));
  } catch { soundEnabled = true; soundVolume = 0.8; soundPath = null; xpHudEnabled = true; }

  const storedCommunity = readJsonWithBackup(COMMUNITY_FILE);
  const identity = validCommunityIdentity(storedCommunity) ? storedCommunity : (validCommunityIdentity(j) ? j : null);
  if (identity) {
    clientId = identity.clientId;
    communityToken = identity.communityToken;
    const copies = [storedCommunity, j].filter((value) => validCommunityIdentity(value)
      && value.clientId === clientId && value.communityToken === communityToken);
    for (const copy of copies) {
      if (Number.isSafeInteger(copy.communityRevision) && copy.communityRevision >= 0) communityRevision = Math.max(communityRevision, copy.communityRevision);
      if (Number.isFinite(copy.communityLastSuccessAt) && copy.communityLastSuccessAt > 0) communityLastSuccessAt = Math.max(communityLastSuccessAt, copy.communityLastSuccessAt);
    }
  }
  let created = false;
  if (!clientId) { clientId = crypto.randomUUID(); created = true; }
  if (!communityToken) { communityToken = crypto.randomBytes(32).toString('base64url'); created = true; }
  if (created || !validCommunityIdentity(storedCommunity)) saveCommunityState();
  if (created) saveSettings();   // id/token são gerados uma vez e reutilizados nesta instalação
}
function saveSettings() { return writeJsonAtomic(SETTINGS_FILE, { soundEnabled, soundVolume, soundPath, xpHudEnabled, itemVis, itemAlert, killStallTimeoutSeconds, clientId, communityToken, communityRevision, communityLastSuccessAt }); }
function saveDiscordSettings() {
  const { webhookUrl: _secret, criticalWebhookUrl: _criticalSecret, ...preferences } = discordNotifications;
  return writeJsonAtomic(DISCORD_FILE, Object.assign(preferences, { criticalWebhookSecret:encodeDiscordWebhook(discordNotifications.criticalWebhookUrl) }));
}
function discordSettingsPayload() {
  const relayStatus = discordRelayNotifier.status();
  const criticalStatus = criticalDiscordNotifier.status();
  const { webhookUrl: _secret, criticalWebhookUrl: _criticalSecret, ...publicSettings } = discordNotifications;
  return Object.assign({}, publicSettings, {
    configured: true,
    criticalConfigured: !!discordNotifications.criticalWebhookUrl,
    lastError: criticalStatus.lastError || relayStatus.lastError,
    lastSuccessAt: Math.max(Number(criticalStatus.lastSuccessAt) || 0, Number(relayStatus.lastSuccessAt) || 0) || null,
  });
}
function pushItemConfig() { if (dashView) send(dashView, 'item-config', { vis: itemVis, alert: itemAlert }); }

// ---- sincronização com o banco comunitário ----
function communityStatus() {
  return {
    available: true,
    enabled: true,
    clientId,
    lastSuccessAt: communityLastSuccessAt || null,
    nextSyncAt: communityNextSyncAt || null,
    lastError: communityLastError,
  };
}
function friendlyCommunityError(error) {
  const status = Number(error && error.status);
  if (error && error.code === 'local_persistence') return 'Não foi possível salvar o histórico local; o envio foi cancelado para não perder números.';
  if (error && error.code === 'invalid_local_snapshot') {
    const species = error.species ? ' de ' + error.species : '';
    return 'Os dados locais' + species + ' estão inconsistentes; nada foi alterado no servidor.';
  }
  if (status === 401 || status === 403) return 'O servidor recusou a conexão. Tentaremos novamente após uma atualização.';
  if (status === 429) return 'Envio recente demais; os dados serão enviados na próxima janela.';
  return 'Sem conexão com a comunidade no momento; tentaremos novamente automaticamente.';
}
function communityAccountId(accountKey) {
  return crypto.createHmac('sha256', communityToken)
    .update('community-account-v1:' + accountKey, 'utf8')
    .digest('hex');
}
async function submitCommunityStats() {
  if (!persistentStateLoaded) return { skipped: true };
  if (communitySubmitInFlight) return communitySubmitInFlight;

  saveHuntLog();
  if (huntLogDirty) {
    const error = new Error('local hunt history was not persisted');
    error.code = 'local_persistence';
    communityLastError = friendlyCommunityError(error);
    throw error;
  }

  const revision = communityRevision + 1;
  const stats = huntLogToAccountStats(huntLog, communityAccountId);
  const performanceRecords = communityPerformanceRecords(huntPerformance);
  communitySubmitInFlight = communityClient.submitStats({
    appVersion: app.getVersion(),
    clientId,
    clientToken: communityToken,
    revision,
    stats,
  }).then(async (result) => {
    const performanceResult = await communityClient.submitPerformance({
      appVersion: app.getVersion(),
      clientId,
      clientToken: communityToken,
      records: performanceRecords,
    });
    if (markCommunityPerformanceRecordsSynced(huntPerformance, performanceRecords)) saveHuntPerformance();
    const savedRevision = Number(result && result.revision);
    communityRevision = Number.isSafeInteger(savedRevision) && savedRevision >= revision ? savedRevision : revision;
    communityLastSuccessAt = Date.now();
    communityLastError = null;
    communityClient.clearCache();
    saveCommunityState();
    saveSettings();
    return Object.assign({}, result, { performanceSaved:Number(performanceResult && performanceResult.saved) || 0 });
  }).catch((error) => {
    const serverRevision = Number(error && error.data && error.data.revision);
    const revisionConflict = Number(error && error.status) === 409
      && (error.code === 'stale_revision' || error.code === 'revision_conflict')
      && Number.isSafeInteger(serverRevision) && serverRevision >= 0;
    if (revisionConflict) {
      communityRevision = Math.max(communityRevision, serverRevision);
      communityLastError = 'A ordem dos envios foi reconciliada; tentaremos novamente automaticamente.';
      saveCommunityState();
      saveSettings();
    } else communityLastError = friendlyCommunityError(error);
    throw error;
  }).finally(() => { communitySubmitInFlight = null; });

  return communitySubmitInFlight;
}
function scheduleCommunitySync(delayMs) {
  if (communityTimer) clearTimeout(communityTimer);
  const requestedDelay = Math.max(0, Number(delayMs) || 0);
  const rateLimitDelay = communityLastSuccessAt
    ? Math.max(0, communityLastSuccessAt + COMMUNITY_SEND_INTERVAL_MS - Date.now())
    : 0;
  const effectiveDelay = Math.max(requestedDelay, rateLimitDelay);
  communityNextSyncAt = Date.now() + effectiveDelay;
  communityTimer = setTimeout(() => {
    communityTimer = null;
    communityNextSyncAt = 0;
    runCommunitySync();
  }, effectiveDelay);
}
function runCommunitySync() {
  if (communitySyncInFlight) return communitySyncInFlight;
  communitySyncInFlight = submitCommunityStats().catch(() => null).finally(() => {
    communitySyncInFlight = null;
    scheduleCommunitySync(COMMUNITY_SEND_INTERVAL_MS);
  });
  return communitySyncInFlight;
}
function startCommunitySync() {
  if (communityTimer || communitySyncInFlight) return;
  scheduleCommunitySync(5000);
}
function waitAtMost(promise, timeoutMs) {
  let timer = null;
  const limited = Promise.race([
    Promise.resolve(promise).catch(() => null),
    new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
  ]);
  return limited.finally(() => { if (timer) clearTimeout(timer); });
}
function flushCommunityBeforeQuit() {
  saveHuntLog();
  return waitAtMost(submitCommunityStats(), COMMUNITY_QUIT_TIMEOUT_MS);
}
async function quitAndInstallSafely() {
  try { await flushCommunityBeforeQuit(); } catch {}
  communityQuitFlushed = true;
  try { autoUpdater.quitAndInstall(); } catch (e) { console.error('[updater] quitAndInstall', e && e.message); }
}

// ---- som (shiny capturado) ----
const DEFAULT_SOUND = path.join(__dirname, 'sounds', 'shiny-default.mp3');
function currentSoundFile() { return (soundPath && fs.existsSync(soundPath)) ? soundPath : DEFAULT_SOUND; }
function soundName() { return soundPath ? path.basename(soundPath) : 'Padrão'; }
function soundDataUrl() {   // devolve o áudio como data URL (a dashView toca isso)
  try {
    const f = currentSoundFile(); const buf = fs.readFileSync(f);
    const ext = path.extname(f).toLowerCase();
    const mime = ext === '.wav' ? 'audio/wav' : ext === '.ogg' ? 'audio/ogg' : ext === '.m4a' ? 'audio/mp4' : 'audio/mpeg';
    return 'data:' + mime + ';base64,' + buf.toString('base64');
  } catch { return null; }
}
function pushSoundConfig() { if (dashView) send(dashView, 'sound-config', { enabled: soundEnabled, volume: soundVolume, dataUrl: soundDataUrl() }); }

function createWindow() {
  storageDir = path.join(app.getPath('userData'), 'storage');
  fs.mkdirSync(storageDir, { recursive: true });
  if (!persistentStateLoaded) {
    DUMP_FILE = path.join(app.getPath('userData'), 'ws-dump.jsonl');
    SESSION_FILE = path.join(app.getPath('userData'), 'session.json');
    SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
    COMMUNITY_FILE = path.join(app.getPath('userData'), 'community.json');
    HUNTLOG_FILE = path.join(app.getPath('userData'), 'huntlog.json');
    HUNT_PERFORMANCE_FILE = path.join(app.getPath('userData'), 'hunt-performance.json');
    ITEM_SOURCES_FILE = path.join(app.getPath('userData'), 'item-sources.json');
    DISCORD_FILE = path.join(app.getPath('userData'), 'discord-notifications.json');
    loadSettings();
    loadHuntLog();
    loadHuntPerformance();
    loadItemSources();
    persistentStateLoaded = true;
    huntLogSaveTimer = setInterval(saveHuntLog, 30000);   // um só timer, mesmo se a janela for recriada
    huntPerformanceTimer = setInterval(() => games.forEach((game) => maybeRecordHuntPerformance(game)), 5000);
    startCommunitySync();
    startKillWatch();
  }

  win = new BaseWindow({
    width: 1400, height: 860,
    minWidth: 800, minHeight: 500,
    frame: false,
    backgroundColor: '#0a0d13',
    icon: undefined,
  });
  launcherMinimized = false;

  dashView = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.contentView.addChildView(dashView);
  dashView.webContents.loadFile(path.join(__dirname, 'app.html'));

  // Overlays próprios permanecem carregados como antes da otimização da v2.0.2.
  cfgView = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  try { cfgView.setBackgroundColor('#111621'); } catch {}
  win.contentView.addChildView(cfgView);
  cfgView.setVisible(false);
  cfgView.webContents.loadFile(path.join(__dirname, 'config.html'));

  xpView = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'xp-panel-preload.js'), contextIsolation: true, sandbox: true },
  });
  try { xpView.setBackgroundColor('#00000000'); } catch {}
  win.contentView.addChildView(xpView);
  xpView.setVisible(false);
  xpView.webContents.loadFile(path.join(__dirname, 'xp-panel.html'));
  xpView.webContents.on('did-finish-load', () => pushXpPanel());

  win.on('resize', () => layout());
  win.on('focus', () => scheduleLauncherRepaint(true));
  win.on('show', () => scheduleLauncherRepaint(true));
  win.on('maximize', () => scheduleLauncherRepaint(true));
  win.on('unmaximize', () => scheduleLauncherRepaint(true));
  win.on('minimize', () => { launcherMinimized = true; });
  win.on('restore', () => {
    launcherMinimized = false;
    scheduleLauncherRepaint(true);
    pushAccounts();
    pushBrowserState();
  });
  win.on('closed', () => {
    if (launcherRepaintTimer) clearTimeout(launcherRepaintTimer);
    if (launcherRecomposeTimer) clearTimeout(launcherRecomposeTimer);
    launcherRepaintTimer = null;
    launcherRecomposeTimer = null;
    launcherRecomposePending = false;
    saveSession();
    // salva o storage de todas as telas antes de fechar
    for (const g of games) {
      if (g._saveInterval) clearInterval(g._saveInterval);
      saveStorage(g).catch(() => {});
    }
    cfgView = null;
    xpView = null;
    cfgOpen = false;
    xpPanelOpen = false;
    win = null;
    launcherMinimized = false;
  });

  layout();

  // Reabre as abas e as telas da última sessão sem misturar as partições de login.
  setTimeout(() => {
    const restored = loadWorkspaceSession();
    restoringWorkspace = true;
    let delay = 0;
    for (let k = 0; k < restored.dreamViews; k++) {
      setTimeout(() => addGame(), delay);
      delay += 350;
    }
    for (const tab of restored.tabs) {
      setTimeout(() => addSiteTab(tab.url, tab), delay);
      delay += 350;
    }
    setTimeout(() => {
      activeTabId = restored.activeTabId === DREAM_TAB_ID || siteTabs.some(tab => tab.id === restored.activeTabId)
        ? restored.activeTabId : DREAM_TAB_ID;
      restoringWorkspace = false;
      saveSession(); layout(); pushAccounts(); pushBrowserState();
    }, delay + 100);
  }, 500);
}

// ---- IPC handlers ----
ipcMain.handle('getBrowserState', () => buildBrowserState());
ipcMain.handle('addSiteTab', (_e, url) => {
  const result = addSiteTab(url);
  if (result.ok) tabDialogOpen = false;
  layout(); pushBrowserState();
  return result;
});
ipcMain.handle('closeSiteTab', (_e, tabId) => closeSiteTab(String(tabId || '')));
ipcMain.handle('selectSiteTab', (_e, tabId) => {
  const id = String(tabId || '');
  if (id !== DREAM_TAB_ID && !siteTabs.some(tab => tab.id === id)) return buildBrowserState();
  activeTabId = id;
  if (!isDreamActive() && xpPanelOpen) setXpPanelOpen(false);
  tabDialogOpen = false;
  setConfigOpen(false);
  layout(); pushBrowserState();
  if (isDreamActive()) pushAccounts();
  saveSession();
  return buildBrowserState();
});
ipcMain.handle('reorderTabs', (_e, orderedIds) => {
  if (!Array.isArray(orderedIds)) return allTabs();
  const byId = new Map(siteTabs.map(tab => [tab.id, tab]));
  const next = [];
  for (const id of orderedIds) { const tab = byId.get(String(id)); if (tab && !next.includes(tab)) next.push(tab); }
  for (const tab of siteTabs) if (!next.includes(tab)) next.push(tab);
  if (next.length === siteTabs.length) { siteTabs.length = 0; siteTabs.push(...next); }
  pushBrowserState(); saveSession();
  return allTabs();
});
ipcMain.handle('setTabDialogOpen', (_e, open) => {
  tabDialogOpen = !!open;
  if (tabDialogOpen) { setConfigOpen(false); setXpPanelOpen(false); }
  layout();
  return tabDialogOpen;
});
ipcMain.handle('navigateSite', async (_e, action, value) => {
  const tab = activeSiteTab();
  const screen = selectedSiteScreen(tab);
  if (!screen) return buildBrowserState();
  const wc = screen.view.webContents;
  try {
    const history = wc.navigationHistory;
    if (action === 'back' && canNavigate(wc, 'canGoBack')) history && history.goBack ? history.goBack() : wc.goBack();
    else if (action === 'forward' && canNavigate(wc, 'canGoForward')) history && history.goForward ? history.goForward() : wc.goForward();
    else if (action === 'reload') wc.reload();
    else if (action === 'home') await wc.loadURL(tab.url);
    else if (action === 'url') {
      const normalized = normalizeSiteUrl(value);
      if (!normalized.ok) return { ...buildBrowserState(), error: normalized.error };
      await wc.loadURL(normalized.url);
    }
  } catch {}
  updateSiteScreenState(tab, screen);
  return buildBrowserState();
});
ipcMain.handle('addView', async () => {
  if (isDreamActive()) return requestAddGame();
  const tab = activeSiteTab();
  if (tab && tab.views.length < MAXV) createSiteScreen(tab);
  return siteSlots(tab);
});
ipcMain.handle('removeView', async (_e, slot) => {
  if (isDreamActive()) return removeGame(slot);
  return removeSiteScreen(activeSiteTab(), slot);
});
ipcMain.handle('reloadGame', async (_e, slot) => {
  if (isDreamActive()) {
    const g = games.find(x => x.slot === +slot);
    if (g) g.view.webContents.reload();
  } else {
    const tab = activeSiteTab();
    const screen = tab && tab.views.find(item => item.slot === +slot);
    if (screen) screen.view.webContents.reload();
  }
});
ipcMain.handle('selectAccount', async (_e, slot) => {
  if (isDreamActive()) {
    if (gameMode === 'single' && selectedSlot === +slot) { gameMode = 'grid'; selectedSlot = null; }
    else { gameMode = 'single'; selectedSlot = +slot; }
    layout(); pushAccounts();
  } else {
    const tab = activeSiteTab();
    if (!tab || !tab.views.some(screen => screen.slot === +slot)) return;
    if (tab.mode === 'single' && tab.selectedSlot === +slot) { tab.mode = 'grid'; tab.selectedSlot = +slot; }
    else { tab.mode = 'single'; tab.selectedSlot = +slot; }
    layout(); pushBrowserState();
  }
});
ipcMain.handle('setGameMode', async (_e, mode) => {
  const nextMode = mode === 'single' ? 'single' : 'grid';
  if (isDreamActive()) {
    gameMode = nextMode;
    if (nextMode === 'grid') selectedSlot = null;
    layout(); pushAccounts();
  } else {
    const tab = activeSiteTab();
    if (!tab) return;
    tab.mode = nextMode;
    if (nextMode === 'grid' && !tab.selectedSlot && tab.views[0]) tab.selectedSlot = tab.views[0].slot;
    layout(); pushBrowserState();
  }
});
// reordena as telas conforme a ordem dos cards arrastados na barra
ipcMain.handle('reorderViews', (_e, orderedSlots) => {
  if (!Array.isArray(orderedSlots)) return isDreamActive() ? activeSlots() : siteSlots(activeSiteTab());
  const list = isDreamActive() ? games : (activeSiteTab() ? activeSiteTab().views : []);
  const bySlot = new Map(list.map(item => [item.slot, item]));
  const next = [];
  for (const s of orderedSlots) { const item = bySlot.get(+s); if (item && !next.includes(item)) next.push(item); }
  for (const item of list) if (!next.includes(item)) next.push(item);
  if (next.length === list.length) { list.length = 0; list.push(...next); }
  layout();
  if (isDreamActive()) pushAccounts(); else pushBrowserState();
  saveSession();
  return list.map(item => item.slot);
});
ipcMain.handle('winMinimize', async () => {
  if (!win) return;
  // Marca antes de chamar minimize(): o resize pode chegar antes do evento
  // "minimize" no Windows.
  launcherMinimized = true;
  win.minimize();
});
ipcMain.handle('winMaximize', async () => { if (win) win.isMaximized() ? win.unmaximize() : win.maximize(); });
ipcMain.handle('winClose', async () => { app.quit(); });
ipcMain.handle('toggleConfig', () => setConfigOpen(!cfgOpen));
ipcMain.handle('closeConfig', () => setConfigOpen(false));
ipcMain.handle('toggleXpPanel', () => setXpPanelOpen(!xpPanelOpen));
ipcMain.handle('getXpHud', () => ({ enabled: xpHudEnabled, open: xpPanelOpen }));
ipcMain.handle('setXpHud', (_e, on) => {
  xpHudEnabled = !!on;
  if (!xpHudEnabled) setXpPanelOpen(false); else refreshXpOverlays();
  saveSettings();
  const state = { enabled: xpHudEnabled, open: xpPanelOpen };
  if (dashView) send(dashView, 'xp-panel-state', state);
  return state;
});
ipcMain.handle('getXpPanelData', () => xpPanelPayload());
ipcMain.on('openXpPanel', (event) => {
  if (games.some((g) => g.view.webContents === event.sender)) setXpPanelOpen(true);
});
ipcMain.on('closeXpPanel', (event) => {
  if (xpView && xpView.webContents === event.sender) setXpPanelOpen(false);
});
ipcMain.on('moveXpPanel', (event, dx, dy) => {
  if (xpView && xpView.webContents === event.sender) moveXpPanel(dx, dy);
});
ipcMain.on('resizeXpPanel', (event, dw, dh) => {
  if (xpView && xpView.webContents === event.sender) resizeXpPanel(dw, dh);
});
ipcMain.on('resetXpPanel', (event) => {
  if (xpView && xpView.webContents === event.sender) resetXpPanelStats();
});
ipcMain.on('openXpPokeData', (event, slot) => {
  if (!xpView || xpView.webContents !== event.sender) return;
  const g = games.find((game) => game.slot === Number(slot));
  if (!g) return;
  const hunt = huntStats(g);
  const species = (hunt && hunt.species) || (g.active && g.active.species) || null;
  setXpPanelOpen(false);
  send(dashView, 'open-pokedata-details', { slot: g.slot, species });
});
ipcMain.handle('openDiscord', async () => shell.openExternal(DISCORD_URL));
ipcMain.handle('setSidebar', (_e, hidden) => { sidebarHidden = !!hidden; layout(); return sidebarHidden; });
ipcMain.handle('setBoxOpen', (_e, open) => {
  boxOpen = !!open;
  if (boxOpen && xpPanelOpen) setXpPanelOpen(false);
  layout();
  return boxOpen;
});
// Box unificada: coleção (bag+depot) de todas as contas, com nome e slot
ipcMain.handle('getBox', () => games.map(g => ({ slot: g.slot, name: g.charName || ('Tela ' + g.slot), pokes: g._box ? Object.values(g._box) : [] })));
function bagAccountsPayload() {
  return {
    accounts: games.map((g) => {
      const locks = g._bagLocks || new Set();
      const items = Object.keys(g._bag || {}).map((itemId) => ({
        itemId,
        count: Math.max(0, Math.round(Number(g._bag[itemId]) || 0)),
        locked: locks.has(itemId),
        rare: isRareItem(itemId),
        sources: Array.isArray(itemDropSources[itemId]) ? itemDropSources[itemId] : [],
      })).sort((a, b) => a.itemId.localeCompare(b.itemId));
      return { slot: g.slot, name: g.charName || ('Tela ' + g.slot), ready: !!g._bag, items };
    }),
  };
}
ipcMain.handle('getBags', () => bagAccountsPayload());
// ---- diagnóstico (dump de rede) ----
ipcMain.handle('getDiag', () => diagOn);
ipcMain.handle('setDiag', (_e, on) => {
  diagOn = !!on;
  if (diagOn) {
    try { fs.writeFileSync(DUMP_FILE, ''); } catch {}   // começa limpo
    diagLines = 0;
    games.forEach(g => { try { g.view.webContents.reload(); } catch {} });   // recarrega pra capturar o estado inicial
  }
  return diagOn;
});
ipcMain.handle('openDumpFolder', () => {
  try { if (DUMP_FILE && fs.existsSync(DUMP_FILE)) shell.showItemInFolder(DUMP_FILE); else shell.openPath(app.getPath('userData')); } catch {}
});

ipcMain.handle('isDev', () => !app.isPackaged);

// ---- som ----
ipcMain.handle('getSoundSettings', () => ({ enabled: soundEnabled, volume: soundVolume, name: soundName(), custom: !!soundPath }));
ipcMain.handle('setSoundEnabled', (_e, on) => { soundEnabled = !!on; saveSettings(); pushSoundConfig(); return soundEnabled; });
ipcMain.handle('setSoundVolume', (_e, v) => { const n = Number(v); if (Number.isFinite(n)) soundVolume = Math.max(0, Math.min(1, n)); saveSettings(); pushSoundConfig(); return soundVolume; });
ipcMain.handle('pickSoundFile', async () => {
  try {
    const r = await dialog.showOpenDialog(win, { title: 'Escolher som', properties: ['openFile'], filters: [{ name: 'Áudio', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }] });
    if (!r.canceled && r.filePaths && r.filePaths[0]) { soundPath = r.filePaths[0]; saveSettings(); pushSoundConfig(); }
  } catch {}
  return { name: soundName(), custom: !!soundPath };
});
ipcMain.handle('resetSound', () => { soundPath = null; saveSettings(); pushSoundConfig(); return { name: soundName(), custom: false }; });
ipcMain.handle('getDiscordNotifications', () => discordSettingsPayload());
ipcMain.handle('setDiscordNotifications', (_e, value) => {
  const submittedWebhook = value && typeof value.criticalWebhookUrl === 'string' ? value.criticalWebhookUrl.trim() : '';
  if (submittedWebhook && !isDiscordWebhookUrl(submittedWebhook)) throw new Error('Use um webhook válido do Discord.');
  discordNotifications = fixedDiscordSettings(value);
  if (!saveDiscordSettings()) throw new Error('Não foi possível salvar as notificações.');
  pushTaskOverview();
  return discordSettingsPayload();
});
ipcMain.handle('getTaskOverview', () => taskOverviewPayload());
ipcMain.handle('setTaskCompletionNotifications', (_e, on) => {
  if (on && !discordNotifications.criticalWebhookUrl) throw new Error('Configure o webhook de alertas nas notificações do Discord.');
  discordNotifications = normalizeDiscordNotifications(Object.assign({}, discordNotifications, { taskCompletions:!!on }), '', discordNotifications.criticalWebhookUrl);
  if (!saveDiscordSettings()) throw new Error('Não foi possível salvar a preferência de Tasks.');
  const payload = taskOverviewPayload();
  pushTaskOverview();
  return payload;
});
ipcMain.handle('getKillWatchSettings', () => ({
  timeoutSeconds: killStallTimeoutSeconds,
  minSeconds: KILL_STALL_MIN_SECONDS,
  maxSeconds: KILL_STALL_MAX_SECONDS,
}));
ipcMain.handle('setKillWatchTimeout', (_e, value) => {
  killStallTimeoutSeconds = normalizeKillStallTimeoutSeconds(value);
  for (const g of games) { resetKillWatch(g._killWatch || (g._killWatch = createKillWatchState())); resetStallRecovery(g); }
  saveSettings();
  return { timeoutSeconds: killStallTimeoutSeconds, minSeconds: KILL_STALL_MIN_SECONDS, maxSeconds: KILL_STALL_MAX_SECONDS };
});

// stats da CAÇADA atual: o jogo não manda contador por hunt, então medimos o delta
// desde que a hunt começou (ou desde que o launcher passou a observar, o que vier depois).
function huntStats(g) {
  const s = g._stats || {}, b = g._huntBase;
  if (!b) return null;
  const speciesList = Array.isArray(s.huntSpeciesList) && s.huntSpeciesList.length
    ? s.huntSpeciesList
    : (s.huntSpecies ? [s.huntSpecies] : []);
  const mixed = speciesList.length > 1;
  const sp = speciesList.length === 1 ? speciesList[0] : null;
  const current = huntDelta(s, b);
  const { kills, caught, shinies, ms } = current;
  return {
    id: g.hunt || null,
    species: sp,
    mixed,
    speciesCount: speciesList.length,
    kills, caught, shinies,
    ms,
    catchRate: kills ? Math.round(caught / kills * 1000) / 10 : null,
    shinyRatio: shinies ? Math.round(kills / shinies) : null,
  };
}

// ---- estatísticas por conta: somente diferenças observadas nesta sessão ----
ipcMain.handle('getStats', () => {
  const seenCharacters = new Set();
  return games.filter((g) => {
    const key = g._charId ? `id:${g._charId}` : `slot:${g.slot}`;
    if (seenCharacters.has(key)) return false;
    seenCharacters.add(key);
    return true;
  }).map((g) => {
    const s = g._stats || {}, b = g._statBase;
    const elapsed = b ? Math.max((Date.now() - b.ts) / 3600000, 0) : 0;   // horas desde o baseline
    const rate = (k) => (b && elapsed > 0.0015 && s[k] != null && b[k] != null) ? Math.round((s[k] - b[k]) / elapsed) : null;  // só depois de ~5s
    const delta = (k) => (b && s[k] != null && b[k] != null) ? s[k] - b[k] : 0;
    const caught = Math.max(delta('totalCaught'), 0), kills = Math.max(delta('kills'), 0), shinies = Math.max(delta('shinyKills'), 0);
    return {
      slot: g.slot,
      name: g.charName || ('Tela ' + g.slot),
      caught, kills, shinies,
      money: delta('money'),
      trainerLevel: s.trainerLevel != null ? s.trainerLevel : null,
      activeLevel: s.level != null ? s.level : null,
      catchRate: kills ? Math.round(caught / kills * 1000) / 10 : null,
      hunt: huntStats(g),
      sessionMs: b ? (Date.now() - b.ts) : 0,
      perHour: { caught: rate('totalCaught'), kills: rate('kills'), shinies: rate('shinyKills'), money: rate('money') },
    };
  });
});

// histórico acumulado de uma espécie (ou de todas, se species vier vazio)
ipcMain.handle('getHuntLog', async (_e, species) => {
  saveHuntLog();
  if (!species) return huntLog;
  const d = Object.assign({}, huntLog[species] || {});
  let huntingNow = 0;
  let mixedNow = 0;
  const seenCharacters = new Set();
  for (const g of games) {
    const characterKey = g._charId ? 'id:' + g._charId : 'slot:' + g.slot;
    if (seenCharacters.has(characterKey)) continue;
    seenCharacters.add(characterKey);
    const s = g._stats || {};
    const activeSpecies = Array.isArray(s.huntSpeciesList) ? s.huntSpeciesList : (s.huntSpecies ? [s.huntSpecies] : []);
    if (activeSpecies.includes(species)) {
      if (activeSpecies.length === 1) huntingNow++;
      else mixedNow++;
    }
  }
  d.huntingNow = huntingNow;
  d.mixedNow = mixedNow;
  d.broke = describeBroke(huntLog[species]);   // sequências de shiny, separadas por personagem
  d.sequences = describeSequences(huntLog[species]);
  let communityWaitTimer = null;
  try {
    d.community = await Promise.race([
      communityClient.getSpeciesStats(species),
      new Promise((_resolve, reject) => {
        communityWaitTimer = setTimeout(() => reject(new Error('community_hub_timeout')), COMMUNITY_HUB_WAIT_MS);
      }),
    ]);
  } catch { d.community = null; d.communityError = true; }
  finally { if (communityWaitTimer) clearTimeout(communityWaitTimer); }
  return (huntLog[species] || huntingNow || mixedNow || d.community || d.communityError) ? d : null;
});

ipcMain.handle('getHuntPerformance', async (_e, species) => {
  const key = typeof species === 'string' && /^[A-Za-z0-9]{1,40}$/.test(species) ? species : null;
  const result = {
    species: key,
    records: key && huntPerformance.data[key] ? huntPerformance.data[key] : {},
    firstMs: HUNT_PERFORMANCE_FIRST_MS,
    intervalMs: HUNT_PERFORMANCE_INTERVAL_MS,
  };
  if (!key) return result;
  let timer = null;
  try {
    result.community = await Promise.race([
      communityClient.getPerformanceLeaderboard(key),
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('performance_timeout')), COMMUNITY_HUB_WAIT_MS); }),
    ]);
  } catch { result.communityError = true; }
  finally { if (timer) clearTimeout(timer); }
  return result;
});

function communityHubTimeout(promise, code) {
  let timer = null;
  const limited = Promise.race([
    promise,
    new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(code)), COMMUNITY_HUB_WAIT_MS); }),
  ]);
  return limited.finally(() => { if (timer) clearTimeout(timer); });
}

async function communityPokemonHub(species) {
  try {
    return await communityHubTimeout(communityClient.getPokemonHub(species), 'pokemon_hub_timeout');
  } catch (hubError) {
    // Compatibilidade enquanto o novo endpoint ainda não chegou ao projeto hospedado.
    const [capture, performance] = await Promise.allSettled([
      communityHubTimeout(communityClient.getSpeciesStats(species), 'species_stats_timeout'),
      communityHubTimeout(communityClient.getPerformanceLeaderboard(species), 'performance_timeout'),
    ]);
    if (capture.status === 'rejected' && performance.status === 'rejected') throw hubError;
    return {
      species,
      capture: capture.status === 'fulfilled' ? capture.value : null,
      performance: performance.status === 'fulfilled' ? performance.value : { xpPerHour:[], mobsPerHour:[] },
    };
  }
}

// Pokédex unificada: o catálogo abastece todos os cards; o detalhe reúne fontes locais e o
// read model comunitário sem entregar as tabelas brutas ao renderer.
ipcMain.handle('getPokedexHubCatalog', async () => {
  saveHuntLog();
  saveHuntPerformance();
  let remoteRows = [];
  let combat = { types:{}, pokemon:{}, matchups:[] };
  let remoteError = false;
  try {
    const remoteCatalog = await communityHubTimeout(communityClient.getPokemonHubCatalog(), 'pokemon_catalog_timeout');
    remoteRows = remoteCatalog && Array.isArray(remoteCatalog.rows) ? remoteCatalog.rows : [];
    if (remoteCatalog && remoteCatalog.combat) combat = remoteCatalog.combat;
  } catch { remoteError = true; }
  return {
    rows: buildPokemonCatalog({ huntLog, huntPerformance, itemSources:itemDropSources, remoteRows }),
    combat,
    remoteError,
  };
});

ipcMain.handle('getPokemonHub', async (_e, species) => {
  const key = typeof species === 'string' && /^[A-Z][A-Za-z0-9]{0,31}$/.test(species) ? species : null;
  if (!key) return null;
  saveHuntLog();
  saveHuntPerformance();
  let remote = null;
  let remoteError = false;
  try { remote = await communityPokemonHub(key); }
  catch { remoteError = true; }
  return buildPokemonHub(key, {
    huntLog,
    huntPerformance,
    itemSources:itemDropSources,
    remote,
    remoteError,
  });
});

// ---- estatísticas comunitárias: envio automático ----
ipcMain.handle('getShareStats', () => communityStatus());
ipcMain.handle('forceCommunitySync', async () => {
  if (app.isPackaged) throw new Error('Envio manual disponível somente no modo de desenvolvimento.');
  if (communityTimer) clearTimeout(communityTimer);
  communityTimer = null;
  communityNextSyncAt = 0;
  try {
    const result = await submitCommunityStats();
    scheduleCommunitySync(COMMUNITY_SEND_INTERVAL_MS);
    return { status: communityStatus(), saved: Number(result && result.saved) || 0 };
  } catch (error) {
    scheduleCommunitySync(COMMUNITY_SEND_INTERVAL_MS);
    throw new Error(friendlyCommunityError(error));
  }
});

// ---- visibilidade dos itens na barra + alerta de item baixo ----
ipcMain.handle('getItemVis', () => itemVis);
ipcMain.handle('setItemVis', (_e, key, on) => { if (key in itemVis) { itemVis[key] = !!on; saveSettings(); pushItemConfig(); } return itemVis; });
ipcMain.handle('getItemAlert', () => itemAlert);
ipcMain.handle('setItemAlert', (_e, key, val) => { if (key in itemAlert) { const n = Number(val); itemAlert[key] = (Number.isFinite(n) && n >= 0) ? Math.round(n) : 0; saveSettings(); pushItemConfig(); } return itemAlert; });
ipcMain.handle('testSound', () => { if (dashView) send(dashView, 'play-sound', { dataUrl: soundDataUrl(), volume: soundVolume }); });

// ---- auto-update (via GitHub Releases) ----
ipcMain.handle('getVersion', () => app.getVersion());
ipcMain.handle('checkForUpdate', () => {
  if (!app.isPackaged) { sendUpdate('error', { message: 'atualização só funciona no app instalado (não no npm start)' }); return; }
  try { autoUpdater.checkForUpdates(); } catch (e) { sendUpdate('error', { message: e && e.message }); }
});
ipcMain.handle('installUpdate', () => quitAndInstallSafely());

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Mantém o jogo e a interface ativos em segundo plano, como antes da economia da v2.0.2.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// Evita que o Chromium mantenha a interface como ocluída após minimizar/restaurar no Windows.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// avisa a UI do andamento da atualização (o menu de config mostra o status)
function sendUpdate(state, extra) { send(cfgView, 'update-status', Object.assign({ state }, extra || {})); }

// Ao abrir, checa se há versão nova no repo; baixa em segundo plano; a UI/config mostra o progresso
// e oferece "reiniciar e instalar". (No `npm start` de dev o autoUpdater nem tenta.)
function setupAutoUpdate() {
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.on('checking-for-update', () => sendUpdate('checking'));
    autoUpdater.on('update-available', (i) => sendUpdate('available', { version: i && i.version }));
    autoUpdater.on('update-not-available', () => sendUpdate('none'));
    autoUpdater.on('download-progress', (p) => sendUpdate('downloading', { percent: Math.round(p && p.percent || 0) }));
    autoUpdater.on('update-downloaded', (i) => {
      const version = i && i.version;
      sendUpdate('downloaded', { version });
      // pergunta ao usuário se quer reiniciar agora pra instalar (se disser "Depois", instala ao fechar o app)
      dialog.showMessageBox({
        type: 'info',
        title: 'Atualização disponível',
        message: `Nova versão ${version ? 'v' + version : ''} baixada!`,
        detail: 'Quer reiniciar agora para instalar? Se escolher "Depois", ela será instalada quando você fechar o app.',
        buttons: ['Reiniciar e instalar', 'Depois'],
        defaultId: 0,
        cancelId: 1,
      }).then((r) => { if (r.response === 0) quitAndInstallSafely(); }).catch(() => {});
    });
    autoUpdater.on('error', (e) => sendUpdate('error', { message: e && e.message }));
    if (app.isPackaged) {
      autoUpdater.checkForUpdates();
      setInterval(() => { try { autoUpdater.checkForUpdates(); } catch {} }, 12 * 60 * 60 * 1000);   // re-checa a cada 12h
    }
  } catch (e) { console.error('[updater] falha ao iniciar:', e && e.message); }
}

app.whenReady().then(() => {
  createWindow();
  // espera a UI carregar antes de checar (pra não perder os eventos de status)
  dashView.webContents.once('did-finish-load', () => { setTimeout(setupAutoUpdate, 1500); pushSoundConfig(); pushItemConfig(); pushAccounts(); pushBrowserState(); });
  cfgView.webContents.once('did-finish-load', () => send(cfgView, 'config-context', buildConfigContext()));
  app.on('activate', () => { if (BaseWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', (event) => {
  saveHuntLog();
  saveHuntPerformance();
  saveItemSources();
  if (communityQuitFlushed || !persistentStateLoaded) return;
  event.preventDefault();
  if (communityQuitPending) return;
  communityQuitPending = true;
  flushCommunityBeforeQuit().finally(() => {
    communityQuitPending = false;
    communityQuitFlushed = true;
    app.quit();
  });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
