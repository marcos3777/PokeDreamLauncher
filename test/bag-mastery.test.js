'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const mastery = require('../mastery-catalog');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.html'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function ui() {
  const context = vm.createContext({
    bagSlot:'all',
    esc:s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' })[c]),
  });
  vm.runInContext(app.slice(app.indexOf('  function groupBagItems('), app.indexOf('  function renderBags(')), context);
  return context;
}

test('visão Todas mostra a referência por conta, sem somar requisitos de várias contas no card', () => {
  const renderer = ui();
  const item = count => ({ itemId:'caterpie_antenna', count, mastery:mastery.masteryForItem('caterpie_antenna', { main:{}, mid:{} }, count) });
  const grouped = renderer.groupBagItems([
    { slot:1, ready:true, name:'Conta A', items:[item(500)] },
    { slot:2, ready:true, name:'Conta B', items:[item(20)] },
  ]);
  assert.equal(grouped[0].count, 520);
  assert.equal(grouped[0].accounts[0].mastery.missing, 0);
  assert.equal(grouped[0].accounts[1].mastery.missing, 400);
  const html = renderer.bagMasteryHtml(grouped[0]);
  assert.match(html, />420×<\/strong>/);
  assert.match(html, /data-bag-mastery-info="caterpie_antenna"/);
  assert.doesNotMatch(html, /Conta A|Conta B|Faltam|Guardar|<table|<details/);
  const reference = renderer.bagMasteryReferenceHtml(grouped[0]);
  assert.match(reference, /<table>/);
  assert.match(reference, /Referência por conta/);
  assert.match(reference, /Inseto \(Bug\)/);
});

test('interface identifica o item mesmo sem progresso e escapa o nome da conta', () => {
  const renderer = ui();
  renderer.bagSlot = 1;
  const info = mastery.masteryForItem('bug_gosme', mastery.createMasteryState(), 50);
  const item = { itemId:'bug_gosme', mastery:info, accounts:[{ slot:1, name:'<img src=x>', mastery:info }] };
  const html = renderer.bagMasteryHtml(item);
  assert.match(html, /Item de maestria/);
  assert.match(html, />—<\/strong>/);
  const reference = renderer.bagMasteryReferenceHtml(item);
  assert.match(reference, /Aguardando o progresso/);
  assert.match(reference, /Defesa/);
  assert.match(reference, /&lt;img src=x&gt;/);
  assert.doesNotMatch(html, /<img src=x>|Quantidade suficiente|Faltam/);
});

test('trocar a conta usa somente seus níveis pendentes e mantém a tabela completa no i', () => {
  const renderer = ui();
  renderer.bagSlot = 1;
  const info = mastery.masteryForItem('caterpie_antenna', { main:{ bug:1 }, mid:{} }, 100);
  const item = { itemId:'caterpie_antenna', mastery:info, accounts:[{ slot:1, name:'Conta A', mastery:info }] };
  assert.match(renderer.bagMasteryHtml(item), />0×<\/strong>/);
  const reference = renderer.bagMasteryReferenceHtml(item);
  assert.match(reference, /Conta A/);
  assert.match(reference, /420×/);
  assert.match(reference, /Concluído/);
  renderer.bagSlot = 2;
  const pending = mastery.masteryForItem('caterpie_antenna', { main:{}, mid:{} }, 20);
  const second = { itemId:'caterpie_antenna', mastery:pending, accounts:[{ slot:2, name:'Conta B', mastery:pending }] };
  assert.match(renderer.bagMasteryHtml(second), />420×<\/strong>/);
  assert.match(renderer.bagMasteryReferenceHtml(second), /Conta B/);
  assert.doesNotMatch(renderer.bagMasteryReferenceHtml(second), /Conta A|Concluído/);
  assert.equal(renderer.bagMasteryHtml({ itemId:'poke_ball' }), '');
});

test('payload real da bolsa transporta requisitos sem remover raridade, trava e fontes', () => {
  const context = vm.createContext({
    ...mastery,
    games:[{ slot:1, charName:'Conta', _bag:{ caterpie_antenna:120, poke_ball:50 }, _bagLocks:new Set(['caterpie_antenna']), _mastery:{ main:{}, mid:{} } }],
    isRareItem:() => false, itemDropSources:{ caterpie_antenna:['Caterpie'] },
  });
  vm.runInContext(main.slice(main.indexOf('function bagAccountsPayload()'), main.indexOf("ipcMain.handle('getBags'")), context);
  const payload = context.bagAccountsPayload();
  const antenna = payload.accounts[0].items.find(i => i.itemId === 'caterpie_antenna');
  assert.equal(antenna.mastery.missing, 300);
  assert.equal(antenna.locked, true);
  assert.equal(antenna.sources[0], 'Caterpie');
  assert.equal(payload.accounts[0].items.find(i => i.itemId === 'poke_ball').mastery, null);
});

test('instalador inclui o catálogo e o módulo sem depender dos arquivos de análise', () => {
  const { build } = require('../package.json');
  assert.ok(build.files.includes('mastery-catalog.js'));
  assert.ok(build.files.includes('assets/mastery-requirements.json'));
  assert.ok(!build.files.includes('analysis/**'));
});

test('integração recebe progresso offline, snapshot e avanço de nível sem depender de mudança na bolsa', () => {
  const noop = () => {};
  const context = vm.createContext({
    ...mastery, ...require('../world-frame'),
    estimatedServerNow:() => 1000, readRuneState:noop, readXpBoostState:noop,
    applyState:noop, resolveName:noop, pushAccounts:noop, updateHunt:() => false,
    applyTaskDelta:() => ({ changed:false }), partyHpSnapshot:() => ({}),
    observePartyDeaths:noop, refreshActive:() => false,
  });
  vm.runInContext(main.slice(main.indexOf('function applyOfflineState('), main.indexOf('function isInfoUrl(')), context);
  const g = { _charId:'sample', _bag:{ caterpie_antenna:120 }, _party:[], _box:{} };
  context.applyOfflineState(g, '/characters/sample/offline', JSON.stringify({ state:{ progress:{ maestriaMain:{}, maestriaMid:{} } } }));
  assert.equal(mastery.masteryForItem('caterpie_antenna', g._mastery, 120).missing, 300);
  context.applyWorldSnapshot(g, { t:1000, k:1, s:{ g:{ maestriaMain:{ bug:1 }, maestriaMid:{} } } });
  assert.equal(mastery.masteryForItem('caterpie_antenna', g._mastery, 120).remaining, 0);
  assert.equal(context.applyWorldFrame(g, { t:1100, k:2, f:{ g:{ mm:{ bug:2 }, md:{ bug:4 } } } }), true);
  assert.equal(mastery.masteryForItem('piece_of_cocoon', g._mastery, 400).remaining, 0);
  assert.equal(mastery.masteryForItem('bug_gosme', g._mastery, 12000).missing, 4433);
  assert.equal(context.applyWorldFrame(g, { t:1050, k:1, f:{ g:{ mm:{ bug:0 } } } }), false);
  assert.equal(g._mastery.main.bug, 2);
});
