const crypto = require('crypto');

const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Dosya içeriğinin gerçek formatını magic-byte (ilk bayt imzaları) ile doğrular.
 * Sadece PNG, JPG/JPEG ve WEBP kabul edilir. SVG ve diğer tüm tipler reddedilir.
 *
 * @param {Buffer} buffer - Multer memoryStorage'dan gelen dosya belleği
 * @param {string} [originalMimetype] - İstemcinin bildirdiği MIME tipi
 * @param {string} [originalName] - İstemcinin bildirdiği dosya adı
 * @returns {{ valid: boolean, ext?: string, mimeType?: string, randomFileName?: string, errorKey?: string, error?: string }}
 */
function validateEvidenceImageBuffer(buffer, originalMimetype = '', originalName = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return {
      valid: false,
      errorKey: 'errors.emptyFile',
      error: 'Boş veya geçersiz dosya yüklendi.',
    };
  }

  if (buffer.length > MAX_EVIDENCE_BYTES) {
    return {
      valid: false,
      errorKey: 'errors.fileTooLarge',
      error: 'Kanıt görseli boyutu en fazla 5 MB olabilir.',
    };
  }

  // SVG uzantısı veya MIME tipi veya içerik kontrolü (kesinlikle reddet)
  const lowerMime = String(originalMimetype || '').toLowerCase();
  const lowerName = String(originalName || '').toLowerCase();
  const headText = buffer.subarray(0, Math.min(buffer.length, 512)).toString('utf8').toLowerCase();

  if (
    lowerMime.includes('svg') ||
    lowerName.endsWith('.svg') ||
    lowerName.endsWith('.svgz') ||
    headText.includes('<svg') ||
    headText.includes('<!doctype svg')
  ) {
    return {
      valid: false,
      errorKey: 'errors.svgNotAllowed',
      error: 'Güvenlik nedeniyle SVG dosyaları kabul edilmemektedir. Sadece PNG, JPG veya WEBP yükleyiniz.',
    };
  }

  let ext = null;
  let detectedMime = null;

  // 1. PNG Magic Bytes: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    ext = 'png';
    detectedMime = 'image/png';
  }
  // 2. JPEG / JPG Magic Bytes: FF D8 FF
  else if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    ext = 'jpg';
    detectedMime = 'image/jpeg';
  }
  // 3. WEBP Magic Bytes: "RIFF" (0..3) + 4 byte size + "WEBP" (8..11)
  else if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    ext = 'webp';
    detectedMime = 'image/webp';
  }

  if (!ext || !detectedMime) {
    return {
      valid: false,
      errorKey: 'errors.invalidFileType',
      error: 'Geçersiz dosya formatı (magic-byte doğrulaması başarısız). Sadece gerçek PNG, JPG veya WEBP görselleri yüklenebilir.',
    };
  }

  const randomFileName = `kanit_${crypto.randomBytes(16).toString('hex')}.${ext}`;

  return {
    valid: true,
    ext,
    mimeType: detectedMime,
    randomFileName,
  };
}

module.exports = {
  MAX_EVIDENCE_BYTES,
  validateEvidenceImageBuffer,
};
