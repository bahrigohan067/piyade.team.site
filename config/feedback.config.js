/**
 * Feedback Pill (Nexus UI Geri Bildirim Bileşeni) Yapılandırması.
 * Tüm görsel renkler public/css/theme.css değişkenlerinden okunur.
 */
const FEEDBACK_CONFIG = {
  enabled: true,
  minLength: 3,
  maxLength: 1000,
  soundEnabled: true,
  accent: '--color-accent',
  sendMinDurationMs: 900,
  sentVisibleMs: 1700,
  requestTimeoutMs: 10000,
  counterShowAt: 800,
  rateLimit: {
    tenMinWindowMs: 10 * 60 * 1000,
    tenMinMax: 3,
    dayWindowMs: 24 * 60 * 60 * 1000,
    dayMax: 10,
  },
};

/**
 * Sayfa yolunu yalnızca güvenli site içi path olarak doğrular (aksi halde "/").
 */
function sanitizeSafePagePath(rawPage) {
  if (typeof rawPage !== 'string') return '/';
  const clean = rawPage.trim().slice(0, 160);
  if (!clean.startsWith('/') || clean.startsWith('//') || /[\r\n<>]/.test(clean)) {
    return '/';
  }
  return clean;
}

module.exports = {
  ...FEEDBACK_CONFIG,
  sanitizeSafePagePath,
};
