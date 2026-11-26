const appConfig = require('../config/app.config');
const gamesConfig = require('../config/games.config');
const { formatDuration, safeNonNegInt } = require('../utils/formatDuration');

const BOT_GAMES_CACHE_TTL_MS = 5 * 60 * 1000; // 5 dakika
let gamesCache = {
  games: null,
  source: null,
  expiresAt: 0,
  fetchedAt: 0,
};

function clearGamesCache() {
  gamesCache = {
    games: null,
    source: null,
    expiresAt: 0,
    fetchedAt: 0,
  };
}

// Oyun sıralaması ve sunucu özeti bellek önbelleği en fazla 60 sn tutulur
const TOP_GAMES_CACHE_TTL_MS = 60 * 1000; // 60 saniye
const topGamesCache = new Map();
const lastGoodTopGamesCache = new Map();

function clearTopGamesCache() {
  topGamesCache.clear();
  lastGoodTopGamesCache.clear();
}

const DIRECTORY_CACHE_TTL_MS = 60 * 1000; // 60 saniye
const directorySearchCache = new Map();
const directoryMemberCache = new Map();

function clearDirectoryCache() {
  directorySearchCache.clear();
  directoryMemberCache.clear();
}

const SUMMARY_CACHE_TTL_MS = 60 * 1000; // 60 saniye
let serverStatsSummaryCache = {
  payload: null,
  expiresAt: 0,
};
let lastGoodSummaryPayload = null;
let summaryBgRefreshInFlight = false;
let lastSummaryBgAttemptAt = 0;

function clearSummaryCache() {
  serverStatsSummaryCache = {
    payload: null,
    expiresAt: 0,
  };
  lastGoodSummaryPayload = null;
  lastSummaryBgAttemptAt = 0;
  lastKnownActiveStats = {
    activeThisMonth: null,
    activeRegisteredCount: null,
    playingNow: null,
    playingCount: 0,
    uncertainCount: 0,
    computedAt: null,
    legacyMode: false,
    botOnline: false,
    stale: false,
    refreshFailed: false,
    updatedAt: 0,
  };
}

/**
 * Geçici Bellek İçi (RAM) Kanıt Deposu (Disk / public/uploads kesinlikle kullanılmaz).
 * Yüklenen kanıt görseli doğrudan Bot API'ye (base64 Buffer olarak) iletilir;
 * ayrıca eski bot sürümleriyle geriye dönük uyumluluk için 5 dakika boyunca RAM'de tutulur.
 */
const ephemeralEvidenceRamStore = new Map();

/**
 * Üst şerit ve Hero için son bilinen sunucu özet istatistikleri önbelleği.
 * Bot erişilemezse son iyi veri korunur ve stale/refreshFailed bayrağı işaretlenir.
 * Henüz hiç veri alınmadıysa null döner, böylece arayüzde "👥 —" gösterilir.
 */
let lastKnownActiveStats = {
  activeThisMonth: null,
  activeRegisteredCount: null,
  playingNow: null,
  playingCount: 0,
  uncertainCount: 0,
  computedAt: null,
  legacyMode: false,
  botOnline: false,
  stale: false,
  refreshFailed: false,
  updatedAt: 0,
};

function getLastKnownActiveStats() {
  const hasActiveThisMonth = typeof lastKnownActiveStats.activeThisMonth === 'number';
  const hasLegacyActive = typeof lastKnownActiveStats.activeRegisteredCount === 'number';
  const primaryActive = hasActiveThisMonth
    ? lastKnownActiveStats.activeThisMonth
    : hasLegacyActive
      ? lastKnownActiveStats.activeRegisteredCount
      : null;

  return {
    activeThisMonth: primaryActive,
    activeRegisteredCount: primaryActive,
    playingNow:
      typeof lastKnownActiveStats.playingNow === 'number' ? lastKnownActiveStats.playingNow : null,
    playingCount:
      typeof lastKnownActiveStats.playingNow === 'number'
        ? lastKnownActiveStats.playingNow
        : safeNonNegInt(lastKnownActiveStats.playingCount, 0),
    uncertainCount: safeNonNegInt(lastKnownActiveStats.uncertainCount, 0),
    computedAt: lastKnownActiveStats.computedAt || null,
    legacyMode: Boolean(lastKnownActiveStats.legacyMode),
    botOnline: Boolean(lastKnownActiveStats.botOnline),
    stale: Boolean(lastKnownActiveStats.stale),
    refreshFailed: Boolean(lastKnownActiveStats.refreshFailed),
  };
}

function updateActiveStatsCache(summaryOrCount, online = true) {
  if (summaryOrCount && typeof summaryOrCount === 'object') {
    const activeVal =
      typeof summaryOrCount.activeThisMonth === 'number' && Number.isFinite(summaryOrCount.activeThisMonth)
        ? Math.max(0, Math.floor(summaryOrCount.activeThisMonth))
        : typeof summaryOrCount.activeRegisteredCount === 'number' && Number.isFinite(summaryOrCount.activeRegisteredCount)
          ? Math.max(0, Math.floor(summaryOrCount.activeRegisteredCount))
          : null;
    const playingVal =
      typeof summaryOrCount.playingNow === 'number' && Number.isFinite(summaryOrCount.playingNow)
        ? Math.max(0, Math.floor(summaryOrCount.playingNow))
        : typeof summaryOrCount.playingCount === 'number' && Number.isFinite(summaryOrCount.playingCount)
          ? Math.max(0, Math.floor(summaryOrCount.playingCount))
          : null;
    lastKnownActiveStats = {
      activeThisMonth: activeVal,
      activeRegisteredCount: activeVal,
      playingNow: playingVal,
      playingCount: playingVal !== null ? playingVal : 0,
      uncertainCount: safeNonNegInt(summaryOrCount.uncertainCount, 0),
      computedAt:
        typeof summaryOrCount.computedAt === 'string' && summaryOrCount.computedAt
          ? summaryOrCount.computedAt
          : null,
      legacyMode: Boolean(summaryOrCount.legacyMode),
      botOnline: Boolean(online),
      stale: Boolean(summaryOrCount.stale),
      refreshFailed: Boolean(summaryOrCount.refreshFailed),
      updatedAt: Date.now(),
    };
    return;
  }

  const numericCount =
    typeof summaryOrCount === 'number' && Number.isFinite(summaryOrCount)
      ? Math.max(0, Math.floor(summaryOrCount))
      : null;
  lastKnownActiveStats = {
    ...lastKnownActiveStats,
    activeThisMonth: numericCount,
    activeRegisteredCount: numericCount,
    botOnline: Boolean(online),
    stale: !online,
    refreshFailed: !online,
    updatedAt: Date.now(),
  };
}

/**
 * Geçici bot erişim hatalarında son bilinen iyi veriyi SİLMEDEN yalnızca çevrimdışı/bayat işaretler.
 */
function markActiveStatsOffline() {
  lastKnownActiveStats = {
    ...lastKnownActiveStats,
    botOnline: false,
    stale: true,
    refreshFailed: true,
  };
}

function storeEphemeralEvidence(fileName, buffer, mimeType) {
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 dakika
  ephemeralEvidenceRamStore.set(fileName, { buffer, mimeType, expiresAt });

  // Süresi dolanları temizle
  for (const [key, val] of ephemeralEvidenceRamStore.entries()) {
    if (val.expiresAt <= Date.now()) {
      ephemeralEvidenceRamStore.delete(key);
    }
  }
}

function getEphemeralEvidence(fileName) {
  const item = ephemeralEvidenceRamStore.get(fileName);
  if (!item) return null;
  if (item.expiresAt <= Date.now()) {
    ephemeralEvidenceRamStore.delete(fileName);
    return null;
  }
  return item;
}

/**
 * Bot API'den dönen veya bağlantı koptuğunda oluşan hataları net sınıflandıran özel hata sınıfı.
 */
class BotApiError extends Error {
  /**
   * @param {string} message - Kullanıcı dostu hata açıklaması
   * @param {number} statusCode - HTTP durum kodu (503 = erişilemiyor, 504 = timeout vb.)
   * @param {boolean} isOffline - Bot API'ye ağ düzeyinde ulaşılamıyor mu?
   * @param {string} errorCategory - Hata sınıfı (TIMEOUT | NETWORK_UNREACHABLE | AUTH_SECRET_MISMATCH | FORBIDDEN_HIERARCHY | NOT_FOUND | VALIDATION_ERROR | RATE_LIMITED | BOT_INTERNAL_ERROR)
   * @param {object} [details] - Ek hata verisi
   */
  constructor(message, statusCode = 500, isOffline = false, errorCategory = 'BOT_INTERNAL_ERROR', details = null) {
    super(message);
    this.name = 'BotApiError';
    this.statusCode = statusCode;
    this.isOffline = isOffline;
    this.errorCategory = errorCategory;
    this.details = details;
  }
}

/**
 * HTTP durum koduna göre net hata sınıflaması yapar.
 */
function classifyHttpStatus(status) {
  if (status === 401) return 'AUTH_SECRET_MISMATCH';
  if (status === 403) return 'FORBIDDEN_HIERARCHY';
  if (status === 404) return 'NOT_FOUND';
  if (status === 400 || status === 422) return 'VALIDATION_ERROR';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 504) return 'TIMEOUT';
  if (status === 502 || status === 503) return 'NETWORK_UNREACHABLE';
  return 'BOT_INTERNAL_ERROR';
}

/**
 * Geçici ağ hatası veya zaman aşımı durumunda yeniden denenip denenmeyeceğini belirler.
 */
function isRetryableError(err) {
  if (!err) return false;
  if (err.isOffline) return true;
  if (err.errorCategory === 'TIMEOUT' || err.errorCategory === 'NETWORK_UNREACHABLE') return true;
  if (err.statusCode === 502 || err.statusCode === 503 || err.statusCode === 504) return true;
  return false;
}

/**
 * Tek bir HTTP isteğini 8 saniye zaman aşımı ile çalıştırır.
 */
async function executeSingleRequest(endpoint, options = {}) {
  const url = `${appConfig.BOT_API_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  const timeoutMs =
    typeof options.timeoutMs === 'number' && options.timeoutMs > 0
      ? options.timeoutMs
      : appConfig.API_TIMEOUT_MS || 8000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${appConfig.API_SECRET}`,
    ...(options.headers || {}),
  };

  const fetchOptions = {
    method: options.method || 'GET',
    headers,
    signal: controller.signal,
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    fetchOptions.body = JSON.stringify(options.body);
  }

  try {
    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);

    let data = null;
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const isJson = contentType.includes('application/json');

    if (isJson) {
      data = await response.json().catch(() => null);
    } else {
      const text = await response.text().catch(() => '');
      data = { error: text ? text.slice(0, 200) : `HTTP ${response.status}` };
    }

    if (!response.ok) {
      const rawErrorMsg = String((data && (data.error || data.message)) || `Bot API Hatası (HTTP ${response.status})`);
      const isRailwayAppNotFound = /application not found|failed to respond|bad gateway|service unavailable/i.test(rawErrorMsg);
      const isMemberLookupEndpoint =
        endpoint.startsWith('/api/member/') || /^\/api\/admin\/members\/[^/?]+/.test(endpoint);
      const isVersionedFeatureEndpoint =
        endpoint === '/api/games' ||
        endpoint.startsWith('/api/roblox/lookup') ||
        endpoint.startsWith('/api/roblox/site-claims/') ||
        endpoint === '/api/roblox/avatars' ||
        endpoint === '/api/register' ||
        endpoint.startsWith('/api/register/status/') ||
        endpoint.startsWith('/api/stats/top-games') ||
        endpoint === '/api/stats/summary' ||
        endpoint === '/api/directory' ||
        endpoint.startsWith('/api/directory?') ||
        endpoint === '/api/directory/lookup' ||
        (/^\/api\/member\/[^/?]+\/activity\b/.test(endpoint) && /Endpoint bulunamadı|Cannot GET/i.test(rawErrorMsg));

      // 1) 401 Yetki Hatası (API_SECRET Uyuşmazlığı)
      if (response.status === 401) {
        markActiveStatsOffline();
        throw new BotApiError(
          'Bot API yetki hatası (HTTP 401): Site ile Bot servisindeki API_SECRET şifreleri birbiriyle uyuşmuyor.',
          401,
          true,
          'AUTH_SECRET_MISMATCH',
          { status: 401 }
        );
      }

      // 1.5) Yeni kayıt/oyun uç noktalarında bot henüz güncellenmemişse JSON 404'ü çevrimdışı sayma
      if (response.status === 404 && isJson && !isRailwayAppNotFound && isVersionedFeatureEndpoint) {
        throw new BotApiError(
          rawErrorMsg,
          404,
          false,
          'ENDPOINT_MISSING',
          data
        );
      }

      // 2) Railway Proxy 404 ("Application not found") veya üye araması dışındaki 404'ler veya JSON olmayan yanıtlar
      if (
        (response.status === 404 && (isRailwayAppNotFound || !isMemberLookupEndpoint || !isJson)) ||
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504 ||
        response.status >= 520
      ) {
        markActiveStatsOffline();
        const category =
          response.status === 504
            ? 'TIMEOUT'
            : response.status === 404
            ? 'ENDPOINT_NOT_FOUND'
            : 'NETWORK_UNREACHABLE';
        const friendlyMsg =
          response.status === 404
            ? 'Bot API uç noktasına ulaşılamadı (HTTP 404). Bot servisi kapalı olabilir, portu açık olmayabilir veya BOT_API_URL yanlış adrese işaret ediyor.'
            : rawErrorMsg;
        throw new BotApiError(friendlyMsg, response.status, true, category, data);
      }

      const category = classifyHttpStatus(response.status);
      throw new BotApiError(rawErrorMsg, response.status, false, category, data);
    }

    // Yanıt 200 OK olsa bile JSON değilse (örneğin BOT_API_URL yanlışlıkla bir HTML web sayfasına ayarlandıysa)
    if (!isJson || data === null || typeof data !== 'object') {
      markActiveStatsOffline();
      throw new BotApiError(
        'Bot API geçerli bir JSON yanıtı döndürmedi (HTML sayfası döndü). BOT_API_URL yanlış bir adrese ayarlanmış olabilir.',
        503,
        true,
        'NON_JSON_RESPONSE'
      );
    }

    return data;
  } catch (err) {
    clearTimeout(timeoutId);

    if (err instanceof BotApiError) {
      throw err;
    }

    markActiveStatsOffline();

    if (err.name === 'AbortError') {
      throw new BotApiError(
        `Bot API yanıt vermedi (${Math.round(timeoutMs / 1000)} sn zaman aşımı). Lütfen daha sonra tekrar deneyin.`,
        504,
        true,
        'TIMEOUT'
      );
    }

    throw new BotApiError(
      'Bot API servisine şu anda ulaşılamıyor. Bot çevrimdışı olabilir veya BOT_API_URL bağlantısı hatalı.',
      503,
      true,
      'NETWORK_UNREACHABLE',
      { originalError: err.message }
    );
  }
}

/**
 * Bot REST API'sine güvenli, 8 sn zaman aşımlı ve 1 kez otomatik yeniden denemeli (retry) HTTP isteği gönderir.
 *
 * @param {string} endpoint - Örn: "/api/health"
 * @param {object} [options] - method, body, headers, retries (varsayılan: 1)
 */
async function requestBotApi(endpoint, options = {}) {
  const maxRetries = options.retries !== undefined ? options.retries : 1;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await executeSingleRequest(endpoint, options);
    } catch (err) {
      lastError = err;
      const shouldRetry = attempt < maxRetries && isRetryableError(err);
      if (!shouldRetry) {
        throw err;
      }
      // Kısa bekleme (250ms) sonrası tek yeniden deneme
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw lastError;
}

// ============================================================================
// 1. SİSTEM & SAĞLIK KONTROLÜ
// ============================================================================

async function checkHealth() {
  return requestBotApi('/api/health', { method: 'GET' });
}

/**
 * Madde 2 & 3: /health uç noktası ve açılış testi için Bot API erişilebilirliğini kontrol eder.
 * Asla secret değerlerini döndürmez. Sonucu "ulaşıldı", "ulaşılamadı" veya "yetki hatası (API_SECRET uyuşmuyor)" olarak sınıflandırır.
 */
async function probeBotApiStatus() {
  const startMs = Date.now();
  try {
    const data = await requestBotApi('/api/health', { method: 'GET', retries: 0 });
    if (!data || data.status !== 'ok') {
      const latencyMs = Date.now() - startMs;
      return {
        reachable: false,
        statusText: 'ulaşılamadı',
        category: 'UNEXPECTED_RESPONSE',
        httpStatus: 200,
        latencyMs,
        explanation: 'Bot API yanıt verdi ancak beklenen sağlık durumunu (status: ok) döndürmedi.',
      };
    }

    // /api/health şifresiz olabileceği için API_SECRET doğrulamasını korumalı /api/stats/summary üzerinden de test et
    try {
      const summaryData = await requestBotApi('/api/stats/summary', { method: 'GET', retries: 0 });
      const normalized = normalizeServerStatsSummaryPayload(summaryData, Date.now());
      if (normalized) {
        updateActiveStatsCache(normalized, true);
        lastGoodSummaryPayload = normalized;
        serverStatsSummaryCache = {
          payload: normalized,
          expiresAt: Date.now() + SUMMARY_CACHE_TTL_MS,
        };
      }
    } catch (summaryErr) {
      // Bot henüz /api/stats/summary güncellemesini almadıysa (404 ENDPOINT_MISSING) /api/games ile API_SECRET'ı doğrula
      if (summaryErr && (summaryErr.errorCategory === 'ENDPOINT_MISSING' || summaryErr.statusCode === 404)) {
        await requestBotApi('/api/games', { method: 'GET', retries: 0 });
      } else {
        throw summaryErr;
      }
    }

    const latencyMs = Date.now() - startMs;
    return {
      reachable: true,
      statusText: 'ulaşıldı',
      category: 'OK',
      httpStatus: 200,
      latencyMs,
      explanation: 'Bot REST API servisine ve korumalı uç noktasına başarıyla ulaşıldı.',
    };
  } catch (err) {
    const latencyMs = Date.now() - startMs;
    const category = err.errorCategory || 'NETWORK_UNREACHABLE';
    const isAuthMismatch = category === 'AUTH_SECRET_MISMATCH' || err.statusCode === 401 || err.statusCode === 403;

    if (isAuthMismatch) {
      return {
        reachable: false,
        statusText: 'yetki hatası (API_SECRET uyuşmuyor)',
        category: 'AUTH_SECRET_MISMATCH',
        httpStatus: err.statusCode || 401,
        latencyMs,
        explanation: 'Bot API servisine ulaşıldı ancak Site ile Bot arasındaki API_SECRET şifreleri uyuşmuyor.',
      };
    }

    return {
      reachable: false,
      statusText: 'ulaşılamadı',
      category,
      httpStatus: err.statusCode || 503,
      latencyMs,
      explanation: err.message || 'Bot API servisine erişilemedi.',
    };
  }
}

/**
 * Madde 3: Uygulama açılışında BOT_API_URL'e bir kez test isteği atar ve sonucu Railway loglarına yazar.
 */
async function runStartupConnectivityTest() {
  const result = await probeBotApiStatus();
  if (result.reachable) {
    console.log(
      `✅ [BOT API AÇILIŞ TESTİ: BAŞARILI] Durum: ${result.statusText} | Sebep Sınıfı: ${result.category} | Süre: ${result.latencyMs}ms`
    );
    // Açılışta aktif üye sayısını da bir kez ısıt (başarısız olursa sessiz geç)
    await getServerStatsSummary({ timeoutMs: 2500 }).catch(() => null);
  } else {
    console.error(
      `❌ [BOT API AÇILIŞ TESTİ: BAŞARISIZ] Durum: ${result.statusText} | Sebep Sınıfı: ${result.category} (HTTP ${result.httpStatus}) | Açıklama: ${result.explanation}`
    );
  }
  return result;
}

// ============================================================================
// 2. ÜYE VE ROL SORGULARI
// ============================================================================

function sanitizeHttpUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 500) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function getKnownGamesLookupMap() {
  const activeList =
    gamesCache && Array.isArray(gamesCache.games) && gamesCache.games.length > 0
      ? gamesCache.games
      : gamesConfig.getGamesConfig();
  const map = new Map();
  for (const g of activeList) {
    if (g && g.id) map.set(String(g.id).toLowerCase(), g);
  }
  return map;
}

function sanitizeRegistrationGames(rawGames) {
  if (!Array.isArray(rawGames)) return [];
  const lookupMap = getKnownGamesLookupMap();
  const seen = new Set();
  const list = [];

  for (const entry of rawGames) {
    if (!entry || typeof entry !== 'object') continue;
    const id = typeof entry.id === 'string' ? entry.id.trim().toLowerCase() : '';
    const username = typeof entry.username === 'string' ? entry.username.trim() : '';
    if (!id || !username || seen.has(id)) continue;
    seen.add(id);

    const catalogItem = lookupMap.get(id) || gamesConfig.getFallbackGameById(id);
    const emoji =
      typeof entry.emoji === 'string' && entry.emoji.trim()
        ? entry.emoji.trim()
        : (catalogItem && catalogItem.emoji) || '🎮';

    let nameObj;
    if (entry.name && typeof entry.name === 'object') {
      nameObj = {
        tr: String(entry.name.tr || entry.name.en || (catalogItem && catalogItem.name.tr) || id).trim(),
        en: String(entry.name.en || entry.name.tr || (catalogItem && catalogItem.name.en) || id).trim(),
      };
    } else if (typeof entry.name === 'string' && entry.name.trim()) {
      const cleanName = entry.name.trim();
      nameObj = { tr: cleanName, en: cleanName };
    } else if (catalogItem && catalogItem.name) {
      nameObj = { ...catalogItem.name };
    } else {
      nameObj = { tr: id.toUpperCase(), en: id.toUpperCase() };
    }

    const profileUrl = sanitizeHttpUrl(entry.profileUrl);

    list.push({
      id,
      emoji,
      name: nameObj,
      username,
      profileUrl,
    });
  }

  return list;
}

/**
 * Bot yanıtındaki kayıt nesnesini güvenli varsayılanlarla normalize eder.
 * Eski klan alanlarını (type, registrationType, clan, clanName) sessizce yok sayar.
 */
function sanitizeRegistrationRecord(reg) {
  if (!reg || typeof reg !== 'object') {
    return { registered: false, games: [], hasGames: false };
  }
  const games = sanitizeRegistrationGames(reg.games);
  const robloxGame = games.find((g) => g.id === 'roblox') || null;
  const displayRealName = reg.name || reg.realName || null;
  const robloxProfileUrl =
    sanitizeHttpUrl(reg.robloxProfileUrl) ||
    (robloxGame && robloxGame.profileUrl) ||
    null;

  const hasAnyInfo = Boolean(
    games.length > 0 ||
    displayRealName ||
    reg.robloxUsername ||
    reg.robloxId
  );

  return {
    registered: typeof reg.registered === 'boolean' ? reg.registered : hasAnyInfo,
    name: displayRealName,
    realName: reg.realName || reg.name || null,
    displayName: reg.displayName || null,
    gender: reg.gender || null,
    games,
    hasGames: games.length > 0,
    robloxUsername: reg.robloxUsername || (robloxGame ? robloxGame.username : null),
    robloxDisplayName: reg.robloxDisplayName || null,
    robloxId: reg.robloxId || null,
    robloxProfileUrl,
    registeredAt: reg.registeredAt || null,
  };
}

async function getMemberRoles(discordId) {
  const data = await requestBotApi(`/api/member/${encodeURIComponent(discordId)}/roles`, {
    method: 'GET',
  });

  if (data) {
    if (typeof data.highestRolePosition !== 'number') {
      const roles = Array.isArray(data.roles) ? data.roles : [];
      data.highestRolePosition = roles.reduce((max, r) => Math.max(max, Number(r.position) || 0), 0);
    }
    if (typeof data.registered !== 'boolean') {
      data.registered = undefined;
    }
    delete data.registrationType;
    delete data.clan;
  }

  return data;
}

async function getMemberProfile(discordId) {
  const raw = await requestBotApi(`/api/member/${encodeURIComponent(discordId)}/profile`, {
    method: 'GET',
  });

  const data = raw && typeof raw === 'object' ? { ...raw } : {};
  const discordObj = data.discord && typeof data.discord === 'object' ? data.discord : {};
  const resolvedDisplayName =
    data.displayName || discordObj.displayName || discordObj.username || String(discordId);

  data.displayName = resolvedDisplayName;
  data.discord = {
    id: discordObj.id || String(discordId),
    username: discordObj.username || '-',
    displayName: discordObj.displayName || resolvedDisplayName,
    avatarUrl: sanitizeHttpUrl(discordObj.avatarUrl) || 'https://cdn.discordapp.com/embed/avatars/0.png',
    level: discordObj.level || 'registered',
  };
  data.registration = sanitizeRegistrationRecord(data.registration);
  const warningsObj = data.warnings && typeof data.warnings === 'object' ? data.warnings : {};
  data.warnings = {
    points: Number(warningsObj.points) || 0,
    tier: Number(warningsObj.tier) || 0,
    staffWarnings: Number(warningsObj.staffWarnings) || 0,
    totalWarnings: Number(warningsObj.totalWarnings) || 0,
    suspendedUntil: warningsObj.suspendedUntil || null,
  };

  // Eski bot sürümlerinden gelebilecek klan/tryout/VS alanlarını sessizce yok say
  delete data.tryout;
  delete data.vs;
  delete data.registrationType;
  delete data.clan;

  return data;
}

function sanitizeFormattedDuration(rawStr, seconds, lang = 'tr') {
  if (
    typeof rawStr === 'string' &&
    rawStr.trim() &&
    !/\b(NaN|Infinity|undefined)\b/i.test(rawStr)
  ) {
    return rawStr.trim().slice(0, 64);
  }
  return formatDuration(seconds, lang);
}

function sanitizeBreakdown(rawBreakdown, lang = 'tr') {
  if (!rawBreakdown || typeof rawBreakdown !== 'object') return null;
  const rawItems = Array.isArray(rawBreakdown.items) ? rawBreakdown.items : [];
  const items = rawItems
    .filter((it) => it && typeof it === 'object' && (it.name || it.id))
    .slice(0, 5)
    .map((it) => {
      const sec = safeNonNegInt(it.seconds, 0);
      return {
        id: String(it.id || it.name).trim().slice(0, 48),
        name: String(it.name || it.id).trim().slice(0, 80),
        seconds: sec,
        formattedDuration: sanitizeFormattedDuration(it.formattedDuration, sec, lang),
      };
    });
  const overflowCount = safeNonNegInt(rawBreakdown.overflowCount, 0);
  const rawLine =
    typeof rawBreakdown.formattedLine === 'string' &&
    rawBreakdown.formattedLine.trim() &&
    !/\b(NaN|Infinity|undefined)\b/i.test(rawBreakdown.formattedLine)
      ? rawBreakdown.formattedLine.trim().slice(0, 260)
      : '';
  const formattedLine = rawLine;
  if (!formattedLine && items.length === 0) return null;
  return { items, overflowCount, formattedLine };
}

/**
 * Üyenin kişisel aylık oyun etkinliği özetini (/api/member/:id/activity) getirir ve güvenli şekilde normalize eder.
 * Roblox aile gruplaması tamamen bot tarafından yapılır; site kendi oyun listesi tutmaz.
 */
async function getMemberActivity(discordId, lang = 'tr') {
  const cleanLang = lang === 'en' ? 'en' : 'tr';
  const raw = await requestBotApi(
    `/api/member/${encodeURIComponent(discordId)}/activity?lang=${cleanLang}`,
    {
      method: 'GET',
      retries: 1,
    }
  );

  const data = raw && typeof raw === 'object' ? raw : {};
  const tracking = data.tracking !== false;
  const month = typeof data.month === 'string' && /^\d{4}-\d{2}$/.test(data.month) ? data.month : '';
  const nextResetAt =
    typeof data.nextResetAt === 'number' && Number.isFinite(data.nextResetAt) && data.nextResetAt > 0
      ? data.nextResetAt
      : typeof data.nextResetUnix === 'number' && Number.isFinite(data.nextResetUnix) && data.nextResetUnix > 0
        ? data.nextResetUnix * 1000
        : null;

  if (!tracking) {
    return {
      userId: String(data.userId || discordId),
      month,
      tracking: false,
      games: [],
      families: [],
      totalSeconds: 0,
      live: null,
      nextResetAt,
    };
  }

  // Yeni bot families veya eski bot games alanını sessizce destekle
  const sourceList =
    Array.isArray(data.families) && data.families.length > 0
      ? data.families.map((f) => ({
          id: f.key,
          name: f.label,
          emoji: f.emoji,
          family: f.key,
          seconds: f.totalSeconds,
          percent: f.percent,
          rank: f.rank,
          formattedDuration: f.formattedDuration,
          breakdown: f.breakdown,
        }))
      : Array.isArray(data.games)
        ? data.games
        : [];

  const normalizedGames = sourceList
    .filter((g) => g && typeof g === 'object' && (g.id || g.key) && Number.isFinite(Number(g.seconds)) && Number(g.seconds) > 0)
    .map((g, idx) => {
      const sec = safeNonNegInt(g.seconds, 0);
      const breakdown = sanitizeBreakdown(g.breakdown, cleanLang);
      return {
        id: String(g.id || g.key).trim().slice(0, 48),
        name: String(g.name || g.label || g.id || g.key).trim().slice(0, 96),
        emoji: String(g.emoji || '🎮').trim().slice(0, 16),
        family: g.family ? String(g.family).trim().slice(0, 32) : null,
        seconds: sec,
        percent: Math.min(100, safeNonNegInt(Math.round(Number(g.percent) || 0), 0)),
        rank: safeNonNegInt(g.rank, idx + 1) || idx + 1,
        formattedDuration: sanitizeFormattedDuration(g.formattedDuration, sec, cleanLang),
        ...(breakdown ? { breakdown } : {}),
      };
    })
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 10);

  const computedTotal = normalizedGames.reduce((sum, g) => sum + g.seconds, 0);
  const totalSeconds =
    typeof data.totalSeconds === 'number' && Number.isFinite(data.totalSeconds) && data.totalSeconds >= computedTotal
      ? Math.floor(data.totalSeconds)
      : computedTotal;

  if (totalSeconds > 0) {
    for (const g of normalizedGames) {
      if (!g.percent) {
        g.percent = Math.min(100, Math.max(0, Math.round((g.seconds / totalSeconds) * 100)));
      }
    }
  }

  let live = null;
  if (data.live && typeof data.live === 'object' && data.live.gameId) {
    const liveSec = safeNonNegInt(data.live.sessionElapsedSec, 0);
    live = {
      gameId: String(data.live.gameId).trim().slice(0, 48),
      name: String(data.live.name || data.live.gameId).trim().slice(0, 96),
      emoji: String(data.live.emoji || '🎮').trim().slice(0, 16),
      family: data.live.family ? String(data.live.family).trim().slice(0, 32) : null,
      sessionElapsedSec: liveSec,
      formattedDuration: sanitizeFormattedDuration(data.live.formattedDuration, liveSec, cleanLang),
    };
  }

  return {
    userId: String(data.userId || discordId),
    month,
    tracking: true,
    games: normalizedGames,
    families: normalizedGames.map((g, idx) => ({
      key: g.id,
      label: g.name,
      emoji: g.emoji,
      totalSeconds: g.seconds,
      uniquePlayers: 1,
      rank: g.rank || idx + 1,
      percent: g.percent,
      formattedDuration: g.formattedDuration,
      ...(g.breakdown ? { breakdown: g.breakdown } : {}),
    })),
    totalSeconds,
    live,
    nextResetAt,
  };
}

/**
 * Bot yanıtındaki families (yeni bot) veya games (eski bot) dizisini tek biçime normalize eder.
 * Site kendi oyun/aile listesini TUTMAZ; botun verdiği gruplanmış veriyi doğrudan gösterir.
 */
function normalizeTopGamesEntries(data, cleanLang, cleanLimit) {
  const hasNewFamilies = Array.isArray(data?.families);
  const rawList = hasNewFamilies
    ? data.families.map((f, idx) => ({
        id: f?.key,
        name: f?.label,
        emoji: f?.emoji,
        family: f?.key,
        seconds: f?.totalSeconds,
        hours: f?.hours,
        percent: f?.percent,
        players: f?.uniquePlayers,
        rank: f?.rank || idx + 1,
        formattedDuration: f?.formattedDuration,
        breakdown: f?.breakdown,
      }))
    : Array.isArray(data?.games)
      ? data.games
      : [];

  const normalized = rawList
    .filter((g) => g && typeof g === 'object' && g.id && Number.isFinite(Number(g.seconds)) && Number(g.seconds) > 0)
    .map((g, idx) => {
      const seconds = safeNonNegInt(g.seconds, 0);
      const hours =
        typeof g.hours === 'number' && Number.isFinite(g.hours) && g.hours >= 0
          ? Number(g.hours.toFixed(1))
          : Number((seconds / 3600).toFixed(1));
      const breakdown = sanitizeBreakdown(g.breakdown, cleanLang);
      return {
        id: String(g.id).trim().slice(0, 48),
        name: String(g.name || g.id).trim().slice(0, 96),
        emoji: String(g.emoji || '🎮').trim().slice(0, 16),
        family: g.family ? String(g.family).trim().slice(0, 32) : null,
        seconds,
        hours,
        percent: Math.min(100, safeNonNegInt(Math.round(Number(g.percent) || 0), 0)),
        players: safeNonNegInt(g.players, 0),
        rank: safeNonNegInt(g.rank, idx + 1) || idx + 1,
        formattedDuration: sanitizeFormattedDuration(g.formattedDuration, seconds, cleanLang),
        ...(breakdown ? { breakdown } : {}),
      };
    })
    .sort((a, b) => b.seconds - a.seconds || b.players - a.players)
    .slice(0, cleanLimit)
    .map((g, idx) => ({ ...g, rank: idx + 1 }));

  return { normalized, hasNewFamilies };
}

/**
 * Sunucuda en çok oynanan oyunların anonim sıralamasını (/api/stats/top-games) getirir.
 * En fazla 60 sn bellek önbelleği + bot çevrimdışı/bozuk yanıt durumunda son iyi veriyi
 * ("veri güncellenemedi" bayrağıyla) çökmeden gösterir.
 */
async function getTopGames(options = {}) {
  const cleanScope = options.scope === 'all' ? 'all' : 'month';
  const cleanGroup = options.group === 'game' ? 'game' : 'family';
  const cleanLang = options.lang === 'en' ? 'en' : 'tr';
  const rawLimit = Number.parseInt(String(options.limit ?? 8), 10);
  const cleanLimit = Number.isFinite(rawLimit) ? Math.min(12, Math.max(1, rawLimit)) : 8;
  const forceRefresh = Boolean(options.forceRefresh);
  const timeoutMs =
    typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : undefined;

  const cacheKey = `${cleanScope}:${cleanGroup}:${cleanLang}:${cleanLimit}`;
  const now = Date.now();
  const cached = topGamesCache.get(cacheKey);

  if (!forceRefresh && cached && cached.expiresAt > now) {
    return {
      ...cached.payload,
      cached: true,
      stale: false,
      refreshFailed: false,
    };
  }

  try {
    const query = `scope=${cleanScope}&group=${cleanGroup}&lang=${cleanLang}&limit=${cleanLimit}`;
    const raw = await requestBotApi(`/api/stats/top-games?${query}`, {
      method: 'GET',
      retries: timeoutMs ? 0 : 1,
      timeoutMs,
    });

    if (!raw || typeof raw !== 'object' || (!Array.isArray(raw.families) && !Array.isArray(raw.games))) {
      throw new BotApiError('Bot API geçersiz oyun sıralaması yanıtı döndürdü.', 502, true, 'INVALID_PAYLOAD');
    }

    const { normalized: normalizedGames, hasNewFamilies } = normalizeTopGamesEntries(raw, cleanLang, cleanLimit);

    const computedTotal = normalizedGames.reduce((sum, g) => sum + g.seconds, 0);
    const totalSeconds =
      typeof raw.totalSeconds === 'number' && Number.isFinite(raw.totalSeconds) && raw.totalSeconds >= computedTotal
        ? Math.floor(raw.totalSeconds)
        : computedTotal;

    if (totalSeconds > 0) {
      for (const g of normalizedGames) {
        if (!g.percent) {
          g.percent = Math.min(100, Math.max(0, Math.round((g.seconds / totalSeconds) * 100)));
        }
      }
    }

    const updatedAt =
      typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) && raw.updatedAt > 0
        ? raw.updatedAt
        : now;
    const computedAt =
      typeof raw.computedAt === 'string' && Number.isFinite(Date.parse(raw.computedAt))
        ? raw.computedAt
        : new Date(updatedAt).toISOString();

    const families = normalizedGames.map((g) => ({
      key: g.id,
      label: g.name,
      emoji: g.emoji,
      totalSeconds: g.seconds,
      uniquePlayers: g.players,
      rank: g.rank,
      percent: g.percent,
      hours: g.hours,
      formattedDuration: g.formattedDuration,
      ...(g.breakdown ? { breakdown: g.breakdown } : {}),
    }));

    const payload = {
      scope: cleanScope,
      group: cleanGroup,
      month: typeof raw.month === 'string' ? raw.month : '',
      since:
        typeof raw.since === 'number' && Number.isFinite(raw.since) && raw.since > 0 ? raw.since : null,
      updatedAt,
      computedAt,
      totalSeconds,
      families,
      games: normalizedGames,
      legacyMode: !hasNewFamilies,
      stale: false,
      refreshFailed: false,
      preparing: false,
      offline: false,
    };

    topGamesCache.set(cacheKey, {
      payload,
      expiresAt: now + TOP_GAMES_CACHE_TTL_MS,
      fetchedAt: now,
    });
    lastGoodTopGamesCache.set(cacheKey, payload);

    return payload;
  } catch (err) {
    const lastGood = lastGoodTopGamesCache.get(cacheKey);
    if (lastGood) {
      return {
        ...lastGood,
        stale: true,
        refreshFailed: true,
        offline: true,
      };
    }

    const isEndpointMissing =
      err && (err.errorCategory === 'ENDPOINT_MISSING' || err.statusCode === 404);

    return {
      scope: cleanScope,
      group: cleanGroup,
      month: '',
      since: null,
      updatedAt: now,
      computedAt: null,
      totalSeconds: 0,
      families: [],
      games: [],
      legacyMode: false,
      stale: !isEndpointMissing,
      refreshFailed: !isEndpointMissing,
      preparing: Boolean(isEndpointMissing),
      offline: !isEndpointMissing,
    };
  }
}

// ============================================================================
// 3. KAYIT VE OYUN SİSTEMİ
// ============================================================================

async function getGames(options = {}) {
  const forceRefresh = Boolean(options && options.forceRefresh);
  const now = Date.now();

  if (!forceRefresh && gamesCache.games && gamesCache.expiresAt > now) {
    return {
      games: gamesCache.games,
      source: gamesCache.source || 'bot',
      cached: true,
    };
  }

  const reqHeaders = {};
  if (options && options.actorType) reqHeaders['X-Actor-Type'] = String(options.actorType);
  if (options && options.actorId) reqHeaders['X-Actor-Id'] = String(options.actorId);

  try {
    const data = await requestBotApi('/api/games', {
      method: 'GET',
      headers: reqHeaders,
      retries: 0,
    });

    if (
      data &&
      Array.isArray(data.games) &&
      data.games.length > 0 &&
      data.games.some((item) => item && typeof item.id === 'string' && item.name)
    ) {
      const normalized = gamesConfig.normalizeGamesList(data.games);
      gamesCache = {
        games: normalized,
        source: 'bot',
        expiresAt: Date.now() + BOT_GAMES_CACHE_TTL_MS,
        fetchedAt: Date.now(),
      };
      return {
        games: normalized,
        source: 'bot',
        cached: false,
      };
    }
  } catch {
    // Bot erişilemez veya eski sürümdeyse sessizce yedek oyun listesine düş
  }

  return {
    games: gamesConfig.getGamesConfig(),
    source: 'fallback',
    cached: false,
  };
}

async function lookupRobloxAccount(query, options = {}) {
  const cleanQuery = typeof query === 'string' ? query.trim() : '';
  if (!cleanQuery) {
    return {
      status: 'NOT_FOUND',
      user: null,
      alreadyRegistered: false,
    };
  }

  const params = new URLSearchParams({ query: cleanQuery });
  if (options && options.ignoreOwnerRef) {
    params.set('ignoreOwnerRef', String(options.ignoreOwnerRef).trim());
  }

  const headers = {};
  if (options && options.actorType) {
    headers['X-Actor-Type'] = String(options.actorType);
  }
  if (options && options.actorId) {
    headers['X-Actor-Id'] = String(options.actorId);
  }

  try {
    const data = await requestBotApi(`/api/roblox/lookup?${params.toString()}`, {
      method: 'GET',
      headers,
      retries: 0,
    });

    const rawStatus = data && typeof data.status === 'string' ? data.status.trim().toUpperCase() : '';
    const allowedStatuses = new Set(['FOUND', 'NOT_FOUND', 'BANNED', 'TEMPORARY_ERROR']);
    const status = allowedStatuses.has(rawStatus) ? rawStatus : 'TEMPORARY_ERROR';

    let user = null;
    if (status === 'FOUND' && data.user && typeof data.user === 'object') {
      const uname = typeof data.user.name === 'string' ? data.user.name.trim() : '';
      user = {
        id: data.user.id !== undefined && data.user.id !== null ? String(data.user.id) : null,
        name: uname || cleanQuery,
        displayName:
          typeof data.user.displayName === 'string' && data.user.displayName.trim()
            ? data.user.displayName.trim()
            : uname || cleanQuery,
        profileUrl: sanitizeHttpUrl(data.user.profileUrl),
        avatarUrl: sanitizeHttpUrl(data.user.avatarUrl),
      };
    }

    return {
      status,
      user,
      alreadyRegistered: Boolean(data && data.alreadyRegistered),
    };
  } catch (err) {
    if (err instanceof BotApiError && err.errorCategory === 'ENDPOINT_MISSING') {
      return {
        status: 'TEMPORARY_ERROR',
        user: null,
        alreadyRegistered: false,
        incompatibleBot: true,
      };
    }
    return {
      status: 'TEMPORARY_ERROR',
      user: null,
      alreadyRegistered: false,
      offline: Boolean(err && err.isOffline),
      rateLimited: Boolean(err && err.statusCode === 429),
    };
  }
}

/**
 * Bot API'de Google site üyesi için Roblox ID benzersizlik sahiplenmesi (site-service aktörü).
 * 409 dönerse { ok: false, conflict: true, code: 'ROBLOX_ALREADY_REGISTERED' } döner.
 * Bot kapalıysa/ulaşılamazsa hata fırlatır (üyelik oluşturulmaz!).
 */
async function claimSiteRobloxId(robloxId, ownerRef) {
  try {
    const data = await requestBotApi(`/api/roblox/site-claims/${encodeURIComponent(String(robloxId))}`, {
      method: 'PUT',
      headers: {
        'X-Actor-Type': 'site-service',
        'X-Actor-Id': 'site',
      },
      body: { ownerRef: String(ownerRef) },
      retries: 0,
    });
    return { ok: true, data };
  } catch (err) {
    if (err instanceof BotApiError && err.statusCode === 409) {
      return {
        ok: false,
        conflict: true,
        code: (err.details && err.details.code) || 'ROBLOX_ALREADY_REGISTERED',
      };
    }
    throw err;
  }
}

/**
 * Bot API'de Google site üyesinin Roblox ID sahiplenmesini bırakır (profil düzenleme / hesap silme).
 */
async function releaseSiteRobloxClaim(robloxId, ownerRef) {
  return requestBotApi(`/api/roblox/site-claims/${encodeURIComponent(String(robloxId))}`, {
    method: 'DELETE',
    headers: {
      'X-Actor-Type': 'site-service',
      'X-Actor-Id': 'site',
    },
    body: { ownerRef: String(ownerRef) },
    retries: 0,
  });
}

/**
 * Bot API'den toplu Roblox avatar headshot URL'leri çeker (POST /api/roblox/avatars, site-service).
 */
async function fetchRobloxAvatarsAsService(ids = []) {
  const cleanIds = [...new Set((Array.isArray(ids) ? ids : []).map((x) => String(x || '').trim()).filter((x) => /^\d{1,20}$/.test(x)))].slice(0, 100);
  if (cleanIds.length === 0) return {};
  try {
    const raw = await requestBotApi('/api/roblox/avatars', {
      method: 'POST',
      headers: {
        'X-Actor-Type': 'site-service',
        'X-Actor-Id': 'site',
      },
      body: { ids: cleanIds },
      retries: 0,
    });
    const source = raw && raw.avatars && typeof raw.avatars === 'object' ? raw.avatars : raw;
    const out = {};
    for (const id of cleanIds) {
      out[id] = source && source[id] ? sanitizeHttpUrl(source[id]) : null;
    }
    return out;
  } catch (_) {
    return {};
  }
}

/**
 * Üyelik oluşturma öncesinde botun ayakta olduğunu doğrular (benzersizlik garantisi için).
 */
async function isBotReachable(timeoutMs = 3000) {
  try {
    const data = await requestBotApi('/api/health', { method: 'GET', retries: 0, timeoutMs });
    return Boolean(data && data.status === 'ok');
  } catch (_) {
    return false;
  }
}

async function getRegistrationStatus(discordId) {
  let data;
  try {
    data = await requestBotApi(`/api/register/status/${encodeURIComponent(discordId)}`, {
      method: 'GET',
    });
  } catch (err) {
    if (err instanceof BotApiError && (err.errorCategory === 'ENDPOINT_MISSING' || err.statusCode === 501)) {
      return {
        registered: false,
        state: 'unavailable',
        incompatibleBot: true,
      };
    }
    throw err;
  }

  if (!data || typeof data !== 'object') {
    return {
      registered: false,
      state: 'unavailable',
      incompatibleBot: true,
    };
  }

  // Eski klan/legacy bot yanıt yapısı geldiyse çökmeden güncelleme uyarısı göster
  if (
    data.options !== undefined ||
    (typeof data.registered !== 'boolean' && typeof data.state !== 'string')
  ) {
    return {
      registered: false,
      state: 'unavailable',
      incompatibleBot: true,
    };
  }

  const normalized = { ...data };
  if (normalized.registration) {
    normalized.registration = sanitizeRegistrationRecord(normalized.registration);
  } else {
    normalized.registration = { registered: false, games: [], hasGames: false };
  }

  if (normalized.application && typeof normalized.application === 'object') {
    const appCopy = { ...normalized.application };
    appCopy.name = appCopy.name || appCopy.realName || null;
    appCopy.games = sanitizeRegistrationGames(appCopy.games);
    delete appCopy.type;
    delete appCopy.registrationType;
    delete appCopy.clan;
    delete appCopy.clanName;
    normalized.application = appCopy;
  }

  normalized.registered = Boolean(normalized.registered || normalized.registration.registered);
  if (typeof normalized.state === 'string') {
    normalized.state = normalized.state.trim().toLowerCase();
  } else {
    normalized.state = normalized.registered ? 'approved' : 'none';
  }

  delete normalized.registrationType;
  delete normalized.clan;

  return normalized;
}

async function submitRegistration({
  discordId,
  name,
  gender,
  games,
  lang,
}) {
  return requestBotApi('/api/register', {
    method: 'POST',
    headers: {
      'X-Actor-Id': String(discordId),
    },
    body: {
      discordId: String(discordId),
      name,
      gender,
      games,
      lang: lang === 'en' ? 'en' : 'tr',
    },
    retries: 0, // Kayıt oluşturmada çift tetiklemeyi önlemek için POST retry kapalı
  });
}

// ============================================================================
// 4. AKTİF ÜYE İSTATİSTİĞİ VE GERİ BİLDİRİM
// ============================================================================

/**
 * Botun /api/stats/summary yanıtını yeni ve eski sürüm uyumlu biçimde normalize eder.
 * Yeni alanlar yoksa (eski bot), sessizce eski activeRegisteredCount/playingCount alanlarına düşer.
 * Geçersiz veya bozuk yanıtta null döner.
 */
function normalizeServerStatsSummaryPayload(raw, now = Date.now(), lang = 'tr') {
  if (!raw || typeof raw !== 'object') return null;

  const hasActiveThisMonth = typeof raw.activeThisMonth === 'number' && Number.isFinite(raw.activeThisMonth) && raw.activeThisMonth >= 0;
  const hasLegacyActive = typeof raw.activeRegisteredCount === 'number' && Number.isFinite(raw.activeRegisteredCount) && raw.activeRegisteredCount >= 0;
  if (!hasActiveThisMonth && !hasLegacyActive) return null;

  const activeThisMonth = hasActiveThisMonth
    ? Math.floor(raw.activeThisMonth)
    : Math.floor(raw.activeRegisteredCount);

  const hasPlayingNow = typeof raw.playingNow === 'number' && Number.isFinite(raw.playingNow) && raw.playingNow >= 0;
  const hasLegacyPlaying = typeof raw.playingCount === 'number' && Number.isFinite(raw.playingCount) && raw.playingCount >= 0;
  const playingNow = hasPlayingNow
    ? Math.floor(raw.playingNow)
    : hasLegacyPlaying
      ? Math.floor(raw.playingCount)
      : null;

  const updatedAt =
    typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) && raw.updatedAt > 0
      ? raw.updatedAt
      : now;
  const computedAt =
    typeof raw.computedAt === 'string' && Number.isFinite(Date.parse(raw.computedAt))
      ? raw.computedAt
      : new Date(updatedAt).toISOString();

  const { normalized: familyEntries } = normalizeTopGamesEntries(raw, lang, 12);

  return {
    activeThisMonth,
    playingNow,
    uncertainCount: safeNonNegInt(raw.uncertainCount, 0),
    computedAt,
    families: familyEntries.map((g) => ({
      key: g.id,
      label: g.name,
      emoji: g.emoji,
      totalSeconds: g.seconds,
      uniquePlayers: g.players,
      rank: g.rank,
      percent: g.percent,
      hours: g.hours,
      formattedDuration: g.formattedDuration,
      ...(g.breakdown ? { breakdown: g.breakdown } : {}),
    })),
    activeRegisteredCount: activeThisMonth,
    totalMemberCount:
      typeof raw.totalMemberCount === 'number' && Number.isFinite(raw.totalMemberCount) && raw.totalMemberCount >= 0
        ? Math.floor(raw.totalMemberCount)
        : activeThisMonth,
    onlineCount: safeNonNegInt(raw.onlineCount, 0),
    playingCount: playingNow !== null ? playingNow : 0,
    updatedAt,
    legacyMode: !hasActiveThisMonth,
    botOnline: true,
    stale: false,
    refreshFailed: false,
    offline: false,
  };
}

/**
 * Sunucudaki bu ay aktif oyuncu (activeThisMonth) ve şu an oyunda (playingNow) özetini (/api/stats/summary) getirir.
 * En fazla 60 saniye bellek önbelleklidir; bot erişilemezse veya yanıt bozuksa
 * son iyi veriyi ("veri güncellenemedi" bayrağıyla) çökmeden döndürür.
 */
async function getServerStatsSummary(options = {}) {
  const forceRefresh = Boolean(options && options.forceRefresh);
  const lang = options && options.lang === 'en' ? 'en' : 'tr';
  const timeoutMs =
    options && typeof options.timeoutMs === 'number' && options.timeoutMs > 0
      ? options.timeoutMs
      : undefined;
  const now = Date.now();

  if (!forceRefresh && serverStatsSummaryCache.payload && serverStatsSummaryCache.expiresAt > now) {
    return serverStatsSummaryCache.payload;
  }

  try {
    const raw = await requestBotApi(`/api/stats/summary?lang=${lang}`, {
      method: 'GET',
      retries: timeoutMs ? 0 : 1,
      timeoutMs,
    });

    const payload = normalizeServerStatsSummaryPayload(raw, now, lang);
    if (!payload) {
      throw new BotApiError('Bot API geçersiz sunucu özeti yanıtı döndürdü.', 502, true, 'INVALID_PAYLOAD');
    }

    updateActiveStatsCache(payload, true);
    lastGoodSummaryPayload = payload;
    serverStatsSummaryCache = {
      payload,
      expiresAt: now + SUMMARY_CACHE_TTL_MS,
    };

    return payload;
  } catch (_) {
    markActiveStatsOffline();
    if (lastGoodSummaryPayload) {
      return {
        ...lastGoodSummaryPayload,
        botOnline: false,
        stale: true,
        refreshFailed: true,
        offline: true,
      };
    }

    return {
      activeThisMonth: null,
      playingNow: null,
      uncertainCount: 0,
      computedAt: null,
      families: [],
      activeRegisteredCount: null,
      totalMemberCount: null,
      onlineCount: 0,
      playingCount: 0,
      updatedAt: now,
      legacyMode: false,
      botOnline: false,
      stale: true,
      refreshFailed: true,
      offline: true,
    };
  }
}

/**
 * Header/sidebar aktif üye sayısını sayfayı bekletmeden arka planda tazeler (en fazla 60 sn'de bir).
 */
function refreshActiveStatsInBackground() {
  const now = Date.now();
  if (summaryBgRefreshInFlight) return;
  if (serverStatsSummaryCache.payload && serverStatsSummaryCache.expiresAt > now) return;
  if (now - lastSummaryBgAttemptAt < SUMMARY_CACHE_TTL_MS) return;

  summaryBgRefreshInFlight = true;
  lastSummaryBgAttemptAt = now;
  getServerStatsSummary({ timeoutMs: 2500 })
    .catch(() => null)
    .finally(() => {
      summaryBgRefreshInFlight = false;
    });
}

// Geriye dönük uyumluluk takma adı: artık /api/stats/summary üzerinden çalışır
async function getHelpStatus() {
  return getServerStatsSummary();
}

/**
 * Feedback Pill mesajını Bot REST API'sine (POST /api/feedback) iletir.
 */
async function sendFeedback({ actorId, message, page, lang }) {
  return requestBotApi('/api/feedback', {
    method: 'POST',
    headers: {
      'X-Actor-Id': String(actorId),
    },
    body: {
      message,
      page,
      lang,
    },
    retries: 0,
  });
}

// ============================================================================
// 5. YÖNETİM PANELİ (ÜYE ARAMA, DETAY, UYARI VE BELLEKTEN KANIT İLETİMİ)
// ============================================================================

async function searchAdminMembers(actorId, query = '') {
  const qParam = query ? `?query=${encodeURIComponent(query)}` : '';
  const data = await requestBotApi(`/api/admin/members${qParam}`, {
    method: 'GET',
    headers: {
      'X-Actor-Id': String(actorId),
    },
  });

  if (data && Array.isArray(data.members)) {
    data.members = data.members.map((m) => {
      if (!m || typeof m !== 'object') return m;
      const copy = { ...m };
      copy.registration = sanitizeRegistrationRecord(copy.registration);
      delete copy.tryout;
      delete copy.vs;
      delete copy.registrationType;
      delete copy.clan;
      return copy;
    });
  }

  return data;
}

async function getAdminMemberDetail(actorId, targetId, options = { audit: true }) {
  const auditQuery = options && options.audit ? '?audit=1' : '';
  const raw = await requestBotApi(`/api/admin/members/${encodeURIComponent(targetId)}${auditQuery}`, {
    method: 'GET',
    headers: {
      'X-Actor-Id': String(actorId),
    },
  });

  const data = raw && typeof raw === 'object' ? { ...raw } : {};
  const discordObj = data.discord && typeof data.discord === 'object' ? data.discord : {};
  data.discord = {
    id: discordObj.id || String(targetId),
    username: discordObj.username || '-',
    displayName: discordObj.displayName || discordObj.username || String(targetId),
    avatarUrl: discordObj.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png',
    level: discordObj.level || 'registered',
    joinedAt: discordObj.joinedAt || null,
    roles: Array.isArray(discordObj.roles) ? discordObj.roles : [],
  };
  data.registration = sanitizeRegistrationRecord(data.registration);

  const warningsObj = data.warnings && typeof data.warnings === 'object' ? data.warnings : {};
  const statsObj = warningsObj.stats && typeof warningsObj.stats === 'object' ? warningsObj.stats : {};
  data.warnings = {
    stats: {
      points: Number(statsObj.points ?? warningsObj.points) || 0,
      tier: Number(statsObj.tier ?? warningsObj.tier) || 0,
    },
    history: Array.isArray(warningsObj.history) ? warningsObj.history : [],
  };
  const modObj = data.moderation && typeof data.moderation === 'object' ? data.moderation : {};
  data.moderation = {
    profanityViolationCount: Number(modObj.profanityViolationCount) || 0,
  };

  // Eski bot sürümlerinden gelebilecek klan/tryout/VS alanlarını sessizce yok say
  delete data.tryout;
  delete data.vs;
  delete data.registrationType;
  delete data.clan;

  return data;
}

async function applyWarning({ actorId, targetUserId, type, reason, ruleCode }) {
  return requestBotApi('/api/admin/warn', {
    method: 'POST',
    headers: {
      'X-Actor-Id': String(actorId),
    },
    body: {
      actorId: String(actorId),
      targetUserId: String(targetUserId),
      type,
      reason,
      ruleCode,
    },
    retries: 0,
  });
}

/**
 * Kanıt görselini diske kaydetmeden doğrudan bellekten (Buffer) veya harici URL olarak Bot API'ye iletir.
 */
async function attachWarningEvidence(warnId, { actorId, fileBuffer = null, fileName = null, mimeType = null, evidenceUrl = null }) {
  let fallbackRamUrl = evidenceUrl;

  if (fileBuffer && Buffer.isBuffer(fileBuffer) && fileName) {
    storeEphemeralEvidence(fileName, fileBuffer, mimeType || 'image/png');
    if (!fallbackRamUrl) {
      fallbackRamUrl = `${appConfig.BASE_URL}/yonetim/kanit-bellek/${encodeURIComponent(fileName)}`;
    }
  }

  const payload = {
    actorId: String(actorId),
    evidenceUrl: fallbackRamUrl,
  };

  if (fileBuffer && Buffer.isBuffer(fileBuffer)) {
    payload.evidenceBase64 = fileBuffer.toString('base64');
    payload.fileName = fileName;
    payload.mimeType = mimeType;
  }

  try {
    return await requestBotApi(`/api/admin/warn/${encodeURIComponent(warnId)}/evidence`, {
      method: 'POST',
      headers: {
        'X-Actor-Id': String(actorId),
      },
      body: payload,
      retries: 0,
    });
  } catch (err) {
    // Eğer uzak bot sunucusu henüz 10MB JSON güncellemesini almamışsa (HTTP 413), RAM URL ile tekrar dene
    if (fileBuffer && (err.statusCode === 413 || err.statusCode === 400) && fallbackRamUrl) {
      return requestBotApi(`/api/admin/warn/${encodeURIComponent(warnId)}/evidence`, {
        method: 'POST',
        headers: {
          'X-Actor-Id': String(actorId),
        },
        body: {
          actorId: String(actorId),
          evidenceUrl: fallbackRamUrl,
        },
        retries: 0,
      });
    }
    throw err;
  }
}

// ============================================================================
// 6. SOHBET ÜYE REHBERİ (GET /api/directory & POST /api/directory/lookup)
// ============================================================================

function sanitizeDirectoryItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : String(raw.id || '').trim();
  if (!/^\d{15,25}$/.test(id)) return null;
  const displayName =
    typeof raw.displayName === 'string' && raw.displayName.trim()
      ? raw.displayName.trim().slice(0, 64)
      : id;
  const discordAvatarUrl = sanitizeHttpUrl(raw.discordAvatarUrl) || null;
  const robloxId =
    raw.robloxId !== undefined && raw.robloxId !== null && String(raw.robloxId).trim()
      ? String(raw.robloxId).trim().slice(0, 32)
      : null;
  const robloxUsername =
    typeof raw.robloxUsername === 'string' && raw.robloxUsername.trim()
      ? raw.robloxUsername.trim().slice(0, 64)
      : null;
  const robloxAvatarUrl = sanitizeHttpUrl(raw.robloxAvatarUrl) || null;
  const hasRoblox = Boolean(raw.hasRoblox && (robloxId || robloxUsername));
  const games = Array.isArray(raw.games)
    ? raw.games
        .filter((g) => g && g.id && g.username)
        .map((g) => ({
          id: String(g.id).trim().toLowerCase(),
          username: String(g.username).trim().slice(0, 64),
        }))
    : undefined;
  return {
    id,
    displayName,
    discordAvatarUrl,
    robloxId,
    robloxUsername,
    robloxAvatarUrl,
    hasRoblox,
    ...(games !== undefined ? { games } : {}),
  };
}

/**
 * Bot rehberini sorgular (60 sn bellek önbelleği).
 * @param {string} actorId - İsteyen üyenin Discord ID'si (veya asService=true ise 'site')
 * @param {{ query?: string, limit?: number, cursor?: string, excludeSelf?: boolean, asService?: boolean }} [opts]
 */
async function getDirectory(actorId, { query = '', limit = 50, cursor = '', excludeSelf = true, asService = false } = {}) {
  const cleanActor = asService ? 'site' : String(actorId || '').trim();
  const cleanQuery = typeof query === 'string' ? query.trim().slice(0, 64) : '';
  const safeLimit = Math.min(100, Math.max(1, Number.parseInt(String(limit || 50), 10) || 50));
  const cleanCursor = typeof cursor === 'string' ? cursor.trim().slice(0, 120) : '';
  const excludeFlag = asService ? '0' : (excludeSelf ? '1' : '0');

  const cacheKey = `${asService ? 'svc' : cleanActor}|${cleanQuery.toLowerCase()}|${safeLimit}|${cleanCursor}|${excludeFlag}`;
  const now = Date.now();
  const cached = directorySearchCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return {
      items: cached.data.items.map((x) => ({ ...x })),
      nextCursor: cached.data.nextCursor,
      hasMore: cached.data.hasMore,
      total: cached.data.total,
    };
  }

  const params = new URLSearchParams();
  if (cleanQuery) params.set('query', cleanQuery);
  params.set('limit', String(safeLimit));
  if (cleanCursor) params.set('cursor', cleanCursor);
  params.set('excludeSelf', excludeFlag);

  const reqHeaders = { 'X-Actor-Id': cleanActor };
  if (asService) reqHeaders['X-Actor-Type'] = 'site-service';

  const raw = await requestBotApi(`/api/directory?${params.toString()}`, {
    method: 'GET',
    headers: reqHeaders,
    retries: 1,
  });

  const rawItems = Array.isArray(raw && raw.items) ? raw.items : [];
  const items = rawItems.map(sanitizeDirectoryItem).filter(Boolean);
  const result = {
    items,
    nextCursor: raw && typeof raw.nextCursor === 'string' ? raw.nextCursor : null,
    hasMore: Boolean(raw && raw.hasMore),
    total: Number.isFinite(Number(raw && raw.total)) ? Number(raw.total) : items.length,
  };

  // Önbelleği güncelle ve üye bazlı hızlı lookup önbelleğini de besle
  const expiresAt = Date.now() + DIRECTORY_CACHE_TTL_MS;
  if (directorySearchCache.size > 200) {
    for (const [k, v] of directorySearchCache.entries()) {
      if (v.expiresAt <= now) directorySearchCache.delete(k);
    }
    if (directorySearchCache.size > 200) directorySearchCache.clear();
  }
  directorySearchCache.set(cacheKey, { data: result, expiresAt });

  for (const item of items) {
    directoryMemberCache.set(item.id, { item, expiresAt });
  }

  return {
    items: result.items.map((x) => ({ ...x })),
    nextCursor: result.nextCursor,
    hasMore: result.hasMore,
    total: result.total,
  };
}

/**
 * Verilen Discord ID listesinin rehber bilgilerini topluca getirir (60 sn bellek önbelleği).
 * @param {string} actorId
 * @param {string[]} ids
 * @returns {Promise<{ items: Array, byId: Map<string, object> }>}
 */
async function lookupDirectoryMembers(actorId, ids = [], options = {}) {
  const asService = Boolean(options && (options.asService || options.includeGames));
  const includeGames = Boolean(options && options.includeGames);
  const cleanActor = asService ? 'site' : String(actorId || '').trim();
  const uniqueIds = [...new Set((Array.isArray(ids) ? ids : []).map((x) => String(x || '').trim()))].filter((id) =>
    /^\d{15,25}$/.test(id)
  );
  const byId = new Map();
  if (uniqueIds.length === 0) {
    return { items: [], byId };
  }

  const now = Date.now();
  const missing = [];
  for (const id of uniqueIds) {
    const cacheKey = includeGames ? `${id}:games` : id;
    const cached = directoryMemberCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      byId.set(id, { ...cached.item });
    } else {
      missing.push(id);
    }
  }

  // Eksik ID'leri 100'lük gruplarla bot API'den çek
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    try {
      const reqHeaders = { 'X-Actor-Id': cleanActor };
      if (asService) reqHeaders['X-Actor-Type'] = 'site-service';
      const reqBody = includeGames ? { ids: chunk, includeGames: true } : { ids: chunk };
      const raw = await requestBotApi('/api/directory/lookup', {
        method: 'POST',
        headers: reqHeaders,
        body: reqBody,
        retries: 1,
      });
      const expiresAt = Date.now() + DIRECTORY_CACHE_TTL_MS;
      const rawItems = Array.isArray(raw && raw.items) ? raw.items : [];
      for (const entry of rawItems) {
        const clean = sanitizeDirectoryItem(entry);
        if (clean) {
          byId.set(clean.id, clean);
          const cacheKey = includeGames ? `${clean.id}:games` : clean.id;
          directoryMemberCache.set(cacheKey, { item: clean, expiresAt });
        }
      }
    } catch (_) {
      // Kısmi hata durumunda diğer bilinen üyeler bozulmasın
    }
  }

  if (directoryMemberCache.size > 1000) {
    for (const [k, v] of directoryMemberCache.entries()) {
      if (v.expiresAt <= now) directoryMemberCache.delete(k);
    }
  }

  const items = uniqueIds.map((id) => byId.get(id)).filter(Boolean);
  return { items, byId };
}

module.exports = {
  TOP_GAMES_CACHE_TTL_MS,
  SUMMARY_CACHE_TTL_MS,
  DIRECTORY_CACHE_TTL_MS,
  BotApiError,
  requestBotApi,
  checkHealth,
  probeBotApiStatus,
  runStartupConnectivityTest,
  getLastKnownActiveStats,
  updateActiveStatsCache,
  clearGamesCache,
  clearTopGamesCache,
  clearSummaryCache,
  clearDirectoryCache,
  normalizeServerStatsSummaryPayload,
  getGames,
  lookupRobloxAccount,
  claimSiteRobloxId,
  releaseSiteRobloxClaim,
  fetchRobloxAvatarsAsService,
  isBotReachable,
  getMemberRoles,
  getMemberProfile,
  getMemberActivity,
  getTopGames,
  getServerStatsSummary,
  refreshActiveStatsInBackground,
  getRegistrationStatus,
  submitRegistration,
  getHelpStatus,
  searchAdminMembers,
  getAdminMemberDetail,
  applyWarning,
  attachWarningEvidence,
  getEphemeralEvidence,
  sendFeedback,
  getDirectory,
  lookupDirectoryMembers,
};
