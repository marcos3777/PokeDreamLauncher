import { withSupabase } from "npm:@supabase/server@1.4.1";

const MAX_BODY_BYTES = 512 * 1024;
const MAX_SPECIES = 300;
const MAX_ACCOUNTS = 32;
const MAX_COUNTER = 1_000_000_000;
const MAX_HUNT_MS = 630_720_000_000;
const MAX_BROKE_SUM = Number.MAX_SAFE_INTEGER;
const MIN_APP_VERSION = [1, 8, 2] as const;
const SPECIES_PATTERN = /^[A-Z][A-Za-z0-9]{0,31}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{64}$/;
const SPECIES_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  NidoranFemale: "NidoranF",
  NidoranMale: "NidoranM",
});
const LEGACY_STAT_KEYS = [
  "kills",
  "caught",
  "shinies",
  "thrown_a",
  "thrown_b",
  "caught_a",
  "caught_b",
  "ms",
] as const;
const ACCOUNT_STAT_KEYS_V2 = [
  "kills",
  "caught",
  "shinies",
  "shiny_caught",
  "broke_max",
  "broke_min",
  "thrown_a",
  "thrown_b",
  "caught_a",
  "caught_b",
  "ms",
] as const;
const ACCOUNT_STAT_KEYS_V3 = [
  "kills",
  "caught",
  "shinies",
  "shiny_caught",
  "broke_max",
  "broke_min",
  "broke_sum",
  "broke_count",
  "thrown_a",
  "thrown_b",
  "caught_a",
  "caught_b",
  "ms",
] as const;

class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly publicCode: string,
  ) {
    super(publicCode);
  }
}

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSupportedAppVersion(value: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value);
  if (!match) return false;
  const actual = match.slice(1, 4).map(Number);
  for (let index = 0; index < MIN_APP_VERSION.length; index++) {
    if (actual[index] !== MIN_APP_VERSION[index]) {
      return actual[index] > MIN_APP_VERSION[index];
    }
  }
  return true;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isSafeCounter(value: unknown, minimum = 0): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= MAX_COUNTER;
}

function isSafeDecimal(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && value <= MAX_COUNTER;
}

function validateStatEntry(entry: unknown, schemaVersion: number): void {
  const expectedKeys = schemaVersion === 1
    ? LEGACY_STAT_KEYS
    : (schemaVersion === 2 ? ACCOUNT_STAT_KEYS_V2 : ACCOUNT_STAT_KEYS_V3);
  if (!isRecord(entry) || !hasExactKeys(entry, expectedKeys)) {
    throw new RequestError(400, "invalid_submission");
  }

  const { kills, caught, shinies, thrown_a, thrown_b, caught_a, caught_b, ms } = entry;
  if (!isSafeCounter(kills, 1)
    || !isSafeCounter(caught)
    || !isSafeCounter(shinies)
    || !isSafeCounter(thrown_a)
    || !isSafeCounter(thrown_b)
    || !isSafeDecimal(caught_a)
    || !isSafeDecimal(caught_b)
    || typeof ms !== "number"
    || !Number.isSafeInteger(ms)
    || ms < 0
    || ms > MAX_HUNT_MS) {
    throw new RequestError(400, "invalid_submission");
  }

  if (caught > kills
    || shinies > kills
    || caught > thrown_a + thrown_b
    || caught_a > thrown_a
    || caught_b > thrown_b
    || caught_a + caught_b > caught + 0.000001) {
    throw new RequestError(400, "invalid_submission");
  }

  if (schemaVersion === 1) return;
  const { shiny_caught, broke_max, broke_min } = entry;
  const validNullableBroke = (value: unknown) => value === null || isSafeCounter(value, 1);
  if (!isSafeCounter(shiny_caught)
    || shiny_caught > shinies
    || shiny_caught > caught
    || !validNullableBroke(broke_max)
    || !validNullableBroke(broke_min)
    || (broke_min !== null && broke_max === null)
    || (typeof broke_max === "number" && broke_max > shinies)
    || (typeof broke_max === "number" && typeof broke_min === "number" && broke_min > broke_max)) {
    throw new RequestError(400, "invalid_submission");
  }

  if (schemaVersion === 2) {
    if (((broke_max === null) !== (broke_min === null))
      || (shiny_caught === 0 && (broke_max !== null || broke_min !== null))) {
      throw new RequestError(400, "invalid_submission");
    }
    return;
  }

  const { broke_sum, broke_count } = entry;
  if (typeof broke_sum !== "number"
    || !Number.isSafeInteger(broke_sum)
    || broke_sum < 0
    || broke_sum > MAX_BROKE_SUM
    || !isSafeCounter(broke_count)
    || broke_count > shiny_caught
    || (broke_count === 0 && broke_sum !== 0)
    || (broke_count > 0 && (broke_max === null || broke_min === null))
    || (typeof broke_count === "number" && broke_count > 0
      && typeof broke_sum === "number"
      && typeof broke_max === "number"
      && typeof broke_min === "number"
      && (broke_sum < broke_min * broke_count || broke_sum > broke_max * broke_count))) {
    throw new RequestError(400, "invalid_submission");
  }
}

function canonicalSpecies(species: string): string {
  return SPECIES_ALIASES[species] || species;
}

function mergeStatEntries(
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown>,
  schemaVersion: number,
): Record<string, unknown> {
  if (!left) return { ...right };
  const keys = schemaVersion === 1
    ? LEGACY_STAT_KEYS
    : (schemaVersion === 2 ? ACCOUNT_STAT_KEYS_V2 : ACCOUNT_STAT_KEYS_V3);
  const merged: Record<string, unknown> = {};
  for (const key of keys) {
    if (key === "broke_max") {
      const values = [left[key], right[key]].filter((value) => value !== null).map(Number);
      merged[key] = values.length ? Math.max(...values) : null;
    } else if (key === "broke_min") {
      const values = [left[key], right[key]].filter((value) => value !== null).map(Number);
      merged[key] = values.length ? Math.min(...values) : null;
    } else {
      merged[key] = Number(left[key]) + Number(right[key]);
    }
  }
  validateStatEntry(merged, schemaVersion);
  return merged;
}

function canonicalizeStats(stats: Record<string, unknown>, schemaVersion: number): Record<string, unknown> {
  if (schemaVersion === 1) {
    const result: Record<string, unknown> = {};
    for (const [species, entry] of Object.entries(stats)) {
      const canonical = canonicalSpecies(species);
      result[canonical] = mergeStatEntries(
        isRecord(result[canonical]) ? result[canonical] as Record<string, unknown> : undefined,
        entry as Record<string, unknown>,
        schemaVersion,
      );
    }
    return result;
  }
  const result: Record<string, unknown> = {};
  for (const [accountId, accountStats] of Object.entries(stats)) {
    const next: Record<string, unknown> = {};
    for (const [species, entry] of Object.entries(accountStats as Record<string, unknown>)) {
      const canonical = canonicalSpecies(species);
      next[canonical] = mergeStatEntries(
        isRecord(next[canonical]) ? next[canonical] as Record<string, unknown> : undefined,
        entry as Record<string, unknown>,
        schemaVersion,
      );
    }
    result[accountId] = next;
  }
  return result;
}

async function readLimitedJson(req: Request): Promise<unknown> {
  const declaredLength = req.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new RequestError(400, "invalid_request");
    }
    if (Number(declaredLength) > MAX_BODY_BYTES) {
      throw new RequestError(413, "payload_too_large");
    }
  }

  if (!req.body) {
    throw new RequestError(400, "invalid_json");
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RequestError(413, "payload_too_large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text);
  } catch {
    throw new RequestError(400, "invalid_json");
  }
}

function validatePayload(body: unknown): {
  clientId: string;
  clientToken: string;
  revision: number;
  schemaVersion: number;
  appVersion: string;
  stats: Record<string, unknown>;
} {
  if (!isRecord(body) || !hasExactKeys(body, [
    "schema_version",
    "app_version",
    "client_id",
    "client_token",
    "revision",
    "stats",
  ])) {
    throw new RequestError(400, "invalid_submission");
  }

  const clientId = body.client_id;
  const clientToken = body.client_token;
  const revision = body.revision;
  const schemaVersion = body.schema_version;
  const appVersion = body.app_version;
  const stats = body.stats;

  if (typeof clientId !== "string" || !UUID_PATTERN.test(clientId)) {
    throw new RequestError(400, "invalid_submission");
  }
  if (typeof clientToken !== "string" || !TOKEN_PATTERN.test(clientToken)) {
    throw new RequestError(400, "invalid_submission");
  }
  if (!Number.isSafeInteger(revision) || (revision as number) < 1) {
    throw new RequestError(400, "invalid_submission");
  }
  if ((schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3)
    || typeof appVersion !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/.test(appVersion)) {
    throw new RequestError(400, "invalid_submission");
  }
  if (!isSupportedAppVersion(appVersion)) {
    throw new RequestError(426, "update_required");
  }
  if (!isRecord(stats)) {
    throw new RequestError(400, "invalid_submission");
  }

  if (schemaVersion === 1) {
    const speciesNames = Object.keys(stats);
    if (speciesNames.length > MAX_SPECIES) {
      throw new RequestError(400, "invalid_submission");
    }
    for (const species of speciesNames) {
      if (!SPECIES_PATTERN.test(species)) throw new RequestError(400, "invalid_submission");
      validateStatEntry(stats[species], 1);
    }
  } else {
    const accountIds = Object.keys(stats);
    if (accountIds.length > MAX_ACCOUNTS) throw new RequestError(400, "invalid_submission");

    for (const accountId of accountIds) {
      const accountStats = stats[accountId];
      if (!ACCOUNT_ID_PATTERN.test(accountId) || !isRecord(accountStats)) {
        throw new RequestError(400, "invalid_submission");
      }
      const speciesNames = Object.keys(accountStats);
      if (speciesNames.length > MAX_SPECIES) throw new RequestError(400, "invalid_submission");
      for (const species of speciesNames) {
        if (!SPECIES_PATTERN.test(species)) throw new RequestError(400, "invalid_submission");
        validateStatEntry(accountStats[species], schemaVersion as number);
      }
    }
  }

  return {
    clientId,
    clientToken,
    revision: revision as number,
    schemaVersion,
    appVersion,
    stats: canonicalizeStats(stats, schemaVersion as number),
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function registrationSourceHash(req: Request): Promise<string> {
  const forwarded = req.headers.get("x-forwarded-for")?.split(/\s*,\s*/)[0]?.trim();
  const ip = forwarded || req.headers.get("cf-connecting-ip")?.trim();
  if (!ip || ip.length > 128) {
    throw new RequestError(400, "invalid_request");
  }

  const serverSecret = Deno.env.get("SUPABASE_SECRET_KEYS")
    || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serverSecret) throw new Error("server secret unavailable");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(serverSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const day = new Date().toISOString().slice(0, 10);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`community-registration-v1:${day}:${ip}`),
  );
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default {
  fetch: withSupabase({ auth: "publishable:default" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return jsonResponse({ error: "method_not_allowed" }, 405, { allow: "POST" });
    }

    const mediaType = req.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (mediaType !== "application/json") {
      return jsonResponse({ error: "unsupported_media_type" }, 415);
    }

    try {
      const payload = validatePayload(await readLimitedJson(req));
      const tokenHash = await sha256Hex(payload.clientToken);
      const sourceHash = await registrationSourceHash(req);
      const rpcName = payload.schemaVersion === 3 ? "replace_hunt_stats_v3" : "replace_hunt_stats";
      const { data, error } = await ctx.supabaseAdmin.rpc(rpcName, {
        p_client_id: payload.clientId,
        p_token_hash: tokenHash,
        p_revision: payload.revision,
        p_schema_version: payload.schemaVersion,
        p_app_version: payload.appVersion,
        p_stats: payload.stats,
        p_source_hash: sourceHash,
      });

      if (error) {
        console.error("submit-stats rpc failed", {
          code: error.code,
          message: error.message,
          details: error.details,
        });

        if (error.message === "invalid_client_token") {
          return jsonResponse({ error: "submission_rejected" }, 403);
        }
        if (error.code === "22023") {
          return jsonResponse({ error: "invalid_submission" }, 400);
        }
        return jsonResponse({ error: "server_error" }, 500);
      }

      const result = Array.isArray(data) ? data[0] : data;
      if (!isRecord(result) || typeof result.status !== "string") {
        console.error("submit-stats returned an invalid result");
        return jsonResponse({ error: "server_error" }, 500);
      }

      if (result.status === "rate_limited" || result.status === "registration_limited") {
        const retryAfter = typeof result.retry_after_seconds === "number"
          ? Math.max(1, Math.trunc(result.retry_after_seconds))
          : 300;
        return jsonResponse(
          { error: result.status, retry_after_seconds: retryAfter },
          429,
          { "retry-after": String(retryAfter) },
        );
      }

      if (result.status === "stale") {
        return jsonResponse({
          error: "stale_revision",
          revision: result.revision,
        }, 409);
      }

      if (result.status === "conflict") {
        return jsonResponse({
          error: "revision_conflict",
          revision: result.revision,
        }, 409);
      }

      if (result.status !== "saved" && result.status !== "replayed") {
        console.error("submit-stats returned an unknown status", { status: result.status });
        return jsonResponse({ error: "server_error" }, 500);
      }

      return jsonResponse({
        ok: true,
        replayed: result.status === "replayed",
        saved: result.saved,
        revision: result.revision,
      });
    } catch (error) {
      if (error instanceof RequestError) {
        return jsonResponse({ error: error.publicCode }, error.status);
      }
      console.error("submit-stats failed", error);
      return jsonResponse({ error: "server_error" }, 500);
    }
  }),
};
