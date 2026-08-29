'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildDiscordPayload,
  collectRareDrops,
  eventEnabled,
  isDiscordWebhookUrl,
  isMythicPokemon,
  normalizeDiscordNotifications,
  normalizeDiscordUserId,
  webhookForEvent,
} = require('../discord-notifications');

const WEBHOOK = 'https://discord.com/api/webhooks/1234567890/valid_token-ABC.def';
const CRITICAL_WEBHOOK = 'https://discord.com/api/webhooks/9876543210/critical_token-XYZ';
const DISCORD_USER_ID = '123456789012345678';

test('aceita somente endpoints oficiais de webhook do Discord', () => {
  assert.equal(isDiscordWebhookUrl(WEBHOOK), true);
  assert.equal(isDiscordWebhookUrl('http://discord.com/api/webhooks/1/token'), false);
  assert.equal(isDiscordWebhookUrl('https://example.com/api/webhooks/1/token'), false);
  assert.equal(isDiscordWebhookUrl('https://discord.com/channels/1/2'), false);
});

test('preferências nascem ligadas e preservam o webhook local ao alterar os toggles', () => {
  const initial = normalizeDiscordNotifications({ webhookUrl:WEBHOOK });
  assert.equal(initial.enabled, true);
  assert.equal(initial.rareDrops, true);
  assert.equal(initial.mythicCaptures, true);
  assert.equal(initial.criticalAlertsEnabled, false);
  const changed = normalizeDiscordNotifications({ shinyCaptures:false, partyDeaths:false }, initial.webhookUrl);
  assert.equal(changed.webhookUrl, WEBHOOK);
  assert.equal(changed.shinyCaptures, false);
  assert.equal(changed.partyDeaths, false);
});

test('alertas pessoais usam outro webhook e exigem um ID numérico do Discord', () => {
  const settings = normalizeDiscordNotifications({
    webhookUrl:WEBHOOK,
    criticalWebhookUrl:CRITICAL_WEBHOOK,
    criticalAlertsEnabled:true,
    discordUserId:`<@${DISCORD_USER_ID}>`,
  });
  assert.equal(settings.discordUserId, DISCORD_USER_ID);
  assert.equal(webhookForEvent({ kind:'rare_drop' }, settings), WEBHOOK);
  assert.equal(webhookForEvent({ kind:'party_death' }, settings), CRITICAL_WEBHOOK);
  assert.equal(eventEnabled({ kind:'party_death' }, settings), true);
  assert.equal(eventEnabled({ kind:'repeated_stall' }, Object.assign({}, settings, { discordUserId:'' })), false);
  assert.equal(eventEnabled({ kind:'party_death' }, Object.assign({}, settings, { criticalAlertsEnabled:false })), false);
  assert.equal(normalizeDiscordUserId('marcos3777'), '');
  assert.equal(normalizeDiscordNotifications({ criticalAlertsEnabled:true, discordUserId:'marcos3777' }).criticalAlertsEnabled, false);
});

test('detecta item raro e associa o Pokémon morto na mesma posição', () => {
  const drops = collectRareDrops([
    { t:'kill', x:12, y:8, species:'Nidorina' },
    { t:'loot', x:12, y:8, items:[{ id:'green_queen_ear', count:2 }, { id:'bottle_of_poison', count:5 }] },
  ]);
  assert.deepEqual(drops, [{
    kind:'rare_drop', itemId:'green_queen_ear', itemName:'Green Queen Ear', count:2, species:'Nidorina',
  }]);
});

test('captura shiny e Mythic vira um único embed com tier, potência e personagem', () => {
  const settings = normalizeDiscordNotifications({ webhookUrl:WEBHOOK });
  const pokemon = { species:'Grimer', shiny:true, essence:'Mythic', potential:91, level:17, caughtBall:'ultra_ball' };
  assert.equal(isMythicPokemon(pokemon), true);
  const payload = buildDiscordPayload({ kind:'pokemon_capture', characterName:'Treinador', pokemon, at:1000 }, settings);
  assert.match(payload.embeds[0].title, /Shiny \+ Mythic/);
  assert.match(payload.embeds[0].description, /Treinador/);
  assert.deepEqual(payload.embeds[0].fields.map((field) => field.name), ['Nível', 'Potência', 'Tier', 'Capturado com']);
});

test('respeita controles independentes de shiny e Mythic', () => {
  const settings = normalizeDiscordNotifications({ webhookUrl:WEBHOOK, shinyCaptures:false, mythicCaptures:true });
  const shinyOnly = buildDiscordPayload({ kind:'pokemon_capture', pokemon:{ species:'Gastly', shiny:true } }, settings);
  const mythic = buildDiscordPayload({ kind:'pokemon_capture', pokemon:{ species:'Grimer', shiny:true, essence:'Mythic' } }, settings);
  assert.equal(shinyOnly, null);
  assert.match(mythic.embeds[0].title, /Mythic/);
  assert.doesNotMatch(mythic.embeds[0].title, /Shiny/);
});

test('mensagem de morte e travamento repetido inclui contexto útil', () => {
  const settings = normalizeDiscordNotifications({ webhookUrl:WEBHOOK, discordUserId:DISCORD_USER_ID });
  const death = buildDiscordPayload({ kind:'party_death', characterName:'Misty', pokemon:{ species:'Starmie', level:50, potential:88 } }, settings);
  const stall = buildDiscordPayload({ kind:'repeated_stall', characterName:'Brock', attempts:2, timeoutSeconds:30 }, settings);
  assert.match(death.embeds[0].description, /Starmie.*Misty/);
  assert.equal(death.content, `<@${DISCORD_USER_ID}>`);
  assert.deepEqual(death.allowed_mentions, { parse:[], users:[DISCORD_USER_ID] });
  assert.match(stall.embeds[0].description, /2ª vez/);
  assert.equal(stall.embeds[0].fields[0].value, '30 segundos');
});

test('launcher usa destino fixo e esconde o teste fora da instalação autorizada', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const config = fs.readFileSync(path.join(root, 'config.html'), 'utf8');
  assert.match(main, /createDiscordRelayNotifier/);
  assert.doesNotMatch(main, /discord\.com\/api\/webhooks/);
  assert.match(main, /if \(!allowDiscordTest\) return/);
  assert.match(config, /id="notifications-test" style="display:none"/);
  assert.match(config, /id="notifications-discord-user"/);
  assert.match(config, /id="notifications-critical-enabled"/);
  assert.doesNotMatch(config, /id="notifications-webhook"|id="notifications-clear"|id="notifications-save"/);
});
