const appConfig = require('./app.config');
const brandConfig = require('./brand.config');
const trLocale = require('../locales/tr.json');
const enLocale = require('../locales/en.json');

/**
 * Merkezi SEO ve Yapılandırılmış Veri (JSON-LD) Konfigürasyonu.
 * Marka adı ve Discord bağlantısı doğrudan config/brand.config.js üzerinden,
 * sayfa başlıkları ve açıklamaları ise locales sözlüklerinden okunur.
 */
const BRAND_NAME = brandConfig.getSiteName();
const SHORT_BRAND_NAME = brandConfig.getSiteName();
const ALTERNATE_NAME = brandConfig.getSiteName();
const ASSET_VERSION = '2.0.0';

const PUBLIC_ROUTE_PATHS = ['/', '/kurallar', '/kayit', '/etkilesim'];

const ROUTE_SEO_KEYS = {
  '/': {
    titleKey: 'seo.homeTitle',
    descKey: 'seo.homeDescription',
  },
  '/kurallar': {
    titleKey: 'seo.rulesTitle',
    descKey: 'seo.rulesDescription',
  },
  '/kayit': {
    titleKey: 'seo.registerTitle',
    descKey: 'seo.registerDescription',
  },
  '/etkilesim': {
    titleKey: 'seo.interactiveTitle',
    descKey: 'seo.interactiveDescription',
  },
};

function readLocaleKey(lang, dotKey) {
  const dict = lang === 'en' ? enLocale : trLocale;
  const parts = String(dotKey || '').split('.');
  let cur = dict;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in cur) {
      cur = cur[p];
    } else {
      return '';
    }
  }
  return typeof cur === 'string' ? cur : '';
}

function getBaseUrl() {
  return (process.env.BASE_URL || appConfig.BASE_URL || 'http://localhost:3001').trim().replace(/\/+$/, '');
}

function getGoogleSiteVerification() {
  return (process.env.GOOGLE_SITE_VERIFICATION || appConfig.GOOGLE_SITE_VERIFICATION || '').trim();
}

/**
 * JSON-LD "sameAs" alanı için doğrulanmış sosyal medya / topluluk linklerini döndürür.
 * Tanımlı değilse boş dizi döner (sahte link basılmaz).
 */
function getSocialLinks() {
  const candidates = [
    brandConfig.getDiscordInviteUrl(),
    process.env.ROBLOX_GROUP_URL,
    process.env.YOUTUBE_URL,
    process.env.TIKTOK_URL,
  ];
  return candidates
    .map((u) => (typeof u === 'string' ? u.trim() : ''))
    .filter((u) => /^https?:\/\/\S+/i.test(u));
}

function normalizeRoutePath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return '/';
  const withoutQuery = rawPath.split('?')[0].trim();
  const stripped = withoutQuery.replace(/^\/(tr|en)(?=\/|$)/i, '') || '/';
  const cleaned = stripped.length > 1 ? stripped.replace(/\/+$/, '') : '/';
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
}

function isPublicIndexablePath(routePath) {
  const normalized = normalizeRoutePath(routePath);
  return PUBLIC_ROUTE_PATHS.includes(normalized);
}

function buildAlternateUrls(baseUrl, normalizedPath) {
  const suffix = normalizedPath === '/' ? '' : normalizedPath;
  return {
    tr: `${baseUrl}/tr${suffix}`,
    en: `${baseUrl}/en${suffix}`,
    xDefault: `${baseUrl}${normalizedPath}`,
  };
}

/**
 * Her istek için sayfa başlığı, meta açıklama, canonical, hreflang, Open Graph ve
 * JSON-LD verilerini üretir.
 */
function buildPageSeo(req, overrides = {}) {
  const baseUrl = getBaseUrl();
  const siteName = brandConfig.getSiteName();
  const lang = (overrides.lang || (req && req.lang) || 'tr') === 'en' ? 'en' : 'tr';
  const normalizedPath = normalizeRoutePath(overrides.routePath || (req && req.canonicalRoutePath) || (req && req.path) || '/');
  const isPublic = overrides.isPublic !== undefined ? Boolean(overrides.isPublic) : isPublicIndexablePath(normalizedPath);
  const noindex = overrides.noindex !== undefined ? Boolean(overrides.noindex) : !isPublic;

  const keyCfg = ROUTE_SEO_KEYS[normalizedPath] || ROUTE_SEO_KEYS['/'];
  const rawTitle = readLocaleKey(lang, keyCfg.titleKey).replace(/\{siteName\}/g, siteName);
  const rawDesc = readLocaleKey(lang, keyCfg.descKey).replace(/\{siteName\}/g, siteName);

  const title = overrides.title || rawTitle || siteName;
  const description = overrides.description || rawDesc || siteName;

  const alternateUrls = buildAlternateUrls(baseUrl, normalizedPath);
  const langPrefixUsed = req && req.langPrefix ? req.langPrefix : null;

  let canonicalUrl = alternateUrls.xDefault;
  if (lang === 'en') {
    canonicalUrl = alternateUrls.en;
  } else if (langPrefixUsed === 'tr') {
    canonicalUrl = alternateUrls.tr;
  }

  return {
    brandName: siteName,
    shortBrandName: siteName,
    alternateName: siteName,
    assetVersion: ASSET_VERSION,
    baseUrl,
    normalizedPath,
    htmlLang: lang,
    title,
    description,
    canonicalUrl,
    alternateUrls,
    ogType: 'website',
    ogLocale: lang === 'en' ? 'en_US' : 'tr_TR',
    ogLocaleAlternate: lang === 'en' ? 'tr_TR' : 'en_US',
    ogImageUrl: `${baseUrl}${brandConfig.ASSETS.ogImage}`,
    logoUrl: `${baseUrl}${brandConfig.ASSETS.icon512}`,
    noindex,
    keepCanonical: Boolean(overrides.keepCanonical),
    isPublic: isPublic && !noindex,
    googleSiteVerification: getGoogleSiteVerification(),
    sameAs: getSocialLinks(),
  };
}

module.exports = {
  BRAND_NAME,
  SHORT_BRAND_NAME,
  ALTERNATE_NAME,
  ASSET_VERSION,
  PUBLIC_ROUTE_PATHS,
  getBaseUrl,
  getGoogleSiteVerification,
  getSocialLinks,
  normalizeRoutePath,
  isPublicIndexablePath,
  buildAlternateUrls,
  buildPageSeo,
};
