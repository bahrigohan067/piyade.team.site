/**
 * Piyade Clan | TSB — Merkezi Marka Görselleri ve Önbellek Sürüm Konfigürasyonu.
 * Tüm görsel yolları, boyutları, alt metin anahtarları ve sürüm numarası (?v=) tek kaynaktan yönetilir.
 */

const VERSION = 1;

// public/css/theme.css içindeki --bg-body değerinin karşılığı (meta theme-color ve webmanifest için)
const THEME_COLOR = '#07080c';

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
  PATHS,
  ASSETS,
  DIMENSIONS,
  ALT_KEYS,
  withVersion,
};
