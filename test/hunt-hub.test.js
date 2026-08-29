'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const HuntMetrics = require('../hunt-metrics');

const html = fs.readFileSync(path.join(__dirname, '..', 'app.html'), 'utf8');
const start = html.indexOf('  function numVal(v)');
const end = html.indexOf('  function openHuntLog(sp)', start);
assert.ok(start >= 0 && end > start, 'bloco do hub não encontrado em app.html');

const renderers = new Function(
  'window', 'fmtInt', 'fmtDur', 'sprStatic', 'esc', 'sprItem',
  `${html.slice(start, end)}; return { capture:huntHubHTML, records:huntPerformanceHTML, adjust:updatePerformanceBuffValue };`,
)(
  { HuntMetrics },
  (value) => value == null ? '—' : Number(value).toLocaleString('pt-BR'),
  (ms) => `${Math.floor(Number(ms || 0) / 60000)}m`,
  (name, shiny) => `/pokemon/${shiny ? 'shiny/' : ''}${name}.png`,
  (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]),
  (name) => `/items/${name}.png`,
);
const renderHub = renderers.capture;

function community(overrides = {}) {
  return {
    contributors: 1,
    kills: 10000,
    caught: 1500,
    shinies: 20,
    shiny_caught: 4,
    broke_avg: 6.5,
    broke_max: 12,
    broke_min: 2,
    thrown_a: 2000,
    thrown_b: 8000,
    caught_a: 200,
    caught_b: 1300,
    ms: 3600000,
    catch_pct: 15,
    catch_pct_a: 10,
    catch_pct_b: 16.25,
    kills_per_shiny: 500,
    ...overrides,
  };
}

test('hub usa somente o histórico observado pelo launcher', () => {
  const output = renderHub('Abra', {
    ms: 3600000,
    kills: 800,
    caught: 10,
    shinies: 12,
    shinyCaught: 3,
    broke: { brokeAvg: 7, brokeMax: 15, brokeMin: 3, streak: 4, rows: [{ name: 'Conta', brokeAvg: 7, brokeMax: 15, brokeMin: 3, streak: 4 }] },
    thrownA: 100,
    thrownB: 700,
    caughtA: 2,
    caughtB: 8,
    sequences: {
      capture: { current:317, record:412, currentName:'Conta', recordName:'Conta' },
      shiny: { current:23, record:96, currentName:'Conta', recordName:'Conta' },
    },
    bestiary: { kills: 46000, caught: 0, shinyKills: 9999 },
    community: community(),
  }, false);
  assert.match(output, /encontros vistos/);
  assert.match(output, /hl-story-hero hl-shiny/);         // shiny conduz a narrativa
  assert.match(output, /Você capturou <b>3 shinies/);
  assert.match(output, /1 <span>em<\/span> 4/);          // 12 aparições shiny / 3 capturas shiny
  assert.match(output, /Broke/);
  assert.match(output, /Médio/);
  assert.match(output, /class="hl-i"/);                   // explicação virou tooltip
  assert.match(output, /1 a cada 67 encontros/);          // 800 encontros / 12 shinies
  assert.match(output, /1 a cada 80 tentativas/);         // 800 encontros / 10 capturas
  assert.match(output, /<span class="value">1\/80<\/span>/);
  assert.match(output, /<span class="value">1\/67<\/span>/);
  assert.match(output, /77% do seu recorde de 412/);
  assert.match(output, /24% do seu recorde de 96/);
  assert.match(output, /verde = você/);
  assert.doesNotMatch(output, /hl-story-delta/);
  assert.doesNotMatch(output, /derrotado/i);              // unidade antiga não volta
  assert.doesNotMatch(output, /Bolas por hora|Bolas por captura|Bolas por derrotado/);   // linhas duplicadas
  assert.doesNotMatch(output, /class="hl-ball/);          // taxas por bola ficam na comparação única
  assert.match(output, /No começo, a amostra pode vir somente de uma conta/);
  assert.doesNotMatch(output, /Histórico do jogo|46\.000|9\.999|bestiário/i);
});

test('hub mantém evento comunitário fracionário visível após ponderação', () => {
  const output = renderHub('MrMime', { community: community({
    caught: 0.2,
    caught_a: 0.1,
    shinies: 0.1,
    thrown_a: 51.5,
    catch_pct_a: null,
  }) }, false);
  assert.match(output, /<span class="value">1\/515<\/span>/);
  assert.match(output, /<span class="value">1\/100\.000<\/span>/);
});

test('hub não transforma ausência de denominador em taxa zero', () => {
  const output = renderHub('MrMime', { kills: 100, caught: 0, thrownA: 100 }, false);
  assert.match(output, /nenhum em 100 tentativas/);   // sem captura ainda: diz isso, não "1 a cada 0"
  assert.doesNotMatch(output, /1 a cada 0 /);
});

test('hub omite ritmo por hora em amostra curta e preserva raridades extremas como razão', () => {
  const output = renderHub('MrMime', {
    ms: 60000,
    kills: 10,
    community: community({ kills: 1000000, shinies: 0.0001, ms: 60000 }),
  }, false);
  assert.match(output, /ritmo: amostra curta/);
  assert.match(output, /1\/10\.000\.000\.000/);
});

test('hub mantém taxa comunitária rara como razão legível', () => {
  const output = renderHub('MrMime', { community: community({ caught_a: 0.01, thrown_a: 100, catch_pct_a: null }) }, false);
  assert.match(output, /1\/10\.000/);
});

test('amostra comunitária não se apresenta como histórico pessoal', () => {
  const output = renderHub('MrMime', { community: community() }, false);
  assert.match(output, /<b>—<\/b><span>encontros vistos<\/span>/);
  assert.match(output, /destaque usa a amostra da comunidade/);
  assert.match(output, /Na comunidade/);
  assert.match(output, /Retrato da comunidade/);
  assert.match(output, /<span class="value">1\/6,7<\/span>/);
});

test('sequência acima do máximo aparece como novo recorde antes de reiniciar', () => {
  const output = renderHub('Vulpix', {
    kills:500, caught:5,
    sequences: {
      capture:{ current:420, record:412, currentName:'Ash' },
      shiny:{ current:96, record:96, currentName:'Ash' },
    },
  }, false);
  assert.match(output, /class="hl-now record"/);
  assert.match(output, /Novo recorde · 8 acima do anterior de 412/);
  assert.match(output, /100% · recorde de 96 igualado/);
  assert.match(output, /Reinicia ao capturar/);
});

test('falha comunitária sem histórico local é explicada no estado vazio', () => {
  const output = renderHub('MrMime', { communityError: true }, false);
  assert.match(output, /amostra da comunidade não pôde ser consultada/);
});

test('falha comunitária não apaga o histórico local', () => {
  const output = renderHub('MrMime', { kills: 500, caught: 5, shinies: 2, communityError: true }, false);
  assert.match(output, /500<\/b><span>encontros vistos/);
  assert.match(output, /A amostra não pôde ser consultada agora/);
});

test('hunt mista explica por que não há atribuição por espécie', () => {
  const output = renderHub('MrMime', { mixedNow: 1 }, false);
  assert.match(output, /hunt mista/);
  assert.match(output, /não atribui os totais globais/);
});

test('aba de recordes mostra máximos independentes com Pokémon, nível e sprites', () => {
  const output = renderers.records('Abra', { records: {
    xpPerHour: { xpPerHour: 123456, mobsPerHour: 321, kills: 80, ms: 600000, savedAt: 1787500000000, trainerName:'Marcos', pokemon: { species:'Alakazam', level:42, shiny:true }, xpBuffs:{ vip:0.2, xpPotion:0.5, task:0.02 } },
    mobsPerHour: { xpPerHour: 100000, mobsPerHour: 456, kills: 90, ms: 900000, savedAt: 1787500300000, trainerName:'Misty', pokemon: { species:'Gengar', level:37, shiny:false } },
    kills: { xpPerHour: 110000, mobsPerHour: 400, kills: 999, ms: 7200000, savedAt: 1787500600000, pokemon: { species:'Dragonite', level:55, shiny:false } },
  }, community: {
    xpPerHour:[{ score:180000, trainerName:'Brock', pokemon:{ species:'Gengar', level:50, shiny:true }, xpBuffs:{ vip:0.2 } }],
    mobsPerHour:[{ score:500, trainerName:'Gary', pokemon:{ species:'Machamp', level:48, shiny:false }, xpBuffs:{} }],
  } }, false, false);
  assert.match(output, /Recordes da hunt/);
  assert.match(output, /Melhor XP\/h/);
  assert.match(output, /Melhor mobs\/h/);
  assert.doesNotMatch(output, /Mais abates/);
  assert.match(output, /Alakazam/);
  assert.match(output, /Nível 42/);
  assert.match(output, /\/pokemon\/shiny\/Alakazam\.png/);
  assert.match(output, /10 minutos/);
  assert.match(output, /cada 5 minutos/);
  assert.match(output, /data-hp-buff="vip"[^>]*>VIP \+20%/);
  assert.match(output, /data-hp-buff="xpPotion"[^>]*>Poção \+50%/);
  assert.match(output, /data-hp-buff="task"[^>]*>Task \+2%/);
  assert.match(output, /data-hp-raw-xp="123456"/);
  assert.match(output, /Top 3 · XP\/h/);
  assert.match(output, /Top 3 · mobs\/h/);
  assert.match(output, /nome do treinador no ranking/);
  assert.match(output, /Marcos/);
  assert.match(output, /Brock/);
  assert.match(output, /Gengar/);
  assert.match(output, /VIP \+20%/);
  assert.equal((output.match(/data-hp-buff="xpPotion"/g) || []).length, 1);
  assert.doesNotMatch(output, /Tela 2/);
});

test('recorde de XP pode remover VIP e poção sem alterar o valor bruto salvo', () => {
  const outputNodes = [{ textContent:'' }, { textContent:'' }];
  const buffs = {
    dataset:{ hpRawXp:'1080' },
    querySelectorAll:() => [
      { dataset:{ hpBuffRate:'0.2' } },
      { dataset:{ hpBuffRate:'0.5' } },
    ],
  };
  const card = {
    querySelector:(selector) => selector === '.hp-buffs' ? buffs : null,
    querySelectorAll:() => outputNodes,
  };
  renderers.adjust({ closest:() => card });
  assert.deepEqual(outputNodes.map((node) => node.textContent), ['600', '600']);
  assert.equal(buffs.dataset.hpRawXp, '1080');
});
