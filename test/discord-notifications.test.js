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
  normalizeDiscordUserId,
  normalizeDiscordNotifications,
  webhookForEvent,
} = require('../discord-notifications');

const WEBHOOK = 'https://discord.com/api/webhooks/1234567890/valid_token-ABC.def';
const CRITICAL_WEBHOOK = 'https://discord.com/api/webhooks/9876543210/critical_token-XYZ';

test('aceita somente endpoints oficiais de webhook do Discord', () => {
  assert.equal(isDiscordWebhookUrl(WEBHOOK), true);
  assert.equal(isDiscordWebhookUrl('http://discord.com/api/webhooks/1/token'), false);
  assert.equal(isDiscordWebhookUrl('https://example.com/api/webhooks/1/token'), false);
  assert.equal(isDiscordWebhookUrl('https://discord.com/channels/1/2'), false);
});

test('aceita somente IDs numéricos de usuário do Discord', () => {
  assert.equal(normalizeDiscordUserId(' 123456789012345678 '), '123456789012345678');
  assert.equal(normalizeDiscordUserId('123'), '');
  assert.equal(normalizeDiscordUserId('12345678901234567x'), '');
});

test('conquistas e drops ficam sempre ativos e alertas pessoais nascem desligados', () => {
  const initial = normalizeDiscordNotifications({ webhookUrl:WEBHOOK });
  assert.equal(initial.enabled, true);
  assert.equal(initial.rareDrops, true);
  assert.equal(initial.mythicCaptures, true);
  assert.equal(initial.shinyCaptures, true);
  assert.equal(initial.partyDeaths, false);
  assert.equal(initial.repeatedStalls, false);
  assert.equal(initial.taskCompletions, false);
  const changed = normalizeDiscordNotifications({ enabled:false, rareDrops:false, shinyCaptures:false }, initial.webhookUrl);
  assert.equal(changed.webhookUrl, WEBHOOK);
  assert.equal(changed.enabled, true);
  assert.equal(changed.rareDrops, true);
  assert.equal(changed.shinyCaptures, true);
});

test('alertas de morte, travamento e Tasks usam o webhook configurado pela pessoa', () => {
  const settings = normalizeDiscordNotifications({
    webhookUrl:WEBHOOK,
    criticalWebhookUrl:CRITICAL_WEBHOOK,
    partyDeaths:true,
    repeatedStalls:true,
    taskCompletions:true,
  });
  assert.equal(webhookForEvent({ kind:'rare_drop' }, settings), WEBHOOK);
  assert.equal(webhookForEvent({ kind:'party_death' }, settings), CRITICAL_WEBHOOK);
  assert.equal(webhookForEvent({ kind:'task_completed' }, settings), CRITICAL_WEBHOOK);
  assert.equal(eventEnabled({ kind:'party_death' }, settings), true);
  assert.equal(eventEnabled({ kind:'task_completed' }, settings), true);
  assert.equal(eventEnabled({ kind:'repeated_stall' }, Object.assign({}, settings, { criticalWebhookUrl:'' })), false);
  assert.equal(eventEnabled({ kind:'party_death' }, Object.assign({}, settings, { partyDeaths:false })), false);
  assert.equal(eventEnabled({ kind:'task_completed' }, Object.assign({}, settings, { taskCompletions:false })), false);
  const withoutWebhook = normalizeDiscordNotifications({ partyDeaths:true, repeatedStalls:true, taskCompletions:true });
  assert.equal(withoutWebhook.partyDeaths, false);
  assert.equal(withoutWebhook.repeatedStalls, false);
  assert.equal(withoutWebhook.taskCompletions, false);
});

test('migração do controle geral antigo mantém alertas pessoais desligados', () => {
  const migrated = normalizeDiscordNotifications({
    criticalWebhookUrl:CRITICAL_WEBHOOK,
    criticalAlertsEnabled:false,
    partyDeaths:true,
    repeatedStalls:true,
  });
  assert.equal(migrated.partyDeaths, false);
  assert.equal(migrated.repeatedStalls, false);
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

test('capturas shiny e Mythic continuam ativas mesmo com preferências antigas desligadas', () => {
  const settings = normalizeDiscordNotifications({ webhookUrl:WEBHOOK, shinyCaptures:false, mythicCaptures:false });
  const shinyOnly = buildDiscordPayload({ kind:'pokemon_capture', pokemon:{ species:'Gastly', shiny:true } }, settings);
  const mythic = buildDiscordPayload({ kind:'pokemon_capture', pokemon:{ species:'Grimer', shiny:true, essence:'Mythic' } }, settings);
  assert.match(shinyOnly.embeds[0].title, /Shiny/);
  assert.match(mythic.embeds[0].title, /Shiny \+ Mythic/);
});

test('alertas pessoais mencionam o usuário somente quando o ID foi configurado', () => {
  const settings = normalizeDiscordNotifications({ criticalWebhookUrl:CRITICAL_WEBHOOK });
  const death = buildDiscordPayload({ kind:'party_death', characterName:'Misty', pokemon:{ species:'Starmie', level:50, potential:88 } }, settings);
  const mentionedSettings = normalizeDiscordNotifications({ criticalWebhookUrl:CRITICAL_WEBHOOK, discordUserId:'123456789012345678' });
  const stall = buildDiscordPayload({ kind:'repeated_stall', characterName:'Brock', attempts:2, timeoutSeconds:30 }, mentionedSettings);
  assert.match(death.embeds[0].description, /Starmie.*Misty/);
  assert.equal(death.content, undefined);
  assert.deepEqual(death.allowed_mentions, { parse:[] });
  assert.match(stall.embeds[0].description, /2ª vez/);
  assert.equal(stall.embeds[0].fields[0].value, '30 segundos');
  assert.equal(stall.content, '<@123456789012345678>');
  assert.deepEqual(stall.allowed_mentions, { parse:[], users:['123456789012345678'] });
});

test('conquistas e drops também incluem a menção configurada', () => {
  const settings = normalizeDiscordNotifications({ webhookUrl:WEBHOOK, discordUserId:'123456789012345678' });
  const payload = buildDiscordPayload({ kind:'rare_drop', itemName:'Green Queen Ear', count:1 }, settings);
  assert.equal(payload.content, '<@123456789012345678>');
  assert.deepEqual(payload.allowed_mentions, { parse:[], users:['123456789012345678'] });
});

test('conclusão de Task gera aviso no webhook de alertas', () => {
  const settings = normalizeDiscordNotifications({ criticalWebhookUrl:CRITICAL_WEBHOOK, taskCompletions:true });
  const payload = buildDiscordPayload({
    kind:'task_completed', characterName:'Misty', species:'Starmie', trackLabel:'Água', target:4000, completed:1,
  }, settings);
  assert.match(payload.embeds[0].title, /Task concluída/);
  assert.match(payload.embeds[0].description, /Starmie.*Misty/);
  assert.equal(payload.embeds[0].fields[0].value, 'Água');
  assert.equal(payload.embeds[0].fields[1].value, '4.000 abates');
});

test('launcher preserva o canal principal e aceita webhook local apenas para alertas', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const config = fs.readFileSync(path.join(root, 'config.html'), 'utf8');
  assert.match(main, /createDiscordRelayNotifier/);
  assert.match(main, /createDiscordNotifier/);
  assert.match(main, /CRITICAL_DISCORD_EVENTS = new Set\(\['party_death', 'repeated_stall', 'task_completed'\]\)/);
  assert.match(main, /hasOwnProperty\.call\(preferences, 'taskCompletions'\)/);
  assert.doesNotMatch(main, /discord\.com\/api\/webhooks/);
  assert.match(config, /id="notifications-critical-webhook"/);
  assert.match(config, /id="notifications-discord-user-id"/);
  assert.match(config, /id="notifications-tasks"/);
  assert.doesNotMatch(config, /id="notifications-critical-enabled"|id="notifications-enabled"|id="notifications-rare-drops"|id="notifications-mythic"|id="notifications-shiny"/);
  assert.doesNotMatch(config + main, /notifications-test|testDiscordNotifications|allowDiscordTest/);
});
