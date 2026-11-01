const crypto = require('crypto');

/**
 * Oturum tabanlı hafif ve tam uyumlu CSRF Güvenlik Katmanı
 */
function csrfProtection(req, res, next) {
  // Oturum yoksa devam et
  if (!req.session) {
    return next();
  }

  // Oturumda CSRF belirteci yoksa üret
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }

  // Tüm şablonların (EJS) erişebilmesi için locals'a aktar
  res.locals.csrfToken = req.session.csrfToken;

  // GET, HEAD, OPTIONS gibi durum değiştirmeyen istekler kontrolden muaftır
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  // POST, PUT, DELETE isteklerinde belirteci doğrula
  const token =
    (req.body && req.body._csrf) ||
    req.headers['x-csrf-token'] ||
    req.headers['csrf-token'];

  if (!token || token !== req.session.csrfToken) {
    console.warn(`[CSRF UYARISI] Geçersiz CSRF belirteci. IP: ${req.ip}, URL: ${req.originalUrl}`);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(403).json({
        error: 'Geçersiz veya süresi dolmuş CSRF güvenlik doğrulaması. Lütfen sayfayı yenileyip tekrar deneyin.',
      });
    }
    return res.status(403).render('errors/403', {
      title: 'Güvenlik Doğrulama Hatası (403)',
      message: 'CSRF güvenlik anahtarınız eşleşmedi veya süresi doldu. Lütfen sayfayı yenileyiniz.',
    });
  }

  next();
}

module.exports = csrfProtection;
