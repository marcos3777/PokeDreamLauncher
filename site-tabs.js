'use strict';

const DREAM_TAB_ID = 'dream';
const MAX_TABS = 4;
const MAX_VIEWS_PER_TAB = 4;

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function normalizeSiteUrl(value) {
  let input = String(value || '').trim();
  if (!input) return { ok: false, error: 'Digite o link do site.' };
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(input)) input = `https://${input}`;

  let url;
  try { url = new URL(input); }
  catch { return { ok: false, error: 'Esse link não parece válido.' }; }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return { ok: false, error: 'Use um link que comece com http:// ou https://.' };
  }
  if (!url.hostname || url.username || url.password) {
    return { ok: false, error: 'Esse link não pode ser aberto pelo launcher.' };
  }
  url.hash = '';
  return { ok: true, url: url.toString(), title: siteTitle(url) };
}

function siteTitle(value) {
  const url = value instanceof URL ? value : new URL(value);
  const host = url.hostname.replace(/^www\./i, '');
  return host || 'Site';
}

function validTabId(value) {
  return typeof value === 'string' && /^site-[a-z\d-]{1,80}$/i.test(value);
}

function sitePartition(tabId, slot) {
  if (!validTabId(tabId)) throw new Error('Invalid site tab id');
  const safeSlot = clampInt(slot, 1, MAX_VIEWS_PER_TAB, 1);
  return `persist:${tabId}-view${safeSlot}`;
}

function restoreWorkspaceState(raw, dreamDefault = 2) {
  const state = raw && typeof raw === 'object' ? raw : {};
  const dreamViews = clampInt(state.views, 1, MAX_VIEWS_PER_TAB, dreamDefault);
  const tabs = [];
  const seen = new Set();

  for (const item of Array.isArray(state.tabs) ? state.tabs : []) {
    if (tabs.length >= MAX_TABS - 1 || !item || !validTabId(item.id) || seen.has(item.id)) continue;
    const normalized = normalizeSiteUrl(item.url);
    if (!normalized.ok) continue;
    seen.add(item.id);
    tabs.push({
      id: item.id,
      url: normalized.url,
      title: String(item.title || normalized.title).trim().slice(0, 80) || normalized.title,
      views: clampInt(item.views, 1, MAX_VIEWS_PER_TAB, 1),
    });
  }

  const activeTabId = state.activeTabId === DREAM_TAB_ID || tabs.some((tab) => tab.id === state.activeTabId)
    ? state.activeTabId
    : DREAM_TAB_ID;
  return { dreamViews, tabs, activeTabId };
}

module.exports = {
  DREAM_TAB_ID,
  MAX_TABS,
  MAX_VIEWS_PER_TAB,
  normalizeSiteUrl,
  restoreWorkspaceState,
  sitePartition,
  siteTitle,
};
