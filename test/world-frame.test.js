'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  acceptWorldFrame,
  activeUidFromParty,
  applyActiveProgress,
  applyKeyedDelta,
  applyObjectDelta,
  applyPartyDelta,
  parseWorldFrame,
  parseWorldMessage,
} = require('../world-frame');

function socketFrame(frame) {
  return `42/world,["world:frame",${JSON.stringify(frame)}]`;
}

test('lê world:frame v3 e ignora outros eventos Socket.IO', () => {
  const frame = parseWorldFrame(socketFrame({ v:3, t:1000, k:20, f:{ p:{ esc:{ kills:116 } } } }));
  assert.equal(frame.v, 3);
  assert.equal(frame.f.p.esc.kills, 116);
  assert.equal(parseWorldFrame('42/world,["world:action_ack",{"accepted":true}]'), null);
  assert.equal(parseWorldFrame('42/chat,["chat:message",{}]'), null);
});

test('lê snapshot do mundo sem confundir com frame incremental', () => {
  const payload = '42/world,["world:snapshot",{"v":3,"t":1200,"k":22,"s":{"h":"grimer"}}]';
  const message = parseWorldMessage(payload);
  assert.equal(message.name, 'world:snapshot');
  assert.equal(message.data.s.h, 'grimer');
  assert.equal(parseWorldFrame(payload), null);
});

test('ordena frames por tempo e passo sem reaplicar duplicados', () => {
  const order = {};
  assert.equal(acceptWorldFrame(order, { t:1000, k:20 }), true);
  assert.equal(acceptWorldFrame(order, { t:1000, k:20 }), false);
  assert.equal(acceptWorldFrame(order, { t:999, k:99 }), false);
  assert.equal(acceptWorldFrame(order, { t:1000, k:21 }), true);
  assert.equal(acceptWorldFrame(order, { t:1400, k:25 }), true);
});

test('mescla compras e remove itens vendidos da mochila', () => {
  const bag = { poke_ball:140, straw:186 };
  assert.equal(applyObjectDelta(bag, { u:{ poke_ball:157 } }), true);
  assert.deepEqual(bag, { poke_ball:157, straw:186 });
  assert.equal(applyObjectDelta(bag, { r:['straw'] }), true);
  assert.deepEqual(bag, { poke_ball:157 });
});

test('mescla adições, atualizações e remoções da Box por uid', () => {
  const box = { 1:{ uid:1, species:'Squirtle', xp:3700 } };
  let result = applyKeyedDelta(box, { u:[{ uid:1, xp:4000 }] }, 'uid');
  assert.equal(result.changed, true);
  assert.equal(box[1].xp, 4000);
  assert.equal(box[1].species, 'Squirtle');
  result = applyKeyedDelta(box, { a:[{ uid:2, species:'Hoothoot', shiny:true }] }, 'uid');
  assert.deepEqual(result.added, [2]);
  assert.equal(box[2].shiny, true);
  applyKeyedDelta(box, { r:[1] }, 'uid');
  assert.equal(box[1], undefined);
});

test('aplica entradas e saídas da party sem confundir updates de HP com ordem', () => {
  const party = [1];
  assert.equal(applyPartyDelta(party, { u:[{ uid:1, hp:200 }] }), false);
  assert.equal(applyPartyDelta(party, { a:[{ uid:2 }] }), true);
  assert.deepEqual(party, [1, 2]);
  assert.equal(applyPartyDelta(party, { r:[1] }), true);
  assert.deepEqual(party, [2]);
});

test('troca o ativo pela marca active e respeita a nova ordem completa da party', () => {
  const party = [34, 179, 64];
  const delta = { u:[{ uid:64, active:true }, { uid:34, active:null }], o:[64, 179, 34] };
  assert.equal(activeUidFromParty(delta), 64);
  assert.equal(applyPartyDelta(party, delta), true);
  assert.deepEqual(party, [64, 179, 34]);
});

test('leva XP e nível do estado essencial para o Pokémon ativo', () => {
  const box = { 1:{ uid:1, species:'Squirtle', xp:4900, level:9 } };
  assert.equal(applyActiveProgress(box, 1, { xp:5200, level:10 }), true);
  assert.equal(box[1].xp, 5200);
  assert.equal(box[1].level, 10);
  assert.equal(applyActiveProgress(box, 2, { xp:9999 }), false);
});

test('integração processa WebSocket mesmo sem diagnóstico e remove o fluxo antigo', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const received = source.indexOf("method === 'Network.webSocketFrameReceived'");
  const parsed = source.indexOf('const frame = parseWorldFrame', received);
  const dumped = source.indexOf('if (diagOn && isDumpSlot(g.slot)) dumpWs', received);
  assert.ok(received >= 0 && parsed > received && dumped > parsed);
  assert.match(source, /isActionReqUrl/);
  assert.doesNotMatch(source, new RegExp('isStateReqUrl|feedState|applyPatch|patchGz|/' + 'save'));
});
