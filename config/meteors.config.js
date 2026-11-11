/**
 * ==============================================================================
 * 🌠 METEORS PARAMETRİK BİLEŞEN YAPILANDIRMASI (METEORS.CONFIG.JS)
 * ==============================================================================
 * Nexus UI Meteors Canvas motorunun tüm davranış, yoğunluk, açı ve etkileşim
 * parametreleri tek merkezden yönetilir. Renkler public/css/theme.css'teki
 * CSS değişkenlerinden okunur.
 * ==============================================================================
 */

const INTENSITY_MULTIPLIERS = {
  low: 0.65,
  medium: 1,
  high: 1.45,
};

const MAX_METEORS = 72;

const METEORS_CONFIG = {
  number: 18,
  intensity: 'medium', // 'low' (0.65) | 'medium' (1) | 'high' (1.45), en çok 72
  angle: 215,          // Derece (sağa bakmaktan saat yönünün tersi)
  minDelay: 0.12,      // Saniye
  maxDelay: 2.4,       // Saniye
  minDuration: 3.2,    // Saniye
  maxDuration: 7.2,    // Saniye
  glow: true,
  colorVar: '--meteors-color',
  tailColorVar: '--meteors-tail-color',
  sparkColorVar: '--meteors-spark-color',
  starColorVar: '--meteors-star-color',
  hoverOnly: false,
  interactive: true,
  stars: 0,            // Soluk yanıp sönen arka plan yıldız sayısı
  autoplay: false,
};

/**
 * Verilen yapılandırma ve ekran genişliğine göre aktif meteor sayısını hesaplar.
 */
function resolveMeteorCount(config = METEORS_CONFIG, isMobile = false) {
  const baseNumber = Math.max(1, Number(config.number) || 18);
  const multiplier = INTENSITY_MULTIPLIERS[config.intensity] || 1;
  const scaled = Math.min(MAX_METEORS, Math.round(baseNumber * multiplier));
  if (isMobile) {
    return Math.max(4, Math.round(scaled * 0.55));
  }
  return scaled;
}

module.exports = {
  METEORS_CONFIG,
  INTENSITY_MULTIPLIERS,
  MAX_METEORS,
  resolveMeteorCount,
};
