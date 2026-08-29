'use strict';

const KILL_STALL_TIMEOUT_MS = 30 * 1000;
const KILL_STALL_MIN_SECONDS = 10;
const KILL_STALL_MAX_SECONDS = 10 * 60;

function normalizeKillStallTimeoutSeconds(value, fallback = KILL_STALL_TIMEOUT_MS / 1000) {
  const fallbackSeconds = Number.isFinite(Number(fallback)) ? Math.round(Number(fallback)) : KILL_STALL_TIMEOUT_MS / 1000;
  const seconds = Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallbackSeconds;
  return Math.max(KILL_STALL_MIN_SECONDS, Math.min(KILL_STALL_MAX_SECONDS, seconds));
}

function createKillWatchState() {
  return { armed: false, lastKillAt: 0 };
}

function observeKill(state, now = Date.now()) {
  const target = state && typeof state === 'object' ? state : createKillWatchState();
  target.armed = true;
  target.lastKillAt = Number.isFinite(now) ? now : Date.now();
  return target;
}

function resetKillWatch(state) {
  const target = state && typeof state === 'object' ? state : createKillWatchState();
  target.armed = false;
  target.lastKillAt = 0;
  return target;
}

function shouldReloadForKillStall(state, now = Date.now(), timeoutMs = KILL_STALL_TIMEOUT_MS) {
  if (!state || state.armed !== true || !Number.isFinite(state.lastKillAt) || state.lastKillAt <= 0) return false;
  const timeout = Math.max(1000, Number(timeoutMs) || KILL_STALL_TIMEOUT_MS);
  if (now - state.lastKillAt < timeout) return false;
  state.armed = false;
  return true;
}

module.exports = {
  KILL_STALL_MAX_SECONDS,
  KILL_STALL_MIN_SECONDS,
  KILL_STALL_TIMEOUT_MS,
  createKillWatchState,
  normalizeKillStallTimeoutSeconds,
  observeKill,
  resetKillWatch,
  shouldReloadForKillStall,
};
