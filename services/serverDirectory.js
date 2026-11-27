const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const serversConfig = require('../config/servers.config');
const chatAutoFilter = require('./chatAutoFilter');

const {
  LIMITS,
  SEED_SERVERS,
  DISCORD_API_ORIGIN,
  DISCORD_USER_AGENT,
  INVITE_CODE_REGEX,
  SNOWFLAKE_REGEX,
  sanitizeDiscordText,
  getRefreshIntervalMs,
  extractInviteCode,
  snowflakeToCreatedAt,
  buildGuildIconUrls,
  buildGuildBannerUrl,
  buildEmojiUrl,
  buildAppIconUrl,
  validateBrandColor,
  computeServerInitials,
} = serversConfig;

// Otomatik içerik filtresinin sunucu ad/etiketlerinde yakalayacağı risk kategorileri
const SERVER_FLAG_CATEGORIES = new Set(['profanity', 'threat', 'discord_invite', 'suspicious_link']);

function resolveDefaultServersDir(envObj = process.env) {
  const vol =
    envObj && typeof envObj.RAILWAY_VOLUME_MOUNT_PATH === 'string'
      ? envObj.RAILWAY_VOLUME_MOUNT_PATH.trim()
      : '';
  if (vol) {
    return path.join(vol, 'servers');
  }
  return path.join(process.cwd(), '.servers-data');
}

function atomicWriteJson(filePath, dataObj) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const payload = JSON.stringify(dataObj, null, 2);
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
  const bakPath = `${filePath}.bak`;

  fs.writeFileSync(tmpPath, payload, 'utf8');
  if (fs.existsSync(filePath)) {
    try {
      fs.copyFileSync(filePath, bakPath);
    } catch (_) {}
  }
  fs.renameSync(tmpPath, filePath);
}

function safeReadJson(filePath) {
  const candidates = [filePath, `${filePath}.bak`];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const raw = fs.readFileSync(candidate, 'utf8');
      if (!raw.trim()) continue;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return { data: parsed, recoveredFromBackup: candidate.endsWith('.bak') };
      }
    } catch (_) {}
  }
  return { data: null, recoveredFromBackup: false };
}

function readJsonlLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return [];
    const out = [];
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        out.push(JSON.parse(t));
      } catch (_) {}
    }
    return out;
  } catch (_) {
    return [];
  }
}

function appendJsonlLine(filePath, obj) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(obj)}\n`, 'utf8');
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toOptionalCount(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function deriveGuildBadge(features, profileBadge) {
  const list = Array.isArray(features) ? features.map((f) => String(f || '').toUpperCase()) : [];
  if (list.includes('PARTNERED')) return 'partnered';
  if (list.includes('VERIFIED')) return 'verified';
  if (list.includes('COMMUNITY')) return 'community';
  if (typeof profileBadge === 'string') {
    const norm = profileBadge.trim().toLowerCase();
    if (norm === 'partnered' || norm === 'verified' || norm === 'community') return norm;
  }
  return null;
}

function parseRetryAfterMs(retryAfterHeader, attempt = 0) {
  const fallbackMs = Math.min(30000, 1500 * Math.pow(2, attempt));
  if (!retryAfterHeader) return fallbackMs;
  const raw = String(retryAfterHeader).trim();
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && asNum >= 0) {
    // Discord Retry-After saniye (veya ondalık saniye) cinsindendir
    const ms = Math.ceil(asNum * 1000);
    return Math.min(60000, Math.max(250, ms));
  }
  const parsedDate = Date.parse(raw);
  if (!Number.isNaN(parsedDate)) {
    const diff = parsedDate - Date.now();
    return Math.min(60000, Math.max(250, diff));
  }
  return fallbackMs;
}

/**
 * Sunucu adı ve etiketlerini mevcut sohbet otomatik filtresinden (chatAutoFilter) geçirir.
 * Eşleşme varsa kategori listesi ve içerik parmak izi (hash) döndürür.
 */
function scanServerTextsForFlags(name, traits) {
  const texts = [];
  const cleanName = sanitizeDiscordText(name, LIMITS.MAX_NAME_LEN);
  if (cleanName) texts.push(cleanName);
  const safeTraits = Array.isArray(traits) ? traits : [];
  for (const tr of safeTraits) {
    const lbl = sanitizeDiscordText(tr && tr.label, LIMITS.MAX_TRAIT_LEN);
    if (lbl) texts.push(lbl);
  }

  const matchedCategories = new Set();
  for (const text of texts) {
    const scan = chatAutoFilter.scanMessageText(text);
    if (scan && Array.isArray(scan.categories)) {
      for (const cat of scan.categories) {
        if (SERVER_FLAG_CATEGORIES.has(cat)) {
          matchedCategories.add(cat);
        }
      }
    }
  }

  const categories = Array.from(matchedCategories);
  const fingerprint = crypto
    .createHash('sha256')
    .update(texts.join('\u001f').toLowerCase())
    .digest('hex')
    .slice(0, 24);

  return {
    flagged: categories.length > 0,
    categories,
    fingerprint,
  };
}

/**
 * Discord davet API yanıtını savunmacı biçimde ayrıştırır.
 * Eksik alanlar gizlenir; eksik sayılar ASLA 0 sayılmaz (null kalır).
 */
function parseDiscordInvitePayload(payload, fetchedAtIso = new Date().toISOString()) {
  if (!payload || typeof payload !== 'object') return null;

  const guild = payload.guild && typeof payload.guild === 'object' ? payload.guild : null;
  const profile =
    (payload.profile && typeof payload.profile === 'object' ? payload.profile : null) ||
    (guild && guild.profile && typeof guild.profile === 'object' ? guild.profile : null);

  const rawGuildId = (guild && guild.id) || (profile && profile.id) || null;
  const guildId = rawGuildId && SNOWFLAKE_REGEX.test(String(rawGuildId)) ? String(rawGuildId) : null;

  const name = sanitizeDiscordText(
    (guild && guild.name) || (profile && profile.name) || '',
    LIMITS.MAX_NAME_LEN
  );
  const description = sanitizeDiscordText(
    (guild && guild.description) || (profile && profile.description) || '',
    LIMITS.MAX_DESC_LEN
  );

  const iconHash = (guild && guild.icon) || (profile && profile.icon_hash) || null;
  const { iconUrl, iconAnimatedUrl, isAnimated } = guildId
    ? buildGuildIconUrls(guildId, iconHash)
    : { iconUrl: null, iconAnimatedUrl: null, isAnimated: false };

  const bannerUrl = guildId
    ? buildGuildBannerUrl(guildId, guild && guild.banner, guild && guild.splash)
    : null;

  const brandColor = validateBrandColor(profile && profile.brand_color_primary);

  const features = Array.isArray(guild && guild.features)
    ? guild.features
        .filter((f) => typeof f === 'string' && f.trim())
        .map((f) => f.trim().slice(0, 64))
        .slice(0, 24)
    : [];

  const badge = deriveGuildBadge(features, profile && profile.badge);

  // Eksik sayıları ASLA 0 sayma — yalnızca geçerli sayısal değer varsa al
  const memberCount = toOptionalCount(
    payload.approximate_member_count !== undefined
      ? payload.approximate_member_count
      : profile && profile.member_count
  );
  const onlineCount = toOptionalCount(
    payload.approximate_presence_count !== undefined
      ? payload.approximate_presence_count
      : profile && profile.online_count
  );

  const boostCount = toOptionalCount(guild && guild.premium_subscription_count);
  const createdAt = guildId ? snowflakeToCreatedAt(guildId) : null;

  const traits = [];
  if (profile && Array.isArray(profile.traits)) {
    for (const item of profile.traits) {
      if (traits.length >= LIMITS.MAX_TRAITS) break;
      if (!item || typeof item !== 'object') continue;
      const label = sanitizeDiscordText(item.label, LIMITS.MAX_TRAIT_LEN);
      if (!label) continue;
      const emojiUrl = item.emoji_id ? buildEmojiUrl(item.emoji_id) : null;
      const emojiText =
        !emojiUrl && typeof item.emoji_name === 'string'
          ? sanitizeDiscordText(item.emoji_name, 8)
          : null;
      const traitObj = { label };
      if (emojiUrl) traitObj.emojiUrl = emojiUrl;
      if (emojiText) traitObj.emoji = emojiText;
      traits.push(traitObj);
    }
  }

  const gameApplicationIds = [];
  if (profile && Array.isArray(profile.game_application_ids)) {
    for (const rawAppId of profile.game_application_ids) {
      if (gameApplicationIds.length >= LIMITS.MAX_GAME_APPS) break;
      const s = String(rawAppId || '').trim();
      if (SNOWFLAKE_REGEX.test(s) && !gameApplicationIds.includes(s)) {
        gameApplicationIds.push(s);
      }
    }
  }

  const tag = sanitizeDiscordText(profile && profile.tag, 16) || null;

  let expiresAt = null;
  if (typeof payload.expires_at === 'string' && payload.expires_at.trim()) {
    const parsedExp = Date.parse(payload.expires_at);
    if (!Number.isNaN(parsedExp)) {
      expiresAt = new Date(parsedExp).toISOString();
    }
  }

  return {
    guildId,
    name: name || null,
    description: description || null,
    iconUrl,
    iconAnimatedUrl,
    iconAnimated: Boolean(isAnimated),
    bannerUrl,
    brandColor,
    features,
    badge,
    tag,
    boostCount,
    memberCount,
    onlineCount,
    createdAt,
    traits,
    gameApplicationIds,
    gameApps: [],
    expiresAt,
    fetchedAt: fetchedAtIso,
  };
}

/**
 * Dosya tabanlı depo arayüzü (ileride veritabanı adaptörüyle birebir değiştirilebilir).
 */
class JsonFileServerRepository {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.dataFile = path.join(this.baseDir, 'servers.json');
    this.auditFile = path.join(this.baseDir, 'audit.jsonl');
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  loadState() {
    const { data, recoveredFromBackup } = safeReadJson(this.dataFile);
    return { data, recoveredFromBackup };
  }

  saveState(stateObj) {
    atomicWriteJson(this.dataFile, stateObj);
  }

  appendAudit(entry) {
    appendJsonlLine(this.auditFile, entry);
  }

  readAudit() {
    return readJsonlLines(this.auditFile);
  }

  rewriteAudit(entries) {
    const dir = path.dirname(this.auditFile);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${this.auditFile}.tmp.${process.pid}.${Date.now()}`;
    const body = entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length > 0 ? '\n' : '');
    fs.writeFileSync(tmpPath, body, 'utf8');
    fs.renameSync(tmpPath, this.auditFile);
  }
}

class ServerDirectory {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.baseDir = options.baseDir || resolveDefaultServersDir(this.env);
    this.repository = options.repository || new JsonFileServerRepository(this.baseDir);
    this.fetchFn = typeof options.fetchFn === 'function' ? options.fetchFn : global.fetch.bind(global);
    this.sleepFn = typeof options.sleepFn === 'function' ? options.sleepFn : defaultSleep;
    this.nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now();
    this.refreshStepDelayMs =
      Number.isFinite(options.refreshStepDelayMs) ? options.refreshStepDelayMs : LIMITS.REFRESH_STEP_DELAY_MS;
    this.discordTimeoutMs =
      Number.isFinite(options.discordTimeoutMs) ? options.discordTimeoutMs : LIMITS.DISCORD_TIMEOUT_MS;
    this.userRefreshCooldownMs =
      Number.isFinite(options.userRefreshCooldownMs)
        ? options.userRefreshCooldownMs
        : LIMITS.USER_REFRESH_COOLDOWN_MS;
    this.staleBgRefreshMs =
      Number.isFinite(options.staleBgRefreshMs) ? options.staleBgRefreshMs : LIMITS.STALE_BG_REFRESH_MS;

    // 24 saatlik bellek-içi oyun uygulama simgesi önbelleği
    this._appIconCache = new Map();

    // Global tek-uçuş (single-flight) tazeleme ve üye tetikli bekleme süresi
    this._refreshInFlight = null;
    this._lastMemberRefreshAt = 0;
    this._startupTimer = null;
    this._intervalTimer = null;

    this._state = this._loadOrSeed();
  }

  _buildSeedRecords() {
    const nowIso = new Date(this.nowFn()).toISOString();
    return SEED_SERVERS.map((seed, idx) => ({
      id: `srv_${crypto.randomBytes(6).toString('hex')}`,
      code: seed.code,
      label: seed.label,
      featured: Boolean(seed.featured),
      hidden: false,
      order: idx,
      addedBy: 'seed',
      addedAt: nowIso,
      note: '',
      status: 'stale',
      consecutiveFailures: 0,
      flaggedReasons: [],
      flaggedHash: null,
      approvedFlagHash: null,
      cache: null,
    }));
  }

  _normalizeRecord(rec, idx) {
    if (!rec || typeof rec !== 'object') return null;
    const code = typeof rec.code === 'string' && INVITE_CODE_REGEX.test(rec.code.trim()) ? rec.code.trim() : null;
    if (!code) return null;
    const allowedStatuses = new Set(['ok', 'stale', 'invalid', 'flagged']);
    return {
      id: typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim() : `srv_${crypto.randomBytes(6).toString('hex')}`,
      code,
      label: sanitizeDiscordText(rec.label, LIMITS.MAX_LABEL_LEN) || code,
      featured: Boolean(rec.featured),
      hidden: Boolean(rec.hidden),
      order: Number.isInteger(rec.order) ? rec.order : idx,
      addedBy: typeof rec.addedBy === 'string' ? rec.addedBy.slice(0, 64) : 'system',
      addedAt: typeof rec.addedAt === 'string' ? rec.addedAt : new Date(this.nowFn()).toISOString(),
      note: sanitizeDiscordText(rec.note, LIMITS.MAX_NOTE_LEN),
      status: allowedStatuses.has(rec.status) ? rec.status : 'stale',
      consecutiveFailures: Number.isInteger(rec.consecutiveFailures) && rec.consecutiveFailures >= 0 ? rec.consecutiveFailures : 0,
      flaggedReasons: Array.isArray(rec.flaggedReasons) ? rec.flaggedReasons.filter((x) => typeof x === 'string') : [],
      flaggedHash: typeof rec.flaggedHash === 'string' ? rec.flaggedHash : null,
      approvedFlagHash: typeof rec.approvedFlagHash === 'string' ? rec.approvedFlagHash : null,
      cache: rec.cache && typeof rec.cache === 'object' ? rec.cache : null,
    };
  }

  _loadOrSeed() {
    const { data, recoveredFromBackup } = this.repository.loadState();
    if (data && Array.isArray(data.servers) && data.servers.length > 0) {
      const normalized = data.servers
        .map((r, i) => this._normalizeRecord(r, i))
        .filter(Boolean)
        .sort((a, b) => a.order - b.order)
        .map((r, i) => ({ ...r, order: i }));

      if (normalized.length > 0) {
        this._enforceSingleFeatured(normalized);
        const state = {
          version: 1,
          updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date(this.nowFn()).toISOString(),
          lastRefreshAt: typeof data.lastRefreshAt === 'string' ? data.lastRefreshAt : null,
          servers: normalized,
        };
        if (recoveredFromBackup) {
          this.repository.saveState(state);
        }
        return state;
      }
    }

    const seeded = {
      version: 1,
      updatedAt: new Date(this.nowFn()).toISOString(),
      lastRefreshAt: null,
      servers: this._buildSeedRecords(),
    };
    this.repository.saveState(seeded);
    return seeded;
  }

  _enforceSingleFeatured(list) {
    let seen = false;
    for (const item of list) {
      if (item.featured && !seen) {
        seen = true;
      } else {
        item.featured = false;
      }
    }
  }

  _persist() {
    this._state.servers.sort((a, b) => a.order - b.order);
    this._state.servers.forEach((s, idx) => {
      s.order = idx;
    });
    this._enforceSingleFeatured(this._state.servers);
    this._state.updatedAt = new Date(this.nowFn()).toISOString();
    this.repository.saveState(this._state);
  }

  flush() {
    try {
      this.repository.saveState(this._state);
    } catch (_) {}
  }

  /**
   * İçeriksiz denetim kaydı (kim, ne zaman, eylem, kod) — 1 yıl saklama süresi.
   */
  logAudit(actorId, action, code = '') {
    const nowMs = this.nowFn();
    const entry = {
      ts: new Date(nowMs).toISOString(),
      actorId: String(actorId || 'system').slice(0, 64),
      action: String(action || 'unknown').slice(0, 64),
      code: typeof code === 'string' ? code.slice(0, 32) : '',
    };
    try {
      this.repository.appendAudit(entry);
    } catch (_) {}
    return entry;
  }

  pruneExpiredAuditLogs() {
    const cutoffMs = this.nowFn() - LIMITS.AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const all = this.repository.readAudit();
    if (!all.length) return 0;
    const kept = all.filter((item) => {
      const ts = item && item.ts ? Date.parse(item.ts) : NaN;
      return !Number.isNaN(ts) && ts >= cutoffMs;
    });
    if (kept.length !== all.length) {
      this.repository.rewriteAudit(kept);
    }
    return all.length - kept.length;
  }

  getAuditLogs(limit = 50) {
    const all = this.repository.readAudit();
    const max = Number.isInteger(limit) && limit > 0 ? limit : 50;
    return all.slice(-max).reverse();
  }

  // ============================================================================
  // DISCORD API İSTEMCİSİ (SSRF KORUMALI, REDIRECT: ERROR, 6 SN ZAMAN AŞIMI)
  // ============================================================================

  async _fetchWithTimeout(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.discordTimeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    try {
      const resp = await this.fetchFn(url, {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'User-Agent': DISCORD_USER_AGENT,
          Accept: 'application/json',
        },
      });
      return resp;
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchGameApplications(appIds) {
    if (!Array.isArray(appIds) || appIds.length === 0) return [];
    const cleanIds = [];
    for (const id of appIds) {
      const s = String(id || '').trim();
      if (SNOWFLAKE_REGEX.test(s) && !cleanIds.includes(s)) {
        cleanIds.push(s);
        if (cleanIds.length >= LIMITS.MAX_GAME_APPS) break;
      }
    }
    if (cleanIds.length === 0) return [];

    const nowMs = this.nowFn();
    const missing = [];
    for (const id of cleanIds) {
      const cached = this._appIconCache.get(id);
      if (!cached || nowMs - cached.cachedAt > LIMITS.APP_ICON_CACHE_TTL_MS) {
        missing.push(id);
      }
    }

    if (missing.length > 0) {
      try {
        const qs = missing.map((id) => `application_ids=${encodeURIComponent(id)}`).join('&');
        const url = `${DISCORD_API_ORIGIN}/api/v10/applications/public?${qs}`;
        const resp = await this._fetchWithTimeout(url);
        if (resp && resp.ok) {
          const data = await resp.json();
          const arr = Array.isArray(data) ? data : [];
          const byId = new Map();
          for (const app of arr) {
            if (!app || typeof app !== 'object') continue;
            const aid = String(app.id || '').trim();
            if (!SNOWFLAKE_REGEX.test(aid)) continue;
            const iconUrl = buildAppIconUrl(aid, app.icon);
            const name = sanitizeDiscordText(app.name, 40) || null;
            byId.set(aid, { id: aid, name, iconUrl, cachedAt: nowMs });
          }
          for (const id of missing) {
            if (byId.has(id)) {
              this._appIconCache.set(id, byId.get(id));
            } else {
              // Olmayan uygulama için de kısa negatif kayıt sakla ki tekrar tekrar sormasın
              this._appIconCache.set(id, { id, name: null, iconUrl: null, cachedAt: nowMs });
            }
          }
        } else {
          // Belgelenmemiş uç nokta hata verirse sessizce simge satırını gizle
          return [];
        }
      } catch (_) {
        return [];
      }
    }

    const resolved = [];
    for (const id of cleanIds) {
      const entry = this._appIconCache.get(id);
      if (entry && entry.iconUrl) {
        resolved.push({
          id: entry.id,
          name: entry.name || undefined,
          iconUrl: entry.iconUrl,
        });
      }
    }
    return resolved.slice(0, LIMITS.MAX_GAME_APPS);
  }

  /**
   * Tek bir Discord davet kodunu Discord v10 public API'den çeker (429 Retry-After uyumlu).
   * @returns {Promise<{ ok: boolean, kind: 'ok'|'not_found'|'rate_limited'|'error', cache?: object, flagCheck?: object, statusCode?: number, error?: string }>}
   */
  async fetchDiscordInvite(rawCode) {
    const code = typeof rawCode === 'string' && INVITE_CODE_REGEX.test(rawCode.trim()) ? rawCode.trim() : null;
    if (!code) {
      return { ok: false, kind: 'error', error: 'INVALID_CODE_FORMAT' };
    }

    // Sabit origin: kullanıcı girdisinden ASLA URL kurulmaz
    const url = `${DISCORD_API_ORIGIN}/api/v10/invites/${encodeURIComponent(code)}?with_counts=true&with_expiration=true`;

    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const resp = await this._fetchWithTimeout(url);
        if (!resp) {
          return { ok: false, kind: 'error', error: 'EMPTY_RESPONSE' };
        }

        if (resp.status === 404) {
          return { ok: false, kind: 'not_found', statusCode: 404, error: 'INVITE_NOT_FOUND' };
        }

        if (resp.status === 429) {
          const retryHeader =
            resp.headers && typeof resp.headers.get === 'function' ? resp.headers.get('retry-after') : null;
          const waitMs = parseRetryAfterMs(retryHeader, attempt);
          if (attempt < maxAttempts - 1) {
            await this.sleepFn(waitMs);
            continue;
          }
          return { ok: false, kind: 'rate_limited', statusCode: 429, error: 'RATE_LIMITED' };
        }

        if (!resp.ok) {
          return { ok: false, kind: 'error', statusCode: resp.status, error: `HTTP_${resp.status}` };
        }

        const payload = await resp.json();
        const parsed = parseDiscordInvitePayload(payload, new Date(this.nowFn()).toISOString());
        if (!parsed || !parsed.guildId) {
          return { ok: false, kind: 'error', error: 'MALFORMED_INVITE_PAYLOAD' };
        }

        if (parsed.gameApplicationIds && parsed.gameApplicationIds.length > 0) {
          parsed.gameApps = await this.fetchGameApplications(parsed.gameApplicationIds);
        }
        delete parsed.gameApplicationIds;

        const flagCheck = scanServerTextsForFlags(parsed.name, parsed.traits);
        return { ok: true, kind: 'ok', cache: parsed, flagCheck };
      } catch (err) {
        // redirect: 'error' veya ağ/timeout hatası
        const errMsg = err && err.message ? String(err.message) : 'FETCH_FAILED';
        return { ok: false, kind: 'error', error: errMsg };
      }
    }

    return { ok: false, kind: 'error', error: 'MAX_RETRIES_EXCEEDED' };
  }

  _applyFetchResultToRecord(record, result) {
    if (result.ok && result.cache) {
      record.cache = result.cache;
      record.consecutiveFailures = 0;

      const flagCheck = result.flagCheck || scanServerTextsForFlags(result.cache.name, result.cache.traits);
      if (flagCheck.flagged) {
        if (record.approvedFlagHash && record.approvedFlagHash === flagCheck.fingerprint) {
          record.status = 'ok';
          record.flaggedReasons = [];
          record.flaggedHash = null;
        } else {
          record.status = 'flagged';
          record.flaggedReasons = flagCheck.categories;
          record.flaggedHash = flagCheck.fingerprint;
        }
      } else {
        record.status = 'ok';
        record.flaggedReasons = [];
        record.flaggedHash = null;
      }
      return;
    }

    if (result.kind === 'not_found') {
      record.consecutiveFailures = (record.consecutiveFailures || 0) + 1;
      if (record.consecutiveFailures >= LIMITS.CONSECUTIVE_404_THRESHOLD) {
        record.status = 'invalid';
      } else if (record.status !== 'flagged') {
        record.status = 'stale';
      }
      return;
    }

    // Geçici ağ / 5xx / 429 hatası: son iyi cache korunur
    if (record.status !== 'flagged' && record.status !== 'invalid') {
      record.status = 'stale';
    }
  }

  /**
   * Tüm sunucuları SIRAYLA ve aralarında 1.5 sn bekleyerek tazeler (global tek-uçuş korumalı).
   */
  async refreshAll({ onProgress = null } = {}) {
    if (this._refreshInFlight) {
      return this._refreshInFlight;
    }

    const runner = (async () => {
      const list = this._state.servers.slice().sort((a, b) => a.order - b.order);
      const total = list.length;
      let okCount = 0;
      let invalidCount = 0;
      let staleCount = 0;
      let flaggedCount = 0;

      for (let i = 0; i < total; i += 1) {
        const rec = list[i];
        const result = await this.fetchDiscordInvite(rec.code);
        this._applyFetchResultToRecord(rec, result);

        if (rec.status === 'ok') okCount += 1;
        else if (rec.status === 'invalid') invalidCount += 1;
        else if (rec.status === 'flagged') flaggedCount += 1;
        else staleCount += 1;

        if (typeof onProgress === 'function') {
          try {
            onProgress({ index: i + 1, total, id: rec.id, code: rec.code, status: rec.status });
          } catch (_) {}
        }

        // Son kayıttan sonra gereksiz bekleme yapma
        if (i < total - 1 && this.refreshStepDelayMs > 0) {
          await this.sleepFn(this.refreshStepDelayMs);
        }
      }

      this._state.lastRefreshAt = new Date(this.nowFn()).toISOString();
      this._persist();
      try {
        this.pruneExpiredAuditLogs();
      } catch (_) {}

      return {
        total,
        okCount,
        staleCount,
        invalidCount,
        flaggedCount,
        refreshedAt: this._state.lastRefreshAt,
      };
    })();

    this._refreshInFlight = runner;
    try {
      return await runner;
    } finally {
      if (this._refreshInFlight === runner) {
        this._refreshInFlight = null;
      }
    }
  }

  async refreshSingle(id) {
    const rec = this._state.servers.find((s) => s.id === id);
    if (!rec) return null;
    const result = await this.fetchDiscordInvite(rec.code);
    this._applyFetchResultToRecord(rec, result);
    this._state.lastRefreshAt = new Date(this.nowFn()).toISOString();
    this._persist();
    return this.getAdminRecordById(id);
  }

  /**
   * Üye /sunucular sayfasını açtığında önbellek 5 dakikadan eskiyse arka planda bir kez tazeler.
   */
  refreshInBackgroundIfStale() {
    if (this._refreshInFlight) return false;
    const lastMs = this._state.lastRefreshAt ? Date.parse(this._state.lastRefreshAt) : 0;
    const nowMs = this.nowFn();
    if (!lastMs || Number.isNaN(lastMs) || nowMs - lastMs >= this.staleBgRefreshMs) {
      this.refreshAll().catch(() => null);
      return true;
    }
    return false;
  }

  /**
   * Üye tetikli yenileme (POST /sunucular/api/yenile) — GLOBAL 60 sn bekleme süresi + tek uçuş.
   */
  getMemberRefreshCooldownLeftMs() {
    const elapsed = this.nowFn() - this._lastMemberRefreshAt;
    if (elapsed >= this.userRefreshCooldownMs) return 0;
    return Math.max(0, this.userRefreshCooldownMs - elapsed);
  }

  async triggerMemberRefresh() {
    const leftMs = this.getMemberRefreshCooldownLeftMs();
    if (leftMs > 0) {
      return {
        ok: false,
        cooldown: true,
        retryAfterMs: leftMs,
        retryAfterSec: Math.ceil(leftMs / 1000),
      };
    }
    this._lastMemberRefreshAt = this.nowFn();
    const summary = await this.refreshAll();
    return { ok: true, cooldown: false, summary };
  }

  /**
   * Sunucu açılışında 20 sn sonra ilk tazeleme, ardından SERVERS_REFRESH_MIN dakikada bir.
   */
  startRefreshScheduler() {
    this.stopRefreshScheduler();
    const intervalMs = getRefreshIntervalMs(this.env);
    this._startupTimer = setTimeout(() => {
      this._startupTimer = null;
      this.refreshAll().catch(() => null);
    }, LIMITS.STARTUP_REFRESH_DELAY_MS);
    if (typeof this._startupTimer.unref === 'function') this._startupTimer.unref();

    this._intervalTimer = setInterval(() => {
      this.refreshAll().catch(() => null);
    }, intervalMs);
    if (typeof this._intervalTimer.unref === 'function') this._intervalTimer.unref();
  }

  stopRefreshScheduler() {
    if (this._startupTimer) {
      clearTimeout(this._startupTimer);
      this._startupTimer = null;
    }
    if (this._intervalTimer) {
      clearInterval(this._intervalTimer);
      this._intervalTimer = null;
    }
  }

  // ============================================================================
  // ÜYE GÖRÜNÜMÜ VE ETag (GİZLİ / FLAGGED / İÇ ALANLAR ASLA DÖNMEZ)
  // ============================================================================

  _toPublicCard(record) {
    const c = record.cache || {};
    const displayName = sanitizeDiscordText(c.name || record.label || record.code, LIMITS.MAX_NAME_LEN);
    const traits = Array.isArray(c.traits)
      ? c.traits.slice(0, LIMITS.MAX_TRAITS).map((t) => {
          const out = { label: sanitizeDiscordText(t.label, LIMITS.MAX_TRAIT_LEN) };
          if (t.emojiUrl && String(t.emojiUrl).startsWith('https://cdn.discordapp.com/')) {
            out.emojiUrl = t.emojiUrl;
          } else if (t.emoji) {
            out.emoji = sanitizeDiscordText(t.emoji, 8);
          }
          return out;
        })
      : [];

    const gameApps = Array.isArray(c.gameApps)
      ? c.gameApps
          .filter((a) => a && typeof a.iconUrl === 'string' && a.iconUrl.startsWith('https://cdn.discordapp.com/'))
          .slice(0, LIMITS.MAX_GAME_APPS)
          .map((a) => ({
            id: String(a.id || ''),
            name: a.name ? sanitizeDiscordText(a.name, 40) : undefined,
            iconUrl: a.iconUrl,
          }))
      : [];

    const iconUrl =
      typeof c.iconUrl === 'string' && c.iconUrl.startsWith('https://cdn.discordapp.com/')
        ? c.iconUrl
        : null;
    const iconAnimatedUrl =
      typeof c.iconAnimatedUrl === 'string' && c.iconAnimatedUrl.startsWith('https://cdn.discordapp.com/')
        ? c.iconAnimatedUrl
        : null;
    const bannerUrl =
      typeof c.bannerUrl === 'string' && c.bannerUrl.startsWith('https://cdn.discordapp.com/')
        ? c.bannerUrl
        : null;

    return {
      id: record.id,
      code: record.code,
      inviteUrl: `https://discord.gg/${record.code}`,
      featured: Boolean(record.featured),
      status: record.status === 'invalid' ? 'invalid' : record.status === 'stale' ? 'stale' : 'ok',
      name: displayName,
      initials: computeServerInitials(displayName),
      description: c.description ? sanitizeDiscordText(c.description, LIMITS.MAX_DESC_LEN) : null,
      iconUrl,
      iconAnimatedUrl,
      bannerUrl,
      brandColor: validateBrandColor(c.brandColor),
      badge: c.badge || null,
      memberCount: toOptionalCount(c.memberCount),
      onlineCount: toOptionalCount(c.onlineCount),
      createdAt: c.createdAt || null,
      traits,
      gameApps,
      fetchedAt: c.fetchedAt || null,
    };
  }

  getPublicServerCards() {
    const visible = this._state.servers
      .filter((s) => !s.hidden && s.status !== 'flagged')
      .sort((a, b) => a.order - b.order);

    const cards = visible.map((s) => this._toPublicCard(s));
    const featuredIdx = cards.findIndex((c) => c.featured);

    return {
      servers: cards,
      featuredIndex: featuredIdx >= 0 ? featuredIdx : 0,
      updatedAt: this._state.lastRefreshAt || this._state.updatedAt || null,
      refreshCooldownLeftMs: this.getMemberRefreshCooldownLeftMs(),
    };
  }

  computePublicEtag(publicPayload = null) {
    const data = publicPayload || this.getPublicServerCards();
    const stableBody = JSON.stringify({
      servers: data.servers,
      featuredIndex: data.featuredIndex,
      updatedAt: data.updatedAt,
    });
    const hash = crypto.createHash('sha1').update(stableBody).digest('hex').slice(0, 20);
    return `W/"srv-${hash}"`;
  }

  // ============================================================================
  // DEVELOPER YÖNETİM İŞLEMLERİ
  // ============================================================================

  getAdminList() {
    const items = this._state.servers
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        ...s,
        preview: this._toPublicCard(s),
      }));

    const invalidCount = items.filter((s) => s.status === 'invalid').length;
    const flaggedCount = items.filter((s) => s.status === 'flagged').length;
    const staleCount = items.filter((s) => s.status === 'stale').length;

    return {
      servers: items,
      totalCount: items.length,
      maxServers: LIMITS.MAX_SERVERS,
      invalidCount,
      flaggedCount,
      staleCount,
      lastRefreshAt: this._state.lastRefreshAt || null,
      updatedAt: this._state.updatedAt || null,
    };
  }

  getAdminRecordById(id) {
    const s = this._state.servers.find((item) => item.id === id);
    if (!s) return null;
    return {
      ...s,
      preview: this._toPublicCard(s),
    };
  }

  _findDuplicate(code, guildId = null, excludeId = null) {
    for (const s of this._state.servers) {
      if (excludeId && s.id === excludeId) continue;
      if (code && s.code.toLowerCase() === code.toLowerCase()) {
        return { reason: 'DUPLICATE_CODE', existing: s };
      }
      if (guildId && s.cache && s.cache.guildId && s.cache.guildId === guildId) {
        return { reason: 'DUPLICATE_GUILD', existing: s };
      }
    }
    return null;
  }

  /**
   * Ekleme öncesi Discord'dan canlı doğrular (henüz diske yazmaz) ve üye kartı önizlemesini döner.
   */
  async verifyInviteForAdd(rawInput) {
    if (this._state.servers.length >= LIMITS.MAX_SERVERS) {
      return { ok: false, code: 'MAX_SERVERS_REACHED' };
    }

    const code = extractInviteCode(rawInput);
    if (!code) {
      return { ok: false, code: 'INVALID_CODE_FORMAT' };
    }

    const dupCode = this._findDuplicate(code, null);
    if (dupCode) {
      return { ok: false, code: dupCode.reason, existingCode: dupCode.existing.code };
    }

    const fetched = await this.fetchDiscordInvite(code);
    if (!fetched.ok) {
      if (fetched.kind === 'not_found') {
        return { ok: false, code: 'INVITE_INVALID' };
      }
      if (fetched.kind === 'rate_limited') {
        return { ok: false, code: 'DISCORD_RATE_LIMITED' };
      }
      return { ok: false, code: 'DISCORD_FETCH_FAILED', detail: fetched.error };
    }

    const dupGuild = this._findDuplicate(null, fetched.cache.guildId);
    if (dupGuild) {
      return { ok: false, code: dupGuild.reason, existingCode: dupGuild.existing.code };
    }

    const tempRecord = {
      id: 'preview',
      code,
      label: fetched.cache.name || code,
      featured: false,
      hidden: false,
      status: fetched.flagCheck && fetched.flagCheck.flagged ? 'flagged' : 'ok',
      cache: fetched.cache,
    };

    return {
      ok: true,
      code,
      cache: fetched.cache,
      flagged: Boolean(fetched.flagCheck && fetched.flagCheck.flagged),
      flaggedReasons: (fetched.flagCheck && fetched.flagCheck.categories) || [],
      flaggedHash: (fetched.flagCheck && fetched.flagCheck.fingerprint) || null,
      expiresAt: fetched.cache.expiresAt || null,
      preview: this._toPublicCard(tempRecord),
    };
  }

  async addServer({ rawInput, label = '', note = '', confirmFlagged = false, actorId = 'developer' }) {
    const verification = await this.verifyInviteForAdd(rawInput);
    if (!verification.ok) {
      return verification;
    }

    if (verification.flagged && !confirmFlagged) {
      return {
        ok: false,
        code: 'FLAGGED_CONFIRM_REQUIRED',
        flaggedReasons: verification.flaggedReasons,
        preview: verification.preview,
      };
    }

    const cleanLabel =
      sanitizeDiscordText(label, LIMITS.MAX_LABEL_LEN) ||
      sanitizeDiscordText(verification.cache.name, LIMITS.MAX_LABEL_LEN) ||
      verification.code;
    const cleanNote = sanitizeDiscordText(note, LIMITS.MAX_NOTE_LEN);

    const nextOrder = this._state.servers.length;
    const nowIso = new Date(this.nowFn()).toISOString();

    const record = {
      id: `srv_${crypto.randomBytes(6).toString('hex')}`,
      code: verification.code,
      label: cleanLabel,
      featured: this._state.servers.length === 0,
      hidden: false,
      order: nextOrder,
      addedBy: String(actorId || 'developer').slice(0, 64),
      addedAt: nowIso,
      note: cleanNote,
      status: verification.flagged ? 'ok' : 'ok',
      consecutiveFailures: 0,
      flaggedReasons: [],
      flaggedHash: null,
      approvedFlagHash: verification.flagged ? verification.flaggedHash : null,
      cache: verification.cache,
    };

    this._state.servers.push(record);
    this._persist();
    this.logAudit(actorId, verification.flagged ? 'add_approved_flagged' : 'add', record.code);

    return {
      ok: true,
      server: this.getAdminRecordById(record.id),
    };
  }

  updateServer(id, { label, note }, actorId = 'developer') {
    const rec = this._state.servers.find((s) => s.id === id);
    if (!rec) return { ok: false, code: 'NOT_FOUND' };

    if (label !== undefined) {
      const cleanLabel = sanitizeDiscordText(label, LIMITS.MAX_LABEL_LEN);
      if (cleanLabel) rec.label = cleanLabel;
    }
    if (note !== undefined) {
      rec.note = sanitizeDiscordText(note, LIMITS.MAX_NOTE_LEN);
    }

    this._persist();
    this.logAudit(actorId, 'edit', rec.code);
    return { ok: true, server: this.getAdminRecordById(rec.id) };
  }

  deleteServer(id, actorId = 'developer') {
    const idx = this._state.servers.findIndex((s) => s.id === id);
    if (idx === -1) return { ok: false, code: 'NOT_FOUND' };
    const [removed] = this._state.servers.splice(idx, 1);

    if (removed.featured && this._state.servers.length > 0) {
      this._state.servers[0].featured = true;
    }
    this._persist();
    this.logAudit(actorId, 'delete', removed.code);
    return { ok: true, deletedCode: removed.code };
  }

  setFeatured(id, actorId = 'developer') {
    const target = this._state.servers.find((s) => s.id === id);
    if (!target) return { ok: false, code: 'NOT_FOUND' };

    for (const s of this._state.servers) {
      s.featured = s.id === id;
    }
    this._persist();
    this.logAudit(actorId, 'feature', target.code);
    return { ok: true, server: this.getAdminRecordById(target.id) };
  }

  toggleHidden(id, actorId = 'developer') {
    const target = this._state.servers.find((s) => s.id === id);
    if (!target) return { ok: false, code: 'NOT_FOUND' };

    target.hidden = !target.hidden;
    this._persist();
    this.logAudit(actorId, target.hidden ? 'hide' : 'show', target.code);
    return { ok: true, server: this.getAdminRecordById(target.id) };
  }

  approveFlagged(id, actorId = 'developer') {
    const target = this._state.servers.find((s) => s.id === id);
    if (!target) return { ok: false, code: 'NOT_FOUND' };

    if (target.cache) {
      const scan = scanServerTextsForFlags(target.cache.name, target.cache.traits);
      target.approvedFlagHash = scan.fingerprint;
    } else if (target.flaggedHash) {
      target.approvedFlagHash = target.flaggedHash;
    }
    target.flaggedReasons = [];
    target.flaggedHash = null;
    target.status = target.cache ? 'ok' : 'stale';

    this._persist();
    this.logAudit(actorId, 'approve_flagged', target.code);
    return { ok: true, server: this.getAdminRecordById(target.id) };
  }

  reorderServers(orderedIds, actorId = 'developer') {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return { ok: false, code: 'INVALID_ORDER' };
    }
    const byId = new Map(this._state.servers.map((s) => [s.id, s]));
    const nextList = [];
    const seen = new Set();

    for (const rawId of orderedIds) {
      const id = String(rawId || '').trim();
      if (!byId.has(id) || seen.has(id)) continue;
      seen.add(id);
      nextList.push(byId.get(id));
    }

    // Listede unutulan kayıt varsa sıranın sonuna koruyarak ekle (veri kaybı olmasın)
    for (const s of this._state.servers) {
      if (!seen.has(s.id)) {
        nextList.push(s);
      }
    }

    nextList.forEach((s, idx) => {
      s.order = idx;
    });
    this._state.servers = nextList;
    this._persist();
    this.logAudit(actorId, 'reorder', nextList.map((s) => s.code).slice(0, 3).join(','));
    return { ok: true, servers: this.getAdminList().servers };
  }
}

let defaultInstance = null;

function getServerDirectory() {
  if (!defaultInstance) {
    defaultInstance = new ServerDirectory();
  }
  return defaultInstance;
}

function setDefaultServerDirectory(instance) {
  if (defaultInstance && defaultInstance !== instance) {
    defaultInstance.stopRefreshScheduler();
  }
  defaultInstance = instance || null;
}

module.exports = {
  ServerDirectory,
  JsonFileServerRepository,
  getServerDirectory,
  setDefaultServerDirectory,
  parseDiscordInvitePayload,
  scanServerTextsForFlags,
  parseRetryAfterMs,
  resolveDefaultServersDir,
};
