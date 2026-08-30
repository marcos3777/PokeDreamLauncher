import { withSupabase } from "npm:@supabase/server@1.4.1";
import { withLauncherVersion } from "../_shared/launcher-version.mjs";

const SPECIES_PATTERN = /^[A-Z][A-Za-z0-9]{0,31}$/;

function response(body: Record<string, unknown>, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(body, {
    status,
    headers:{ "cache-control":status === 200 ? "public, max-age=60, stale-while-revalidate=300" : "no-store", ...headers },
  });
}

export default {
  fetch: withSupabase({ auth:"publishable:default" }, withLauncherVersion(async (req, ctx) => {
    if (req.method !== "GET") return response({ error:"method_not_allowed" }, 405, { allow:"GET" });
    const url = new URL(req.url);
    const hunts = url.searchParams.getAll("hunt");
    if (hunts.length !== 1 || !SPECIES_PATTERN.test(hunts[0])
      || [...url.searchParams.keys()].some((key) => key !== "hunt")) {
      return response({ error:"invalid_request" }, 400);
    }
    const { data, error } = await ctx.supabaseAdmin.rpc("get_hunt_performance_leaderboard_v3", { p_hunt_species:hunts[0] });
    if (error) {
      console.error("performance-leaderboard rpc failed", { code:error.code, message:error.message, details:error.details });
      return response({ error:"server_error" }, 500);
    }
    const grouped: Record<string, unknown[]> = { xp_per_hour:[], mobs_per_hour:[] };
    for (const row of Array.isArray(data) ? data : []) {
      if (row && typeof row === "object" && (row.metric === "xp_per_hour" || row.metric === "mobs_per_hour")) {
        grouped[row.metric].push(row);
      }
    }
    return response({ data:grouped });
  })),
};
