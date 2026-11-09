const crypto = require('crypto');
const appConfig = require('../config/app.config');
const { BotApiError } = require('../services/botApiClient');

/**
 * Log metinlerinden secret ve token değerlerini temizler (asla sızdırmaz).
 */
function sanitizeLogText(input) {
  if (!input) return '';
  let text = typeof input === 'string' ? input : String(input);

  const secrets = [
    appConfig.API_SECRET,
    appConfig.DISCORD_CLIENT_SECRET,
    appConfig.SESSION_SECRET,
  ].filter((s) => typeof s === 'string' && s.trim().length >= 4);

  for (const secretVal of secrets) {
    text = text.split(secretVal).join('[GİZLİ_ANAHTAR]');
  }

  // Bearer token, OAuth token ve çerez değerlerini maskele
  text = text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [MASKELEME]')
    .replace(/(access_token|refresh_token|client_secret|api_secret|session_secret)=([^&\s]+)/gi, '$1=[MASKELEME]')
    .replace(/piyade\.sid=([^;\s]+)/gi, 'piyade.sid=[MASKELEME]');

  return text;
}

/**
 * Kullanıcıya ekranda gösterilecek ve Railway loglarında aratılabilecek 8 karakterli rastgele Hata Kodu üretir.
 */
function generateErrorCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

/**
 * 404 Bulunamadı Yakalayıcı
 */
function notFoundHandler(req, res) {
  res.status(404).render('errors/404', {
    title: req.t ? req.t('errors.404Title') : 'Sayfa Bulunamadı — Piyade Team | TSB',
    url: req.originalUrl,
  });
}

/**
 * Global Hata Yakalayıcı
 * - Her hatada 8 karakterli rastgele "Hata Kodu" üretir, hem sayfada gösterir hem Railway loguna yazar.
 * - Mesaj + Stack + İstek Yolunu secret/token değerlerini maskeleyerek Railway loglarına yazar.
 * - Bot REST API'sine erişilemiyorsa (isOffline = true) 500 yerine "bot-offline" sayfasını gösterir.
 */
function globalErrorHandler(err, req, res, next) {
  const errorCode = generateErrorCode();
  const method = req ? req.method : 'GET';
  const requestPath = sanitizeLogText(req ? req.originalUrl || req.url || '/' : '/');
  const safeMessage = sanitizeLogText(err && err.message ? err.message : 'Bilinmeyen sunucu hatası');
  const safeStack = sanitizeLogText(err && err.stack ? err.stack : 'Stack bilgisi mevcut değil');
  const errorCategory = (err && (err.errorCategory || err.code || err.name)) || 'INTERNAL_SERVER_ERROR';
  const statusCode = (err && err.statusCode) || 500;

  console.error('================================================================');
  console.error(`❌ [SUNUCU HATASI] Hata Kodu: ${errorCode}`);
  console.error(`📍 İstek Yolu  : ${method} ${requestPath}`);
  console.error(`🏷️ Hata Sınıfı : ${errorCategory} (HTTP ${statusCode})`);
  console.error(`💬 Hata Mesajı : ${safeMessage}`);
  console.error(`📄 Stack İzleri:\n${safeStack}`);
  console.error('================================================================');

  // Bot API'ye ulaşılamıyorsa 500 yerine özel "bot-offline" sayfasını göster
  if ((err instanceof BotApiError && err.isOffline) || (err && err.isOffline)) {
    return res.status(503).render('errors/bot-offline', {
      title: req.t ? req.t('errors.botOfflineTitle') : 'Bot API Servisine Ulaşılamıyor — Piyade Team | TSB',
      errorMessage: safeMessage,
      errorCode,
      botApiUrl: appConfig.IS_PROD ? 'Railway Bot API' : appConfig.BOT_API_URL,
    });
  }

  return res.status(statusCode).render('errors/500', {
    title: req.t ? req.t('errors.500Title') : 'Sunucu Hatası — Piyade Team | TSB',
    errorCode,
    message: appConfig.IS_PROD
      ? req.t
        ? req.t('errors.500DefaultMsg')
        : 'İşleminiz sırasında beklenmeyen bir hata oluştu. Lütfen daha sonra tekrar deneyin.'
      : safeMessage,
    stack: appConfig.IS_PROD ? null : safeStack,
  });
}

module.exports = {
  sanitizeLogText,
  generateErrorCode,
  notFoundHandler,
  globalErrorHandler,
};
