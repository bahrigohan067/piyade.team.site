const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const appConfig = require('./app.config');
const brandConfig = require('./brand.config');
const trLocale = require('../locales/tr.json');
const enLocale = require('../locales/en.json');

/**
 * CSS/JS dosyaları değiştiğinde tarayıcı önbelleğini (immutable) otomatik yenileyen sürüm etiketi üretir.
 */
function computeAssetVersion(baseVersion = '2.2.0') {
  try {
    const hash = crypto.createHash('sha1');
    const publicDir = path.join(__dirname, '..', 'public');
    const trackedFiles = [
      'css/theme.css',
      'css/style.css',
      'js/app.js',
      'js/activity-panel.js',
      'js/top-games.js',
    ];
    for (const rel of trackedFiles) {
      const fullPath = path.join(publicDir, rel);
      if (fs.existsSync(fullPath)) {
        hash.update(fs.readFileSync(fullPath));
      }
    }
    return `${baseVersion}-${hash.digest('hex').slice(0, 8)}`;
  } catch (_) {
    return baseVersion;
  }
}

/**
 * Merkezi SEO ve Yapılandırılmış Veri (JSON-LD) Konfigürasyonu.
 * Marka adı (Piyade World / Piyade Dünyası), takma adlar ve Discord bağlantısı
 * doğrudan config/brand.config.js üzerinden, sayfa başlıkları, açıklamalar ve SSS
 * verileri ise locales sözlüklerinden okunur.
 */
const BRAND_NAME = brandConfig.getSiteName();
const TURKISH_BRAND_NAME = brandConfig.getTurkishSiteName();
const SHORT_BRAND_NAME = brandConfig.getShortSiteName();
const BILINGUAL_BRAND_NAME = brandConfig.getBilingualSiteName();
const ALTERNATE_NAME = TURKISH_BRAND_NAME;
const ALTERNATE_NAMES = brandConfig.getBrandAliases();
const ASSET_VERSION = computeAssetVersion('2.2.0');

const KNOWS_ABOUT = Object.freeze([
  'Roblox',
  'Counter-Strike 2',
  'CS2',
  'Zula',
  'Minecraft',
  'TLauncher',
  'Discord Gaming Community',
  'Piyade World',
  'Piyade Dünyası',
]);

const PUBLIC_ROUTE_PATHS = ['/', '/kurallar', '/kayit', '/etkilesim'];

const ROUTE_SEO_KEYS = {
  '/': {
    titleKey: 'seo.homeTitle',
    descKey: 'seo.homeDescription',
    keywordsKey: 'seo.homeKeywords',
    breadcrumbKey: 'nav.home',
  },
  '/kurallar': {
    titleKey: 'seo.rulesTitle',
    descKey: 'seo.rulesDescription',
    keywordsKey: 'seo.rulesKeywords',
    breadcrumbKey: 'nav.rules',
  },
  '/kayit': {
    titleKey: 'seo.registerTitle',
    descKey: 'seo.registerDescription',
    keywordsKey: 'seo.registerKeywords',
    breadcrumbKey: 'nav.register',
  },
  '/etkilesim': {
    titleKey: 'seo.interactiveTitle',
    descKey: 'seo.interactiveDescription',
    keywordsKey: 'seo.interactiveKeywords',
    breadcrumbKey: 'nav.interactive',
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

function buildHomeFaqItems(lang) {
  const items = [];
  for (let i = 1; i <= 4; i += 1) {
    const q = readLocaleKey(lang, `home.faq${i}Q`).trim();
    const a = readLocaleKey(lang, `home.faq${i}A`).trim();
    if (q && a) {
      items.push({ question: q, answer: a });
    }
  }
  return items;
}

function buildBreadcrumbList(baseUrl, normalizedPath, canonicalUrl, lang) {
  const homeUrl = lang === 'en' ? `${baseUrl}/en` : `${baseUrl}/`;
  const homeLabel =
    lang === 'en'
      ? 'Piyade World (Piyade Dünyası)'
      : 'Piyade World | Piyade Dünyası';

  const elements = [
    {
      '@type': 'ListItem',
      position: 1,
      name: homeLabel,
      item: homeUrl,
    },
  ];

  if (normalizedPath !== '/') {
    const keyCfg = ROUTE_SEO_KEYS[normalizedPath];
    const subLabel =
      (keyCfg && readLocaleKey(lang, keyCfg.breadcrumbKey)) ||
      normalizedPath.replace(/^\/+/, '');
    elements.push({
      '@type': 'ListItem',
      position: 2,
      name: subLabel,
      item: canonicalUrl,
    });
  }

  return elements;
}

function buildJsonLdGraph({
  baseUrl,
  canonicalUrl,
  normalizedPath,
  lang,
  title,
  description,
  logoUrl,
  ogImageUrl,
  sameAs,
  alternateNames,
  breadcrumbItems,
  faqItems,
}) {
  const inLangCode = lang === 'en' ? 'en-US' : 'tr-TR';

  const graph = [
    {
      '@type': 'Organization',
      '@id': `${baseUrl}/#organization`,
      name: PRIMARY_ORG_NAME(),
      alternateName: alternateNames,
      url: baseUrl,
      logo: {
        '@type': 'ImageObject',
        url: logoUrl,
        width: 512,
        height: 512,
      },
      image: ogImageUrl,
      description,
      knowsAbout: [...KNOWS_ABOUT],
      sameAs: Array.isArray(sameAs) ? sameAs : [],
    },
    {
      '@type': 'WebSite',
      '@id': `${baseUrl}/#website`,
      name: 'Piyade World | Piyade Dünyası',
      alternateName: alternateNames,
      url: baseUrl,
      inLanguage: ['tr-TR', 'en-US'],
      logo: {
        '@type': 'ImageObject',
        url: logoUrl,
        width: 512,
        height: 512,
      },
      publisher: {
        '@id': `${baseUrl}/#organization`,
      },
    },
    {
      '@type': 'WebPage',
      '@id': `${canonicalUrl}#webpage`,
      url: canonicalUrl,
      name: title,
      description,
      inLanguage: inLangCode,
      isPartOf: {
        '@id': `${baseUrl}/#website`,
      },
      about: {
        '@id': `${baseUrl}/#organization`,
      },
      breadcrumb: {
        '@id': `${canonicalUrl}#breadcrumb`,
      },
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${canonicalUrl}#breadcrumb`,
      itemListElement: breadcrumbItems,
    },
  ];

  if (normalizedPath === '/' && Array.isArray(faqItems) && faqItems.length > 0) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${canonicalUrl}#faq`,
      mainEntity: faqItems.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.answer,
        },
      })),
    });
  }

  return {
    '@context': 'https://schema.org',
    '@graph': graph,
  };
}

function PRIMARY_ORG_NAME() {
  return brandConfig.getSiteName();
}

/**
 * Her istek için sayfa başlığı, meta açıklama, canonical, hreflang, Open Graph ve
 * JSON-LD verilerini üretir.
 */
function buildPageSeo(req, overrides = {}) {
  const baseUrl = getBaseUrl();
  const siteName = brandConfig.getSiteName();
  const trSiteName = brandConfig.getTurkishSiteName();
  const shortSiteName = brandConfig.getShortSiteName();
  const bilingualSiteName = brandConfig.getBilingualSiteName();
  const alternateNames = brandConfig.getBrandAliases();

  const lang = (overrides.lang || (req && req.lang) || 'tr') === 'en' ? 'en' : 'tr';
  const normalizedPath = normalizeRoutePath(
    overrides.routePath || (req && req.canonicalRoutePath) || (req && req.path) || '/'
  );
  const isPublic =
    overrides.isPublic !== undefined ? Boolean(overrides.isPublic) : isPublicIndexablePath(normalizedPath);
  const noindex = overrides.noindex !== undefined ? Boolean(overrides.noindex) : !isPublic;

  const keyCfg = ROUTE_SEO_KEYS[normalizedPath] || ROUTE_SEO_KEYS['/'];
  const rawTitle = readLocaleKey(lang, keyCfg.titleKey).replace(/\{siteName\}/g, siteName);
  const rawDesc = readLocaleKey(lang, keyCfg.descKey).replace(/\{siteName\}/g, siteName);
  const rawKeywords = keyCfg.keywordsKey
    ? readLocaleKey(lang, keyCfg.keywordsKey).replace(/\{siteName\}/g, siteName)
    : 'Piyade World, Piyade Dünyası, Piyade, Piyade Oyuncu Topluluğu, Piyade Discord, Roblox, CS2, Zula, Minecraft';

  const title = overrides.title || rawTitle || bilingualSiteName;
  const description = overrides.description || rawDesc || bilingualSiteName;
  const keywords = overrides.keywords || rawKeywords;

  const alternateUrls = buildAlternateUrls(baseUrl, normalizedPath);
  const langPrefixUsed = req && req.langPrefix ? req.langPrefix : null;

  let canonicalUrl = alternateUrls.xDefault;
  if (lang === 'en') {
    canonicalUrl = alternateUrls.en;
  } else if (langPrefixUsed === 'tr') {
    canonicalUrl = alternateUrls.tr;
  }

  const ogImageUrl = `${baseUrl}${brandConfig.ASSETS.ogImage}`;
  const logoUrl = `${baseUrl}${brandConfig.ASSETS.icon512}`;
  const sameAs = getSocialLinks();
  const breadcrumbItems = buildBreadcrumbList(baseUrl, normalizedPath, canonicalUrl, lang);
  const faqItems = normalizedPath === '/' ? buildHomeFaqItems(lang) : [];

  const jsonLdObj = buildJsonLdGraph({
    baseUrl,
    canonicalUrl,
    normalizedPath,
    lang,
    title,
    description,
    logoUrl,
    ogImageUrl,
    sameAs,
    alternateNames,
    breadcrumbItems,
    faqItems,
  });

  const jsonLdString = JSON.stringify(jsonLdObj).replace(/</g, '\\u003c');
  const ogImageAlt =
    readLocaleKey(lang, 'brand.heroLogoAlt') || 'Piyade World – Piyade Dünyası Resmi Logosu';

  return {
    brandName: bilingualSiteName,
    primaryBrandName: siteName,
    turkishBrandName: trSiteName,
    shortBrandName: shortSiteName,
    alternateName: trSiteName,
    alternateNames,
    assetVersion: ASSET_VERSION,
    baseUrl,
    normalizedPath,
    htmlLang: lang,
    title,
    description,
    keywords,
    canonicalUrl,
    alternateUrls,
    ogType: 'website',
    ogLocale: lang === 'en' ? 'en_US' : 'tr_TR',
    ogLocaleAlternate: lang === 'en' ? 'tr_TR' : 'en_US',
    ogImageUrl,
    ogImageAlt,
    logoUrl,
    noindex,
    keepCanonical: Boolean(overrides.keepCanonical),
    isPublic: isPublic && !noindex,
    googleSiteVerification: getGoogleSiteVerification(),
    sameAs,
    breadcrumbItems,
    faqItems,
    jsonLd: jsonLdObj,
    jsonLdString,
  };
}

module.exports = {
  BRAND_NAME,
  TURKISH_BRAND_NAME,
  SHORT_BRAND_NAME,
  BILINGUAL_BRAND_NAME,
  ALTERNATE_NAME,
  ALTERNATE_NAMES,
  KNOWS_ABOUT,
  ASSET_VERSION,
  PUBLIC_ROUTE_PATHS,
  getBaseUrl,
  getGoogleSiteVerification,
  getSocialLinks,
  normalizeRoutePath,
  isPublicIndexablePath,
  buildAlternateUrls,
  buildHomeFaqItems,
  buildPageSeo,
};
