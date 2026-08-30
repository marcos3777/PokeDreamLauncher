'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMasteryState, readMasteryState, masteryForItem } = require('../mastery-catalog');
const catalog = require('../assets/mastery-requirements.json');

function progress(main = {}, mid = {}) {
  const state = createMasteryState();
  readMasteryState(state, { maestriaMain:main, maestriaMid:mid });
  return state;
}

test('catálogo cobre os 18 elementos, com cinco níveis de dano e defesa', () => {
  assert.deepEqual(catalog.types.map(t => t.id).sort(), ['bug','dark','dragon','electric','fairy','fighting','fire','flying','ghost','grass','ground','ice','normal','poison','psychic','rock','steel','water']);
  for (const type of catalog.types) {
    assert.deepEqual(type.damage.map(l => l.level), [1,2,3,4,5]);
    assert.deepEqual(type.defense.map(l => l.level), [1,2,3,4,5]);
    assert.deepEqual(type.damage.map(l => l.gold), [250000,750000,1875000,3750000,7500000]);
    for (const level of [...type.damage, ...type.defense]) {
      for (const item of level.items) {
        assert.match(item.itemId, /^[a-z0-9_]+$/);
        assert.ok(item.name && Number.isInteger(item.count) && item.count > 0);
      }
    }
  }
});

test('Planta preserva os requisitos de referência dos cinco níveis', () => {
  const grass = catalog.types.find(t => t.id === 'grass');
  assert.deepEqual(grass.damage.map(l => l.items.map(i => [i.itemId, i.count])), [
    [['flower_stem',420],['leaves',420]],
    [['bulb',594],['chicory',594]],
    [['sunflower',1350],['big_leaf',1125]],
    [['small_red_flower',2160],['poison_petal',2160]],
    [['red_petal',3240],['coconut_leaves',2700]],
  ]);
});

test('Bug nível 1 pede guardar 420 antenas e desconta apenas a bolsa atual', () => {
  const result = masteryForItem('caterpie_antenna', progress(), 120);
  assert.equal(result.remaining, 420);
  assert.equal(result.missing, 300);
  assert.deepEqual(result.uses.map(u => [u.type, u.track, u.level, u.count, u.completed]), [['bug','main',1,420,false]]);
  assert.equal(masteryForItem('caterpie_antenna', progress(), 600).missing, 0);
  assert.equal(masteryForItem('poke_ball', progress(), 1000), null);
});

test('concluir um nível retira seu consumo futuro sem descontar de novo itens já gastos', () => {
  const state = progress();
  assert.equal(readMasteryState(state, { mm:{ bug:1 } }, true), true);
  const result = masteryForItem('caterpie_antenna', state, 0);
  assert.equal(result.remaining, 0);
  assert.equal(result.missing, 0);
  assert.equal(result.uses[0].completed, true);
  assert.equal(masteryForItem('piece_of_cocoon', state, 300).missing, 780);
});

test('itens usados em vários níveis e elementos são somados antes de descontar a bolsa', () => {
  const result = masteryForItem('steelix_tail', progress({ ground:4, steel:3 }), 1000);
  assert.equal(result.uses.length, 3);
  assert.equal(result.remaining, 2700 + 1350 + 2700);
  assert.equal(result.missing, 5750);
});

test('Bug Gosme pertence à defesa, sem confundir com os níveis de dano', () => {
  const result = masteryForItem('bug_gosme', progress({ bug:5 }, { bug:4 }), 12000);
  assert.equal(result.remaining, 16433);
  assert.equal(result.missing, 4433);
  assert.ok(result.uses.every(u => u.track === 'mid'));
  assert.equal(result.uses.filter(u => u.completed).length, 4);
});

test('progresso desconhecido não vira nível zero nem quantidade suficiente', () => {
  const state = createMasteryState();
  readMasteryState(state, { mm:{ bug:2 } }, true);
  assert.equal(masteryForItem('caterpie_antenna', state, 9999).remaining, null);
  assert.equal(masteryForItem('caterpie_antenna', state, 9999).missing, null);
  readMasteryState(state, { maestriaMain:{} });
  assert.equal(masteryForItem('caterpie_antenna', state).remaining, 420);
  assert.equal(masteryForItem('bug_gosme', state).remaining, null);
});

test('deltas diretos preservam os outros elementos, removem null e ignoram chaves estranhas', () => {
  const state = progress({ bug:2, grass:3 }, { bug:1 });
  readMasteryState(state, { mm:{ bug:3, fire:1, unknown:5 }, md:{ bug:null } }, true);
  assert.deepEqual(state, { main:{ bug:3, grass:3, fire:1 }, mid:{} });
  assert.equal(readMasteryState(state, {}, true), false);
  readMasteryState(state, { maestriaMain:{ grass:1 }, maestriaMid:{} });
  assert.deepEqual(state, { main:{ grass:1 }, mid:{} });
});

test('estados inválidos não liberam itens e consultas não alteram outras contas', () => {
  const a = progress({ bug:1 });
  const b = progress({ bug:0 });
  assert.equal(masteryForItem('caterpie_antenna', a, 500).remaining, 0);
  assert.equal(masteryForItem('caterpie_antenna', b, 20).missing, 400);
  readMasteryState(b, { mm:{ bug:99 } }, true);
  assert.equal(masteryForItem('caterpie_antenna', b, 500).remaining, null);
  const first = masteryForItem('caterpie_antenna', a);
  first.uses[0].count = 1;
  assert.equal(masteryForItem('caterpie_antenna', a).uses[0].count, 420);
});
