const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;

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

module.exports = {
  generalLimiter,
  globalLimiter: generalLimiter,
  authLimiter,
  formLimiter,
  formActionLimiter: formLimiter,
  robloxLookupLimiter,
};
