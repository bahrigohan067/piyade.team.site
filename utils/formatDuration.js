/**
 * Site genelinde tek merkezi süre ve göreli zaman biçimleyici (utils/formatDuration.js).
 * Bot tarafındaki activity.config.js -> formatDuration ile birebir tutarlıdır.
 * NaN, Infinity, undefined veya negatif değerlerde ASLA bozuk metin üretmez.
 */

function safeNonNegInt(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.floor(num);
}

/**
 * Saniye cinsinden süreyi TR/EN okunabilir biçime çevirir:
 * - 0 sn (veya geçersiz/NaN/Infinity) -> "0 dk" / "0 min"
 * - 0 < sn < 60 -> "1 dk'dan az" / "<1 min"
 * - 60 dk (3600 sn) -> "1 sa" / "1 hr"
 * - 119.6 dk (7176 sn) -> "1 sa 59 dk" / "1 hr 59 min"
 * - 41 sa 47 dk -> "41 sa 47 dk" / "41 hr 47 min"
 */
function formatDuration(seconds, lang = 'tr') {
  const isEn = lang === 'en';
  const raw = Number(seconds);
  if (!Number.isFinite(raw) || raw <= 0) {
    return isEn ? '0 min' : '0 dk';
  }
  if (raw < 60) {
    return isEn ? '<1 min' : "1 dk'dan az";
  }

  const totalSec = Math.floor(raw);
  const totalMinutes = Math.floor(totalSec / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return isEn ? `${minutes} min` : `${minutes} dk`;
  }
  if (minutes === 0) {
    return isEn ? `${hours} hr` : `${hours} sa`;
  }
  return isEn ? `${hours} hr ${minutes} min` : `${hours} sa ${minutes} dk`;
}

/**
 * ISO zaman damgasını veya milisaniye değerini göreli "Son güncelleme" metnine çevirir.
 * Geçersiz değerlerde boş dize döner (asla NaN/undefined üretmez).
 */
function formatRelativeUpdated(isoOrMs, lang = 'tr', nowMs = Date.now()) {
  const isEn = lang === 'en';
  let ts = NaN;
  if (typeof isoOrMs === 'number') {
    ts = isoOrMs;
  } else if (typeof isoOrMs === 'string' && isoOrMs.trim()) {
    ts = Date.parse(isoOrMs);
  }
  if (!Number.isFinite(ts) || ts <= 0) return '';

  const cleanNow = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const diffSec = Math.max(0, Math.floor((cleanNow - ts) / 1000));

  if (diffSec < 45) {
    return isEn ? 'just now' : 'az önce';
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return isEn ? `${diffMin} min ago` : `${diffMin} dk önce`;
  }
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    return isEn ? `${diffHr} hr ago` : `${diffHr} sa önce`;
  }
  const diffDay = Math.floor(diffHr / 24);
  return isEn ? `${diffDay} d ago` : `${diffDay} gün önce`;
}

module.exports = {
  safeNonNegInt,
  formatDuration,
  formatRelativeUpdated,
};
