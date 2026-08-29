'use strict';

function parseWorldMessage(payload) {
  const text = String(payload || '');
  const match = text.match(/^42\/world,(\[[\s\S]*\])$/);
  if (!match) return null;
  try {
    const event = JSON.parse(match[1]);
    if (!Array.isArray(event) || typeof event[0] !== 'string' || !event[1] || typeof event[1] !== 'object') return null;
    return { name: event[0], data: event[1] };
  } catch { return null; }
}

function parseWorldFrame(payload) {
  const message = parseWorldMessage(payload);
  return message && message.name === 'world:frame' ? message.data : null;
}

function acceptWorldFrame(order, frame) {
  if (!order || typeof order !== 'object' || !frame || typeof frame !== 'object') return false;
  const time = Number(frame.t);
  const step = Number(frame.k);
  if (!Number.isFinite(time) || !Number.isFinite(step)) return false;
  if (Number.isFinite(order.time)) {
    if (time < order.time || (time === order.time && step <= order.step)) return false;
  }
  order.time = time;
  order.step = step;
  return true;
}

function applyObjectDelta(target, delta) {
  if (!target || typeof target !== 'object' || Array.isArray(target) || !delta || typeof delta !== 'object') return false;
  let changed = false;
  const updates = delta.u;
  if (updates && typeof updates === 'object' && !Array.isArray(updates)) {
    for (const [key, value] of Object.entries(updates)) {
      if (target[key] !== value) { target[key] = value; changed = true; }
    }
  }
  if (Array.isArray(delta.r)) {
    for (const key of delta.r) {
      if (Object.prototype.hasOwnProperty.call(target, key)) { delete target[key]; changed = true; }
    }
  }
  return changed;
}

function deltaId(entry, key) {
  if (entry && typeof entry === 'object') return entry[key];
  return entry;
}

function applyKeyedDelta(target, delta, key = 'uid') {
  const result = { changed: false, added: [] };
  if (!target || typeof target !== 'object' || Array.isArray(target) || !delta || typeof delta !== 'object') return result;
  for (const collection of [delta.a, delta.u]) {
    if (!Array.isArray(collection)) continue;
    for (const patch of collection) {
      const id = deltaId(patch, key);
      if (id == null || !patch || typeof patch !== 'object') continue;
      const existed = Object.prototype.hasOwnProperty.call(target, id);
      const current = existed && target[id] && typeof target[id] === 'object' ? target[id] : {};
      target[id] = Object.assign(current, patch);
      result.changed = true;
      if (!existed) result.added.push(id);
    }
  }
  if (Array.isArray(delta.r)) {
    for (const entry of delta.r) {
      const id = deltaId(entry, key);
      if (id != null && Object.prototype.hasOwnProperty.call(target, id)) {
        delete target[id]; result.changed = true;
      }
    }
  }
  return result;
}

function applyPartyDelta(party, delta) {
  if (!Array.isArray(party) || !delta || typeof delta !== 'object') return false;
  let changed = false;
  if (Array.isArray(delta.r)) {
    const removed = new Set(delta.r.map((entry) => deltaId(entry, 'uid')).filter((uid) => uid != null).map(String));
    for (let i = party.length - 1; i >= 0; i--) {
      if (removed.has(String(party[i]))) { party.splice(i, 1); changed = true; }
    }
  }
  if (Array.isArray(delta.a)) {
    for (const entry of delta.a) {
      const uid = deltaId(entry, 'uid');
      if (uid != null && !party.some((current) => String(current) === String(uid))) { party.push(uid); changed = true; }
    }
  }
  // `o` é a ordem completa após uma troca. O jogo move o ativo para a primeira
  // posição sem reenviar a party inteira.
  if (Array.isArray(delta.o)) {
    const ordered = delta.o.map((entry) => deltaId(entry, 'uid')).filter((uid) => uid != null);
    if (ordered.length !== party.length || ordered.some((uid, index) => String(uid) !== String(party[index]))) {
      party.splice(0, party.length, ...ordered);
      changed = true;
    }
  }
  return changed;
}

function activeUidFromParty(party) {
  if (!party || typeof party !== 'object') return null;
  const collections = Array.isArray(party) ? [party] : [party.a, party.u];
  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    for (const entry of collection) {
      if (entry && typeof entry === 'object' && entry.active === true && entry.uid != null) return entry.uid;
    }
  }
  return null;
}

function applyActiveProgress(box, activeUid, progress) {
  if (!box || typeof box !== 'object' || activeUid == null || !box[activeUid] || !progress || typeof progress !== 'object') return false;
  let changed = false;
  for (const key of ['xp', 'level', 'hp']) {
    if (progress[key] != null && box[activeUid][key] !== progress[key]) {
      box[activeUid][key] = progress[key]; changed = true;
    }
  }
  return changed;
}

module.exports = {
  acceptWorldFrame,
  activeUidFromParty,
  applyActiveProgress,
  applyKeyedDelta,
  applyObjectDelta,
  applyPartyDelta,
  parseWorldFrame,
  parseWorldMessage,
};
