const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const chatConfig = require('../config/chat.config');

/**
 * Genel Site Rate Limiter (1 dakikada max 150 istek)
 */
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  message: {
    error: 'Çok fazla istek gönderdiniz. Lütfen bir süre sonra tekrar deneyiniz.',
  },
});

/**
 * Giriş / OAuth2 Rate Limiter (5 dakikada max 25 istek)
 */
const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  message: {
    error: 'Giriş işlemleri için çok fazla istek yapıldı. Lütfen 5 dakika sonra deneyiniz.',
  },
});

/**
 * Form Gönderim Limiter'ı (Kayıt / Uyarı çağrısı) (1 dakikada max 15 işlem)
 */
const formLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  message: {
    error: 'İşlem sınırı aşıldı. Lütfen 1 dakika bekleyiniz.',
  },
});

/**
 * Roblox Hesap Kontrol Proxy Limiter'ı (Kullanıcı başına 1 dakikada max 10 istek)
 */
const robloxLookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  keyGenerator: (req) => {
    const uid = req.session && req.session.user && req.session.user.id;
    if (uid) return `roblox_lookup_user:${String(uid)}`;
    return `roblox_lookup_ip:${ipKeyGenerator(req.ip)}`;
  },
  handler: (req, res) => {
    const msg =
      req.t
        ? req.t('register.robloxLookupRateLimited')
        : 'Çok fazla Roblox sorgusu yaptınız. Lütfen 1 dakika bekleyiniz.';
    return res.status(429).json({
      code: 'RATE_LIMITED',
      status: 'TEMPORARY_ERROR',
      error: msg,
    });
  },
});

/**
 * Kişisel Etkinliğim API Limiter'ı (Kullanıcı başına 1 dakikada max 20 istek)
 */
const activityApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  keyGenerator: (req) => {
    const uid = req.session && req.session.user && req.session.user.id;
    if (uid) return `activity_user:${String(uid)}`;
    return `activity_ip:${ipKeyGenerator(req.ip)}`;
  },
  handler: (req, res) => {
    const msg = req.t
      ? req.t('activityPanel.rateLimited')
      : 'Çok sık etkinlik yenilemesi yaptınız. Lütfen biraz bekleyin.';
    return res.status(429).json({
      ok: false,
      code: 'RATE_LIMITED',
      error: msg,
    });
  },
});

/**
 * Herkese Açık En Çok Oynanan Oyunlar API Limiter'ı (IP başına 1 dakikada max 30 istek)
 */
const publicStatsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  handler: (req, res) => {
    const msg = req.t
      ? req.t('home.topGamesError')
      : 'Çok fazla istek gönderdiniz. Lütfen bir süre sonra tekrar deneyiniz.';
    return res.status(429).json({
      ok: false,
      code: 'RATE_LIMITED',
      error: msg,
    });
  },
});

/**
 * Sohbet Mesaj Gönderme Limiter'ı (Kullanıcı başına 1 dakikada max 30 mesaj)
 */
const chatMessageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: chatConfig.LIMITS.MAX_MESSAGES_PER_MIN || 30,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  keyGenerator: (req) => {
    const uid = req.session && req.session.user && req.session.user.id;
    if (uid) return `chat_msg_user:${String(uid)}`;
    return `chat_msg_ip:${ipKeyGenerator(req.ip)}`;
  },
  handler: (req, res) => {
    const msg = req.t
      ? req.t('chat.errRateLimited')
      : 'Çok hızlı mesaj gönderiyorsunuz. Lütfen biraz bekleyin.';
    return res.status(429).json({
      ok: false,
      code: 'RATE_LIMITED',
      error: msg,
    });
  },
});

/**
 * Sohbet Dosya Yükleme Limiter'ı (Kullanıcı başına 1 dakikada max 10 yükleme)
 */
const chatUploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: chatConfig.FILES.MAX_UPLOADS_PER_MIN || 10,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  keyGenerator: (req) => {
    const uid = req.session && req.session.user && req.session.user.id;
    if (uid) return `chat_upload_user:${String(uid)}`;
    return `chat_upload_ip:${ipKeyGenerator(req.ip)}`;
  },
  handler: (req, res) => {
    const msg = req.t
      ? req.t('chat.errUploadRateLimited')
      : 'Çok sık dosya yüklediniz. Lütfen 1 dakika bekleyin.';
    return res.status(429).json({
      ok: false,
      code: 'RATE_LIMITED',
      error: msg,
    });
  },
});

/**
 * Sohbet Moderasyon Paneli Limiter'ı (Kullanıcı başına 1 dakikada max 60 istek)
 */
const chatModLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  keyGenerator: (req) => {
    const uid = req.session && req.session.user && req.session.user.id;
    if (uid) return `chat_mod_user:${String(uid)}`;
    return `chat_mod_ip:${ipKeyGenerator(req.ip)}`;
  },
  handler: (req, res) => {
    return res.status(429).json({
      ok: false,
      code: 'RATE_LIMITED',
      error: 'Moderasyon paneli hız sınırı aşıldı. Lütfen kısa süre sonra tekrar deneyin.',
    });
  },
});

module.exports = {
  generalLimiter,
  globalLimiter: generalLimiter,
  authLimiter,
  formLimiter,
  formActionLimiter: formLimiter,
  robloxLookupLimiter,
  activityApiLimiter,
  publicStatsLimiter,
  chatMessageLimiter,
  chatUploadLimiter,
  chatModLimiter,
};
