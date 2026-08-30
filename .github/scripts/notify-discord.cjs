function webhookUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('DISCORD_RELEASE_WEBHOOK ausente ou inválido.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'discord.com' || url.port
    || url.username || url.password || !/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(url.pathname)) {
    throw new Error('DISCORD_RELEASE_WEBHOOK deve ser um webhook HTTPS do Discord.');
  }
  url.searchParams.set('wait', 'true');
  return url;
}

function announcement(release) {
  if (release.draft || release.prerelease) throw new Error('O aviso exige uma versão estável publicada.');
  const installer = release.assets?.find(asset => asset.name === 'Poke-Dream-Launcher-Windows-x64.exe');
  if (!installer || !release.assets.some(asset => asset.name === 'latest.yml')
    || !release.assets.some(asset => asset.name === 'Poke-Dream-Launcher-Windows-x64.exe.blockmap')) {
    throw new Error('A versão ainda não contém todos os arquivos da atualização Windows.');
  }
  const body = (release.body || '').trim();
  if (!body || body.length > 3500) throw new Error('A descrição publicada deve ter entre 1 e 3.500 caracteres.');
  return {
    username: 'Poke Dream Launcher',
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `Nova atualização — ${release.tag_name}`,
      url: release.html_url,
      color: 0x36b37e,
      description: body,
      fields: [{ name: 'Baixar atualização', value: `[Baixar para Windows](${installer.browser_download_url})` }],
      footer: { text: 'Poke Dream Launcher • Novidades para os jogadores' },
    }],
  };
}

async function notify({ github, context, core, env = process.env, fetchImpl = fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const url = webhookUrl(env.DISCORD_RELEASE_WEBHOOK);
  const { data: release } = await github.rest.repos.getReleaseByTag({ ...context.repo, tag: env.RELEASE_TAG });
  const payload = announcement(release);
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      // Nunca registrar erros de rede que possam incluir o endereço secreto.
      throw new Error('Falha de conexão com o Discord. Confira o canal antes de repetir o aviso, pois a entrega pode ter ocorrido.');
    }
    if (response.ok) {
      core.info('Aviso da atualização enviado ao Discord.');
      return;
    }
    if (response.status === 429 && attempt < 2) {
      const data = await response.json().catch(() => ({}));
      const delay = Number(data.retry_after ?? response.headers?.get('retry-after'));
      if (Number.isFinite(delay) && delay > 0 && delay <= 30) {
        await sleep(Math.ceil(delay * 1000));
        continue;
      }
    }
    throw new Error(`O Discord recusou o aviso (HTTP ${response.status}). O instalador continua publicado; corrija o problema e reexecute apenas os jobs com falha.`);
  }
}

module.exports = { notify, announcement, webhookUrl };
