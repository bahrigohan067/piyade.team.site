const appConfig = require('../config/app.config');
const { BotApiError } = require('../services/botApiClient');

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
 * Bot REST API'sine erişilemiyorsa (isOffline = true) anlaşılır "Bot API Servisine Ulaşılamıyor" sayfası gösterir.
 */
function globalErrorHandler(err, req, res, next) {
  console.error('[WEB SUNUCU HATASI]:', err.message);

  // Bot API'ye ulaşılamıyorsa özel 503 sayfasını göster
  if (err instanceof BotApiError && err.isOffline) {
    return res.status(503).render('errors/bot-offline', {
      title: req.t ? req.t('errors.botOfflineTitle') : 'Bot API Servisine Ulaşılamıyor — Piyade Team | TSB',
      errorMessage: err.message,
      botApiUrl: appConfig.IS_PROD ? 'Railway Bot API' : appConfig.BOT_API_URL,
    });
  }

  const statusCode = err.statusCode || 500;
  return res.status(statusCode).render('errors/500', {
    title: req.t ? req.t('errors.500Title') : 'Sunucu Hatası — Piyade Team | TSB',
    message: appConfig.IS_PROD
      ? req.t
        ? req.t('errors.500DefaultMsg')
        : 'İşleminiz sırasında beklenmeyen bir hata oluştu. Lütfen daha sonra tekrar deneyin.'
      : err.message,
    stack: appConfig.IS_PROD ? null : err.stack,
  });
}

module.exports = {
  notFoundHandler,
  globalErrorHandler,
};
