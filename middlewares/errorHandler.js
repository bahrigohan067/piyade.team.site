const { BotApiUnavailableError } = require('../services/botApiClient');
const appConfig = require('../config/app.config');

/**
 * 404 Bulunamadı Yakalayıcısı
 */
function notFoundHandler(req, res) {
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(404).json({ error: 'Sayfa veya API endpoint bulunamadı.' });
  }

  res.status(404).render('errors/404', {
    title: 'Sayfa Bulunamadı (404)',
    url: req.originalUrl,
  });
}

/**
 * Global Hata Yakalayıcı Middleware
 */
function globalErrorHandler(err, req, res, next) {
  console.error(`[SUNUCU HATASI] ${req.method} ${req.originalUrl}:`, err);

  // 1. Bot REST API Ulaşılamaz / Çevrimdışı Hatası
  if (err instanceof BotApiUnavailableError || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(503).json({
        error: 'Bot REST API servisine şu anda ulaşılamıyor.',
        details: err.message,
      });
    }

    return res.status(503).render('errors/bot-offline', {
      title: 'Bot API Çevrimdışı (503)',
      botApiUrl: appConfig.BOT_API_URL,
      errorMessage: err.message,
    });
  }

  // 2. JSON İstekleri için Hata Yanıtı
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(err.status || 500).json({
      error: err.message || 'Sunucuda beklenmeyen bir hata meydana geldi.',
    });
  }

  // 3. Genel 500 Sayfası
  res.status(err.status || 500).render('errors/500', {
    title: 'Sunucu Hatası (500)',
    message: err.message || 'Sunucu içi bir hata meydana geldi.',
    stack: !appConfig.IS_PRODUCTION ? err.stack : null,
  });
}

module.exports = {
  notFoundHandler,
  globalErrorHandler,
};
