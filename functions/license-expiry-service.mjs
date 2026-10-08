const ORIGINS = new Set([
  'https://vn-keen.skin', 'https://www.vn-keen.skin',
  'https://vn-keen.pages.dev', 'https://vn-keen.github.io'
]);
const KEY_PATTERN = /^VN-KEEN-(SKIN|AIM)-(?:[A-Z0-9]{4}-){3}[A-Z0-9]{4}$/;
const WINDOW_SECONDS = 15 * 60;

function reply(body, status, origin) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Origin'
  };
  if (ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}

async function hash(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export async function handleLicenseExpiry(request, env, now = Math.floor(Date.now() / 1000)) {
  const origin = request.headers.get('Origin');
  if (origin && !ORIGINS.has(origin)) return reply({ success: false, code: 'ORIGIN_NOT_ALLOWED' }, 403, origin);
  if (request.method !== 'POST') return reply({ success: false, code: 'METHOD_NOT_ALLOWED' }, 405, origin);
  if (!env?.LICENSE_DB || !env?.LICENSEGATE_API_KEY) return reply({ success: false, code: 'NOT_CONFIGURED' }, 503, origin);

  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const bucket = `expiry:${await hash(ip)}:${Math.floor(now / WINDOW_SECONDS)}`;
    const attempt = await env.LICENSE_DB.prepare(`INSERT INTO wallet_auth_limits (bucket,attempts,expires_at)
      VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts`)
      .bind(bucket, (Math.floor(now / WINDOW_SECONDS) + 1) * WINDOW_SECONDS).first();
    if (Number(attempt?.attempts || 0) > 40)
      return reply({ success: false, code: 'RATE_LIMITED' }, 429, origin);

    const bodyText = await request.text();
    if (bodyText.length > 256) return reply({ success: false, code: 'INVALID_KEY' }, 400, origin);
    let key;
    try { key = JSON.parse(bodyText)?.key; } catch { return reply({ success: false, code: 'INVALID_JSON' }, 400, origin); }
    if (typeof key !== 'string' || !KEY_PATTERN.test(key))
      return reply({ success: false, code: 'INVALID_KEY' }, 400, origin);

    const upstream = await fetch('https://api.licensegate.io/admin/licenses/key/' + encodeURIComponent(key), {
      headers: { Authorization: env.LICENSEGATE_API_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (upstream.status === 404) return reply({ success: false, code: 'NOT_FOUND' }, 404, origin);
    if (!upstream.ok) return reply({ success: false, code: 'PROVIDER_UNAVAILABLE' }, 503, origin);
    const license = await upstream.json();
    const scope = key.startsWith('VN-KEEN-SKIN-') ? 'VN-KEEN-SKIN' : 'VN-KEEN-AIM';
    if (license?.licenseKey !== key || license.licenseScope !== scope || license.active !== true)
      return reply({ success: false, code: 'NOT_FOUND' }, 404, origin);
    const expiryMs = Date.parse(license.expirationDate);
    if (!Number.isFinite(expiryMs)) return reply({ success: false, code: 'EXPIRY_UNAVAILABLE' }, 503, origin);
    const lifetime = expiryMs === Date.parse('2099-12-31T23:59:59.000Z');
    return reply({ success: true, expiresAt: Math.floor(expiryMs / 1000), serverTime: now, lifetime }, 200, origin);
  } catch {
    // Never echo a key, provider response, or administrator secret to the client.
    return reply({ success: false, code: 'SERVICE_UNAVAILABLE' }, 503, origin);
  }
}
