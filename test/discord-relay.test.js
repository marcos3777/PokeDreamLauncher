'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiscordRelayNotifier, relayEventEnabled, serializeRelayEvent } = require('../discord-relay');

const IDENTITY = {
  clientId:'123e4567-e89b-42d3-a456-426614174000',
  clientToken:'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ',
  appVersion:'2.0.11',
};

test('relay mantém conquistas e drops sempre ativos sem precisar conhecer o webhook', () => {
  assert.equal(relayEventEnabled({ kind:'rare_drop' }, { enabled:true, rareDrops:true }), true);
  assert.equal(relayEventEnabled({ kind:'rare_drop' }, { enabled:false, rareDrops:false }), true);
  assert.equal(relayEventEnabled({ kind:'party_death' }, { partyDeaths:true }), false);
  assert.equal(relayEventEnabled({ kind:'task_completed' }, { taskCompletions:true }), false);
  assert.equal(serializeRelayEvent({ kind:'task_completed' }, { taskCompletions:true }), null);
});

test('relay envia somente o evento estruturado para a Edge Function', async () => {
  let request = null;
  const notifier = createDiscordRelayNotifier(() => ({
    enabled:true, rareDrops:true, mythicCaptures:true, shinyCaptures:true,
  }), () => IDENTITY, {
    baseUrl:'https://example.supabase.co',
    publishableKey:'sb_publishable_test',
    fetchImpl:async (url, init) => {
      request = { url, init, body:JSON.parse(init.body) };
      return { ok:true, status:200, json:async () => ({ ok:true }) };
    },
  });
  const result = await notifier.notify({
    kind:'rare_drop', characterName:'Ash', slot:1, at:1000,
    itemId:'green_queen_ear', itemName:'Green Queen Ear', count:2, species:'Nidorina',
  });
  assert.equal(result.ok, true);
  assert.equal(request.url, 'https://example.supabase.co/functions/v1/discord-notification');
  assert.equal(request.init.headers.apikey, 'sb_publishable_test');
  assert.equal(request.body.client_token, IDENTITY.clientToken);
  assert.equal(request.body.event.kind, 'rare_drop');
  assert.equal(JSON.stringify(request.body).includes('discord.com/api/webhooks'), false);
});

test('serialização limita os campos e inclui todos os motivos da captura', () => {
  const event = serializeRelayEvent({
    kind:'pokemon_capture', characterName:'Misty', slot:2,
    pokemon:{ species:'Starmie', shiny:true, essence:'Mythic', level:50, ignored:'secret' },
    ignored:'secret',
  }, { shinyCaptures:false, mythicCaptures:true });
  assert.deepEqual(event.reasons, ['Shiny', 'Mythic']);
  assert.equal(Object.hasOwn(event, 'ignored'), false);
  assert.equal(Object.hasOwn(event.pokemon, 'ignored'), false);
});
