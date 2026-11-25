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

  // /geri-bildirim veya /sohbet/api/* oturum süresi dolmuş/girişsiz isteklerde 403 CSRF yerine net 401 SESSION_EXPIRED dön
  if (
    (req.path === '/geri-bildirim' || req.path.startsWith('/sohbet/api/') || req.path.startsWith('/sohbet/moderasyon/api/')) &&
    (!req.session.user || !req.session.user.id)
  ) {
    return res.status(401).json({
      code: 'SESSION_EXPIRED',
      error: 'Oturumun sona ermiş, lütfen tekrar giriş yap.',
    });
  }

  // POST, PUT, DELETE isteklerinde belirteci doğrula
  const token =
    (req.body && req.body._csrf) ||
    (req.query && req.query._csrf) ||
    req.headers['x-csrf-token'] ||
    req.headers['csrf-token'];

  if (!token || token !== req.session.csrfToken) {
    console.warn(`[CSRF UYARISI] Geçersiz CSRF belirteci. IP: ${req.ip}, URL: ${req.originalUrl}`);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(403).json({
        code: 'CSRF_INVALID',
        error: 'Geçersiz veya süresi dolmuş CSRF güvenlik doğrulaması. Lütfen sayfayı yenileyip tekrar deneyin.',
      });
    }
    return res.status(403).render('errors/403', {
      title: req.t ? req.t('errors.403Title') : 'Güvenlik Doğrulama Hatası (403)',
      message: 'CSRF güvenlik anahtarınız eşleşmedi veya süresi doldu. Lütfen sayfayı yenileyiniz.',
    });
  }

  return next();
}

function timingSafeTokenMatch(expected, provided) {
  if (typeof expected !== 'string' || typeof provided !== 'string' || !expected || !provided) {
    return false;
  }
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * GET tabanlı hassas proxy rotalarında (örn. /kayit/roblox-kontrol) CSRF belirtecini açıkça doğrular.
 */
function verifyCsrfRequest(req, res, next) {
  if (!req.session || !req.session.csrfToken) {
    return res.status(403).json({
      code: 'CSRF_INVALID',
      error: req.t ? req.t('errors.csrfInvalid') : 'CSRF güvenlik doğrulaması başarısız.',
    });
  }

  const token =
    req.headers['x-csrf-token'] ||
    req.headers['csrf-token'] ||
    (req.query && req.query._csrf) ||
    (req.body && req.body._csrf);

  if (!timingSafeTokenMatch(req.session.csrfToken, typeof token === 'string' ? token : '')) {
    console.warn(`[CSRF UYARISI] Geçersiz proxy CSRF belirteci. IP: ${req.ip}, URL: ${req.originalUrl}`);
    return res.status(403).json({
      code: 'CSRF_INVALID',
      error: req.t ? req.t('errors.csrfInvalid') : 'Geçersiz veya süresi dolmuş CSRF güvenlik doğrulaması.',
    });
  }

  return next();
}

csrfProtection.csrfProtection = csrfProtection;
csrfProtection.verifyCsrfToken = csrfProtection;
csrfProtection.verifyCsrfRequest = verifyCsrfRequest;

module.exports = csrfProtection;
