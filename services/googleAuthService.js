const crypto = require('crypto');
const appConfig = require('../config/app.config');
const authConfig = require('../config/auth.config');

/**
 * ==============================================================================
 * 🔑 BAĞIMLILIKSIZ GOOGLE OAUTH2 / OIDC VE JWKS DOĞRULAMA SERVİSİ
 * ==============================================================================
 * - Yalnızca Node.js yerleşik crypto ve fetch kullanır (0 yeni npm paketi).
 * - PKCE (S256), state, nonce, iss, aud, exp, email_verified=true ve RS256 JWKS
 *   imzasını Node crypto.createPublicKey({ format: 'jwk' }) ile doğrular.
 * - Profil resmi (picture) ASLA döndürülmez veya saklanmaz.
 * ==============================================================================
 */

let jwksCache = {
  url: '',
  keys: [],
  expiresAt: 0,
};

function clearJwksCache() {
  jwksCache = { url: '', keys: [], expiresAt: 0 };
}

function base64UrlEncode(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecodeToBuffer(str) {
  const padded = String(str || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const mod = padded.length % 4;
  const full = mod === 0 ? padded : padded + '='.repeat(4 - mod);
  return Buffer.from(full, 'base64');
}

function generateOAuthSecurityParams() {
  const state = crypto.randomBytes(24).toString('hex');
  const nonce = crypto.randomBytes(24).toString('hex');
  const codeVerifier = base64UrlEncode(crypto.randomBytes(32));
  const codeChallenge = base64UrlEncode(crypto.createHash('sha256').update(codeVerifier).digest());
  return { state, nonce, codeVerifier, codeChallenge };
}

/**
 * Bot API'nin site-guest aktörü için "g_" + HMAC-SHA256(googleSub, SECRET) ilk 32 hex üretir.
 */
function deriveSiteGuestActorId(googleSub, envObj = process.env) {
  const secret =
    (envObj && (envObj.SESSION_SECRET || envObj.API_SECRET)) ||
    appConfig.SESSION_SECRET ||
    appConfig.API_SECRET ||
    'piyade-site-guest-fallback-secret';
  const hex = crypto.createHmac('sha256', secret).update(String(googleSub || ''), 'utf8').digest('hex').slice(0, 32);
  return `g_${hex}`;
}

function getAuthorizationUrl({ state, nonce, codeChallenge, lang = 'tr', envObj = process.env }) {
  const { clientId } = authConfig.getGoogleCredentials(envObj);
  const endpoints = authConfig.getGoogleEndpoints(envObj);
  const redirectUri = authConfig.getGoogleRedirectUri(envObj);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
    hl: lang === 'en' ? 'en' : 'tr',
  });
  return `${endpoints.authUrl}?${params.toString()}`;
}

async function exchangeCodeForTokens({ code, codeVerifier, envObj = process.env }) {
  const { clientId, clientSecret } = authConfig.getGoogleCredentials(envObj);
  const endpoints = authConfig.getGoogleEndpoints(envObj);
  const redirectUri = authConfig.getGoogleRedirectUri(envObj);

  const body = new URLSearchParams({
    code: String(code || ''),
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: String(codeVerifier || ''),
  });

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(endpoints.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
      signal: controller.signal,
    });
    clearTimeout(tid);
    const data = await resp.json().catch(() => null);
    if (!resp.ok || !data || !data.id_token) {
      const err = new Error((data && (data.error_description || data.error)) || 'Google token değişimi başarısız oldu.');
      err.code = 'TOKEN_EXCHANGE_FAILED';
      throw err;
    }
    return data;
  } catch (err) {
    clearTimeout(tid);
    if (err && err.code) throw err;
    const wrapped = new Error('Google kimlik sunucusuna ulaşılamadı.');
    wrapped.code = 'TOKEN_EXCHANGE_NETWORK';
    throw wrapped;
  }
}

function parseMaxAgeSeconds(cacheControlHeader) {
  const m = String(cacheControlHeader || '').match(/max-age=(\d+)/i);
  if (!m) return 3600;
  const sec = Number.parseInt(m[1], 10);
  if (!Number.isFinite(sec)) return 3600;
  return Math.min(6 * 3600, Math.max(300, sec));
}

async function fetchGoogleJwks({ forceRefresh = false, envObj = process.env } = {}) {
  const endpoints = authConfig.getGoogleEndpoints(envObj);
  const now = Date.now();
  if (!forceRefresh && jwksCache.url === endpoints.jwksUrl && jwksCache.keys.length > 0 && jwksCache.expiresAt > now) {
    return jwksCache.keys;
  }

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(endpoints.jwksUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!resp.ok) {
      const err = new Error('Google JWKS anahtarları alınamadı.');
      err.code = 'JWKS_FETCH_FAILED';
      throw err;
    }
    const data = await resp.json();
    const keys = Array.isArray(data && data.keys) ? data.keys : [];
    const maxAgeSec = parseMaxAgeSeconds(resp.headers.get('cache-control'));
    jwksCache = {
      url: endpoints.jwksUrl,
      keys,
      expiresAt: Date.now() + maxAgeSec * 1000,
    };
    return keys;
  } catch (err) {
    clearTimeout(tid);
    if (err && err.code) throw err;
    const wrapped = new Error('Google JWKS bağlantı hatası.');
    wrapped.code = 'JWKS_FETCH_FAILED';
    throw wrapped;
  }
}

function timingSafeStrEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Google OIDC id_token'ını tam olarak doğrular:
 * - JWT yapısı + RS256 başlığı + JWKS imzası (Node crypto.createPublicKey({ format: 'jwk' }))
 * - iss, aud, exp, nonce, email_verified === true, sub, email
 * - picture alanını KESİNLİKLE döndürmez!
 */
async function verifyIdToken(idToken, { expectedNonce, expectedClientId = null, nowSec = Math.floor(Date.now() / 1000), envObj = process.env } = {}) {
  const fail = (code, message) => {
    const err = new Error(message);
    err.code = code;
    throw err;
  };

  if (typeof idToken !== 'string') {
    fail('INVALID_ID_TOKEN', 'Geçersiz kimlik belirteci.');
  }
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    fail('INVALID_ID_TOKEN', 'JWT biçimi geçersiz.');
  }

  let header;
  let payload;
  try {
    header = JSON.parse(base64UrlDecodeToBuffer(parts[0]).toString('utf8'));
    payload = JSON.parse(base64UrlDecodeToBuffer(parts[1]).toString('utf8'));
  } catch (_) {
    fail('INVALID_ID_TOKEN', 'JWT içeriği çözümlenemedi.');
  }

  if (!header || header.alg !== 'RS256') {
    fail('UNSUPPORTED_ALG', 'Desteklenmeyen imza algoritması.');
  }

  // 1) JWKS üzerinden uygun anahtarı bul (gerekirse önbelleği bir kez yenile)
  let keys = await fetchGoogleJwks({ forceRefresh: false, envObj });
  let jwk = keys.find((k) => k && k.kty === 'RSA' && (!header.kid || k.kid === header.kid));
  if (!jwk) {
    keys = await fetchGoogleJwks({ forceRefresh: true, envObj });
    jwk = keys.find((k) => k && k.kty === 'RSA' && (!header.kid || k.kid === header.kid));
  }
  if (!jwk) {
    fail('JWKS_KEY_NOT_FOUND', 'Doğrulama anahtarı bulunamadı.');
  }

  // 2) RSA-SHA256 imza doğrulaması (Node yerleşik crypto)
  let verifiedSig = false;
  try {
    const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`, 'ascii');
    const signatureBuf = base64UrlDecodeToBuffer(parts[2]);
    verifiedSig = crypto.verify('RSA-SHA256', signingInput, publicKey, signatureBuf);
  } catch (_) {
    verifiedSig = false;
  }
  if (!verifiedSig) {
    fail('INVALID_SIGNATURE', 'Google kimlik imzası doğrulanamadı.');
  }

  // 3) Claim kontrolleri: iss, aud, exp, nonce, email_verified
  const endpoints = authConfig.getGoogleEndpoints(envObj);
  const clientId = expectedClientId || authConfig.getGoogleCredentials(envObj).clientId;

  if (!payload || typeof payload !== 'object') {
    fail('INVALID_PAYLOAD', 'Kimlik içeriği geçersiz.');
  }

  if (!endpoints.issuers.includes(String(payload.iss || ''))) {
    fail('INVALID_ISSUER', 'Kimlik sağlayıcısı (iss) geçersiz.');
  }

  const audMatches = Array.isArray(payload.aud)
    ? payload.aud.includes(clientId)
    : payload.aud === clientId;
  if (!clientId || !audMatches) {
    fail('INVALID_AUDIENCE', 'Uygulama hedefi (aud) eşleşmiyor.');
  }

  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || exp <= nowSec - 60) {
    fail('TOKEN_EXPIRED', 'Google kimlik belirtecinin süresi dolmuş.');
  }

  if (!expectedNonce || !timingSafeStrEqual(String(payload.nonce || ''), String(expectedNonce))) {
    fail('INVALID_NONCE', 'Güvenlik nonce değeri eşleşmiyor.');
  }

  if (payload.email_verified !== true) {
    fail('EMAIL_NOT_VERIFIED', 'Yalnızca e-posta adresi doğrulanmış Google hesapları kabul edilir.');
  }

  const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const name = typeof payload.name === 'string' ? payload.name.trim().slice(0, 120) : '';

  if (!sub || !email) {
    fail('MISSING_CLAIMS', 'Google hesabından temel kimlik alanları alınamadı.');
  }

  // GÜVENLİK: payload.picture kesinlikle kopyalanmaz ve saklanmaz!
  return {
    sub,
    email,
    emailVerified: true,
    name,
  };
}

module.exports = {
  clearJwksCache,
  base64UrlEncode,
  generateOAuthSecurityParams,
  deriveSiteGuestActorId,
  getAuthorizationUrl,
  exchangeCodeForTokens,
  fetchGoogleJwks,
  verifyIdToken,
};
