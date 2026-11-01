const rateLimit = require('express-rate-limit');

/**
 * Genel Site Rate Limiter (1 dakikada max 150 istek)
 */
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
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
  message: {
    error: 'Giriş işlemleri için çok fazla istek yapıldı. Lütfen 5 dakika sonra deneyiniz.',
  },
});

/**
 * Form Gönderim Limiter'ı (Kayıt / Uyarı / Takviye çağrısı) (1 dakikada max 15 işlem)
 */
const formLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'İşlem sınırı aşıldı. Lütfen 1 dakika bekleyiniz.',
  },
});

module.exports = {
  generalLimiter,
  authLimiter,
  formLimiter,
};
