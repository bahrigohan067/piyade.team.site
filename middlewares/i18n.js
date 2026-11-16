const fs = require('fs');
const path = require('path');
const appConfig = require('../config/app.config');
const siteConfig = require('../config/site.config');
const nexusConfig = require('../config/nexus.config');
const feedbackConfig = require('../config/feedback.config');
const brandConfig = require('../config/brand.config');
const { generateIdempotencyKey } = require('./idempotency');

const LOCALES_DIR = path.join(__dirname, '..', 'locales');

/**
 * locales/ klasöründeki JSON dosyalarından desteklenen dil listesini ve sözlükleri tek kaynaktan yükler.
 * Yeni bir dil eklemek için locales/<dilKodu>.json dosyası eklemek yeterlidir.
 */
function loadLocalesFromDisk(dirPath = LOCALES_DIR) {
  const discovered = {};
  if (fs.existsSync(dirPath)) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        const code = path.basename(entry.name, '.json').toLowerCase();
        try {
          const parsed = JSON.parse(fs.readFileSync(path.join(dirPath, entry.name), 'utf8'));
          if (parsed && typeof parsed === 'object') {
            discovered[code] = parsed;
          }
        } catch (_) {}
      }
    }
  }

  const orderedCodes = [];
  if (discovered.tr) orderedCodes.push('tr');
  if (discovered.en) orderedCodes.push('en');
  for (const code of Object.keys(discovered).sort()) {
    if (!orderedCodes.includes(code)) {
      orderedCodes.push(code);
    }
  }

  return {
    supportedLangs: orderedCodes.length > 0 ? orderedCodes : ['tr', 'en'],
    localesMap: discovered,
  };
}

const { supportedLangs: SUPPORTED_LANGS, localesMap: LOCALES } = loadLocalesFromDisk();
const LANG_PREFIX_REGEX = new RegExp(`^\\/(${SUPPORTED_LANGS.join('|')})(?:(\\/.*))?$`, 'i');

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Ham Cookie başlığından belirli bir çerez değerini okur.
 */
function parseCookieHeader(cookieHeader, name) {
  if (!cookieHeader || typeof cookieHeader !== 'string') return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [rawKey, ...rawVal] = part.trim().split('=');
    if (rawKey === name) {
      try {
        return decodeURIComponent(rawVal.join('='));
      } catch (_) {
        return rawVal.join('=');
      }
    }
  }
  return null;
}

/**
 * Accept-Language başlığından varsayılan dili algılar.
 */
function detectFromAcceptLanguage(acceptLanguageHeader) {
  if (!acceptLanguageHeader || typeof acceptLanguageHeader !== 'string') {
    return SUPPORTED_LANGS[0] || 'tr';
  }

  const tokens = acceptLanguageHeader
    .split(',')
    .map((item) => {
      const [tagPart, qPart] = item.trim().split(';');
      const code = (tagPart || '').trim().toLowerCase().slice(0, 2);
      let q = 1.0;
      if (qPart && qPart.trim().startsWith('q=')) {
        const parsed = parseFloat(qPart.trim().slice(2));
        if (!Number.isNaN(parsed)) q = parsed;
      }
      return { code, q };
    })
    .filter((x) => SUPPORTED_LANGS.includes(x.code))
    .sort((a, b) => b.q - a.q);

  if (tokens.length > 0) {
    return tokens[0].code;
  }

  return SUPPORTED_LANGS[0] || 'tr';
}

/**
 * Nokta notasyonlu anahtarı ilgili dil sözlüğünden çözümler.
 */
function translate(lang, key, fallback = '') {
  const dict = LOCALES[lang] || LOCALES.tr || {};
  const fallbackDict = LOCALES.tr || {};

  const segments = String(key || '').split('.');
  let current = dict;
  for (const seg of segments) {
    if (current && typeof current === 'object' && seg in current) {
      current = current[seg];
    } else {
      current = undefined;
      break;
    }
  }

  if (typeof current === 'string') return current;

  let fbCurrent = fallbackDict;
  for (const seg of segments) {
    if (fbCurrent && typeof fbCurrent === 'object' && seg in fbCurrent) {
      fbCurrent = fbCurrent[seg];
    } else {
      fbCurrent = undefined;
      break;
    }
  }

  if (typeof fbCurrent === 'string') return fbCurrent;
  return fallback || key;
}

/**
 * Dil tercihini 1 yıl geçerli çereze kaydeder.
 */
function setLanguageCookie(res, lang) {
  const validLang = SUPPORTED_LANGS.includes(lang) ? lang : SUPPORTED_LANGS[0] || 'tr';
  res.cookie('lang', validLang, {
    maxAge: ONE_YEAR_MS,
    httpOnly: false,
    secure: appConfig.IS_PROD,
    sameSite: 'lax',
    path: '/',
  });
}

/**
 * Çok Dilli (i18n) ve SEO Meta Middleware
 * - Desteklenen dil URL öneklerini ve ?lang=... sorgu parametrelerini doğrudan destekler.
 * - Çerez ve Accept-Language yalnızca URL'de dil belirtilmediğinde varsayılan dil için kullanılır.
 * - Her istek için res.locals.seo, res.locals.supportedLangs ve res.locals.siteConfig nesnelerini hazırlar.
 * - Girişli/özel sayfalarda otomatik olarak X-Robots-Tag: noindex, nofollow başlığı ekler.
 */
function i18nMiddleware(req, res, next) {
  const originalPath = req.path || '/';
  const prefixMatch = originalPath.match(LANG_PREFIX_REGEX);
  const queryLang = req.query && req.query.lang ? String(req.query.lang).toLowerCase() : null;

  let activeLang = null;
  let langPrefix = null;
  let strippedPath = originalPath;

  if (prefixMatch) {
    langPrefix = prefixMatch[1].toLowerCase();
    activeLang = langPrefix;
    strippedPath = prefixMatch[2] || '/';
    setLanguageCookie(res, activeLang);

    // Express rotalarının (/ , /kurallar, /kayit, /etkilesim) aynı şekilde eşleşmesi için iç URL'yi normalize et
    const queryIndex = req.url.indexOf('?');
    const querySuffix = queryIndex !== -1 ? req.url.slice(queryIndex) : '';
    req.url = `${strippedPath}${querySuffix}`;
  } else if (queryLang && SUPPORTED_LANGS.includes(queryLang)) {
    activeLang = queryLang;
    langPrefix = queryLang;
    setLanguageCookie(res, activeLang);
  } else {
    const cookieLang = parseCookieHeader(req.headers.cookie, 'lang');
    if (cookieLang && SUPPORTED_LANGS.includes(cookieLang.toLowerCase())) {
      activeLang = cookieLang.toLowerCase();
    } else {
      activeLang = detectFromAcceptLanguage(req.headers['accept-language']);
    }
  }

  req.lang = activeLang;
  req.langPrefix = langPrefix;
  req.canonicalRoutePath = siteConfig.normalizeRoutePath(strippedPath);

  res.locals.lang = activeLang;
  res.locals.supportedLangs = SUPPORTED_LANGS;
  res.locals.siteConfig = siteConfig;
  res.locals.nexusConfig = nexusConfig;
  res.locals.feedbackConfig = feedbackConfig;
  res.locals.brandConfig = brandConfig;
  if (req.session && req.session.user && req.session.user.inGuild) {
    if (!req.session.feedbackPendingIdemKey) {
      req.session.feedbackPendingIdemKey = generateIdempotencyKey(req);
    }
    res.locals.feedbackIdempotencyKey = req.session.feedbackPendingIdemKey;
  } else {
    res.locals.feedbackIdempotencyKey = '';
  }
  req.t = (key, fallback) => translate(activeLang, key, fallback);
  res.locals.t = req.t;

  const seo = siteConfig.buildPageSeo(req);
  res.locals.seo = seo;

  // Giriş gerektiren veya herkese açık olmayan sayfalara otomatik X-Robots-Tag: noindex, nofollow uygula
  if (seo.noindex) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }

  req.applySeo = (overrides = {}) => {
    const updated = siteConfig.buildPageSeo(req, overrides);
    res.locals.seo = updated;
    if (updated.noindex) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    }
    return updated;
  };

  next();
}

/**
 * Dil Değiştirme Route İşleyicisi (/lang/:code)
 */
function handleLanguageSwitch(req, res) {
  const requested = String(req.params.code || '').toLowerCase();
  const targetLang = SUPPORTED_LANGS.includes(requested) ? requested : SUPPORTED_LANGS[0] || 'tr';

  // /lang/* yolu arama motorları tarafından indekslenmemelidir
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  setLanguageCookie(res, targetLang);

  // Güvenli açık yönlendirme (open-redirect) kontrolü: sadece site içi yollara yönlendir
  const referer = req.get('Referrer') || req.get('Referer') || '/';
  let redirectPath = '/';
  try {
    if (referer.startsWith('/') && !referer.startsWith('//')) {
      redirectPath = referer;
    } else {
      const parsed = new URL(referer);
      redirectPath = `${parsed.pathname}${parsed.search || ''}`;
    }
  } catch (_) {
    redirectPath = '/';
  }

  const cleanRoute = siteConfig.normalizeRoutePath(redirectPath);
  if (siteConfig.isPublicIndexablePath(cleanRoute)) {
    const suffix = cleanRoute === '/' ? '' : cleanRoute;
    return res.redirect(`/${targetLang}${suffix}`);
  }

  return res.redirect(redirectPath);
}

module.exports = {
  SUPPORTED_LANGS,
  LOCALES,
  loadLocalesFromDisk,
  i18nMiddleware,
  handleLanguageSwitch,
  setLanguageCookie,
  translate,
};
