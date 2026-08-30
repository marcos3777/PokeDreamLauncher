import { withSupabase } from "npm:@supabase/server@1.4.1";
import { withLauncherVersion, launcherVersionError, isSupportedAppVersion as supportedVersion } from "../_shared/launcher-version.mjs";

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_RECORDS = 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const TRAINER_NAME_PATTERN = /^[^\u0000-\u001f\u007f]{1,40}$/u;

class RequestError extends Error {
  constructor(readonly status: number, readonly publicCode: string) { super(publicCode); }
}

function response(body: Record<string, unknown>, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(body, { status, headers:{ "cache-control":"no-store", ...headers } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}


async function readJson(req: Request): Promise<unknown> {
  const length = req.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    throw new RequestError(Number(length) > MAX_BODY_BYTES ? 413 : 400, "invalid_request");
  }
  if (!req.body) throw new RequestError(400, "invalid_json");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) { await reader.cancel(); throw new RequestError(413, "payload_too_large"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal:true }).decode(bytes)); }
  catch { throw new RequestError(400, "invalid_json"); }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
      if (!isRecord(body) || !exactKeys(body, ["schema_version", "app_version", "client_id", "client_token", "records"])) {
        throw new RequestError(400, "invalid_submission");
      }
      if ((body.schema_version !== 1 && body.schema_version !== 2 && body.schema_version !== 3)
        || typeof body.app_version !== "string" || !supportedVersion(body.app_version)
        || typeof body.client_id !== "string" || !UUID_PATTERN.test(body.client_id)
        || typeof body.client_token !== "string" || !TOKEN_PATTERN.test(body.client_token)
        || !Array.isArray(body.records) || body.records.length > MAX_RECORDS) {
        throw new RequestError(typeof body.app_version === "string" && !supportedVersion(body.app_version) ? 426 : 400,
          typeof body.app_version === "string" && !supportedVersion(body.app_version) ? "update_required" : "invalid_submission");
      }
      const records = body.records.map((record) => {
        if (!isRecord(record)) throw new RequestError(400, "invalid_submission");
        if (body.schema_version === 1) return { ...record, trainer_name:null, completed_task_types:0, rune_bonus_percent:0 };
        if (typeof record.trainer_name !== "string") throw new RequestError(400, "invalid_submission");
        const trainerName = record.trainer_name.trim();
        if (!TRAINER_NAME_PATTERN.test(trainerName)) throw new RequestError(400, "invalid_submission");
        if (body.schema_version === 2) return { ...record, trainer_name:trainerName, completed_task_types:0, rune_bonus_percent:0 };
        return { ...record, trainer_name:trainerName };
      });
      const { data, error } = await ctx.supabaseAdmin.rpc("submit_hunt_performance_v3", {
        p_client_id:body.client_id,
        p_token_hash:await sha256(body.client_token),
        p_app_version:body.app_version,
        p_records:records,
      });
      if (error) {
        console.error("submit-performance rpc failed", { code:error.code, message:error.message, details:error.details });
        if (error.message === "invalid_client_token") return response({ error:"submission_rejected" }, 403);
        if (error.code === "22023") return response({ error:"invalid_submission" }, 400);
        return response({ error:"server_error" }, 500);
      }
      const result = Array.isArray(data) ? data[0] : data;
      if (!isRecord(result) || typeof result.status !== "string") return response({ error:"server_error" }, 500);
      if (result.status === "rate_limited") {
        const retry = Math.max(1, Math.trunc(Number(result.retry_after_seconds) || 300));
        return response({ error:"rate_limited", retry_after_seconds:retry }, 429, { "retry-after":String(retry) });
      }
      if (result.status !== "saved") return response({ error:"server_error" }, 500);
      return response({ ok:true, saved:Number(result.saved) || 0 });
    } catch (error) {
      if (error instanceof RequestError) return response({ error:error.publicCode }, error.status);
      console.error("submit-performance failed", error);
      return response({ error:"server_error" }, 500);
    }
  })),
};
