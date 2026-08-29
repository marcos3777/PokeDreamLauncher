'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildXpOverlayScript, createXpRate, observeKillXp, resetXpRate, xpPerHour } = require('../xp-rate');

test('soma somente o XP principal dos eventos de abate', () => {
  const rate = createXpRate(1000);
  const gained = observeKillXp(rate, [
    { t: 'hit', xp: 9999 },
    { t: 'kill', xp: 500, partnerXp: 100 },
    { t: 'kill', xp: '250' },
    { t: 'kill', xp: -1 },
  ]);
  assert.equal(gained, 750);
  assert.equal(rate.xp, 750);
});

test('calcula XP por hora a partir do período observado', () => {
  const rate = createXpRate(1000);
  observeKillXp(rate, [{ t: 'kill', xp: 1000 }]);
  assert.equal(xpPerHour(rate, 11000), 360000);
});

test('espera uma amostra mínima e reinicia ao trocar de hunt', () => {
  const rate = createXpRate(1000);
  observeKillXp(rate, [{ t: 'kill', xp: 500 }]);
  assert.equal(xpPerHour(rate, 4999), null);
  assert.equal(resetXpRate(rate, 9000), rate);
  assert.deepEqual(rate, { startedAt: 9000, xp: 0 });
});

test('gera um atalho flutuante válido para abrir o painel conjunto', () => {
  const script = buildXpOverlayScript({ startedAt: 1000, xp: 750 });
  assert.doesNotThrow(() => new Function(script));
  assert.match(script, /pointer-events:auto/);
  assert.match(script, /openXpPanel/);
  assert.match(script, /XP\/H/);
  const hidden = buildXpOverlayScript({ startedAt: 1000, xp: 750 }, { visible:false });
  assert.match(hidden, /panel\.remove\(\)/);
});
