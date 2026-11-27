/**
 * ==============================================================================
 * 🌐 PİYADE SUNUCULARIMIZ — MERKEZİ KONFİGÜRASYON VE SAF YARDIMCILAR
 * ==============================================================================
 * - Nexus UI 3D Card Carousel varsayılan props değerleri (saf Vanilla JS + CSS)
 * - İlk kurulum tohum (seed) sunucuları (kodlar AYNEN korunur, tahminle değiştirilmez)
 * - SSRF-güvenli davet kodu ayrıştırıcı, BigInt snowflake tarih türetici,
 *   yalnızca https://cdn.discordapp.com üreten görsel URL kurucuları ve metin temizleyici
 * ==============================================================================
 */

const INVITE_CODE_REGEX = /^[A-Za-z0-9-]{2,32}$/;
const SNOWFLAKE_REGEX = /^\d{15,22}$/;
const DISCORD_HASH_REGEX = /^(?:a_)?[A-Za-z0-9_-]{2,64}$/;
const BRAND_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

const DISCORD_EPOCH_MS = 1420070400000n;
const DISCORD_API_ORIGIN = 'https://discord.com';
const DISCORD_CDN_ORIGIN = 'https://cdn.discordapp.com';
const DISCORD_USER_AGENT = 'PiyadeWorld-Site/1.0';

const ALLOWED_INVITE_HOSTS = new Set([
  'discord.gg',
  'www.discord.gg',
  'discord.com',
  'www.discord.com',
  'discordapp.com',
  'www.discordapp.com',
]);

const LIMITS = Object.freeze({
  MAX_SERVERS: 24,
  MAX_NAME_LEN: 60,
  MAX_LABEL_LEN: 60,
  MAX_TRAIT_LEN: 30,
  MAX_DESC_LEN: 200,
  MAX_NOTE_LEN: 300,
  MAX_TRAITS: 6,
  MAX_GAME_APPS: 6,
  DISCORD_TIMEOUT_MS: 6000,
  REFRESH_STEP_DELAY_MS: 1500,
  STARTUP_REFRESH_DELAY_MS: 20000,
  DEFAULT_REFRESH_MIN: 10,
  MIN_REFRESH_MIN: 1,
  MAX_REFRESH_MIN: 1440,
  STALE_BG_REFRESH_MS: 5 * 60 * 1000,
  USER_REFRESH_COOLDOWN_MS: 60 * 1000,
  APP_ICON_CACHE_TTL_MS: 24 * 60 * 60 * 1000,
  AUDIT_RETENTION_DAYS: 365,
  CONSECUTIVE_404_THRESHOLD: 2,
  VERIFY_RATE_LIMIT_PER_MIN: 6,
});

/**
 * Nexus UI 3D Card Carousel Props (https://www.nexus-ui.com/components/card-carousel-3d)
 * Tüm hareket sabitleri ve zamanlayıcılar tek yerden yönetilir.
 */
const CAROUSEL_CONFIG = Object.freeze({
  radius: null, // boşsa r = (itemWidth / 2 + 16) / Math.tan(Math.PI / N) ile otomatik hesaplanır
  itemWidth: 300,
  itemHeight: 410,
  mobileBreakpoint: 640,
  mobileItemWidth: 252,
  mobileItemHeight: 360,
  edgePadding: 16,
  perspective: 1500,
  autoRotate: true,
  autoSpeed: 1,
  scrollSpeed: 1,
  direction: 'cw', // 'cw' | 'ccw'
  autoplay: false,
  autoplayIntervalMs: 2400,
  autoRotateStartDelayMs: 2500,
  autoRotateResumeDelayMs: 3500,
  enableSound: true,
  hintTr: 'Sürükle, kaydır veya ok tuşlarını kullan.',
  hintEn: 'Drag, scroll or use the arrow keys.',
  pollIntervalMs: 60000,
});

/**
 * İlk kurulum tohum (seed) listesi — dosya yoksa bu sırayla oluşturulur.
 * UYARI: 3. ve 4. kodlar 9 karakterdir; tahminle ASLA değiştirilmez.
 */
const SEED_SERVERS = Object.freeze([
  Object.freeze({ code: 'y2aA9U5RyR', label: 'Piyade World | Satış', featured: true }),
  Object.freeze({ code: 'TvuAbUbKJj', label: 'Piyade World | Ana Sunucu', featured: false }),
  Object.freeze({ code: 'CnVBC6JTg', label: 'Piyade | SCP Asker Kampı', featured: false }),
  Object.freeze({ code: 'kTVBJtMtG', label: 'Piyade RP | Kapalı', featured: false }),
  Object.freeze({ code: 'm4BaGwRsNu', label: 'Piyade Team | Jail Break', featured: false }),
  Object.freeze({ code: 'GW2za6Jpdr', label: 'PİYADELER | OLUŞUM', featured: false }),
]);

// Kontrol karakterleri, sıfır genişlikli karakterler ve BiDi yön değiştiriciler
const UNSAFE_CHARS_REGEX = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

/**
 * Discord'dan veya formdan gelen güvenilmez metni temizler ve uzunluğunu sınırlar.
 */
function sanitizeDiscordText(raw, maxLen = LIMITS.MAX_NAME_LEN) {
  if (raw === null || raw === undefined) return '';
  const cleaned = String(raw)
    .replace(UNSAFE_CHARS_REGEX, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const limit = Number.isInteger(maxLen) && maxLen > 0 ? maxLen : LIMITS.MAX_NAME_LEN;
  if (cleaned.length <= limit) return cleaned;
  return cleaned.slice(0, limit).trim();
}

/**
 * Ortam değişkeninden (SERVERS_REFRESH_MIN) tazeleme aralığını (ms) okur.
 */
function getRefreshIntervalMs(envObj = process.env) {
  const raw = envObj && envObj.SERVERS_REFRESH_MIN !== undefined ? String(envObj.SERVERS_REFRESH_MIN).trim() : '';
  const parsed = Number.parseInt(raw, 10);
  const mins =
    Number.isFinite(parsed) && parsed >= LIMITS.MIN_REFRESH_MIN && parsed <= LIMITS.MAX_REFRESH_MIN
      ? parsed
      : LIMITS.DEFAULT_REFRESH_MIN;
  return mins * 60 * 1000;
}

/**
 * SSRF-güvenli Discord davet kodu ayrıştırıcı.
 * Kabul edilen biçimler:
 *  - KOD
 *  - discord.gg/KOD
 *  - discord.com/invite/KOD
 *  - discordapp.com/invite/KOD
 *  (isteğe bağlı http:// veya https://, www., sondaki / veya ?sorgu)
 *
 * Herhangi bir başka alan adı, IP, yol geçişi (..) veya geçersiz karakter reddedilir.
 * @returns {string|null} Temiz davet kodu veya geçersizse null
 */
function extractInviteCode(rawInput) {
  if (typeof rawInput !== 'string') return null;
  const trimmed = rawInput.replace(UNSAFE_CHARS_REGEX, '').trim();
  if (!trimmed || trimmed.length > 256) return null;

  // Doğrudan çıplak kod (slash, nokta, boşluk, protokol yok)
  if (!trimmed.includes('/') && !trimmed.includes('.') && !trimmed.includes(':') && !/\s/.test(trimmed)) {
    return INVITE_CODE_REGEX.test(trimmed) ? trimmed : null;
  }

  // Boşluk veya tehlikeli protokoller içeriyorsa doğrudan reddet
  if (/\s/.test(trimmed)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  const candidateUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed;
  try {
    parsed = new URL(candidateUrl);
  } catch (_) {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.username || parsed.password || parsed.port) return null;

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_INVITE_HOSTS.has(host)) return null;

  // Yol segmentlerini incele (path traversal engeli dahil)
  const rawPathname = parsed.pathname || '';
  if (rawPathname.includes('..') || rawPathname.includes('\\')) return null;

  const segments = rawPathname.split('/').filter(Boolean);

  let code = null;
  if (host === 'discord.gg' || host === 'www.discord.gg') {
    if (segments.length === 1) {
      code = segments[0];
    } else if (segments.length === 2 && segments[0].toLowerCase() === 'invite') {
      code = segments[1];
    }
  } else if (
    host === 'discord.com' ||
    host === 'www.discord.com' ||
    host === 'discordapp.com' ||
    host === 'www.discordapp.com'
  ) {
    if (segments.length === 2 && segments[0].toLowerCase() === 'invite') {
      code = segments[1];
    }
  }

  if (!code || !INVITE_CODE_REGEX.test(code)) return null;
  return code;
}

/**
 * Discord guild snowflake kimliğinden oluşturulma tarihini BigInt ile türetir.
 * Snowflake kesinlikle Number'a çevrilmeden bit kaydırılır.
 * @returns {string|null} ISO-8601 tarih dizesi veya null
 */
function snowflakeToCreatedAt(guildId) {
  if (guildId === null || guildId === undefined) return null;
  const raw = String(guildId).trim();
  if (!SNOWFLAKE_REGEX.test(raw)) return null;
  try {
    const idBig = BigInt(raw);
    const epochMsBig = (idBig >> 22n) + DISCORD_EPOCH_MS;
    const epochMs = Number(epochMsBig);
    if (!Number.isFinite(epochMs) || epochMs < 1420070400000 || epochMs > 4102444800000) {
      return null;
    }
    return new Date(epochMs).toISOString();
  } catch (_) {
    return null;
  }
}

/**
 * Oluşturulma tarihini Intl kısa ay + yıl biçimine çevirir.
 * Örn: TR "Eki 2026" / EN "Oct 2026"
 */
function formatCreatedMonth(isoOrMs, lang = 'tr') {
  if (!isoOrMs) return '';
  const dt = new Date(isoOrMs);
  if (Number.isNaN(dt.getTime())) return '';
  const locale = lang === 'en' ? 'en-US' : 'tr-TR';
  try {
    return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(dt);
  } catch (_) {
    return `${dt.getUTCFullYear()}`;
  }
}

/**
 * Discord CDN görsel adresleri — YALNIZCA https://cdn.discordapp.com üretir.
 */
function buildGuildIconUrls(guildId, iconHash) {
  const gid = String(guildId || '').trim();
  const hash = String(iconHash || '').trim();
  if (!SNOWFLAKE_REGEX.test(gid) || !DISCORD_HASH_REGEX.test(hash)) {
    return { iconUrl: null, iconAnimatedUrl: null, isAnimated: false };
  }
  const isAnimated = hash.startsWith('a_');
  const iconUrl = `${DISCORD_CDN_ORIGIN}/icons/${gid}/${hash}.png?size=256`;
  const iconAnimatedUrl = isAnimated ? `${DISCORD_CDN_ORIGIN}/icons/${gid}/${hash}.gif?size=256` : null;
  return { iconUrl, iconAnimatedUrl, isAnimated };
}

function buildGuildBannerUrl(guildId, bannerHash, splashHash = null) {
  const gid = String(guildId || '').trim();
  if (!SNOWFLAKE_REGEX.test(gid)) return null;
  const bHash = String(bannerHash || '').trim();
  if (bHash && DISCORD_HASH_REGEX.test(bHash)) {
    return `${DISCORD_CDN_ORIGIN}/banners/${gid}/${bHash}.png?size=600`;
  }
  const sHash = String(splashHash || '').trim();
  if (sHash && DISCORD_HASH_REGEX.test(sHash)) {
    return `${DISCORD_CDN_ORIGIN}/splashes/${gid}/${sHash}.png?size=600`;
  }
  return null;
}

function buildEmojiUrl(emojiId) {
  const eid = String(emojiId || '').trim();
  if (!SNOWFLAKE_REGEX.test(eid)) return null;
  return `${DISCORD_CDN_ORIGIN}/emojis/${eid}.png?size=32`;
}

function buildAppIconUrl(appId, iconHash) {
  const aid = String(appId || '').trim();
  const hash = String(iconHash || '').trim();
  if (!SNOWFLAKE_REGEX.test(aid) || !DISCORD_HASH_REGEX.test(hash)) return null;
  return `${DISCORD_CDN_ORIGIN}/app-icons/${aid}/${hash}.png?size=64`;
}

function validateBrandColor(raw) {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 0xffffff) {
    return `#${raw.toString(16).padStart(6, '0')}`;
  }
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (BRAND_COLOR_REGEX.test(trimmed)) return trimmed.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed.toLowerCase()}`;
  return null;
}

/**
 * Silindir yarıçap hesabı: N < 3 için 3B kapalı (0), N >= 3 için r = (itemWidth / 2 + edgePadding) / tan(PI / N)
 */
function computeCarouselRadius(count, itemWidth = CAROUSEL_CONFIG.itemWidth, edgePadding = CAROUSEL_CONFIG.edgePadding) {
  const n = Number(count);
  if (!Number.isFinite(n) || n < 3) return 0;
  const w = Number.isFinite(Number(itemWidth)) && Number(itemWidth) > 0 ? Number(itemWidth) : CAROUSEL_CONFIG.itemWidth;
  const pad = Number.isFinite(Number(edgePadding)) && Number(edgePadding) >= 0 ? Number(edgePadding) : CAROUSEL_CONFIG.edgePadding;
  return (w / 2 + pad) / Math.tan(Math.PI / n);
}

/**
 * Baş harflerden güvenli 1-2 karakterlik yer tutucu üretir (sunucu simgesi yoksa).
 */
function computeServerInitials(name) {
  const clean = sanitizeDiscordText(name, LIMITS.MAX_NAME_LEN);
  if (!clean) return 'PW';
  const words = clean.split(/[\s|/_-]+/).filter(Boolean);
  if (words.length >= 2) {
    return `${Array.from(words[0])[0] || ''}${Array.from(words[1])[0] || ''}`.toUpperCase();
  }
  const chars = Array.from(clean.replace(/[\s|/_-]+/g, ''));
  return chars.slice(0, 2).join('').toUpperCase() || 'PW';
}

/**
 * İstemciye gönderilecek carousel props nesnesini seçili dile göre döndürür.
 */
function getClientCarouselConfig(lang = 'tr', overrides = {}) {
  const isEn = lang === 'en';
  return Object.assign({}, CAROUSEL_CONFIG, {
    hint: isEn ? CAROUSEL_CONFIG.hintEn : CAROUSEL_CONFIG.hintTr,
  }, overrides || {});
}

module.exports = {
  INVITE_CODE_REGEX,
  SNOWFLAKE_REGEX,
  DISCORD_HASH_REGEX,
  BRAND_COLOR_REGEX,
  DISCORD_EPOCH_MS,
  DISCORD_API_ORIGIN,
  DISCORD_CDN_ORIGIN,
  DISCORD_USER_AGENT,
  LIMITS,
  CAROUSEL_CONFIG,
  SEED_SERVERS,
  sanitizeDiscordText,
  getRefreshIntervalMs,
  extractInviteCode,
  snowflakeToCreatedAt,
  formatCreatedMonth,
  buildGuildIconUrls,
  buildGuildBannerUrl,
  buildEmojiUrl,
  buildAppIconUrl,
  validateBrandColor,
  computeCarouselRadius,
  computeServerInitials,
  getClientCarouselConfig,
};
