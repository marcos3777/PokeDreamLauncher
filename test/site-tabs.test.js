'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DREAM_TAB_ID,
  MAX_TABS,
  MAX_VIEWS_PER_TAB,
  normalizeSiteUrl,
  restoreWorkspaceState,
  sitePartition,
} = require('../site-tabs');

test('normalizes common site links and rejects unsupported protocols', () => {
  assert.equal(normalizeSiteUrl('example.com').url, 'https://example.com/');
  assert.equal(normalizeSiteUrl('http://example.com/path#section').url, 'http://example.com/path');
  assert.equal(normalizeSiteUrl('javascript:alert(1)').ok, false);
  assert.equal(normalizeSiteUrl('file:///tmp/test').ok, false);
});

test('gives every site screen a stable isolated partition', () => {
  assert.equal(sitePartition('site-abc123', 1), 'persist:site-abc123-view1');
  assert.equal(sitePartition('site-abc123', 4), 'persist:site-abc123-view4');
  assert.notEqual(sitePartition('site-abc123', 1), sitePartition('site-abc123', 2));
});

test('restores at most four tabs and four views per tab', () => {
  const raw = {
    views: 99,
    activeTabId: 'site-two',
    tabs: [
      { id: 'site-one', url: 'one.example', views: 9 },
      { id: 'site-two', url: 'https://two.example', views: 2 },
      { id: 'site-three', url: 'three.example', views: 1 },
      { id: 'site-four', url: 'four.example', views: 1 },
    ],
  };
  const restored = restoreWorkspaceState(raw);
  assert.equal(restored.dreamViews, MAX_VIEWS_PER_TAB);
  assert.equal(restored.tabs.length + 1, MAX_TABS);
  assert.equal(restored.tabs[0].views, MAX_VIEWS_PER_TAB);
  assert.equal(restored.activeTabId, 'site-two');
});

test('falls back to the fixed PokeDream tab for invalid saved state', () => {
  const restored = restoreWorkspaceState({ activeTabId: 'missing', tabs: [{ id: 'bad', url: 'x', views: 1 }] });
  assert.equal(restored.activeTabId, DREAM_TAB_ID);
  assert.deepEqual(restored.tabs, []);
});
