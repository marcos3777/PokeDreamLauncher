import { withSupabase } from "npm:@supabase/server@1.4.1";
import { withLauncherVersion, launcherVersionError } from "../_shared/launcher-version.mjs";

const MAX_BODY_BYTES = 16 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/;
const DISCORD_ID_PATTERN = /^\d{17,20}$/;
const WEBHOOK_PATH_PATTERN = /^\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/;

type JsonObject = Record<string, unknown>;

class RequestError extends Error {
  constructor(readonly status: number, readonly publicCode: string) { super(publicCode); }
}

function response(body: JsonObject, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(body, { status, headers:{ "cache-control":"no-store", ...headers } });
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: JsonObject, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validText(value: unknown, max: number, nullable = false): boolean {
  if (nullable && value === null) return true;
  return typeof value === "string" && value.length >= 1 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validNumber(value: unknown, min: number, max: number, nullable = false): boolean {
  if (nullable && value === null) return true;
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function validCommonEvent(event: JsonObject): boolean {
  const now = Date.now();
  return validText(event.characterName, 40, true)
    && (event.slot === null || (Number.isInteger(event.slot) && Number(event.slot) >= 1 && Number(event.slot) <= 4))
    && Number.isSafeInteger(event.at)
    && Number(event.at) >= now - 7 * 24 * 60 * 60 * 1000
    && Number(event.at) <= now + 5 * 60 * 1000;
}

function validPokemon(value: unknown): value is JsonObject {
  return isRecord(value)
    && exactKeys(value, ["species", "level", "potential", "essence", "tier", "caughtBall", "shiny"])
    && validText(value.species, 50)
    && validNumber(value.level, 1, 100000, true)
    && validNumber(value.potential, 0, 100, true)
    && validText(value.essence, 30, true)
    && validText(value.tier, 30, true)
    && validText(value.caughtBall, 50, true)
    && typeof value.shiny === "boolean";
}

function validateEvent(value: unknown): JsonObject {
  if (!isRecord(value) || typeof value.kind !== "string") throw new RequestError(400, "invalid_event");
  if (value.kind === "test") {
    if (!exactKeys(value, ["kind", "at"]) || !Number.isSafeInteger(value.at)) throw new RequestError(400, "invalid_event");
    return value;
  }
  if (!validCommonEvent(value)) throw new RequestError(400, "invalid_event");
  if (value.kind === "rare_drop") {
    if (!exactKeys(value, ["kind", "characterName", "slot", "at", "itemId", "itemName", "count", "species"])
      || typeof value.itemId !== "string" || !/^[A-Za-z0-9_:-]{1,80}$/.test(value.itemId)
      || !validText(value.itemName, 100)
      || !Number.isInteger(value.count) || Number(value.count) < 1 || Number(value.count) > 100000
      || !validText(value.species, 50, true)) throw new RequestError(400, "invalid_event");
  } else if (value.kind === "pokemon_capture") {
    if (!exactKeys(value, ["kind", "characterName", "slot", "at", "pokemon", "reasons"])
      || !validPokemon(value.pokemon) || !Array.isArray(value.reasons)
      || value.reasons.length < 1 || value.reasons.length > 2
      || new Set(value.reasons).size !== value.reasons.length
      || value.reasons.some((reason) => reason !== "Shiny" && reason !== "Mythic")
      || (value.reasons.includes("Shiny") && value.pokemon.shiny !== true)
      || (value.reasons.includes("Mythic") && !/^mythic$/i.test(String(value.pokemon.essence || value.pokemon.tier || "")))) {
      throw new RequestError(400, "invalid_event");
    }
  } else if (value.kind === "party_death") {
    if (!exactKeys(value, ["kind", "characterName", "slot", "at", "pokemon"]) || !validPokemon(value.pokemon)) {
      throw new RequestError(400, "invalid_event");
    }
  } else if (value.kind === "repeated_stall") {
    if (!exactKeys(value, ["kind", "characterName", "slot", "at", "attempts", "timeoutSeconds"])
      || !Number.isInteger(value.attempts) || Number(value.attempts) < 2 || Number(value.attempts) > 1000
      || !validNumber(value.timeoutSeconds, 1, 3600, true)) throw new RequestError(400, "invalid_event");
  } else {
    throw new RequestError(400, "invalid_event");
  }
  return value;
}

async function readJson(req: Request): Promise<unknown> {
  const length = req.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    throw new RequestError(Number(length) > MAX_BODY_BYTES ? 413 : 400, "invalid_request");
  }
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new RequestError(413, "payload_too_large");
  try { return JSON.parse(text); } catch { throw new RequestError(400, "invalid_json"); }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requestSource(req: Request): string {
  const direct = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip");
  if (direct) return direct.trim().slice(0, 128);
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return (forwarded.split(",").pop() || "unknown").trim().slice(0, 128);
  return "unknown";
}

function webhookUrl(value: string | undefined): string {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" || url.hostname !== "discord.com" || !WEBHOOK_PATH_PATTERN.test(url.pathname)) throw new Error();
    return url.toString();
  } catch { throw new RequestError(503, "notification_channel_unavailable"); }
}

function shortText(value: unknown, max = 1000): string {
  const text = String(value == null ? "" : value).trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function accountLabel(event: JsonObject): string {
  return shortText(event.characterName || (event.slot ? `Tela ${event.slot}` : "Personagem não identificado"), 200);
}

function pokemonFields(pokemon: JsonObject): JsonObject[] {
  const fields: JsonObject[] = [];
  if (pokemon.level !== null) fields.push({ name:"Nível", value:String(pokemon.level), inline:true });
  if (pokemon.potential !== null) fields.push({ name:"Potência", value:`${pokemon.potential}%`, inline:true });
  if (pokemon.essence || pokemon.tier) fields.push({ name:"Tier", value:shortText(pokemon.essence || pokemon.tier, 100), inline:true });
  if (pokemon.caughtBall) fields.push({ name:"Capturado com", value:shortText(String(pokemon.caughtBall).replace(/_/g, " "), 100), inline:true });
  return fields;
}

function buildDiscordPayload(event: JsonObject, discordUserId: string | null): JsonObject {
  const who = accountLabel(event);
  let embed: JsonObject;
  if (event.kind === "rare_drop") {
    embed = {
      title:"✨ Drop raro", color:0xF5C85D,
      description:`**${shortText(event.itemName, 200)}**${Number(event.count) > 1 ? ` ×${event.count}` : ""}`,
      fields:[
        { name:"Personagem", value:who, inline:true },
        { name:"Drop de", value:shortText(event.species || "Pokémon não identificado", 200), inline:true },
      ],
    };
  } else if (event.kind === "pokemon_capture") {
    const pokemon = event.pokemon as JsonObject;
    const reasons = event.reasons as string[];
    embed = {
      title:`${reasons.includes("Shiny") ? "✨" : "🌟"} Captura ${reasons.join(" + ")}`,
      color:reasons.includes("Shiny") ? 0xF5C85D : 0x9B6DFF,
      description:`**${shortText(pokemon.species || "Pokémon", 200)}** foi capturado por **${who}**.`,
      fields:pokemonFields(pokemon),
    };
  } else if (event.kind === "party_death") {
    const pokemon = event.pokemon as JsonObject;
    embed = {
      title:"💀 Pokémon da party morreu", color:0xF06A73,
      description:`**${shortText(pokemon.species || "Pokémon", 200)}** de **${who}** ficou sem HP.`,
      fields:pokemonFields(pokemon),
    };
  } else if (event.kind === "repeated_stall") {
    embed = {
      title:"⚠️ Tela travou novamente", color:0xF0AA5F,
      description:`A tela de **${who}** precisou do F5 automático pela **${event.attempts}ª vez seguida**.`,
      fields:event.timeoutSeconds === null ? [] : [{ name:"Tempo sem resposta", value:`${event.timeoutSeconds} segundos`, inline:true }],
    };
  } else {
    embed = { title:"✅ Canal seguro conectado", color:0x61D692, description:"As notificações do Poke Dream Launcher estão funcionando." };
  }
  embed.timestamp = new Date(Number(event.at)).toISOString();
  embed.footer = { text:"Poke Dream Launcher" };
  return {
    username:"Poke Dream Launcher",
    allowed_mentions:discordUserId ? { parse:[], users:[discordUserId] } : { parse:[] },
    embeds:[embed],
    ...(discordUserId ? { content:`<@${discordUserId}>` } : {}),
  };
}

export default {
  fetch: withSupabase({ auth:"publishable:default" }, withLauncherVersion(async (req, ctx) => {
    if (req.method !== "POST") return response({ error:"method_not_allowed" }, 405, { allow:"POST" });
    if (req.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      return response({ error:"unsupported_media_type" }, 415);
    }
    try {
      const body = await readJson(req);
      const versionError = launcherVersionError(req, isRecord(body) ? (body.app_version ?? null) : null);
      if (versionError) return versionError;
      if (!isRecord(body) || !exactKeys(body, ["schema_version", "app_version", "client_id", "client_token", "discord_user_id", "event"])
        || body.schema_version !== 1
        || typeof body.app_version !== "string" || !VERSION_PATTERN.test(body.app_version)
        || typeof body.client_id !== "string" || !UUID_PATTERN.test(body.client_id)
        || typeof body.client_token !== "string" || !TOKEN_PATTERN.test(body.client_token)) {
        throw new RequestError(400, "invalid_submission");
      }
      const event = validateEvent(body.event);
      const discordUserId = body.discord_user_id === null
        ? null
        : (typeof body.discord_user_id === "string" && DISCORD_ID_PATTERN.test(body.discord_user_id)
          ? body.discord_user_id
          : null);
      if (body.discord_user_id !== null && discordUserId === null) throw new RequestError(400, "invalid_discord_user");

      const sourceSalt = Deno.env.get("DISCORD_RATE_LIMIT_SALT") || Deno.env.get("SUPABASE_URL") || "poke-dream-launcher";
      const sourceHash = await sha256(`${sourceSalt}:${requestSource(req)}`);
      const { data, error } = await ctx.supabaseAdmin.rpc("authorize_discord_notification", {
        p_client_id:body.client_id,
        p_token_hash:await sha256(body.client_token),
        p_source_hash:sourceHash,
      });
      if (error) {
        console.error("notification authorization failed", { code:error.code, message:error.message });
        if (error.code === "28000") return response({ error:"notification_identity_not_registered" }, 403);
        if (error.code === "22023") return response({ error:"invalid_submission" }, 400);
        return response({ error:"server_error" }, 500);
      }
      const authorization = Array.isArray(data) ? data[0] : data;
      if (!isRecord(authorization) || typeof authorization.status !== "string") return response({ error:"server_error" }, 500);
      if (authorization.status === "rate_limited") {
        const retry = Math.max(1, Math.trunc(Number(authorization.retry_after_seconds) || 600));
        return response({ error:"rate_limited", retry_after_seconds:retry }, 429, { "retry-after":String(retry) });
      }
      if (authorization.status !== "allowed") return response({ error:"server_error" }, 500);

      const { data:storedWebhook, error:webhookError } = await ctx.supabaseAdmin.rpc("get_discord_notification_webhook", {
        p_event_kind:event.kind,
      });
      if (webhookError) {
        console.error("notification Vault lookup failed", { code:webhookError.code, message:webhookError.message });
        return response({ error:"notification_channel_unavailable" }, 503);
      }
      const target = webhookUrl(typeof storedWebhook === "string" ? storedWebhook : undefined);
      const discordResponse = await fetch(target, {
        method:"POST",
        headers:{ "content-type":"application/json", "user-agent":"Poke-Dream-Launcher-Relay" },
        body:JSON.stringify(buildDiscordPayload(event, discordUserId)),
      });
      if (!discordResponse.ok) {
        console.error("Discord notification failed", { status:discordResponse.status, kind:event.kind });
        return response({ error:"discord_unavailable" }, 502);
      }
      return response({ ok:true });
    } catch (error) {
      if (error instanceof RequestError) return response({ error:error.publicCode }, error.status);
      console.error("discord notification failed", error);
      return response({ error:"server_error" }, 500);
    }
  })),
};
