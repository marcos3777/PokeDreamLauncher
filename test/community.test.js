'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SUPABASE_PUBLISHABLE_KEY,
  CommunityHttpError,
  CommunitySnapshotError,
  huntLogToStats,
  huntLogToAccountStats,
  buildSubmitPayload,
  buildPerformancePayload,
  parsePerformanceLeaderboard,
  parsePokemonHubCatalog,
  parsePokemonHub,
  createCommunityClient,
} = require('../community');

const CLIENT_ID = '3f2a91c4-7b8e-4d1a-9f60-2c5e8a4b1d33';
const CLIENT_TOKEN = 'A'.repeat(43);

test('envio comunitário fica sempre ativo e não expõe opção de desligamento', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  const config = fs.readFileSync(path.join(root, 'config.html'), 'utf8');
  assert.match(main, /enabled: true/);
  assert.doesNotMatch(main + preload + config, /setShareStats|share-on|communityPreferenceVersion/);
  assert.doesNotMatch(main + preload + config, /getChangelog|changelog-btn|Novidades/);
});

test('envio manual existe somente no modo de desenvolvimento', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  const config = fs.readFileSync(path.join(root, 'config.html'), 'utf8');
  assert.match(main, /ipcMain\.handle\('forceCommunitySync',[\s\S]*?if \(app\.isPackaged\) throw/);
  assert.match(preload, /forceCommunitySync: \(\) => ipcRenderer\.invoke\('forceCommunitySync'\)/);
  assert.match(config, /id="share-force" style="display:none"/);
  assert.match(config, /P\.isDev\(\)[\s\S]*?share-force/);
});

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function aggregate(species = 'MrMime') {
  return {
    species,
    contributors: '2',
    kills: '800',
    caught: '120',
    shinies: '3',
    shiny_caught: '1',
    broke_avg: '6',
    broke_max: '8',
    broke_min: '3',
    thrown_a: '200',
    thrown_b: '600',
    caught_a: '30.25',
    caught_b: '89.75',
    ms: '900000',
    catch_pct: '15.00',
    catch_pct_a: '15.13',
    catch_pct_b: '14.96',
    kills_per_shiny: '267',
  };
}

function weightedAggregate(species = 'MrMime') {
  return {
    ...aggregate(species),
    kills: '10000.0',
    caught: '17.25',
    shinies: '0.1',
    shiny_caught: '0.05',
    broke_avg: '6.5',
    broke_max: '8',
    broke_min: '3',
    thrown_a: '51.5',
    thrown_b: '9948.5',
    caught_a: '1.25',
    caught_b: '16.0',
    ms: '3600000.5',
    catch_pct: '0.1725',
    catch_pct_a: '2.4272',
    catch_pct_b: '0.1608',
    kills_per_shiny: '100000',
  };
}

function leaderboard(species = 'MrMime') {
  return {
    xp_per_hour:[{
      rank:1, hunt_species:species, metric:'xp_per_hour', score:'180000', trainer_name:'Brock',
      pokemon_species:'Alakazam', pokemon_shiny:false, pokemon_level:80, vip:true, xp_potion:false,
      completed_task_types:2, rune_bonus_percent:0,
      achieved_at:1787500000000,
    }],
    mobs_per_hour:[{
      rank:1, hunt_species:species, metric:'mobs_per_hour', score:'500', trainer_name:'Misty',
      pokemon_species:'Gengar', pokemon_shiny:true, pokemon_level:75, vip:false, xp_potion:false,
      completed_task_types:0, rune_bonus_percent:0,
      achieved_at:1787500001000,
    }],
  };
}

test('pokemon hub interpreta catálogo compacto e detalhe unificado', () => {
  const catalog = parsePokemonHubCatalog({ data:[{
    species:'MrMime', dex_number:122, contributors:'2', catch_pct:'15.5', kills_per_shiny:'267',
    broke_avg:'6.5', broke_max:'9', broke_min:'3', best_xp_per_hour:'180000', best_mobs_per_hour:'500',
  }] });
  assert.deepEqual(catalog[0].performance, { xpPerHour:180000, mobsPerHour:500 });
  assert.equal(catalog[0].capture.brokeAvg, 6.5);

  const hub = parsePokemonHub({ data:{
    species:'MrMime', dex_number:122, capture:aggregate(), performance:leaderboard(),
  } }, 'MrMime');
  assert.equal(hub.capture.catch_pct, 15);
  assert.equal(hub.performance.xpPerHour[0].trainerName, 'Brock');
  assert.equal(hub.performance.mobsPerHour[0].pokemon.shiny, true);
});

test('cliente consulta catálogo e espécie pelo endpoint unificado', async () => {
  const urls = [];
  const client = createCommunityClient({ fetchImpl:async (url) => {
    urls.push(url);
    return url.includes('?species=')
      ? jsonResponse({ data:{ species:'MrMime', dex_number:122, capture:aggregate(), performance:leaderboard() } })
      : jsonResponse({ data:[{ species:'MrMime', dex_number:122, contributors:null, catch_pct:null,
        kills_per_shiny:null, broke_avg:null, broke_max:null, broke_min:null,
        best_xp_per_hour:'180000', best_mobs_per_hour:'500' }] });
  } });
  assert.equal((await client.getPokemonHubCatalog())[0].performance.xpPerHour, 180000);
  assert.equal((await client.getPokemonHub('MrMime')).dexNumber, 122);
  assert.equal(urls.length, 2);
});

test('huntLogToStats separa shinies encontrados de capturas e envia somente dados comunitários', () => {
  const stats = huntLogToStats({
    MrMime: {
      kills: 20,
      caught: 1,
      shinies: 3,
      thrownA: 5,
      thrownB: 15,
      caughtA: 0.25,
      caughtB: 0.75,
      ms: 12345,
      dryBalls: 99,
      dryKills: 42,
      shinyCaught: 2,
      bestiary: { kills: 46000, caught: 0 },
      pend: 1,
      updated: 123,
      streaks: [{ name: 'Conta pessoal', balls: 4 }],
    },
    Empty: { kills: 0, caught: 0, shinies: 0, thrownA: 0, thrownB: 0, caughtA: 0, caughtB: 0, ms: 1 },
  });

  assert.deepEqual(stats, {
    MrMime: {
      kills: 20,
      caught: 1,
      shinies: 3,
      thrown_a: 5,
      thrown_b: 15,
      caught_a: 0.25,
      caught_b: 0.75,
      ms: 12345,
    },
  });
  assert.equal(JSON.stringify(stats).includes('Conta pessoal'), false);
  assert.equal(JSON.stringify(stats).includes('dryBalls'), false);
  assert.equal(JSON.stringify(stats).includes('shinyCaught'), false);
  assert.equal(JSON.stringify(stats).includes('bestiary'), false);
});

test('huntLogToStats rejeita o snapshot inteiro em vez de apagar uma espécie silenciosamente', () => {
  assert.throws(() => huntLogToStats({
    MrMime: { kills: 20, caught: 1, shinies: 3, thrownA: 5, thrownB: 15, caughtA: 0.25, caughtB: 0.75, ms: 12345 },
    'nome inválido': { kills: 10 },
  }), (error) => error instanceof CommunitySnapshotError && error.species === 'nome inválido');
});

test('huntLogToAccountStats separa personagens e não envia nome nem chave bruta', () => {
  const stats = huntLogToAccountStats({
    MrMime: {
      accounts: {
        'id:123': {
          name: 'Conta pessoal', seen: 3, caught: 1, streak: 0, brokeMax: 3, brokeMin: 3, brokeTotal: 3, brokeCount: 1,
          stats: { kills: 20, caught: 2, shinies: 3, shinyCaught: 1, thrownA: 5, thrownB: 15, caughtA: 0.5, caughtB: 1.5, ms: 12345 },
        },
        'id:456': {
          name: 'Outra conta', seen: 1, caught: 0, streak: 1, brokeMax: null, brokeMin: null, brokeTotal: 0, brokeCount: 0,
          stats: { kills: 10, caught: 1, shinies: 1, shinyCaught: 0, thrownA: 4, thrownB: 6, caughtA: 0.4, caughtB: 0.6, ms: 5000 },
        },
      },
    },
  }, (key) => key === 'id:123' ? 'a'.repeat(64) : 'b'.repeat(64));

  assert.deepEqual(Object.keys(stats), ['a'.repeat(64), 'b'.repeat(64)]);
  assert.equal(stats['a'.repeat(64)].MrMime.shiny_caught, 1);
  assert.equal(stats['a'.repeat(64)].MrMime.broke_max, 3);
  assert.equal(stats['a'.repeat(64)].MrMime.broke_sum, 3);
  assert.equal(stats['a'.repeat(64)].MrMime.broke_count, 1);
  assert.equal(stats['b'.repeat(64)].MrMime.broke_max, 1);
  assert.equal(stats['b'.repeat(64)].MrMime.broke_min, null);
  assert.equal(JSON.stringify(stats).includes('Conta pessoal'), false);
  assert.equal(JSON.stringify(stats).includes('id:123'), false);
});

test('envio comunitário normaliza e une os aliases de Nidoran', () => {
  const account = (kills, ms) => ({
    name:'Conta', seen:kills, caught:0, streak:0, brokeMax:null, brokeMin:null, brokeTotal:0, brokeCount:0,
    stats:{ kills, caught:0, shinies:0, shinyCaught:0, thrownA:0, thrownB:0, caughtA:0, caughtB:0, ms },
  });
  const stats = huntLogToAccountStats({
    NidoranF:{ accounts:{ 'id:123':account(10, 1000) } },
    NidoranFemale:{ accounts:{ 'id:123':account(20, 2000) } },
    NidoranMale:{ accounts:{ 'id:123':account(30, 3000) } },
  }, () => 'a'.repeat(64));
  assert.equal(stats['a'.repeat(64)].NidoranF.kills, 30);
  assert.equal(stats['a'.repeat(64)].NidoranF.ms, 3000);
  assert.equal(stats['a'.repeat(64)].NidoranM.kills, 30);
  assert.equal(stats['a'.repeat(64)].NidoranFemale, undefined);
  assert.equal(stats['a'.repeat(64)].NidoranMale, undefined);
});

test('buildSubmitPayload inclui versões, identidade e revisão', () => {
  const payload = buildSubmitPayload({
    appVersion: '1.5.2',
    clientId: CLIENT_ID,
    clientToken: CLIENT_TOKEN,
    revision: 7,
    stats: {},
  });
  assert.deepEqual(payload, {
    schema_version: 3,
    app_version: '1.5.2',
    client_id: CLIENT_ID,
    client_token: CLIENT_TOKEN,
    revision: 7,
    stats: {},
  });
});

test('submitStats usa endpoint e headers públicos corretos', async () => {
  let call;
  const client = createCommunityClient({
    baseUrl: 'https://example.supabase.co/',
    fetchImpl: async (url, init) => {
      call = { url, init };
      return jsonResponse({ ok: true, saved: 0, revision: 1 });
    },
  });

  const result = await client.submitStats({
    appVersion: '1.5.2', clientId: CLIENT_ID, clientToken: CLIENT_TOKEN, revision: 1, stats: {},
  });
  assert.equal(result.ok, true);
  assert.equal(call.url, 'https://example.supabase.co/functions/v1/submit-stats');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.apikey, SUPABASE_PUBLISHABLE_KEY);
  assert.equal(call.init.headers['content-type'], 'application/json');
  assert.equal(JSON.parse(call.init.body).schema_version, 3);
});

test('recordes usam endpoint separado e incluem treinador e bônus de XP', async () => {
  let call;
  const records = [{ account_id:'a'.repeat(64), trainer_name:'Marcos', hunt_species:'Grimer', pokemon_species:'Gengar', pokemon_shiny:true, completed_task_types:2, rune_bonus_percent:0 }];
  const payload = buildPerformancePayload({ appVersion:'1.10.0', clientId:CLIENT_ID, clientToken:CLIENT_TOKEN, records });
  assert.equal(payload.records[0].trainer_name, 'Marcos');
  assert.equal(payload.records[0].completed_task_types, 2);
  const client = createCommunityClient({
    baseUrl:'https://example.supabase.co',
    fetchImpl:async (url, init) => { call = { url, init }; return jsonResponse({ ok:true, saved:1 }); },
  });
  assert.equal((await client.submitPerformance({ appVersion:'1.10.0', clientId:CLIENT_ID, clientToken:CLIENT_TOKEN, records })).saved, 1);
  assert.equal(call.url, 'https://example.supabase.co/functions/v1/submit-performance');
  assert.equal(JSON.parse(call.init.body).schema_version, 3);
});

test('top 3 separa XP e mobs, preserva shiny e expõe apenas buffs realmente usados', async () => {
  const wire = { data:{
    xp_per_hour:[{ hunt_species:'Grimer', metric:'xp_per_hour', score:180000, trainer_name:'Marcos', pokemon_species:'Gengar', pokemon_shiny:true, pokemon_level:50, vip:true, xp_potion:false, completed_task_types:2, rune_bonus_percent:0, achieved_at:1787500000000 }],
    mobs_per_hour:[{ hunt_species:'Grimer', metric:'mobs_per_hour', score:720, trainer_name:'Ash', pokemon_species:'Alakazam', pokemon_shiny:false, pokemon_level:42, vip:true, xp_potion:true, completed_task_types:0, rune_bonus_percent:0, achieved_at:1787500000000 }],
  } };
  const parsed = parsePerformanceLeaderboard(wire, 'Grimer');
  assert.deepEqual(parsed.xpPerHour[0].xpBuffs, { vip:0.2, task:0.02 });
  assert.equal(parsed.xpPerHour[0].pokemon.shiny, true);
  assert.equal(parsed.xpPerHour[0].trainerName, 'Marcos');
  assert.deepEqual(parsed.mobsPerHour[0].xpBuffs, {});

  let calls = 0;
  const client = createCommunityClient({ fetchImpl:async () => { calls++; return jsonResponse(wire); } });
  assert.equal((await client.getPerformanceLeaderboard('Grimer')).xpPerHour[0].score, 180000);
  await client.getPerformanceLeaderboard('Grimer');
  assert.equal(calls, 1);
});

test('top 3 continua aceitando respostas v2 sem os bônus novos', () => {
  const legacy = leaderboard('Vulpix');
  for (const rows of [legacy.xp_per_hour, legacy.mobs_per_hour]) {
    for (const row of rows) {
      delete row.completed_task_types;
      delete row.rune_bonus_percent;
    }
  }
  const parsed = parsePerformanceLeaderboard({ data:legacy }, 'Vulpix');
  assert.deepEqual(parsed.xpPerHour[0].xpBuffs, { vip:0.2 });
  assert.deepEqual(parsed.mobsPerHour[0].xpBuffs, {});
});

test('erros HTTP preservam status e código público', async () => {
  const client = createCommunityClient({
    fetchImpl: async () => jsonResponse({ error: 'rate_limited', retry_after_seconds: 20 }, 429),
  });
  await assert.rejects(
    client.submitStats({ appVersion: '1.5.2', clientId: CLIENT_ID, clientToken: CLIENT_TOKEN, revision: 1, stats: {} }),
    (error) => error instanceof CommunityHttpError && error.status === 429 && error.code === 'rate_limited',
  );
});

test('conflito de revisão preserva a revisão aceita pelo servidor', async () => {
  const client = createCommunityClient({
    fetchImpl: async () => jsonResponse({ error: 'revision_conflict', revision: 8 }, 409),
  });
  await assert.rejects(
    client.submitStats({ appVersion: '1.5.2', clientId: CLIENT_ID, clientToken: CLIENT_TOKEN, revision: 7, stats: {} }),
    (error) => error instanceof CommunityHttpError
      && error.status === 409
      && error.code === 'revision_conflict'
      && error.data.revision === 8,
  );
});

test('getSpeciesStats interpreta envelope, números e cache positivo', async () => {
  let calls = 0;
  const client = createCommunityClient({
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(url.endsWith('/functions/v1/species-stats?species=MrMime&format=precise'), true);
      assert.equal(init.headers.apikey, SUPABASE_PUBLISHABLE_KEY);
      return jsonResponse({ data: aggregate() });
    },
  });
  const first = await client.getSpeciesStats('MrMime');
  const second = await client.getSpeciesStats('MrMime');
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  assert.equal(first.contributors, 2);
  assert.equal(first.caught_a, 30.25);
  assert.equal(first.broke_avg, 6);
});

test('getSpeciesStats preserva contagens ponderadas fracionárias do servidor', async () => {
  const client = createCommunityClient({
    fetchImpl: async () => jsonResponse({ data: weightedAggregate() }),
  });
  const stats = await client.getSpeciesStats('MrMime');
  assert.equal(stats.shinies, 0.1);
  assert.equal(stats.shiny_caught, 0.05);
  assert.equal(stats.broke_max, 8);
  assert.equal(stats.broke_avg, 6.5);
  assert.equal(stats.caught, 17.25);
  assert.equal(stats.thrown_a, 51.5);
  assert.equal(stats.ms, 3600000.5);
});

test('cache negativo expira antes do positivo', async () => {
  let calls = 0;
  let clock = 1000;
  const client = createCommunityClient({
    now: () => clock,
    fetchImpl: async () => { calls++; return jsonResponse({ data: null }); },
  });
  assert.equal(await client.getSpeciesStats('Tauros'), null);
  assert.equal(await client.getSpeciesStats('Tauros'), null);
  assert.equal(calls, 1);
  clock += 5 * 60 * 1000 + 1;
  assert.equal(await client.getSpeciesStats('Tauros'), null);
  assert.equal(calls, 2);
});

test('leituras simultâneas da mesma espécie compartilham uma requisição', async () => {
  let resolveFetch;
  let calls = 0;
  const client = createCommunityClient({
    fetchImpl: () => {
      calls++;
      return new Promise((resolve) => { resolveFetch = resolve; });
    },
  });
  const first = client.getSpeciesStats('MrMime');
  const second = client.getSpeciesStats('MrMime');
  assert.equal(first, second);
  resolveFetch(jsonResponse({ data: aggregate() }));
  assert.equal((await first).kills, 800);
  assert.equal(calls, 1);
});

test('consulta iniciada antes da limpeza não recoloca resposta antiga no cache', async () => {
  let resolveFirst;
  let calls = 0;
  const client = createCommunityClient({
    fetchImpl: () => {
      calls++;
      if (calls === 1) return new Promise((resolve) => { resolveFirst = resolve; });
      return Promise.resolve(jsonResponse({ data: aggregate('MrMime') }));
    },
  });

  const stale = client.getSpeciesStats('MrMime');
  client.clearCache();
  const fresh = client.getSpeciesStats('MrMime');
  assert.equal(calls, 2);
  resolveFirst(jsonResponse({ data: aggregate('MrMime') }));
  await stale;
  await fresh;
  await client.getSpeciesStats('MrMime');
  assert.equal(calls, 2);
});

test('timeout aborta a chamada sem vazar o erro de rede', async () => {
  const client = createCommunityClient({
    timeoutMs: 10,
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
  });
  await assert.rejects(
    client.getSpeciesStats('MrMime'),
    (error) => error instanceof CommunityHttpError && error.code === 'timeout' && error.status === 0,
  );
});

test('abortSubmissions permite cancelar explicitamente um envio em andamento', async () => {
  const client = createCommunityClient({
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
  });
  const pending = client.submitStats({ appVersion: '1.5.2', clientId: CLIENT_ID, clientToken: CLIENT_TOKEN, revision: 1, stats: {} });
  client.abortSubmissions();
  await assert.rejects(pending, (error) => error instanceof CommunityHttpError && error.code === 'aborted');
});
