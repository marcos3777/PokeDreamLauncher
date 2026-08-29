'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RARE_ITEM_NAMES, canonicalItemName, isRareItem, rareItemName } = require('../rare-items');

test('catálogo raro contém os 121 itens informados sem duplicatas', () => {
  assert.equal(RARE_ITEM_NAMES.length, 121);
  assert.equal(new Set(RARE_ITEM_NAMES.map(canonicalItemName)).size, 121);
});

test('reconhece ids do jogo independentemente de espaços, hífens e apóstrofos', () => {
  assert.equal(isRareItem('purple_leaf'), true);
  assert.equal(isRareItem('two-colored_tail'), true);
  assert.equal(isRareItem('purple_nurses_fur'), true);
  assert.equal(isRareItem('capoeira_tail'), true);
  assert.equal(isRareItem('earth_stone'), false);
  assert.equal(rareItemName('green_queen_ear'), 'Green Queen Ear');
  assert.equal(rareItemName('earth_stone'), null);
});
