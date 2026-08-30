'use strict';

(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PokemonEffectiveness = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildApi() {
  const VALID_RELATIONS = new Set(['super_effective', 'neutral', 'resisted', 'immune']);

  function multiplierForRelations(relations) {
    const values = Array.isArray(relations) ? relations.filter((value) => VALID_RELATIONS.has(value)) : [];
    if (!values.length) return null;
    if (values.includes('immune')) return 0.25;

    if (values.length === 1) {
      if (values[0] === 'super_effective') return 1.75;
      if (values[0] === 'resisted') return 0.5;
      return 1;
    }

    const weak = values.filter((value) => value === 'super_effective').length;
    const resisted = values.filter((value) => value === 'resisted').length;
    if (weak >= 2) return 1.75;
    if (weak === 1 && resisted === 0) return 1.5;
    if (weak === 1 && resisted === 1) return 1;
    if (resisted === 1) return 0.75;
    if (resisted >= 2) return 0.5;
    return 1;
  }

  function createMatchupIndex(rows) {
    const index = Object.create(null);
    for (const row of Array.isArray(rows) ? rows : []) {
      const attackType = row && (row.attackType || row.attack_type_code);
      const defenseType = row && (row.defenseType || row.defense_type_code);
      const relation = row && row.relation;
      if (typeof attackType !== 'string' || typeof defenseType !== 'string' || !VALID_RELATIONS.has(relation)) continue;
      index[`${attackType}:${defenseType}`] = relation;
    }
    return index;
  }

  function effectivenessFor(attackType, defenseTypes, matchupIndex) {
    if (typeof attackType !== 'string' || !attackType || !Array.isArray(defenseTypes) || !defenseTypes.length) return null;
    const relations = defenseTypes.map((defenseType) => matchupIndex && matchupIndex[`${attackType}:${defenseType}`]);
    if (relations.some((relation) => !VALID_RELATIONS.has(relation))) return null;
    const multiplier = multiplierForRelations(relations);
    return multiplier == null ? null : { attackType, defenseTypes:[...defenseTypes], relations, multiplier };
  }

  function compareCombatRows(left, right, includeXp) {
    const leftMultiplier = Number(left && left.multiplier);
    const rightMultiplier = Number(right && right.multiplier);
    const safeLeft = Number.isFinite(leftMultiplier) ? leftMultiplier : -1;
    const safeRight = Number.isFinite(rightMultiplier) ? rightMultiplier : -1;
    if (safeLeft !== safeRight) return safeRight - safeLeft;
    if (includeXp) {
      const leftXp = Number(left && left.xpPerHour) || 0;
      const rightXp = Number(right && right.xpPerHour) || 0;
      if (leftXp !== rightXp) return rightXp - leftXp;
    }
    return (Number(left && left.dex) || 0) - (Number(right && right.dex) || 0);
  }

  function groupByTaskLevel(rows) {
    const groups = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const number = Number(row && row.taskLevel);
      const level = Number.isFinite(number) && number > 0 ? number : null;
      const key = level == null ? 'none' : String(level);
      if (!groups.has(key)) groups.set(key, { level, rows:[] });
      groups.get(key).rows.push(row);
    }
    return [...groups.values()].sort((left, right) => {
      if (left.level == null) return 1;
      if (right.level == null) return -1;
      return right.level - left.level;
    });
  }

  return { compareCombatRows, createMatchupIndex, effectivenessFor, groupByTaskLevel, multiplierForRelations };
});
