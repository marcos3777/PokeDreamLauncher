'use strict';

const MIN_XP_RATE_MS = 5000;

function safeNow(value) {
  const time = Number(value);
  return Number.isFinite(time) ? time : Date.now();
}

function createXpRate(now = Date.now()) {
  return { startedAt: safeNow(now), xp: 0 };
}

function resetXpRate(rate, now = Date.now()) {
  const target = rate && typeof rate === 'object' ? rate : createXpRate(now);
  target.startedAt = safeNow(now);
  target.xp = 0;
  return target;
}

function observeKillXp(rate, events) {
  if (!rate || typeof rate !== 'object' || !Array.isArray(events)) return 0;
  let gained = 0;
  for (const event of events) {
    if (!event || event.t !== 'kill') continue;
    const xp = Number(event.xp);
    if (Number.isFinite(xp) && xp > 0) gained += xp;
  }
  if (gained > 0) rate.xp = Math.max(0, Number(rate.xp) || 0) + gained;
  return gained;
}

function xpPerHour(rate, now = Date.now(), minElapsedMs = MIN_XP_RATE_MS) {
  if (!rate || !Number.isFinite(Number(rate.startedAt))) return null;
  const elapsed = safeNow(now) - Number(rate.startedAt);
  const xp = Number(rate.xp);
  if (!Number.isFinite(xp) || xp <= 0 || elapsed < Math.max(1, Number(minElapsedMs) || 0)) return null;
  return Math.max(0, Math.round(xp * 3600000 / elapsed));
}

function buildXpOverlayScript(rate, options = {}) {
  const state = {
    xp: Math.max(0, Number(rate && rate.xp) || 0),
    startedAt: Number(rate && rate.startedAt) || Date.now(),
    minElapsedMs: MIN_XP_RATE_MS,
    visible: options.visible !== false,
  };
  return `(() => {
    const data = ${JSON.stringify(state)};
    const id = 'poke-dream-launcher-xp-rate';
    let panel = document.getElementById(id);
    if (!data.visible) {
      if (panel) panel.remove();
      return false;
    }
    if (panel && panel.tagName !== 'BUTTON') { panel.remove(); panel = null; }
    if (!panel) {
      panel = document.createElement('button');
      panel.type = 'button';
      panel.id = id;
      panel.setAttribute('aria-label', 'Abrir painel conjunto de experiência por hora');
      panel.style.cssText = 'all:initial;position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;pointer-events:auto;cursor:pointer;display:flex;align-items:center;gap:8px;padding:7px 11px;border:1px solid rgba(89,216,196,.42);border-radius:999px;background:rgba(7,15,18,.92);box-shadow:0 6px 22px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.05);backdrop-filter:blur(8px);font-family:Inter,Segoe UI,Arial,sans-serif;line-height:1;white-space:nowrap;contain:content;';
      const label = document.createElement('span');
      label.textContent = 'XP/H';
      label.style.cssText = 'all:initial;color:#59d8c4;font:800 9px/1 Inter,Segoe UI,Arial,sans-serif;letter-spacing:.8px;';
      const value = document.createElement('span');
      value.dataset.xpRateValue = '1';
      value.style.cssText = 'all:initial;color:#f2f7f6;font:800 13px/1 Inter,Segoe UI,Arial,sans-serif;font-variant-numeric:tabular-nums;';
      panel.append(label, value);
      (document.body || document.documentElement).appendChild(panel);
      const draw = () => {
        const current = document.getElementById(id);
        if (!current) return;
        const output = current.querySelector('[data-xp-rate-value]');
        const xp = Number(current.dataset.xp) || 0;
        const elapsed = Date.now() - (Number(current.dataset.startedAt) || Date.now());
        const minElapsed = Number(current.dataset.minElapsedMs) || 5000;
        const perHour = xp > 0 && elapsed >= minElapsed ? Math.max(0, Math.round(xp * 3600000 / elapsed)) : null;
        if (output) output.textContent = perHour == null ? '—' : perHour.toLocaleString('pt-BR');
        current.title = perHour == null ? 'Aguardando XP suficiente para calcular a taxa' : perHour.toLocaleString('pt-BR') + ' XP por hora · ' + xp.toLocaleString('pt-BR') + ' XP observado';
      };
      panel.__xpRateDraw = draw;
      panel.addEventListener('click', () => {
        if (window.pokeLauncherHud && typeof window.pokeLauncherHud.openXpPanel === 'function') window.pokeLauncherHud.openXpPanel();
      });
      const timer = setInterval(() => {
        if (!document.getElementById(id)) { clearInterval(timer); return; }
        draw();
      }, 1000);
      panel.__xpRateTimer = timer;
    }
    panel.dataset.xp = String(data.xp);
    panel.dataset.startedAt = String(data.startedAt);
    panel.dataset.minElapsedMs = String(data.minElapsedMs);
    if (typeof panel.__xpRateDraw === 'function') panel.__xpRateDraw();
    return true;
  })()`;
}

module.exports = { MIN_XP_RATE_MS, buildXpOverlayScript, createXpRate, observeKillXp, resetXpRate, xpPerHour };
