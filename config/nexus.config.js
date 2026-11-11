/**
 * Nexus UI Tarzı Bağımsız Bileşen Parametreleri (Meteors, Dart Rating, Floating Dock, Orbital Loader).
 * Tüm görsel renkler public/css/theme.css içindeki mor tema değişkenlerinden okunur.
 */
const NEXUS_CONFIG = {
  meteors: {
    number: 18,
    intensity: 'medium', // 'low' | 'medium' | 'high'
    intensityMultipliers: {
      low: 0.65,
      medium: 1,
      high: 1.45,
    },
    maxCount: 72,
    mobileFactor: 0.55,
    angle: 215, // Derece: sağa bakmaktan (0°) saat yönünün tersi
    minDelay: 0.12, // Saniye
    maxDelay: 2.4, // Saniye
    minDuration: 3.2, // Saniye
    maxDuration: 7.2, // Saniye
    glow: true,
    colorVar: '--meteor-color',
    coreColorVar: '--meteor-core-color',
    sparkColorVar: '--meteor-spark-color',
    glowColorVar: '--meteor-glow-color',
    starColorVar: '--meteor-star-color',
    hoverOnly: false,
    interactive: true,
    stars: 0,
    autoplay: false,
  },
  dartRating: {
    autoplay: false,
    minValue: 1,
    maxValue: 10,
    maxHoldSeconds: 1.4,
    maxJitterPx: 14,
  },
  floatingDock: {
    distance: 112,
    magnification: 1.45,
    neighborShiftPx: 9,
    expandedIconScale: 1.24,
    expandedRowShiftPx: 6,
    spring: {
      stiffness: 340,
      damping: 24,
      mass: 0.85,
    },
    mobileStaggerMs: 42,
  },
  orbitalLoader: {
    enableSound: false,
    requestTimeoutMs: 45000,
    successRedirectDelayMs: 750,
  },
};

module.exports = NEXUS_CONFIG;
