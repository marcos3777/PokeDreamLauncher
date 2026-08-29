'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { learnLootSourcesFromDump, normalizeLootSources, observeLootSources } = require('../loot-sources');

test('associa o loot ao Pokémon morto na mesma posição', () => {
  const sources = {};
  const changed = observeLootSources([
    { t:'kill', x:29, y:14, species:'Abra' },
    { t:'loot', x:29, y:14, items:[{ id:'psychic_vest', count:1 }] },
  ], sources);
  assert.equal(changed, true);
  assert.deepEqual(sources, { psychic_vest:['Abra'] });
});

test('não atribui um loot ambíguo quando há mais de uma morte', () => {
  const sources = {};
  observeLootSources([
    { t:'kill', x:1, y:1, species:'Abra' },
    { t:'kill', x:2, y:2, species:'Geodude' },
    { t:'loot', x:3, y:3, items:[{ id:'small_stone', count:1 }] },
  ], sources);
  assert.deepEqual(sources, {});
});

test('deduplica fontes e aprende a partir do JSONL do diagnóstico', () => {
  const sources = { enchanted_gem:['Abra'] };
  const frame = { v:3, t:1000, k:1, f:{ v:[
    { t:'kill', x:4, y:5, species:'Abra' },
    { t:'loot', x:4, y:5, items:[{ id:'enchanted_gem', count:1 }, { id:'enigma_stone', count:1 }] },
  ] } };
  const dump = JSON.stringify({ kind:'ws', dir:'recv', raw:'42/world,["world:frame",'+JSON.stringify(frame)+']' });
  assert.equal(learnLootSourcesFromDump(dump, sources), true);
  assert.deepEqual(sources, { enchanted_gem:['Abra'], enigma_stone:['Abra'] });
});

test('normaliza somente ids e nomes seguros', () => {
  assert.deepEqual(normalizeLootSources({ psychic_vest:['Abra', 'Abra'], '<script>':['X'], earth_stone:'Geodude' }), { psychic_vest:['Abra'] });
});
