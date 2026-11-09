const appConfig = require('../config/app.config');

/**
 * Geçici Bellek İçi (RAM) Kanıt Deposu (Disk / public/uploads kesinlikle kullanılmaz).
 * Yüklenen kanıt görseli doğrudan Bot API'ye (base64 Buffer olarak) iletilir;
 * ayrıca eski bot sürümleriyle geriye dönük uyumluluk için 5 dakika boyunca RAM'de tutulur.
 */
const ephemeralEvidenceRamStore = new Map();

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
  const timeoutMs = appConfig.API_TIMEOUT_MS || 8000;

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
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await response.json().catch(() => null);
    } else {
      const text = await response.text().catch(() => '');
      data = { error: text || `HTTP ${response.status}` };
    }

    if (!response.ok) {
      const errorMsg = (data && data.error) || `Bot API Hatası (HTTP ${response.status})`;
      const category = classifyHttpStatus(response.status);
      const isOfflineStatus = response.status === 502 || response.status === 503 || response.status === 504;
      throw new BotApiError(errorMsg, response.status, isOfflineStatus, category, data);
    }

    return data;
  } catch (err) {
    clearTimeout(timeoutId);

    if (err instanceof BotApiError) {
      throw err;
    }

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

// ============================================================================
// 2. ÜYE VE ROL SORGULARI
// ============================================================================

async function getMemberRoles(discordId) {
  const data = await requestBotApi(`/api/member/${encodeURIComponent(discordId)}/roles`, {
    method: 'GET',
  });

  if (data && typeof data.highestRolePosition !== 'number') {
    const roles = Array.isArray(data.roles) ? data.roles : [];
    data.highestRolePosition = roles.reduce((max, r) => Math.max(max, Number(r.position) || 0), 0);
  }

  return data;
}

async function getMemberProfile(discordId) {
  const data = await requestBotApi(`/api/member/${encodeURIComponent(discordId)}/profile`, {
    method: 'GET',
  });

  if (data) {
    data.discord = data.discord || {};
    data.registration = data.registration || { registered: false };
    data.tryout = data.tryout || { level: 0, formCount: 0 };
    data.vs = data.vs || { points: 0, wins: 0, losses: 0, kills: 0 };
    data.warnings = data.warnings || { points: 0, tier: 0, staffWarnings: 0, totalWarnings: 0 };
  }

  return data;
}

// ============================================================================
// 3. KAYIT SİSTEMİ
// ============================================================================

async function getRegistrationStatus(discordId) {
  return requestBotApi(`/api/register/status/${encodeURIComponent(discordId)}`, {
    method: 'GET',
  });
}

async function submitRegistration({ discordId, realName, gender, robloxInput }) {
  return requestBotApi('/api/register', {
    method: 'POST',
    body: {
      discordId,
      realName,
      gender,
      robloxInput,
    },
    retries: 0, // Kayıt oluşturmada çift tetiklemeyi önlemek için POST retry kapalı
  });
}

// ============================================================================
// 4. TRYOUT VE ACİL TAKVİYE (YARDIM) SİSTEMİ
// ============================================================================

async function getTryoutLeaderboard() {
  return requestBotApi('/api/tryout/leaderboard', {
    method: 'GET',
  });
}

async function getHelpStatus(discordId) {
  const query = discordId ? `?userId=${encodeURIComponent(discordId)}` : '';
  return requestBotApi(`/api/help/status${query}`, {
    method: 'GET',
  });
}

async function triggerHelpCall(discordId) {
  return requestBotApi('/api/help/call', {
    method: 'POST',
    body: { userId: discordId },
    retries: 0,
  });
}

// ============================================================================
// 5. YÖNETİM PANELİ (ÜYE ARAMA, DETAY, UYARI VE BELLEKTEN KANIT İLETİMİ)
// ============================================================================

async function searchAdminMembers(actorId, query = '') {
  const qParam = query ? `?query=${encodeURIComponent(query)}` : '';
  return requestBotApi(`/api/admin/members${qParam}`, {
    method: 'GET',
    headers: {
      'X-Actor-Id': String(actorId),
    },
  });
}

async function getAdminMemberDetail(actorId, targetId, options = { audit: true }) {
  const auditQuery = options && options.audit ? '?audit=1' : '';
  const data = await requestBotApi(`/api/admin/members/${encodeURIComponent(targetId)}${auditQuery}`, {
    method: 'GET',
    headers: {
      'X-Actor-Id': String(actorId),
    },
  });

  if (data) {
    data.discord = data.discord || { roles: [] };
    data.registration = data.registration || { registered: false };
    data.tryout = data.tryout || { current: { level: 0, formCount: 0 }, forms: [] };
    data.tryout.current = data.tryout.current || { level: 0, formCount: 0 };
    data.tryout.forms = data.tryout.forms || [];
    data.vs = data.vs || { points: 0, wins: 0, losses: 0, kills: 0 };
    data.warnings = data.warnings || { stats: { points: 0, tier: 0 }, history: [] };
    data.warnings.stats = data.warnings.stats || { points: 0, tier: 0 };
    data.warnings.history = data.warnings.history || [];
    data.moderation = data.moderation || { profanityViolationCount: 0 };
  }

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
  getMemberRoles,
  getMemberProfile,
  getRegistrationStatus,
  submitRegistration,
  getTryoutLeaderboard,
  getHelpStatus,
  triggerHelpCall,
  searchAdminMembers,
  getAdminMemberDetail,
  applyWarning,
  attachWarningEvidence,
  getEphemeralEvidence,
};
