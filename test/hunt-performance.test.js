'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { HUNT_PERFORMANCE_V, XP_RUNE_RATES, activeXpBuffs, backfillTrainerNameForAccount, communityPerformanceRecords, createPerformanceBaseline, markCommunityPerformanceRecordsSynced, normalizeHuntPerformance, performanceDelta, updatePerformanceRecords, xpRuneBonusRate } = require('../hunt-performance');

const ACCOUNT_ID = 'a'.repeat(64);

function sample(overrides) {
  return Object.assign({
    xpPerHour: 120000,
    mobsPerHour: 720,
    kills: 120,
    ms: 600000,
    xpGained: 20000,
    xpElapsedMs: 600000,
    savedAt: 1000,
    trainerName: 'Treinador A',
    pokemon: { species:'Abra', level:39, shiny:false },
    xpBuffs: { vip:0.2, xpPotion:0.5, task:0.02 },
    accountId: ACCOUNT_ID,
  }, overrides || {});
}

test('salva máximos independentes com o contexto do Pokémon ativo', () => {
  const store = { v:HUNT_PERFORMANCE_V, data:{} };
  assert.deepEqual(updatePerformanceRecords(store, 'Grimer', sample()).metrics, ['xpPerHour','mobsPerHour']);
  assert.equal(store.data.Grimer.xpPerHour.pokemon.species, 'Abra');
  assert.equal(store.data.Grimer.xpPerHour.trainerName, 'Treinador A');
  assert.deepEqual(store.data.Grimer.xpPerHour.xpBuffs, { vip:0.2, xpPotion:0.5, task:0.02 });
  assert.equal(store.data.Grimer.mobsPerHour.mobsPerHour, 720);

  const result = updatePerformanceRecords(store, 'Grimer', sample({ xpPerHour:130000, mobsPerHour:700, kills:140, pokemon:{ species:'Golem', level:42 } }));
  assert.deepEqual(result.metrics, ['xpPerHour','mobsPerHour']);
  assert.equal(store.data.Grimer.xpPerHour.pokemon.species, 'Golem');
  assert.equal(store.data.Grimer.mobsPerHour.pokemon.species, 'Abra');
  assert.equal(store.data.Grimer.kills, undefined);
  assert.equal(store.accounts[ACCOUNT_ID].Grimer['Abra:0'].mobsPerHour.mobsPerHour, 720);
  assert.equal(store.accounts[ACCOUNT_ID].Grimer['Golem:0'].xpPerHour.xpPerHour, 130000);
});

test('ignora amostras menores e normaliza somente registros seguros', () => {
  const store = { v:HUNT_PERFORMANCE_V, data:{} };
  updatePerformanceRecords(store, 'Gastly', sample());
  assert.equal(updatePerformanceRecords(store, 'Gastly', sample({ xpPerHour:100000, mobsPerHour:600, kills:100 })).changed, false);
  const normalized = normalizeHuntPerformance(store);
  assert.equal(normalized.data.Gastly.xpPerHour.xpPerHour, 120000);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.data.Gastly.xpPerHour, 'accountName'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.data.Gastly.xpPerHour, 'slot'), false);
  assert.equal(normalizeHuntPerformance({ v:1, data:{ '../bad':sample() } }).data['../bad'], undefined);
});

test('migra v1 sem Mais abates e só envia amostras novas verificáveis', () => {
  const legacy = normalizeHuntPerformance({ v:1, data:{ Grimer:{
    xpPerHour:sample({ xpGained:undefined, xpElapsedMs:undefined }),
    kills:sample({ kills:999 }),
  } } });
  assert.equal(legacy.v, HUNT_PERFORMANCE_V);
  assert.equal(legacy.data.Grimer.kills, undefined);
  assert.deepEqual(communityPerformanceRecords(legacy), []);

  const store = { v:HUNT_PERFORMANCE_V, data:{}, accounts:{} };
  updatePerformanceRecords(store, 'Grimer', sample());
  const records = communityPerformanceRecords(store);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((record) => record.metric).sort(), ['mobs_per_hour','xp_per_hour']);
  assert.equal(records[0].account_id, ACCOUNT_ID);
  assert.equal(records[0].trainer_name, 'Treinador A');
  assert.equal(records[0].completed_task_types, 2);
  assert.equal(records[0].rune_bonus_percent, 0);
});

test('preenche e reenvia recordes antigos uma única vez por conta', () => {
  const store = { v:HUNT_PERFORMANCE_V, data:{}, accounts:{}, trainerNameSync:{} };
  updatePerformanceRecords(store, 'Grimer', sample());
  for (const record of Object.values(store.data.Grimer)) record.trainerName = null;
  for (const record of Object.values(store.accounts[ACCOUNT_ID].Grimer['Abra:0'])) {
    record.trainerName = null;
    record.communityPending = false;
  }

  const prepared = backfillTrainerNameForAccount(store, ACCOUNT_ID, 'Treinador Antigo', 2000);
  assert.deepEqual(prepared, { changed:true, pending:true, records:2 });
  assert.equal(store.data.Grimer.xpPerHour.trainerName, 'Treinador Antigo');
  const submitted = communityPerformanceRecords(store);
  assert.equal(submitted.length, 2);
  assert.equal(markCommunityPerformanceRecordsSynced(store, submitted, 3000), true);
  assert.deepEqual(communityPerformanceRecords(store), []);
  assert.equal(store.trainerNameSync[ACCOUNT_ID].completedAt, 3000);

  assert.deepEqual(backfillTrainerNameForAccount(store, ACCOUNT_ID, 'Outro Nome', 4000), {
    changed:false, pending:false, records:0,
  });
  assert.equal(store.accounts[ACCOUNT_ID].Grimer['Abra:0'].xpPerHour.trainerName, 'Treinador Antigo');
});

test('normal e shiny do mesmo Pokémon ficam como candidatos diferentes por conta', () => {
  const store = { v:HUNT_PERFORMANCE_V, data:{}, accounts:{} };
  updatePerformanceRecords(store, 'Grimer', sample({ pokemon:{ species:'Gengar', level:50, shiny:false } }));
  updatePerformanceRecords(store, 'Grimer', sample({ xpPerHour:130000, mobsPerHour:730, pokemon:{ species:'Gengar', level:50, shiny:true } }));
  assert.ok(store.accounts[ACCOUNT_ID].Grimer['Gengar:0']);
  assert.ok(store.accounts[ACCOUNT_ID].Grimer['Gengar:1']);
});

test('detecta VIP, poção e uma porcentagem por trilha de task concluída', () => {
  assert.deepEqual(activeXpBuffs({ premiumActive:true, premiumUntilMs:2000, xpBoostEndsAtMs:3000, completedTaskTypes:2 }, 1000), { vip:0.2, xpPotion:0.5, task:0.02 });
  assert.deepEqual(activeXpBuffs({ premiumActive:true, premiumUntilMs:900, xpBoostEndsAtMs:3000 }, 1000), { xpPotion:0.5 });
  assert.deepEqual(activeXpBuffs({ premiumActive:false, xpBoostEndsAtMs:900 }, 1000), {});
  assert.deepEqual(activeXpBuffs({ completedTaskTypes:1, runeBonusRate:0.12 }, 1000), { task:0.01, rune:0.12 });
});

test('detecta a runa de XP atribuída à espécie com bônus por estágio', () => {
  assert.deepEqual(XP_RUNE_RATES, { 1:0.02, 2:0.04, 3:0.08 });
  assert.equal(xpRuneBonusRate('Haunter', { Haunter:'xp' }, { xp:1 }), 0.02);
  assert.equal(xpRuneBonusRate('haunter', { Haunter:'xp' }, { xp:2 }), 0.04);
  assert.equal(xpRuneBonusRate('Haunter', { Haunter:'xp' }, { xp:3 }), 0.08);
  assert.equal(xpRuneBonusRate('Gastly', { Haunter:'xp' }, { xp:3 }), 0);
  assert.equal(xpRuneBonusRate('Haunter', { Haunter:'catch' }, { xp:3 }), 0);
});

test('salva e envia a porcentagem da runa junto ao novo recorde', () => {
  const store = { v:HUNT_PERFORMANCE_V, data:{}, accounts:{} };
  updatePerformanceRecords(store, 'Haunter', sample({ xpBuffs:{ rune:0.08 } }));
  assert.deepEqual(store.data.Haunter.xpPerHour.xpBuffs, { rune:0.08 });
  assert.ok(communityPerformanceRecords(store).every((record) => record.rune_bonus_percent === 8));
});

test('trocar o Pokémon cria um baseline novo sem misturar os nove minutos anteriores', () => {
  const beforeSwitch = createPerformanceBaseline({ xp:1000, kills:20 }, 0);
  assert.deepEqual(performanceDelta(beforeSwitch, { xp:5500, kills:110 }, 9 * 60 * 1000), {
    ms:9 * 60 * 1000, xpGained:4500, kills:90,
  });
  const afterSwitch = createPerformanceBaseline({ xp:5500, kills:110 }, 9 * 60 * 1000);
  assert.deepEqual(performanceDelta(afterSwitch, { xp:8500, kills:160 }, 19 * 60 * 1000), {
    ms:10 * 60 * 1000, xpGained:3000, kills:50,
  });
});
