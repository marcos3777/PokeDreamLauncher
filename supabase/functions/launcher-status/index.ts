import { withSupabase } from "npm:@supabase/server@1.4.1";
import { MIN_LAUNCHER_VERSION, withLauncherVersion } from "../_shared/launcher-version.mjs";

export default {
  fetch: withSupabase({ auth: "publishable:default" }, withLauncherVersion(async (req) => {
    if (req.method !== "GET") return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { allow: "GET" } });
    return Response.json({ ok: true, min_version: MIN_LAUNCHER_VERSION });
  })),
};
