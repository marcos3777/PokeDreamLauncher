'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { stripTypeScriptTypes } = require('node:module');
const { createLauncherAccess } = require('../launcher-access');
const { createCommunityClient } = require('../community');
const { createDiscordRelayNotifier } = require('../discord-relay');

const sharedUrl = pathToFileURL(path.join(__dirname, '../supabase/functions/_shared/launcher-version.mjs')).href;
const gate = import(sharedUrl);
const blockedPayload = { error:'update_required', min_version:'2.0.20' };
const json = (data, status = 200) => Response.json(data, { status });
const identity = { appVersion:'2.0.22', clientId:'123e4567-e89b-42d3-a456-426614174000', clientToken:'A'.repeat(43) };

async function loadHandler(name) {
  const file = path.join(__dirname, '../supabase/functions', name, 'index.ts');
  // Execute the real handler with only Supabase's credential wrapper replaced.
  // Database operations and outbound calls must never run for blocked requests.
  const source = fs.readFileSync(file, 'utf8')
    .replace('import { withSupabase } from "npm:@supabase/server@1.4.1";', 'const withSupabase = (_options, handler) => handler;')
    .replace('"../_shared/launcher-version.mjs"', JSON.stringify(sharedUrl));
  const js = stripTypeScriptTypes(source, { mode:'transform' });
  return (await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))).default.fetch;
}

test('mínimo compara as três partes e recusa versões inválidas e pré-lançamentos', async () => {
  const { isSupportedAppVersion } = await gate;
  for (const version of ['2.0.20', '2.0.21', '2.0.100', '2.1.0', '3.0.0', '10.0.0', '2.0.20+build.7']) {
    assert.equal(isSupportedAppVersion(version), true, version);
  }
  for (const version of [null, '', '2.0.9', '2.0.19', '1.99.99', '2.0', 'v2.0.20', '02.0.20', '2.0.20-beta.1', '2.0.20+', 'NaN.0.20', '9007199254740992.0.0']) {
    assert.equal(isSupportedAppVersion(version), false, String(version));
  }
});

test('todos os endpoints recusam leitura/escrita antes de acessar banco ou enviar Discord', async () => {
  const routes = [
    ['submit-stats','POST',''], ['submit-performance','POST',''], ['discord-notification','POST',''],
    ['species-stats','GET','?species=MrMime'], ['performance-leaderboard','GET','?hunt=MrMime'],
    ['pokemon-hub','GET','?scope=catalog'], ['pokemon-hub','GET','?scope=combat'],
    ['pokemon-hub','GET','?species=MrMime'], ['pokemon-hub','GET',''], ['launcher-status','GET',''],
  ];
  for (const [name, method, query] of routes) {
    const handler = await loadHandler(name);
    for (const version of [null, '', '2.0.19', '1.10.0', 'invalid', '2.0.20-beta']) {
      const headers = { 'content-type':'application/json', 'if-none-match':'"pokemon-combat-20260829192538"' };
      if (version !== null) headers['x-launcher-version'] = version;
      const req = new Request('https://example.com/'+name+query, { method, headers, ...(method === 'POST' ? { body:'{}' } : {}) });
      const result = await handler(req, new Proxy({}, { get() { throw new Error('blocked request reached the database'); } }));
      assert.equal(result.status, 426, `${name} ${version}`);
      assert.equal(result.headers.get('cache-control'), 'no-store');
      const payload = await result.json();
      assert.equal(payload.error, 'update_required');
      assert.equal(payload.min_version, '2.0.20');
      assert.equal(Object.hasOwn(payload, 'data'), false);
    }
  }
});

test('versões aceitas consultam os endpoints reais e não geram cache HTTP compartilhado', async () => {
  for (const [name, query] of [['species-stats','?species=MrMime'], ['performance-leaderboard','?hunt=MrMime'], ['pokemon-hub','?species=MrMime'], ['launcher-status','']]) {
    const handler = await loadHandler(name);
    for (const version of ['2.0.20', '2.0.22', '3.0.0']) {
      const result = await handler(new Request('https://example.com/'+name+query, { headers:{ 'x-launcher-version':version } }), {
        supabaseAdmin:{ rpc:async () => ({ data:null, error:null }) },
      });
      assert.equal(result.status, 200, name);
      assert.equal(result.headers.get('cache-control'), 'private, no-store');
      assert.match(result.headers.get('vary'), /x-launcher-version/);
    }
  }
});

test('POST não permite cabeçalho novo com versão antiga, ausente ou divergente no corpo', async () => {
  for (const name of ['submit-stats', 'submit-performance', 'discord-notification']) {
    const handler = await loadHandler(name);
    for (const [body, expected] of [[{ app_version:'2.0.19' },426], [{},426], [{ app_version:'2.0.21' },400]]) {
      const result = await handler(new Request('https://example.com/'+name, {
        method:'POST', headers:{ 'content-type':'application/json', 'x-launcher-version':'2.0.22' }, body:JSON.stringify(body),
      }), new Proxy({}, { get() { throw new Error('unexpected database operation'); } }));
      assert.equal(result.status, expected, name);
    }
  }
});

test('launcher envia a versão também nas consultas e na checagem inicial', async () => {
  const calls = [];
  const client = createCommunityClient({ appVersion:identity.appVersion, fetchImpl:async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/launcher-status')) return json({ ok:true, min_version:'2.0.20' });
    if (url.includes('/submit-')) return json({ ok:true, saved:0, revision:1 });
    if (url.includes('/performance-leaderboard')) return json({ data:{ xp_per_hour:[], mobs_per_hour:[] } });
    if (url.includes('scope=catalog')) return json({ data:[] });
    return json({ data:null });
  } });
  await client.checkLauncherVersion();
  await client.getSpeciesStats('MrMime');
  await client.getPerformanceLeaderboard('MrMime');
  await client.getPokemonHub('MrMime');
  await client.getPokemonHubCatalog();
  await client.getPokemonCombatCatalog().catch(() => {});
  await client.submitStats({ ...identity, revision:1, stats:{} });
  for (const { init } of calls) {
    assert.equal(init.headers['x-launcher-version'], identity.appVersion);
    assert.equal(init.cache, 'no-store');
  }
  assert.equal(calls.length, 7);
});

test('426 interrompe leituras, cache, envios e a fila do Discord na mesma sessão', async () => {
  let notifications = 0;
  const access = createLauncherAccess({ appVersion:identity.appVersion, onBlocked:() => notifications++ });
  let calls = 0;
  const client = createCommunityClient({ appVersion:identity.appVersion, access, fetchImpl:async () => {
    calls++;
    return calls === 1 ? json({ data:null }) : json(blockedPayload, 426);
  } });
  await client.getSpeciesStats('MrMime');
  await assert.rejects(client.checkLauncherVersion(), { code:'update_required', status:426 });
  const operations = [
    () => client.getSpeciesStats('MrMime'), () => client.getPerformanceLeaderboard('MrMime'),
    () => client.getPokemonHub('MrMime'), () => client.getPokemonHubCatalog(), () => client.getPokemonCombatCatalog(),
    () => client.submitStats({ ...identity, revision:1, stats:{} }), () => client.submitPerformance({ ...identity, records:[] }),
  ];
  for (const operation of operations) await assert.rejects(operation(), { code:'update_required' });
  const relay = createDiscordRelayNotifier({}, identity, { access, fetchImpl:async () => { calls++; throw new Error('unexpected send'); } });
  assert.equal((await relay.notify({ kind:'test' })).ok, false);
  assert.equal(calls, 2);
  assert.equal(notifications, 1);
  assert.equal(access.status().minVersion, '2.0.20');
});

test('uma leitura em andamento não entrega dados depois que outra recebe 426', async () => {
  let finish;
  const client = createCommunityClient({ fetchImpl:async url => url.includes('species-stats')
    ? new Promise(resolve => { finish = resolve; }) : json(blockedPayload, 426) });
  const pending = client.getSpeciesStats('MrMime');
  await assert.rejects(client.checkLauncherVersion(), { status:426 });
  finish(json({ data:null }));
  await assert.rejects(pending, { status:426 });
});

test('426 no Discord pausa também a comunidade e os eventos já enfileirados', async () => {
  const access = createLauncherAccess({ appVersion:identity.appVersion });
  let calls = 0;
  const relay = createDiscordRelayNotifier({}, identity, {
    baseUrl:'https://example.com', publishableKey:'public-test', access,
    fetchImpl:async (_url, init) => { calls++; assert.equal(init.headers['x-launcher-version'], identity.appVersion); return json(blockedPayload,426); },
  });
  const client = createCommunityClient({ access, fetchImpl:async () => { calls++; return json({ data:null }); } });
  await Promise.all([relay.notify({ kind:'test' }), relay.notify({ kind:'test' })]);
  await assert.rejects(client.getSpeciesStats('MrMime'), { status:426 });
  assert.equal(calls, 1);
});

test('erro de rede não é confundido com atualização obrigatória', async () => {
  const access = createLauncherAccess();
  let calls = 0;
  const client = createCommunityClient({ access, fetchImpl:async () => { calls++; if (calls === 1) throw new Error('offline'); return json({ ok:true }); } });
  await assert.rejects(client.checkLauncherVersion(), { code:'network_error' });
  assert.equal(access.status().updateRequired, false);
  assert.equal((await client.checkLauncherVersion()).ok, true);
});
