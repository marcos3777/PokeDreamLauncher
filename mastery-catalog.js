'use strict';

const catalog = require('./assets/mastery-requirements.json');
const TYPE_IDS = new Set(catalog.types.map((type) => type.id));
const requirements = new Map();
for (const type of catalog.types) {
  for (const [track, levels] of [['main', type.damage], ['mid', type.defense]]) {
    for (const level of levels) {
      for (const item of level.items) {
        if (!requirements.has(item.itemId)) requirements.set(item.itemId, { name:item.name, uses:[] });
        requirements.get(item.itemId).uses.push({
          type:type.id, typeName:type.name, track, trackName:track === 'main' ? 'Dano' : 'Defesa',
          level:level.level, count:item.count, gold:level.gold,
        });
      }
    }
  }
}

function isMap(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// null means the game has not supplied this track yet; {} means level zero.
function createMasteryState() { return { main:null, mid:null }; }

function validLevel(value) { return Number.isInteger(value) && value >= 0 && value <= 5; }

function readMasteryState(state, source, delta = false) {
  if (!state || !isMap(source)) return false;
  const before = JSON.stringify(state);
  for (const [track, full, short] of [['main', 'maestriaMain', 'mm'], ['mid', 'maestriaMid', 'md']]) {
    const key = Object.hasOwn(source, full) ? full : short;
    if (!Object.hasOwn(source, key)) {
      if (!delta) state[track] = null;
      continue;
    }
    const value = source[key];
    if (!isMap(value)) { state[track] = null; continue; }
    // Full names are snapshots; compact names in world:frame are direct patches.
    const patch = delta && key === short;
    if (!patch) state[track] = {};
    // A patch without its baseline cannot establish the other elements' levels.
    if (!isMap(state[track])) continue;
    for (const [type, level] of Object.entries(value)) {
      if (!TYPE_IDS.has(type)) continue;
      if (level === null && patch) delete state[track][type];
      else state[track][type] = validLevel(level) ? level : null;
    }
  }
  return before !== JSON.stringify(state);
}

function masteryForItem(itemId, state, count = 0) {
  const definition = requirements.get(itemId);
  if (!definition) return null;
  const uses = definition.uses.map((use) => {
    const levels = state && state[use.track];
    const current = isMap(levels) ? (Object.hasOwn(levels, use.type) ? levels[use.type] : 0) : null;
    return { ...use, completed:validLevel(current) ? current >= use.level : null };
  });
  const known = uses.every((use) => use.completed !== null);
  const remaining = known ? uses.reduce((sum, use) => sum + (use.completed ? 0 : use.count), 0) : null;
  const owned = Number.isFinite(Number(count)) ? Math.max(0, Math.floor(Number(count))) : 0;
  return {
    name:definition.name, uses, remaining,
    missing:known ? Math.max(0, remaining - owned) : null,
  };
}

module.exports = { createMasteryState, readMasteryState, masteryForItem };
