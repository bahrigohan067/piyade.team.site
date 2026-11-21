/**
 * Merkezi Marka Kimliği, Görsel Yolları ve Önbellek Sürüm Konfigürasyonu.
 * Marka adı (Piyade World / Piyade Dünyası), takma adlar (aliases), Discord davet bağlantısı,
 * tüm görsel yolları, boyutlar ve sürüm numarası (?v=) tek kaynaktan yönetilir.
 */

const VERSION = 1;

// public/css/theme.css içindeki --bg-body değerinin karşılığı (meta theme-color ve webmanifest için)
const THEME_COLOR = '#07080c';

const PRIMARY_BRAND_NAME = 'Piyade World';
const TURKISH_BRAND_NAME = 'Piyade Dünyası';
const SHORT_BRAND_NAME = 'Piyade';
const BILINGUAL_BRAND_NAME = 'Piyade World | Piyade Dünyası';

const BRAND_ALIASES = Object.freeze([
  'Piyade World',
  'Piyade Dünyası',
  'Piyade',
  'Piyade Oyuncu Topluluğu',
  'Piyade Gaming Community',
  'Piyade Discord',
]);

function getSiteName(envObj = process.env) {
  const raw = envObj && typeof envObj.SITE_NAME === 'string' ? envObj.SITE_NAME.trim() : '';
  if (!raw || raw.toLowerCase() === 'piyade') {
    return PRIMARY_BRAND_NAME;
  }
  return raw;
}

function getTurkishSiteName() {
  return TURKISH_BRAND_NAME;
}

function getShortSiteName() {
  return SHORT_BRAND_NAME;
}

function getBilingualSiteName() {
  return BILINGUAL_BRAND_NAME;
}

function getBrandAliases() {
  return [...BRAND_ALIASES];
}

function getDiscordInviteUrl(envObj = process.env) {
  const raw = envObj && typeof envObj.DISCORD_INVITE_URL === 'string' ? envObj.DISCORD_INVITE_URL.trim() : '';
  return /^https?:\/\/\S+/i.test(raw) ? raw : '';
}

const SITE_NAME = getSiteName();
const DISCORD_INVITE_URL = getDiscordInviteUrl();

const PATHS = {
  logo256: '/img/brand/logo-256.webp',
  logo512: '/img/brand/logo-512.webp',
  logo768: '/img/brand/logo-768.webp',
  logo1024: '/img/brand/logo-1024.webp',
  icon192: '/img/brand/icon-192.png',
  icon512: '/img/brand/icon-512.png',
  appleTouchIcon: '/img/brand/apple-touch-icon.png',
  faviconIco: '/img/brand/favicon.ico',
  favicon16: '/img/brand/favicon-16.png',
  favicon32: '/img/brand/favicon-32.png',
  favicon48: '/img/brand/favicon-48.png',
  ogImage: '/img/brand/og-image.jpg',
  manifest: '/site.webmanifest',
};

function withVersion(assetPath, version = VERSION) {
  if (!assetPath || typeof assetPath !== 'string') return '';
  return `${assetPath}?v=${encodeURIComponent(String(version))}`;
}

const ASSETS = Object.freeze(
  Object.fromEntries(Object.entries(PATHS).map(([key, val]) => [key, withVersion(val, VERSION)]))
);

const DIMENSIONS = {
  heroWidth: 1024,
  heroHeight: 1024,
  ogWidth: 1200,
  ogHeight: 630,
  navbarIcon: 40,
  collapsedSidebarIcon: 36,
  mobileTopbarIcon: 32,
  footerLogo: 56,
  errorWatermark: 512,
  appleTouch: 180,
  icon192: 192,
  icon512: 512,
};

const ALT_KEYS = {
  heroLogoAlt: 'brand.heroLogoAlt',
  iconAlt: 'brand.iconAlt',
  footerLogoAlt: 'brand.footerLogoAlt',
};

module.exports = {
  VERSION,
  THEME_COLOR,
  PRIMARY_BRAND_NAME,
  TURKISH_BRAND_NAME,
  SHORT_BRAND_NAME,
  BILINGUAL_BRAND_NAME,
  BRAND_ALIASES,
  ALTERNATE_NAMES: BRAND_ALIASES,
  SITE_NAME,
  DISCORD_INVITE_URL,
  getSiteName,
  getTurkishSiteName,
  getShortSiteName,
  getBilingualSiteName,
  getBrandAliases,
  getDiscordInviteUrl,
  PATHS,
  ASSETS,
  DIMENSIONS,
  ALT_KEYS,
  withVersion,
};
