'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  compareCombatRows,
  createMatchupIndex,
  effectivenessFor,
  groupByTaskLevel,
  multiplierForRelations,
} = require('../pokemon-effectiveness');

test('aplica os multiplicadores próprios do PokeDream', () => {
  assert.equal(multiplierForRelations(['super_effective']), 1.75);
  assert.equal(multiplierForRelations(['resisted']), 0.5);
  assert.equal(multiplierForRelations(['super_effective', 'neutral']), 1.5);
  assert.equal(multiplierForRelations(['resisted', 'neutral']), 0.75);
  assert.equal(multiplierForRelations(['super_effective', 'resisted']), 1);
  assert.equal(multiplierForRelations(['immune', 'super_effective']), 0.25);
});
test('água causa 1,75x em Vulpix e 0,75x em Bellsprout', () => {
  const index = createMatchupIndex([
    { attack_type_code:'water', defense_type_code:'fire', relation:'super_effective' },
    { attack_type_code:'water', defense_type_code:'grass', relation:'resisted' },
    { attack_type_code:'water', defense_type_code:'poison', relation:'neutral' },
  ]);
  assert.equal(effectivenessFor('water', ['fire'], index).multiplier, 1.75);
  assert.equal(effectivenessFor('water', ['grass', 'poison'], index).multiplier, 0.75);
});

test('ordena por dano e usa XP/h apenas como desempate quando solicitado', () => {
  const rows = [
    { species:'A', dex:1, multiplier:1.5, xpPerHour:100000 },
    { species:'B', dex:2, multiplier:1.75, xpPerHour:50000 },
    { species:'C', dex:3, multiplier:1.5, xpPerHour:200000 },
  ];
  assert.deepEqual([...rows].sort((a, b) => compareCombatRows(a, b, false)).map((row) => row.species), ['B','A','C']);
  assert.deepEqual([...rows].sort((a, b) => compareCombatRows(a, b, true)).map((row) => row.species), ['B','C','A']);
});

test('separa níveis de task sem promover um Pokémon de nível menor', () => {
  const groups = groupByTaskLevel([
    { species:'Nv70 forte', taskLevel:70 },
    { species:'Nv80 fraco', taskLevel:80 },
    { species:'Sem task', taskLevel:null },
  ]);
  assert.deepEqual(groups.map((group) => group.level), [80,70,null]);
  assert.equal(groups[0].rows[0].species, 'Nv80 fraco');
});
