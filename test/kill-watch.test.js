'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { KILL_STALL_MAX_SECONDS, KILL_STALL_MIN_SECONDS, createKillWatchState, normalizeKillStallTimeoutSeconds, observeKill, resetKillWatch, shouldReloadForKillStall } = require('../kill-watch');

test('timer configurável mantém 30 segundos como padrão e limita valores inseguros', () => {
  assert.equal(normalizeKillStallTimeoutSeconds(undefined), 30);
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
  assert.equal(shouldReloadForKillStall(state, 30999), false);
  assert.equal(shouldReloadForKillStall(state, 31000), true);
});

test('uma nova kill renova os 30 segundos', () => {
  const state = observeKill(createKillWatchState(), 1000);
  observeKill(state, 25000);
  assert.equal(shouldReloadForKillStall(state, 54999), false);
  assert.equal(shouldReloadForKillStall(state, 55000), true);
});

test('failsafe respeita um intervalo personalizado', () => {
  const state = observeKill(createKillWatchState(), 1000);
  assert.equal(shouldReloadForKillStall(state, 75999, 75000), false);
  assert.equal(shouldReloadForKillStall(state, 76000, 75000), true);
});

test('reload desarma o failsafe para impedir loop infinito', () => {
  const state = observeKill(createKillWatchState(), 1000);
  assert.equal(shouldReloadForKillStall(state, 31000), true);
  assert.equal(shouldReloadForKillStall(state, 61000), false);
  resetKillWatch(state);
  assert.deepEqual(state, { armed: false, lastKillAt: 0 });
});
