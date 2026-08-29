import { withSupabase } from "npm:@supabase/server@1.4.1";

const SPECIES_PATTERN = /^[A-Z][A-Za-z0-9]{0,31}$/;

function response(body: Record<string, unknown>, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": status === 200 ? "public, max-age=60, stale-while-revalidate=300" : "no-store",
      ...headers,
    },
  });
}

export default {
  fetch: withSupabase({ auth: "publishable:default" }, async (req, ctx) => {
    if (req.method !== "GET") return response({ error: "method_not_allowed" }, 405, { allow: "GET" });

    const url = new URL(req.url);
    const speciesValues = url.searchParams.getAll("species");
    const hasUnknownParameter = [...url.searchParams.keys()].some((key) => key !== "species");
    if (hasUnknownParameter || speciesValues.length > 1
      || (speciesValues.length === 1 && !SPECIES_PATTERN.test(speciesValues[0]))) {
      return response({ error: "invalid_request" }, 400);
    }

    const detail = speciesValues.length === 1;
    const { data, error } = detail
      ? await ctx.supabaseAdmin.rpc("get_pokemon_hub", { p_species: speciesValues[0] })
      : await ctx.supabaseAdmin.rpc("get_pokemon_hub_catalog");

    if (error) {
      console.error("pokemon-hub rpc failed", {
        code: error.code,
        message: error.message,
        details: error.details,
      });
      return response({ error: "server_error" }, 500);
    }

    return response({ data: data ?? (detail ? null : []) });
  }),
};
