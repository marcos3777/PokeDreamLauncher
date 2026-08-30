import { withSupabase } from "npm:@supabase/server@1.4.1";
import { withLauncherVersion } from "../_shared/launcher-version.mjs";

const SPECIES_PATTERN = /^[A-Z][A-Za-z0-9]{0,31}$/;
const COMBAT_CATALOG_VERSION = "20260829192538";
const COMBAT_CATALOG_ETAG = `"pokemon-combat-${COMBAT_CATALOG_VERSION}"`;

function response(body: Record<string, unknown>, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": status === 200 ? "public, max-age=60, stale-while-revalidate=300" : "no-store",
      ...headers,
    },
  });
}

function notModifiedResponse(): Response {
  return new Response(null, {
    status: 304,
    headers: {
      "cache-control": "no-cache",
      etag: COMBAT_CATALOG_ETAG,
    },
  });
}

async function readCombatCatalog(ctx: any) {
  const [types, pokemon, speciesTypes, matchups] = await Promise.all([
    ctx.supabaseAdmin.from("types").select("code,name_pt,sort_order").order("sort_order"),
    ctx.supabaseAdmin.from("community_species").select("species,attack_type_code").order("dex_number"),
    ctx.supabaseAdmin.from("community_species_types").select("species,type_code,slot").order("species").order("slot"),
    ctx.supabaseAdmin.from("type_matchups").select("attack_type_code,defense_type_code,relation")
      .order("attack_type_code").order("defense_type_code"),
  ]);
  const failed = [types, pokemon, speciesTypes, matchups].find((result) => result.error);
  return {
    error: failed?.error ?? null,
    combat: {
      types: types.data ?? [],
      pokemon: pokemon.data ?? [],
      species_types: speciesTypes.data ?? [],
      matchups: matchups.data ?? [],
    },
  };
}

function serverError(error: any): Response {
  console.error("pokemon-hub rpc failed", {
    code: error?.code,
    message: error?.message,
    details: error?.details,
  });
  return response({ error: "server_error" }, 500);
}

export default {
  fetch: withSupabase({ auth: "publishable:default" }, withLauncherVersion(async (req, ctx) => {
    if (req.method !== "GET") return response({ error: "method_not_allowed" }, 405, { allow: "GET" });

    const url = new URL(req.url);
    const speciesValues = url.searchParams.getAll("species");
    const scopeValues = url.searchParams.getAll("scope");
    const hasUnknownParameter = [...url.searchParams.keys()].some((key) => key !== "species" && key !== "scope");
    const scope = scopeValues.length === 1 ? scopeValues[0] : null;
    if (hasUnknownParameter || speciesValues.length > 1 || scopeValues.length > 1
      || (scope != null && scope !== "catalog" && scope !== "combat")
      || (speciesValues.length > 0 && scope != null)
      || (speciesValues.length === 1 && !SPECIES_PATTERN.test(speciesValues[0]))) {
      return response({ error: "invalid_request" }, 400);
    }

    const detail = speciesValues.length === 1;
    if (detail) {
      const { data, error } = await ctx.supabaseAdmin.rpc("get_pokemon_hub", { p_species: speciesValues[0] });
      if (error) return serverError(error);
      return response({ data: data ?? null });
    }

    if (scope === "combat") {
      if (req.headers.get("if-none-match") === COMBAT_CATALOG_ETAG) return notModifiedResponse();
      const combatCatalog = await readCombatCatalog(ctx);
      if (combatCatalog.error) return serverError(combatCatalog.error);
      return response({ version: COMBAT_CATALOG_VERSION, combat: combatCatalog.combat }, 200, {
        "cache-control": "no-cache",
        etag: COMBAT_CATALOG_ETAG,
      });
    }

    if (scope === "catalog") {
      const { data, error } = await ctx.supabaseAdmin.rpc("get_pokemon_hub_catalog");
      if (error) return serverError(error);
      return response({ data: data ?? [] });
    }

    // Formato combinado mantido para launchers antigos.
    const [catalog, combatCatalog] = await Promise.all([
      ctx.supabaseAdmin.rpc("get_pokemon_hub_catalog"),
      readCombatCatalog(ctx),
    ]);
    if (catalog.error) return serverError(catalog.error);
    if (combatCatalog.error) return serverError(combatCatalog.error);

    return response({
      data: catalog.data ?? [],
      combat: combatCatalog.combat,
    });
  })),
};
