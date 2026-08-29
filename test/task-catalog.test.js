'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TASK_LEVEL_BY_SPECIES,
  TASK_TRACKS,
  applyTaskDelta,
  completedTaskTrackCount,
  taskMapFromState,
} = require('../task-catalog');

test('catálogo preserva trilhas, níveis e identificadores conhecidos', () => {
  assert.equal(Object.values(TASK_TRACKS).flatMap((track) => track.tasks).length, 230);
  assert.equal(TASK_LEVEL_BY_SPECIES.Bellsprout, 1);
  assert.equal(TASK_LEVEL_BY_SPECIES.Haunter, 50);
  assert.equal(TASK_LEVEL_BY_SPECIES.Exeggutor, 80);
  assert.equal(TASK_TRACKS.poison.tasks.find((entry) => entry.species === 'NidoranF').huntId, 'nidoran_female');
  assert.equal(TASK_TRACKS.fairy.tasks.find((entry) => entry.species === 'Mr. Mime').huntId, 'mrmime');
});

test('estado completo e deltas mantêm o progresso observado', () => {
  const tasks = taskMapFromState([{ id:'poison_venonat', p:999, c:0 }]);
  const result = applyTaskDelta(tasks, { u:[{ id:'poison_venonat', c:1, p:null }] });
  assert.equal(result.changed, true);
  assert.deepEqual(result.completions, [{ id:'poison_venonat', previousCompleted:0, completed:1 }]);
  assert.deepEqual(tasks.poison_venonat, { id:'poison_venonat', progress:null, completed:1 });
});

test('bônus conta somente trilhas de tipo inteiramente concluídas', () => {
  const states = {};
  for (const definition of TASK_TRACKS.water.tasks) states[definition.id] = { completed:1 };
  for (const definition of TASK_TRACKS.fire.tasks) states[definition.id] = { completed:1 };
  states[TASK_TRACKS.grass.tasks[0].id] = { completed:1 };
  assert.equal(completedTaskTrackCount(states), 2);
  delete states[TASK_TRACKS.water.tasks.at(-1).id];
  assert.equal(completedTaskTrackCount(states), 1);
});
