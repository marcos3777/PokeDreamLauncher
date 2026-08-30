// Compatibility gate, not proof that a client is an unmodified official build.
// Deploy every importing function when changing this shared minimum.
export const MIN_LAUNCHER_VERSION = '2.0.20';
export const LAUNCHER_VERSION_HEADER = 'x-launcher-version';

function parseVersion(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  // Only stable releases; build metadata does not affect precedence.
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
  if (!match) return null;
  const parts = match.slice(1, 4).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

export function isSupportedAppVersion(value) {
  const actual = parseVersion(value);
  const minimum = parseVersion(MIN_LAUNCHER_VERSION);
  if (!actual) return false;
  for (let index = 0; index < 3; index++) {
    if (actual[index] !== minimum[index]) return actual[index] > minimum[index];
  }
  return true;
}

export function launcherVersionError(req, bodyVersion = undefined) {
  const version = req.headers.get(LAUNCHER_VERSION_HEADER);
  if (!isSupportedAppVersion(version)
    || (bodyVersion !== undefined && !isSupportedAppVersion(bodyVersion))) {
    return Response.json({
      error: 'update_required',
      min_version: MIN_LAUNCHER_VERSION,
      message: `Atualize o launcher para a versão ${MIN_LAUNCHER_VERSION} ou superior para usar os recursos online.`,
    }, { status: 426, headers: { 'cache-control': 'no-store' } });
  }
  if (bodyVersion !== undefined && bodyVersion !== version) {
    return Response.json({ error: 'version_mismatch' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }
  return null;
}

export function withLauncherVersion(handler) {
  return async (req, ctx) => {
    const blocked = launcherVersionError(req);
    if (blocked) return blocked;
    const response = await handler(req, ctx);
    // Never let a shared HTTP cache serve a permitted response to an old client.
    const headers = new Headers(response.headers);
    headers.set('cache-control', 'private, no-store');
    headers.set('vary', [...new Set((headers.get('vary') || '').split(',').map(s => s.trim()).filter(Boolean).concat(LAUNCHER_VERSION_HEADER))].join(', '));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
}
