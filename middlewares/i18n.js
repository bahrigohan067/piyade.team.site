const appConfig = require('../config/app.config');
const trLocale = require('../locales/tr.json');
const enLocale = require('../locales/en.json');

const SUPPORTED_LANGS = ['tr', 'en'];
const LOCALES = {
  tr: trLocale,
  en: enLocale,
};

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
 * Accept-Language başlığından varsayılan dili algılar ('tr' veya 'en').
 */
function detectFromAcceptLanguage(acceptLanguageHeader) {
  if (!acceptLanguageHeader || typeof acceptLanguageHeader !== 'string') {
    return 'tr';
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

  return 'tr';
}

/**
 * Nokta notasyonlu anahtarı (Örn: "home.heroTitleLine1") ilgili dil sözlüğünden çözümler.
 */
function translate(lang, key, fallback = '') {
  const dict = LOCALES[lang] || LOCALES.tr;
  const fallbackDict = LOCALES.tr;

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
  const validLang = SUPPORTED_LANGS.includes(lang) ? lang : 'tr';
  res.cookie('lang', validLang, {
    maxAge: ONE_YEAR_MS,
    httpOnly: false,
    secure: appConfig.IS_PROD,
    sameSite: 'lax',
    path: '/',
  });
}

/**
 * Çok Dilli (i18n) Middleware
 */
function i18nMiddleware(req, res, next) {
  // 1. Önce ?lang=tr|en sorgu parametresi varsa çereze kaydet
  const queryLang = req.query && req.query.lang ? String(req.query.lang).toLowerCase() : null;
  let activeLang = null;

  if (queryLang && SUPPORTED_LANGS.includes(queryLang)) {
    activeLang = queryLang;
    setLanguageCookie(res, activeLang);
  } else {
    // 2. Çerezden ('lang') kontrol et
    const cookieLang = parseCookieHeader(req.headers.cookie, 'lang');
    if (cookieLang && SUPPORTED_LANGS.includes(cookieLang.toLowerCase())) {
      activeLang = cookieLang.toLowerCase();
    } else {
      // 3. Varsayılan olarak Accept-Language başlığından algıla
      activeLang = detectFromAcceptLanguage(req.headers['accept-language']);
    }
  }

  req.lang = activeLang;
  res.locals.lang = activeLang;
  req.t = (key, fallback) => translate(activeLang, key, fallback);
  res.locals.t = req.t;

  next();
}

/**
 * Dil Değiştirme Route İşleyicisi (/lang/:code)
 */
function handleLanguageSwitch(req, res) {
  const requested = String(req.params.code || '').toLowerCase();
  const targetLang = SUPPORTED_LANGS.includes(requested) ? requested : 'tr';

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

  return res.redirect(redirectPath);
}

module.exports = {
  SUPPORTED_LANGS,
  i18nMiddleware,
  handleLanguageSwitch,
  setLanguageCookie,
  translate,
};
