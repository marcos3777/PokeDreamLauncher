create function public.get_discord_notification_webhook(p_event_kind text)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select secret.decrypted_secret
  from vault.decrypted_secrets as secret
  where secret.name = case
    when p_event_kind in ('party_death', 'repeated_stall') then 'discord_critical_webhook_url'
    when p_event_kind in ('rare_drop', 'pokemon_capture', 'test') then 'discord_webhook_url'
    else null
  end
  limit 1
$$;

revoke all on function public.get_discord_notification_webhook(text) from public, anon, authenticated;
grant execute on function public.get_discord_notification_webhook(text) to service_role;
