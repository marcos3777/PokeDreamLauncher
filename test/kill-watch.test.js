'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { KILL_STALL_MAX_SECONDS, KILL_STALL_MIN_SECONDS, createKillWatchState, normalizeKillStallTimeoutSeconds, observeKill, resetKillWatch, shouldReloadForKillStall } = require('../kill-watch');

test('timer configurável mantém 120 segundos como padrão e limita valores inseguros', () => {
  assert.equal(normalizeKillStallTimeoutSeconds(undefined), 120);
  assert.equal(normalizeKillStallTimeoutSeconds(75), 75);
  assert.equal(normalizeKillStallTimeoutSeconds(1), KILL_STALL_MIN_SECONDS);
  assert.equal(normalizeKillStallTimeoutSeconds(99999), KILL_STALL_MAX_SECONDS);
});

test('configuração expõe e persiste o timer sem o texto removido do compartilhamento', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  const config = fs.readFileSync(path.join(root, 'config.html'), 'utf8');
  assert.match(main, /killStallTimeoutSeconds/);
  assert.match(main, /ipcMain\.handle\('setKillWatchTimeout'/);
  assert.match(preload, /setKillWatchTimeout/);
  assert.match(config, /id="failsafe-seconds"/);
  assert.doesNotMatch(config, /Nunca envia/);
});

test('failsafe só arma depois de observar uma kill', () => {
  const state = createKillWatchState();
  assert.equal(shouldReloadForKillStall(state, 60000), false);
  observeKill(state, 1000);
  assert.equal(shouldReloadForKillStall(state, 120999), false);
  assert.equal(shouldReloadForKillStall(state, 121000), true);
});

test('uma nova kill renova os 120 segundos', () => {
  const state = observeKill(createKillWatchState(), 1000);
  observeKill(state, 25000);
  assert.equal(shouldReloadForKillStall(state, 144999), false);
  assert.equal(shouldReloadForKillStall(state, 145000), true);
});

test('failsafe respeita um intervalo personalizado', () => {
  const state = observeKill(createKillWatchState(), 1000);
  assert.equal(shouldReloadForKillStall(state, 75999, 75000), false);
  assert.equal(shouldReloadForKillStall(state, 76000, 75000), true);
});

test('reload desarma o failsafe para impedir loop infinito', () => {
  const state = observeKill(createKillWatchState(), 1000);
  assert.equal(shouldReloadForKillStall(state, 121000), true);
  assert.equal(shouldReloadForKillStall(state, 241000), false);
  resetKillWatch(state);
  assert.deepEqual(state, { armed: false, lastKillAt: 0 });
});

function recoveryHarness() {
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  let now = 121000;
  const reloaded = [];
  const games = Array.from({ length: 4 }, (_, slot) => ({
    slot, _killWatch: observeKill(createKillWatchState(), 1000),
    view: { webContents: { isDestroyed: () => false, reload: () => reloaded.push({ slot, at: now }) } },
  }));
  const context = vm.createContext({ games, killStallTimeoutSeconds: 120, shouldReloadForKillStall,
    Date: { now: () => now }, console: { log() {} }, discordEvent() {} });
  vm.runInContext(source.slice(source.indexOf('const STALL_RECOVERY_STABLE_MS'), source.indexOf('function startKillWatch()')), context);
  return { games, reloaded, tick(at) { now = at; vm.runInContext('checkKillStalls()', context); } };
}

test('queda simultânea recarrega uma tela a cada 15 segundos sem desarmar as pendentes', () => {
  const h = recoveryHarness();
  h.tick(121000);
  assert.deepEqual(h.reloaded, [{ slot: 0, at: 121000 }]);
  assert.equal(h.games[1]._killWatch.armed, true);
  h.tick(135999);
  assert.equal(h.reloaded.length, 1);
  h.tick(136000);
  h.tick(151000);
  h.tick(166000);
  assert.deepEqual(h.reloaded.map(x => x.at), [121000, 136000, 151000, 166000]);
  assert.deepEqual(h.reloaded.map(x => x.slot), [0, 1, 2, 3]);
});

test('tela que volta a matar enquanto aguarda não recebe F5 e novas tentativas respeitam o intervalo', () => {
  const h = recoveryHarness();
  h.tick(121000);
  observeKill(h.games[1]._killWatch, 130000);
  h.tick(136000);
  assert.deepEqual(h.reloaded.map(x => x.slot), [0, 2]);
  h.tick(151000);
  h.tick(241000);
  assert.deepEqual(h.reloaded.at(-1), { slot: 0, at: 241000 });
  h.tick(250000);
  assert.equal(h.reloaded.length, 4);
  h.tick(256000);
  assert.deepEqual(h.reloaded.at(-1), { slot: 1, at: 256000 });
});
