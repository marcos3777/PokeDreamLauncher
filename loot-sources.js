'use strict';

const { parseWorldFrame } = require('./world-frame');

const ITEM_ID = /^[a-z0-9_:-]{1,80}$/i;
const SPECIES = /^[a-z0-9 .'-]{1,60}$/i;

function normalizeLootSources(value) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [itemId, entries] of Object.entries(value)) {
    if (!ITEM_ID.test(itemId) || !Array.isArray(entries)) continue;
    const species = [...new Set(entries.map(String).filter((name) => SPECIES.test(name)))];
    if (species.length) result[itemId] = species.slice(0, 30);
  }
  return result;
}

function samePosition(a, b) {
  return a && b && a.x != null && a.y != null && String(a.x) === String(b.x) && String(a.y) === String(b.y);
}

function observeLootSources(events, sources) {
  if (!Array.isArray(events) || !sources || typeof sources !== 'object') return false;
  const kills = events.filter((event) => event && event.t === 'kill' && SPECIES.test(String(event.species || '')));
  if (!kills.length) return false;
  let changed = false;
  for (const loot of events) {
    if (!loot || loot.t !== 'loot' || !Array.isArray(loot.items)) continue;
    const exact = kills.filter((kill) => samePosition(kill, loot));
    const kill = exact.length ? exact[exact.length - 1] : (kills.length === 1 ? kills[0] : null);
    if (!kill) continue;
    const species = String(kill.species);
    for (const item of loot.items) {
      const itemId = String(item && item.id || '');
      if (!ITEM_ID.test(itemId)) continue;
      const current = Array.isArray(sources[itemId]) ? sources[itemId] : (sources[itemId] = []);
      if (!current.includes(species) && current.length < 30) { current.push(species); changed = true; }
    }
  }
  return changed;
}

function learnLootSourcesFromDump(text, sources) {
  if (typeof text !== 'string' || !sources || typeof sources !== 'object') return false;
  let changed = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    if (!record || record.kind !== 'ws' || record.dir !== 'recv') continue;
    const frame = parseWorldFrame(record.raw);
    if (frame && frame.f && observeLootSources(frame.f.v, sources)) changed = true;
  }
  return changed;
}

module.exports = { learnLootSourcesFromDump, normalizeLootSources, observeLootSources };
