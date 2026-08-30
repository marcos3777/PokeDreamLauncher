const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readReleaseNotes } = require('./release-notes.cjs');
const { notify, announcement, webhookUrl } = require('./notify-discord.cjs');

const release = {
  tag_name: 'v1.2.3', draft: false, prerelease: false,
  html_url: 'https://github.com/example/launcher/releases/tag/v1.2.3',
  body: '## O que mudou\n\n- Agora sua escolha fica salva.\n- Correção de texto com "aspas" e @everyone.',
  assets: ['Poke-Dream-Launcher-Windows-x64.exe', 'Poke-Dream-Launcher-Windows-x64.exe.blockmap', 'latest.yml']
    .map(name => ({ name, browser_download_url: `https://github.com/example/launcher/releases/download/v1.2.3/${name}` })),
};
const fakeWebhook = 'https://discord.com/api/webhooks/123/test_token';
function options(fetchImpl) {
  return {
    github: { rest: { repos: { getReleaseByTag: async args => {
      assert.deepEqual(args, { owner: 'example', repo: 'launcher', tag: 'v1.2.3' });
      return { data: release };
    } } } },
    context: { repo: { owner: 'example', repo: 'launcher' } },
    core: { info: () => {} }, env: { DISCORD_RELEASE_WEBHOOK: fakeWebhook, RELEASE_TAG: 'v1.2.3' }, fetchImpl,
  };
}

test('publicação exige notas revisadas da versão exata', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-notes-'));
  t.after(() => {
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
    assert.match(path.basename(root), /^launcher-notes-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, 'release-notes'));
  assert.throws(() => readReleaseNotes(root, '1.2.3'), /Falta/);
  assert.throws(() => readReleaseNotes(root, '../1'), /inválida/);
  const file = path.join(root, 'release-notes', 'v1.2.3.md');
  for (const text of ['', '## O que mudou', '- TODO escrever', '- ' + 'x'.repeat(3500)]) {
    fs.writeFileSync(file, text);
    assert.throws(() => readReleaseNotes(root, '1.2.3'));
  }
  fs.writeFileSync(file, release.body);
  assert.equal(readReleaseNotes(root, '1.2.3').body, release.body);
  fs.writeFileSync(file, '- Agora você pode consultar todo o histórico.');
  assert.match(readReleaseNotes(root, '1.2.3').body, /todo o histórico/);
  assert.throws(() => readReleaseNotes(root, '1.2.4'), /Falta/);
});

test('aviso preserva português, texto e download sem permitir menções', () => {
  const payload = JSON.parse(JSON.stringify(announcement(release)));
  assert.equal(payload.embeds[0].description, release.body);
  assert.match(payload.embeds[0].fields[0].value, /\/v1\.2\.3\/Poke-Dream-Launcher-Windows-x64\.exe/);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.throws(() => announcement({ ...release, draft: true }), /publicada/);
  assert.throws(() => announcement({ ...release, prerelease: true }), /publicada/);
  assert.throws(() => announcement({ ...release, assets: release.assets.slice(0, 1) }), /arquivos/);
  assert.throws(() => announcement({ ...release, body: '' }), /descrição/);
  assert.throws(() => announcement({ ...release, body: 'x'.repeat(3501) }), /descrição/);
});

test('endereço precisa ser do Discord e a entrega pede confirmação', () => {
  assert.equal(webhookUrl(fakeWebhook).searchParams.get('wait'), 'true');
  for (const url of ['', fakeWebhook.replace('https:', 'http:'), fakeWebhook.replace('discord.com', 'example.com')]) {
    assert.throws(() => webhookUrl(url), /DISCORD_RELEASE_WEBHOOK/);
  }
});

test('envia um único aviso com o conteúdo da versão publicada', async () => {
  let calls = 0;
  await notify(options(async (url, init) => {
    calls++;
    assert.equal(url.searchParams.get('wait'), 'true');
    assert.equal(init.redirect, 'error');
    assert.equal(JSON.parse(init.body).embeds[0].description, release.body);
    return { ok: true, status: 200 };
  }));
  assert.equal(calls, 1);
});

test('segredo ausente impede envio', async () => {
  const args = options(() => assert.fail('não deve enviar'));
  args.env = { RELEASE_TAG: 'v1.2.3' };
  await assert.rejects(notify(args), /ausente/);
});

test('aguarda limite temporário do Discord antes de tentar novamente', async () => {
  let calls = 0;
  const delays = [];
  const args = options(async () => ++calls === 1
    ? { ok: false, status: 429, json: async () => ({ retry_after: 0.5 }) }
    : { ok: true, status: 200 });
  args.sleep = async delay => delays.push(delay);
  await notify(args);
  assert.deepEqual(delays, [500]);
  assert.equal(calls, 2);
});

test('falhas não vazam o webhook nem repetem entrega incerta', async () => {
  let calls = 0;
  await assert.rejects(notify(options(async () => {
    calls++;
    throw new Error(`connection failed: ${fakeWebhook}`);
  })), error => !error.message.includes(fakeWebhook) && /entrega pode ter ocorrido/.test(error.message));
  assert.equal(calls, 1);
  await assert.rejects(notify(options(async () => ({ ok: false, status: 404 }))), /HTTP 404/);
});

test('limite persistente do Discord termina sem repetição ilimitada', async () => {
  let calls = 0;
  const args = options(async () => {
    calls++;
    return { ok: false, status: 429, json: async () => ({ retry_after: 1 }) };
  });
  args.sleep = async () => {};
  await assert.rejects(notify(args), /HTTP 429/);
  assert.equal(calls, 3);
});
