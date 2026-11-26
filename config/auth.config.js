/**
 * ==============================================================================
 * 🔐 PIYADE WORLD — GOOGLE OAUTH2 / OIDC, HATIRLAMA ÇEREZİ VE YENİ ÜYE SINIRLARI
 * ==============================================================================
 * - Üretimde (NODE_ENV !== 'test') Google uç adresleri ASLA ortam değişkeniyle
 *   değiştirilemez; her zaman resmi Google adresleri kullanılır.
 * - GOOGLE_CLIENT_ID veya GOOGLE_CLIENT_SECRET yoksa Google düğmesi gizlenir
 *   ve açılışta tek satır uyarı basılır.
 * ==============================================================================
 */

const OFFICIAL_GOOGLE_ENDPOINTS = Object.freeze({
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
  issuers: ['https://accounts.google.com', 'accounts.google.com'],
});

const REMEMBER_COOKIE_NAME = 'pw_remember';
const REMEMBER_TTL_DAYS = 90;
const REMEMBER_TTL_MS = REMEMBER_TTL_DAYS * 24 * 60 * 60 * 1000;
const REMEMBER_MAX_DEVICES = 5;

const DELETE_REAUTH_MAX_AGE_MS = 10 * 60 * 1000; // Hesap silme yeniden doğrulama süresi: 10 dk
const PENDING_GOOGLE_TTL_MS = 30 * 60 * 1000; // Geçici Google oturumu ömrü: 30 dk
const MAX_SIGNUPS_PER_HOUR_PER_IP = 3;

function getGoogleCredentials(envObj = process.env) {
  const clientId = String((envObj && envObj.GOOGLE_CLIENT_ID) || '').trim();
  const clientSecret = String((envObj && envObj.GOOGLE_CLIENT_SECRET) || '').trim();
  return {
    clientId,
    clientSecret,
    enabled: Boolean(clientId && clientSecret),
  };
}

function isGoogleEnabled(envObj = process.env) {
  return getGoogleCredentials(envObj).enabled;
}

function getGoogleRedirectUri(envObj = process.env) {
  const baseUrl = String((envObj && envObj.BASE_URL) || 'http://localhost:3001')
    .trim()
    .replace(/\/+$/, '');
  return `${baseUrl}/auth/google/callback`;
}

/**
 * Google OAuth2 / OIDC uç adreslerini döndürür.
 * GÜVENLİK: Test ortamı (NODE_ENV === 'test') DIŞINDA env geçersiz kılmaya KESİNLİKLE izin verilmez.
 */
function getGoogleEndpoints(envObj = process.env) {
  const isTestEnv = String((envObj && envObj.NODE_ENV) || '').trim().toLowerCase() === 'test';
  if (!isTestEnv) {
    return {
      authUrl: OFFICIAL_GOOGLE_ENDPOINTS.authUrl,
      tokenUrl: OFFICIAL_GOOGLE_ENDPOINTS.tokenUrl,
      jwksUrl: OFFICIAL_GOOGLE_ENDPOINTS.jwksUrl,
      issuers: [...OFFICIAL_GOOGLE_ENDPOINTS.issuers],
    };
  }

  const testAuthUrl = String(envObj.GOOGLE_TEST_AUTH_URL || '').trim();
  const testTokenUrl = String(envObj.GOOGLE_TEST_TOKEN_URL || '').trim();
  const testJwksUrl = String(envObj.GOOGLE_TEST_JWKS_URL || '').trim();
  const testIssuer = String(envObj.GOOGLE_TEST_ISSUER || '').trim();

  return {
    authUrl: testAuthUrl || OFFICIAL_GOOGLE_ENDPOINTS.authUrl,
    tokenUrl: testTokenUrl || OFFICIAL_GOOGLE_ENDPOINTS.tokenUrl,
    jwksUrl: testJwksUrl || OFFICIAL_GOOGLE_ENDPOINTS.jwksUrl,
    issuers: testIssuer ? [testIssuer] : [...OFFICIAL_GOOGLE_ENDPOINTS.issuers],
  };
}

function getNewMemberRestrictionHours(envObj = process.env) {
  const raw = Number.parseFloat(String((envObj && envObj.NEW_MEMBER_RESTRICTION_HOURS) ?? '24'));
  return Number.isFinite(raw) && raw >= 0 ? raw : 24;
}

function getNewMemberRestrictionMs(envObj = process.env) {
  return Math.round(getNewMemberRestrictionHours(envObj) * 60 * 60 * 1000);
}

function logGoogleStartupStatus(envObj = process.env) {
  if (!isGoogleEnabled(envObj)) {
    console.warn(
      '⚠️ [GOOGLE GİRİŞ] GOOGLE_CLIENT_ID veya GOOGLE_CLIENT_SECRET tanımlı değil; "Google ile devam et" düğmesi gizlendi.'
    );
  }
}

module.exports = {
  OFFICIAL_GOOGLE_ENDPOINTS,
  REMEMBER_COOKIE_NAME,
  REMEMBER_TTL_DAYS,
  REMEMBER_TTL_MS,
  REMEMBER_MAX_DEVICES,
  DELETE_REAUTH_MAX_AGE_MS,
  PENDING_GOOGLE_TTL_MS,
  MAX_SIGNUPS_PER_HOUR_PER_IP,
  getGoogleCredentials,
  isGoogleEnabled,
  getGoogleRedirectUri,
  getGoogleEndpoints,
  getNewMemberRestrictionHours,
  getNewMemberRestrictionMs,
  logGoogleStartupStatus,
};
