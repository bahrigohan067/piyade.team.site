const appConfig = require('../config/app.config');
const gamesConfig = require('../config/games.config');

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

const TOP_GAMES_CACHE_TTL_MS = 5 * 60 * 1000; // 5 dakika
const topGamesCache = new Map();
const lastGoodTopGamesCache = new Map();

function clearTopGamesCache() {
  topGamesCache.clear();
  lastGoodTopGamesCache.clear();
}

const SUMMARY_CACHE_TTL_MS = 60 * 1000; // 60 saniye
let serverStatsSummaryCache = {
  payload: null,
  expiresAt: 0,
};
let summaryBgRefreshInFlight = false;
let lastSummaryBgAttemptAt = 0;

function clearSummaryCache() {
  serverStatsSummaryCache = {
    payload: null,
    expiresAt: 0,
  };
  lastSummaryBgAttemptAt = 0;
}

/**
 * Geçici Bellek İçi (RAM) Kanıt Deposu (Disk / public/uploads kesinlikle kullanılmaz).
 * Yüklenen kanıt görseli doğrudan Bot API'ye (base64 Buffer olarak) iletilir;
 * ayrıca eski bot sürümleriyle geriye dönük uyumluluk için 5 dakika boyunca RAM'de tutulur.
 */
const ephemeralEvidenceRamStore = new Map();

/**
 * Header ("👥 X Aktif" / "👥 — Aktif") için son bilinen aktif üye sayısı önbelleği.
 * Bot API'den veri alınamadığında 0 yerine null döner, böylece arayüzde "—" gösterilir.
 */
let lastKnownActiveStats = {
  activeRegisteredCount: null,
  botOnline: null,
  updatedAt: 0,
};

function getLastKnownActiveStats() {
  return {
    activeRegisteredCount:
      typeof lastKnownActiveStats.activeRegisteredCount === 'number'
        ? lastKnownActiveStats.activeRegisteredCount
        : null,
    botOnline: Boolean(lastKnownActiveStats.botOnline),
  };
}

function updateActiveStatsCache(count, online = true) {
  lastKnownActiveStats = {
    activeRegisteredCount: typeof count === 'number' ? count : null,
    botOnline: Boolean(online),
    updatedAt: Date.now(),
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
        endpoint === '/api/register' ||
        endpoint.startsWith('/api/register/status/') ||
        endpoint.startsWith('/api/stats/top-games') ||
        endpoint === '/api/stats/summary' ||
        (/^\/api\/member\/[^/?]+\/activity\b/.test(endpoint) && /Endpoint bulunamadı|Cannot GET/i.test(rawErrorMsg));

      // 1) 401 Yetki Hatası (API_SECRET Uyuşmazlığı)
      if (response.status === 401) {
        updateActiveStatsCache(null, false);
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
        updateActiveStatsCache(null, false);
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
      updateActiveStatsCache(null, false);
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

    updateActiveStatsCache(null, false);

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
      if (summaryData && typeof summaryData.activeRegisteredCount === 'number') {
        updateActiveStatsCache(summaryData.activeRegisteredCount, true);
        serverStatsSummaryCache = {
          payload: summaryData,
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

/**
 * Üyenin kişisel aylık oyun etkinliği özetini (/api/member/:id/activity) getirir ve güvenli şekilde normalize eder.
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
      totalSeconds: 0,
      live: null,
      nextResetAt,
    };
  }

  const rawGames = Array.isArray(data.games) ? data.games : [];
  const normalizedGames = rawGames
    .filter((g) => g && typeof g === 'object' && g.id && Number(g.seconds) > 0)
    .map((g) => ({
      id: String(g.id).trim().slice(0, 48),
      name: String(g.name || g.id).trim().slice(0, 96),
      emoji: String(g.emoji || '🎮').trim().slice(0, 16),
      family: g.family ? String(g.family).trim().slice(0, 32) : null,
      seconds: Math.max(0, Math.floor(Number(g.seconds) || 0)),
      percent: Math.min(100, Math.max(0, Math.round(Number(g.percent) || 0))),
      formattedDuration: g.formattedDuration ? String(g.formattedDuration).trim().slice(0, 64) : null,
    }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 10);

  const computedTotal = normalizedGames.reduce((sum, g) => sum + g.seconds, 0);
  const totalSeconds =
    typeof data.totalSeconds === 'number' && Number.isFinite(data.totalSeconds) && data.totalSeconds >= computedTotal
      ? Math.floor(data.totalSeconds)
      : computedTotal;

  // Eğer toplam pozitifse ve yüzdeler gelmemişse hesapla
  if (totalSeconds > 0) {
    for (const g of normalizedGames) {
      if (!g.percent) {
        g.percent = Math.min(100, Math.max(0, Math.round((g.seconds / totalSeconds) * 100)));
      }
    }
  }

  let live = null;
  if (data.live && typeof data.live === 'object' && data.live.gameId) {
    live = {
      gameId: String(data.live.gameId).trim().slice(0, 48),
      name: String(data.live.name || data.live.gameId).trim().slice(0, 96),
      emoji: String(data.live.emoji || '🎮').trim().slice(0, 16),
      family: data.live.family ? String(data.live.family).trim().slice(0, 32) : null,
      sessionElapsedSec: Math.max(0, Math.floor(Number(data.live.sessionElapsedSec) || 0)),
      formattedDuration: data.live.formattedDuration ? String(data.live.formattedDuration).trim().slice(0, 64) : null,
    };
  }

  return {
    userId: String(data.userId || discordId),
    month,
    tracking: true,
    games: normalizedGames,
    totalSeconds,
    live,
    nextResetAt,
  };
}

/**
 * Sunucuda en çok oynanan oyunların anonim sıralamasını (/api/stats/top-games) getirir.
 * 5 dakika bellek önbelleği + bot çevrimdışı/404 durumunda zarif stale/preparing yedeklemesi içerir.
 */
async function getTopGames(options = {}) {
  const cleanScope = options.scope === 'all' ? 'all' : 'month';
  const cleanGroup = options.group === 'family' ? 'family' : 'game';
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
    };
  }

  try {
    const query = `scope=${cleanScope}&group=${cleanGroup}&lang=${cleanLang}&limit=${cleanLimit}`;
    const raw = await requestBotApi(`/api/stats/top-games?${query}`, {
      method: 'GET',
      retries: timeoutMs ? 0 : 1,
      timeoutMs,
    });

    const data = raw && typeof raw === 'object' ? raw : {};
    const rawGames = Array.isArray(data.games) ? data.games : [];
    const normalizedGames = rawGames
      .filter((g) => g && typeof g === 'object' && g.id && Number(g.seconds) > 0)
      .map((g) => {
        const seconds = Math.max(0, Math.floor(Number(g.seconds) || 0));
        const hours =
          typeof g.hours === 'number' && Number.isFinite(g.hours)
            ? Number(g.hours.toFixed(1))
            : Number((seconds / 3600).toFixed(1));
        return {
          id: String(g.id).trim().slice(0, 48),
          name: String(g.name || g.id).trim().slice(0, 96),
          emoji: String(g.emoji || '🎮').trim().slice(0, 16),
          family: g.family ? String(g.family).trim().slice(0, 32) : null,
          seconds,
          hours,
          percent: Math.min(100, Math.max(0, Math.round(Number(g.percent) || 0))),
          players: Math.max(0, Math.floor(Number(g.players) || 0)),
          formattedDuration: g.formattedDuration ? String(g.formattedDuration).trim().slice(0, 64) : null,
        };
      })
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, cleanLimit);

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

    const payload = {
      scope: cleanScope,
      group: cleanGroup,
      month: typeof data.month === 'string' ? data.month : '',
      since:
        typeof data.since === 'number' && Number.isFinite(data.since) && data.since > 0 ? data.since : null,
      updatedAt:
        typeof data.updatedAt === 'number' && Number.isFinite(data.updatedAt) ? data.updatedAt : now,
      totalSeconds,
      games: normalizedGames,
      stale: false,
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
      totalSeconds: 0,
      games: [],
      stale: !isEndpointMissing,
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

  try {
    const data = await requestBotApi('/api/games', {
      method: 'GET',
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

async function lookupRobloxAccount(query) {
  const cleanQuery = typeof query === 'string' ? query.trim() : '';
  if (!cleanQuery) {
    return {
      status: 'NOT_FOUND',
      user: null,
      alreadyRegistered: false,
    };
  }

  try {
    const data = await requestBotApi(`/api/roblox/lookup?query=${encodeURIComponent(cleanQuery)}`, {
      method: 'GET',
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
    };
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
 * Sunucudaki aktif kayıtlı oyuncu, toplam üye ve oynayan kişi sayılarını (/api/stats/summary) getirir.
 * 60 saniye bellek önbelleklidir; başarılı olduğunda header/sidebar ("👥 X Aktif") önbelleğini günceller.
 */
async function getServerStatsSummary(options = {}) {
  const forceRefresh = Boolean(options && options.forceRefresh);
  const timeoutMs =
    options && typeof options.timeoutMs === 'number' && options.timeoutMs > 0
      ? options.timeoutMs
      : undefined;
  const now = Date.now();

  if (!forceRefresh && serverStatsSummaryCache.payload && serverStatsSummaryCache.expiresAt > now) {
    return serverStatsSummaryCache.payload;
  }

  const raw = await requestBotApi('/api/stats/summary', {
    method: 'GET',
    retries: timeoutMs ? 0 : 1,
    timeoutMs,
  });

  const data = raw && typeof raw === 'object' ? raw : {};
  const activeRegisteredCount =
    typeof data.activeRegisteredCount === 'number' && Number.isFinite(data.activeRegisteredCount)
      ? Math.max(0, Math.floor(data.activeRegisteredCount))
      : null;

  const payload = {
    activeRegisteredCount,
    totalMemberCount:
      typeof data.totalMemberCount === 'number' && Number.isFinite(data.totalMemberCount)
        ? Math.max(0, Math.floor(data.totalMemberCount))
        : activeRegisteredCount,
    onlineCount:
      typeof data.onlineCount === 'number' && Number.isFinite(data.onlineCount)
        ? Math.max(0, Math.floor(data.onlineCount))
        : 0,
    playingCount:
      typeof data.playingCount === 'number' && Number.isFinite(data.playingCount)
        ? Math.max(0, Math.floor(data.playingCount))
        : 0,
    updatedAt:
      typeof data.updatedAt === 'number' && Number.isFinite(data.updatedAt) ? data.updatedAt : now,
  };

  if (typeof activeRegisteredCount === 'number') {
    updateActiveStatsCache(activeRegisteredCount, true);
  }

  serverStatsSummaryCache = {
    payload,
    expiresAt: now + SUMMARY_CACHE_TTL_MS,
  };

  return payload;
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

module.exports = {
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
  getGames,
  lookupRobloxAccount,
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
};
