'use strict';

(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HuntMetrics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildApi() {
  function finiteNonNegative(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function percentage(numerator, denominator) {
    const num = finiteNonNegative(numerator);
    const den = finiteNonNegative(denominator);
    return num !== null && den !== null && den > 0 ? num / den * 100 : null;
  }

  function perEvent(total, events) {
    const all = finiteNonNegative(total);
    const count = finiteNonNegative(events);
    return all !== null && count !== null && count > 0 ? all / count : null;
  }

  function perHour(value, milliseconds) {
    const count = finiteNonNegative(value);
    const ms = finiteNonNegative(milliseconds);
    return count !== null && ms !== null && ms > 0 ? count * 3600000 / ms : null;
  }

  function huntSpeciesFromId(huntId) {
    if (typeof huntId !== 'string') return null;
    if (/^[A-Z][A-Za-z0-9]{0,31}$/.test(huntId)) return huntId;
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(huntId)) return null;
    const special = {
      farfetchd: 'Farfetchd', hooh: 'HoOh', mrmime: 'MrMime', mr_mime: 'MrMime',
      nidoranf: 'NidoranF', nidoranm: 'NidoranM', porygon2: 'Porygon2',
    };
    if (special[huntId]) return special[huntId];
    return huntId.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  }

  function huntBaseline(huntId, stats, now = Date.now()) {
    const source = stats && typeof stats === 'object' ? stats : {};
    const value = (key) => {
      if (source[key] == null) return null;
      const number = Number(source[key]);
      return Number.isFinite(number) && number >= 0 ? number : null;
    };
    return {
      huntId,
      ts: Number.isFinite(Number(now)) ? Number(now) : Date.now(),
      totalCaught: value('totalCaught'),
      kills: value('kills'),
      shinyKills: value('shinyKills'),
    };
  }

  function huntDelta(stats, baseline, now = Date.now()) {
    const source = stats && typeof stats === 'object' ? stats : {};
    const base = baseline && typeof baseline === 'object' ? baseline : null;
    if (!base) return null;
    const delta = (key) => {
      if (source[key] == null || base[key] == null) return 0;
      const current = Number(source[key]);
      const initial = Number(base[key]);
      return Number.isFinite(current) && Number.isFinite(initial) ? Math.max(current - initial, 0) : 0;
    };
    const currentTime = Number(now);
    const initialTime = Number(base.ts);
    return {
      kills: delta('kills'),
      caught: delta('totalCaught'),
      shinies: delta('shinyKills'),
      ms: Number.isFinite(currentTime) && Number.isFinite(initialTime) ? Math.max(currentTime - initialTime, 0) : 0,
    };
  }

  function describe(input) {
    const source = input && typeof input === 'object' ? input : {};
    const kills = finiteNonNegative(source.kills) || 0;
    const caught = finiteNonNegative(source.caught) || 0;
    const shinies = finiteNonNegative(source.shinies) || 0;
    const thrown = finiteNonNegative(source.thrown) || 0;
    const ms = finiteNonNegative(source.ms) || 0;
    return {
      kills, caught, shinies, thrown, ms,
      catchPct: percentage(caught, kills),
      shinyPct: percentage(shinies, kills),
      encountersPerCatch: perEvent(kills, caught),
      encountersPerShiny: perEvent(kills, shinies),
      ballsPerCatch: perEvent(thrown, caught),
      ballsPerEncounter: perEvent(thrown, kills),
      perHour: {
        kills: perHour(kills, ms),
        caught: perHour(caught, ms),
        shinies: perHour(shinies, ms),
        thrown: perHour(thrown, ms),
      },
    };
  }

  function accountEntry(entry, account) {
    const key = account && account.key ? String(account.key) : '';
    if (!key) return null;
    const accounts = entry.accounts && typeof entry.accounts === 'object' && !Array.isArray(entry.accounts)
      ? entry.accounts
      : (entry.accounts = {});
    const acc = accounts[key] || (accounts[key] = {
      name: '', seen: 0, caught: 0, streak: 0,
      brokeMax: null, brokeMin: null, brokeTotal: 0, brokeCount: 0,
      captureDryBalls: 0, captureDryBallsMax: null, dryKills: 0, dryKillsMax: null,
    });
    // Dados antigos não tinham soma/quantidade. Uma única captura com max=min pode ser
    // reconstruída com exatidão; com várias capturas, a média passa a contar daqui em diante.
    if (finiteNonNegative(acc.brokeTotal) === null || finiteNonNegative(acc.brokeCount) === null) {
      const caught = finiteNonNegative(acc.caught) || 0;
      const max = acc.brokeMax == null ? null : finiteNonNegative(acc.brokeMax);
      const min = acc.brokeMin == null ? null : finiteNonNegative(acc.brokeMin);
      if (caught === 1 && max !== null && max === min) {
        acc.brokeTotal = max;
        acc.brokeCount = 1;
      } else {
        acc.brokeTotal = 0;
        acc.brokeCount = 0;
      }
    }
    if (account.name) acc.name = String(account.name);
    return acc;
  }

  function recordCounters(target, values) {
    const { ms, kills, caught, shinies, shinyCaught, thrownA, thrownB, thrown } = values;
    target.ms = (finiteNonNegative(target.ms) || 0) + ms;
    target.kills = (finiteNonNegative(target.kills) || 0) + kills;
    target.caught = (finiteNonNegative(target.caught) || 0) + caught;
    target.shinies = (finiteNonNegative(target.shinies) || 0) + shinies;
    target.shinyCaught = (finiteNonNegative(target.shinyCaught) || 0) + shinyCaught;
    target.thrownA = (finiteNonNegative(target.thrownA) || 0) + thrownA;
    target.thrownB = (finiteNonNegative(target.thrownB) || 0) + thrownB;
    target.caughtA = finiteNonNegative(target.caughtA) || 0;
    target.caughtB = finiteNonNegative(target.caughtB) || 0;

    if (caught) target.pend = (finiteNonNegative(target.pend) || 0) + caught;
    if (target.pend && thrown) {
      const pending = target.pend;
      target.pend = 0;
      if (!thrownA) target.caughtB = (finiteNonNegative(target.caughtB) || 0) + pending;
      else if (!thrownB) target.caughtA = (finiteNonNegative(target.caughtA) || 0) + pending;
      else {
        const attributedA = pending * thrownA / thrown;
        target.caughtA = (finiteNonNegative(target.caughtA) || 0) + attributedA;
        target.caughtB = (finiteNonNegative(target.caughtB) || 0) + pending - attributedA;
      }
    }
  }

  // Broke = quantas aparições de shiny passaram até capturar um. É uma SEQUÊNCIA, então não
  // pode somar entre contas: cada personagem tem a sua. Por isso fica num mapa por conta.
  function recordAccountBroke(acc, shinies, shinyCaught) {
    if (!acc) return;
    acc.seen = (finiteNonNegative(acc.seen) || 0) + shinies;
    acc.streak = (finiteNonNegative(acc.streak) || 0) + shinies;
    if (!shinyCaught) return;
    // Uma amostra por janela: se dois shinies caírem no mesmo frame não dá pra saber a divisão,
    // então registra a sequência corrente uma vez e zera, em vez de inventar um zero.
    const sample = acc.streak;
    acc.caught = (finiteNonNegative(acc.caught) || 0) + shinyCaught;
    acc.streak = 0;
    if (sample > 0) {
      // atenção: finiteNonNegative(null) devolve 0, então o "sem amostra ainda" tem que ser
      // testado antes — senão o mínimo trava em zero pra sempre.
      const max = acc.brokeMax == null ? null : finiteNonNegative(acc.brokeMax);
      const min = acc.brokeMin == null ? null : finiteNonNegative(acc.brokeMin);
      acc.brokeMax = max === null ? sample : Math.max(max, sample);
      acc.brokeMin = min === null ? sample : Math.min(min, sample);
      acc.brokeTotal = (finiteNonNegative(acc.brokeTotal) || 0) + sample;
      acc.brokeCount = (finiteNonNegative(acc.brokeCount) || 0) + 1;
    }
  }

  function recordSequenceCounters(target, thrown, caught, kills, shinies) {
    if (!target || typeof target !== 'object') return;
    const captureCurrent = (finiteNonNegative(target.captureDryBalls) || 0) + thrown;
    if (caught) {
      const captureMax = target.captureDryBallsMax == null ? null : finiteNonNegative(target.captureDryBallsMax);
      if (captureCurrent > 0) target.captureDryBallsMax = captureMax === null ? captureCurrent : Math.max(captureMax, captureCurrent);
      target.captureDryBalls = 0;
    } else target.captureDryBalls = captureCurrent;

    const shinyCurrent = (finiteNonNegative(target.dryKills) || 0) + kills;
    if (shinies) {
      const shinyMax = target.dryKillsMax == null ? null : finiteNonNegative(target.dryKillsMax);
      if (shinyCurrent > 0) target.dryKillsMax = shinyMax === null ? shinyCurrent : Math.max(shinyMax, shinyCurrent);
      target.dryKills = 0;
    } else target.dryKills = shinyCurrent;
  }

  function recordObservation(entry, input) {
    if (!entry || typeof entry !== 'object') return false;
    const observation = input && typeof input === 'object' ? input : {};
    const ms = finiteNonNegative(observation.ms) || 0;
    const kills = finiteNonNegative(observation.kills) || 0;
    const caught = finiteNonNegative(observation.caught) || 0;
    const shinies = finiteNonNegative(observation.shinies) || 0;
    const thrownA = finiteNonNegative(observation.thrownA) || 0;
    const thrownB = finiteNonNegative(observation.thrownB) || 0;
    const shinyCaught = Math.min(caught, finiteNonNegative(observation.shinyCaught) || 0);
    const thrown = thrownA + thrownB;

    const values = { ms, kills, caught, shinies, shinyCaught, thrownA, thrownB, thrown };
    recordCounters(entry, values);

    recordSequenceCounters(entry, thrown, caught, kills, shinies);
    entry.dryBalls = (finiteNonNegative(entry.dryBalls) || 0) + thrown;
    if (shinies) entry.dryBalls = 0;

    const activity = !!(kills || caught || shinies || shinyCaught || thrown);
    if (ms || activity) {
      const account = accountEntry(entry, observation.account);
      if (account) {
        const stats = account.stats && typeof account.stats === 'object' && !Array.isArray(account.stats)
          ? account.stats
          : (account.stats = {});
        recordCounters(stats, values);
        recordSequenceCounters(account, thrown, caught, kills, shinies);
        if (shinies || shinyCaught) recordAccountBroke(account, shinies, shinyCaught);
      }
    }

    if (activity && Number.isFinite(Number(observation.now))) entry.updated = Number(observation.now);
    return !!(ms || activity);
  }

  // agrega o broke pra exibição: por conta + o pior/melhor entre elas (nunca somando sequências)
  function describeBroke(entry) {
    const accounts = entry && entry.accounts && typeof entry.accounts === 'object' ? entry.accounts : null;
    if (!accounts) return null;
    const rows = [];
    for (const key of Object.keys(accounts)) {
      const a = accounts[key] || {};
      const seen = finiteNonNegative(a.seen) || 0;
      const caught = finiteNonNegative(a.caught) || 0;
      if (!seen && !caught) continue;
      const streak = finiteNonNegative(a.streak) || 0;
      const closedMax = a.brokeMax == null ? null : finiteNonNegative(a.brokeMax);
      const brokeTotal = finiteNonNegative(a.brokeTotal) || 0;
      const brokeCount = finiteNonNegative(a.brokeCount) || 0;
      rows.push({
        key,
        name: a.name || '',
        seen, caught,
        streak,
        brokeMax: streak > 0 && closedMax !== null ? Math.max(streak, closedMax) : (streak > 0 ? streak : closedMax),
        brokeMin: a.brokeMin == null ? null : finiteNonNegative(a.brokeMin),
        brokeAvg: brokeCount > 0 ? brokeTotal / brokeCount : null,
        brokeTotal,
        brokeCount,
        catchPct: percentage(caught, seen),
      });
    }
    if (!rows.length) return null;
    rows.sort((x, y) => y.seen - x.seen);
    const maxes = rows.map((r) => r.brokeMax).filter((v) => v !== null);
    const mins = rows.map((r) => r.brokeMin).filter((v) => v !== null);
    const brokeTotal = rows.reduce((sum, row) => sum + row.brokeTotal, 0);
    const brokeCount = rows.reduce((sum, row) => sum + row.brokeCount, 0);
    return {
      rows,
      brokeAvg: brokeCount > 0 ? brokeTotal / brokeCount : null,
      brokeMax: maxes.length ? Math.max(...maxes) : null,
      brokeMin: mins.length ? Math.min(...mins) : null,
      streak: rows.length === 1 ? rows[0].streak : null,   // só faz sentido com uma conta
    };
  }

  function describeSequences(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const accounts = entry.accounts && typeof entry.accounts === 'object' && !Array.isArray(entry.accounts) ? entry.accounts : null;
    const rows = accounts ? Object.keys(accounts).map((key) => {
      const account = accounts[key] || {};
      const captureCurrent = finiteNonNegative(account.captureDryBalls) || 0;
      const captureRecord = account.captureDryBallsMax == null ? null : finiteNonNegative(account.captureDryBallsMax);
      const shinyCurrent = finiteNonNegative(account.dryKills) || 0;
      const shinyRecord = account.dryKillsMax == null ? null : finiteNonNegative(account.dryKillsMax);
      return { key, name:account.name || '', captureCurrent, captureRecord, shinyCurrent, shinyRecord };
    }).filter((row) => row.captureCurrent || row.captureRecord !== null || row.shinyCurrent || row.shinyRecord !== null) : [];

    function peak(currentKey, recordKey, fallbackCurrent, fallbackRecord) {
      if (!rows.length) return {
        current:finiteNonNegative(fallbackCurrent) || 0,
        record:fallbackRecord == null ? null : finiteNonNegative(fallbackRecord),
        currentName:'', recordName:'',
      };
      const currentRow = rows.reduce((best, row) => !best || row[currentKey] > best[currentKey] ? row : best, null);
      const recordRows = rows.filter((row) => row[recordKey] !== null);
      const recordRow = recordRows.reduce((best, row) => !best || row[recordKey] > best[recordKey] ? row : best, null);
      return {
        current:currentRow ? currentRow[currentKey] : 0,
        record:recordRow ? recordRow[recordKey] : null,
        currentName:currentRow ? currentRow.name : '',
        recordName:recordRow ? recordRow.name : '',
      };
    }

    return {
      capture:peak('captureCurrent', 'captureRecord', entry.captureDryBalls, entry.captureDryBallsMax),
      shiny:peak('shinyCurrent', 'shinyRecord', entry.dryKills, entry.dryKillsMax),
      rows,
    };
  }

  return { describe, describeBroke, describeSequences, huntBaseline, huntDelta, huntSpeciesFromId, perEvent, perHour, percentage, recordObservation };
});
