'use strict';

function createLauncherAccess(options = {}) {
  const currentVersion = String(options.appVersion || '');
  let blocked = null;
  const listeners = new Set();
  if (typeof options.onBlocked === 'function') listeners.add(options.onBlocked);

  function status() {
    return blocked ? { ...blocked } : { updateRequired:false, currentVersion };
  }
  function error() {
    if (!blocked) return null;
    return Object.assign(new Error(blocked.message), {
      status:426, code:'update_required', data:{ error:'update_required', min_version:blocked.minVersion },
    });
  }
  function block(data) {
    if (!blocked) {
      const minimum = data && typeof data.min_version === 'string' && /^\d+\.\d+\.\d+$/.test(data.min_version) && data.min_version.length <= 32
        ? data.min_version : null;
      blocked = {
        updateRequired:true, currentVersion, minVersion:minimum,
        message:minimum
          ? `Atualize o launcher para a versão ${minimum} ou superior para usar os recursos online.`
          : 'Atualize o launcher para continuar usando os recursos online.',
      };
      for (const listener of listeners) { try { listener(status()); } catch {} }
    }
    return error();
  }
  function assertAllowed() { const reason = error(); if (reason) throw reason; }
  function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  return { status, error, block, assertAllowed, subscribe };
}

module.exports = { createLauncherAccess };
