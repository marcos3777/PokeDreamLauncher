'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const config = fs.readFileSync(path.join(root, 'config.html'), 'utf8');
const xpPanel = fs.readFileSync(path.join(root, 'xp-panel.html'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const xpPanelPreload = fs.readFileSync(path.join(root, 'xp-panel-preload.js'), 'utf8');
const gamePreload = fs.readFileSync(path.join(root, 'game-preload.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

function inlineScripts(html) {
  return Array.from(html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi), (match) => match[1]).filter((source) => source.trim());
}

test('scripts inline da interface continuam sintaticamente válidos', () => {
  for (const [name, html] of [['app.html', app], ['config.html', config], ['xp-panel.html', xpPanel]]) {
    const scripts = inlineScripts(html);
    assert.ok(scripts.length, `${name} precisa manter ao menos um script inline`);
    scripts.forEach((source) => assert.doesNotThrow(() => new Function(source), `${name} possui JavaScript inválido`));
  }
});

test('painel de XP usa somente a ponte dedicada', () => {
  const used = new Set(Array.from(xpPanel.matchAll(/\bP\.([A-Za-z0-9_]+)/g), (match) => match[1]));
  const exposed = new Set(Array.from(xpPanelPreload.matchAll(/^\s{2}([A-Za-z0-9_]+):/gm), (match) => match[1]));
  assert.deepEqual(Array.from(used).filter((name) => !exposed.has(name)).sort(), []);
  assert.match(xpPanel, /mobs\/h/);
  assert.doesNotMatch(xpPanel, /> abates</);
});

test('atalho do painel de XP abre a espécie no PokéData sem restaurar a tela antiga de Stats', () => {
  assert.match(xpPanel, /P\.openPokeData/);
  assert.match(xpPanelPreload, /openXpPokeData/);
  assert.match(main, /ipcMain\.on\('openXpPokeData',[\s\S]*hunt && hunt\.species[\s\S]*g\.active && g\.active\.species[\s\S]*open-pokedata-details/);
  assert.match(preload, /onOpenPokeDataDetails[\s\S]*open-pokedata-details/);
  assert.match(app, /function openDexSpecies\(species\)[\s\S]*toggleDex\(true\)/);
  assert.doesNotMatch(app, /function (?:render|toggle|load)Stats|statsOpen|class="st-/);
  assert.doesNotMatch(app + preload + xpPanelPreload + main, /open-stats-details|openXpDetails|onOpenStatsDetails/);
});

test('ranking reinicia sua própria amostra quando o Pokémon ativo muda', () => {
  assert.match(main, /deltaActiveUid[\s\S]*resetPerformanceSchedule\(g\)/);
  assert.match(main, /performanceDelta\(g\._performanceBaseline/);
  assert.match(main, /resolveName\(g\)[\s\S]*prepareTrainerNameBackfill\(g\)/);
  assert.match(main, /markCommunityPerformanceRecordsSynced\(huntPerformance, performanceRecords\)/);
  assert.match(app, /Trocar o Pokémon reinicia somente esta medição/);
});

test('toda função da ponte usada pela interface continua exposta pelo preload', () => {
  const used = new Set(Array.from((app + config).matchAll(/\bP\.([A-Za-z0-9_]+)/g), (match) => match[1]));
  const exposed = new Set(Array.from(preload.matchAll(/^\s{2}([A-Za-z0-9_]+):/gm), (match) => match[1]));
  assert.deepEqual(Array.from(used).filter((name) => !exposed.has(name)).sort(), []);
});

test('todo canal invoke exposto pelo preload possui handler no processo principal', () => {
  const invoked = new Set(Array.from((preload + xpPanelPreload).matchAll(/ipcRenderer\.invoke\('([^']+)'/g), (match) => match[1]));
  const handled = new Set(Array.from(main.matchAll(/ipcMain\.handle\('([^']+)'/g), (match) => match[1]));
  assert.deepEqual(Array.from(invoked).filter((channel) => !handled.has(channel)).sort(), []);
});

test('canais de ação dos overlays possuem listeners no processo principal', () => {
  const sent = new Set(Array.from((gamePreload + xpPanelPreload).matchAll(/ipcRenderer\.send\('([^']+)'/g), (match) => match[1]));
  const listened = new Set(Array.from(main.matchAll(/ipcMain\.on\('([^']+)'/g), (match) => match[1]));
  assert.deepEqual(Array.from(sent).filter((channel) => !listened.has(channel)).sort(), []);
});

test('shell e configurações preservam os pontos de integração essenciais', () => {
  const requiredAppIds = ['tabs','btn-cfg','btn-grid','btn-box','btn-bag','btn-dex','btn-tasks','btn-stats','btn-add','side','main'];
  const requiredConfigIds = ['settings-home-btn','config-scope','sound-btn','items-btn','share-btn','failsafe-btn','xp-hud-enabled','item-display','item-alerts'];
  requiredAppIds.forEach((id) => assert.match(app, new RegExp(`id=["']${id}["']`), `id ${id} ausente em app.html`));
  requiredConfigIds.forEach((id) => assert.ok(
    config.includes(`id="${id}"`) || config.includes(`id='${id}'`) || config.includes(`.id = '${id}'`) || config.includes(`.id = "${id}"`),
    `id ${id} ausente em config.html`,
  ));
  assert.match(app, /--accent:#59d8c4/);
  assert.match(app, /content-visibility:auto/);
  assert.match(config, /grid-template-columns:220px minmax\(0,1fr\)/);
  assert.doesNotMatch(config + preload + main, /share-on|setShareStats|getChangelog|changelog-btn|Novidades/);
  ['drag-handle','resize-handle','reset','count','rows','close'].forEach((id) => assert.match(xpPanel, new RegExp(`id=["']${id}["']`), `id ${id} ausente em xp-panel.html`));
  assert.doesNotMatch(xpPanel, /XP\/h desde o início/);
});

test('painel de Tasks acompanha as contas e controla o aviso geral', () => {
  const taskPanel = app.slice(app.indexOf('// ---- Tasks:'), app.indexOf('function openDexSpecies'));
  assert.match(app, /function renderTasks\(value\)/);
  assert.match(app, /Notificar conclusões/);
  assert.match(app, /P\.getTaskOverview/);
  assert.match(app, /P\.setTaskCompletionNotifications/);
  assert.match(preload, /onTaskOverview[\s\S]*task-overview/);
  assert.match(main, /ipcMain\.handle\('getTaskOverview'/);
  assert.match(main, /notifyTaskCompletions\(g, taskResult\.completions\)/);
  assert.ok(taskPanel.length > 0);
  assert.doesNotMatch(taskPanel, /automa[cç][aã]o|autom[aá]tic/i);
});

test('alertas pessoais usam webhook próprio sem ID nem botão de teste', () => {
  assert.match(config, /id="notifications-critical-webhook"/);
  assert.match(config, /Webhook do seu canal/);
  assert.doesNotMatch(config + preload + main, /notifications-test|testDiscordNotifications|notifications-discord-user|discordUserId|allowDiscordTest/);
});

test('bolsa usa os sprites do jogo sem piscar nem destacar itens configurados em vermelho', () => {
  assert.match(app, /https:\/\/pokedream\.com\.br\/items\//);
  assert.match(app, /data-fallback-src/);
  assert.match(app, /signature !== bagDataSignature/);
  assert.doesNotMatch(app, /\.bag-row\.low\s*\{/);
  assert.doesNotMatch(app, /Baixo · no limite/);
});

test('card da conta mostra nível do segundo Pokémon e saldo', () => {
  assert.match(app, /p2\.level/);
  assert.match(app, /items && inf\.items\.money/);
  assert.match(app, /items\/gold\.png/);
  assert.match(app, /generation-v\/black-white\/animated/);
  assert.doesNotMatch(app, /p2\.xpPct/);
});

test('launcher preserva o comportamento anterior às otimizações da v2.0.2', () => {
  assert.doesNotMatch(main, /disposeWebContentsView|setLauncherBackgroundEconomy|setBackgroundThrottling/);
  assert.doesNotMatch(main, /function (?:ensure|destroy)(?:Config|Xp)View/);
  assert.match(main, /backgroundThrottling: false/);
  assert.match(main, /function removeGame\(slot\)[\s\S]*saveStorage\(g\)\.catch[\s\S]*removeChildView\(g\.view\)/);
  assert.match(main, /cfgView = new WebContentsView[\s\S]*cfgView\.setVisible\(false\)[\s\S]*xpView = new WebContentsView[\s\S]*xpView\.setVisible\(false\)/);
  assert.match(main, /disable-background-timer-throttling/);
  assert.match(main, /disable-renderer-backgrounding/);
  assert.match(main, /disable-backgrounding-occluded-windows/);
});

test('launcher força nova composição da interface após restaurar ou receber foco', () => {
  assert.match(main, /function layout\(forceBounds = false\)/);
  assert.match(main, /function repaintLauncherViews\(\)[\s\S]*layout\(true\)[\s\S]*webContents\.invalidate\(\)/);
  assert.match(main, /function launcherViewIsVisible\(view\)[\s\S]*game\._shown[\s\S]*screen\._shown/);
  assert.match(main, /function recomposeLauncherViews\(\)[\s\S]*launcherViewIsVisible\(view\)[\s\S]*setVisible\(false\)[\s\S]*removeChildView\(view\)[\s\S]*addChildView\(view\)[\s\S]*repaintLauncherViews\(\)/);
  assert.match(main, /function scheduleLauncherRepaint\(recompose = false\)[\s\S]*setTimeout\([\s\S]*160\)/);
  assert.match(main, /function scheduleLauncherRepaint\(recompose = false\)[\s\S]*setTimeout\([\s\S]*500\)/);
  assert.match(main, /win\.on\('focus', \(\) => scheduleLauncherRepaint\(true\)\)/);
  assert.match(main, /win\.on\('show', \(\) => scheduleLauncherRepaint\(true\)\)/);
  assert.match(main, /win\.on\('maximize', \(\) => scheduleLauncherRepaint\(true\)\)/);
  assert.match(main, /win\.on\('unmaximize', \(\) => scheduleLauncherRepaint\(true\)\)/);
  assert.match(main, /win\.on\('restore',[\s\S]*scheduleLauncherRepaint\(true\)/);
  assert.match(main, /appendSwitch\('disable-features', 'CalculateNativeWinOcclusion'\)/);
});
