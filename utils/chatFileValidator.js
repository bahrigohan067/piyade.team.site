const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const chatConfig = require('../config/chat.config');

const ALLOWED_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt', 'mp4', 'webm']);

const TYPE_SPECS = Object.freeze({
  png: { ext: 'png', mimeType: 'image/png', category: 'image', maxBytes: chatConfig.FILES.MAX_IMAGE_BYTES },
  jpg: { ext: 'jpg', mimeType: 'image/jpeg', category: 'image', maxBytes: chatConfig.FILES.MAX_IMAGE_BYTES },
  gif: { ext: 'gif', mimeType: 'image/gif', category: 'image', maxBytes: chatConfig.FILES.MAX_IMAGE_BYTES },
  webp: { ext: 'webp', mimeType: 'image/webp', category: 'image', maxBytes: chatConfig.FILES.MAX_IMAGE_BYTES },
  pdf: { ext: 'pdf', mimeType: 'application/pdf', category: 'pdf', maxBytes: chatConfig.FILES.MAX_PDF_BYTES },
  txt: { ext: 'txt', mimeType: 'text/plain; charset=utf-8', category: 'txt', maxBytes: chatConfig.FILES.MAX_TXT_BYTES },
  mp4: { ext: 'mp4', mimeType: 'video/mp4', category: 'video', maxBytes: chatConfig.FILES.MAX_VIDEO_BYTES },
  webm: { ext: 'webm', mimeType: 'video/webm', category: 'video', maxBytes: chatConfig.FILES.MAX_VIDEO_BYTES },
});

let diskCheckOverrideFn = null;

/**
 * Orijinal dosya adını güvenli biçimde temizler (yalnızca gösterim içindir; diskte ASLA kullanılmaz).
 * Yol ayırıcıları, kontrol karakterleri ve çift uzantı hileleri temizlenir; en çok 80 karakterdir.
 */
function sanitizeOriginalFilename(rawName, fallbackExt = '') {
  const maxLen = chatConfig.FILES.MAX_FILENAME_LENGTH || 80;
  let name = typeof rawName === 'string' ? rawName : '';
  // Yol bileşenlerini at (hem Windows hem POSIX)
  name = name.replace(/\\/g, '/').split('/').pop() || '';
  // Kontrol, sıfır genişlikli ve tehlikeli karakterleri temizle
  name = name.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\uFEFF]/g, '');
  name = name.replace(/[<>:"|?*]/g, '_').trim();
  // Başta/sonda nokta veya boşluk bırakma
  name = name.replace(/^[.\s]+|[.\s]+$/g, '');

  const lastDot = name.lastIndexOf('.');
  let stem = lastDot > 0 ? name.slice(0, lastDot) : name;
  let ext = lastDot > 0 ? name.slice(lastDot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';

  if (fallbackExt) {
    ext = String(fallbackExt).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // Çift uzantı hilesini önlemek için kök addaki tüm noktaları alt çizgiye çevir
  stem = stem.replace(/\.+/g, '_').replace(/\s+/g, ' ').trim();
  if (!stem) stem = 'dosya';

  const suffix = ext ? `.${ext}` : '';
  const maxStemLen = Math.max(1, maxLen - suffix.length);
  if (stem.length > maxStemLen) {
    stem = stem.slice(0, maxStemLen).trim() || 'dosya';
  }
  return `${stem}${suffix}`;
}

function extractDeclaredExtension(rawName) {
  if (typeof rawName !== 'string') return '';
  const base = rawName.replace(/\\/g, '/').split('/').pop() || '';
  const idx = base.lastIndexOf('.');
  if (idx <= 0 || idx === base.length - 1) return '';
  const rawExt = base.slice(idx + 1).toLowerCase().trim();
  if (!ALLOWED_EXTS.has(rawExt)) return '';
  return rawExt === 'jpeg' ? 'jpg' : rawExt;
}

/**
 * Magic-byte imzalarıyla gerçek dosya türünü tespit eder (istemci MIME/uzantısına güvenmez).
 */
function detectMagicType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;

  // 1) PNG: 89 50 4E 47 0D 0A 1A 0A
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
    return 'png';
  }

  // 2) JPEG: FF D8 FF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }

  // 3) GIF: GIF87a veya GIF89a
  if (buffer.length >= 6) {
    const hdr6 = buffer.subarray(0, 6).toString('ascii');
    if (hdr6 === 'GIF87a' || hdr6 === 'GIF89a') {
      return 'gif';
    }
  }

  // 4) WEBP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }

  // 5) PDF: %PDF-
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'pdf';
  }

  // 6) MP4: ISO BMFF ftyp kutusu (offset 4..7 == 'ftyp')
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const boxSize = buffer.readUInt32BE(0);
    if (boxSize >= 12 && boxSize <= buffer.length + 1024) {
      return 'mp4';
    }
  }

  // 7) WebM: EBML başlığı (1A 45 DF A3)
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return 'webm';
  }

  return null;
}

/**
 * Bağımlılıksız JPEG segment ayrıştırıcısı: APP1 (EXIF/GPS/XMP, 0xFFE1) ve APP13 (IPTC, 0xFFED)
 * segmentlerini bayt düzeyinde siler. Bozuk veya kesik JPEG dosyalarını reddeder.
 */
function stripJpegMetadata(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return { ok: false, code: 'CORRUPT_JPEG', error: 'Geçersiz veya bozuk JPEG dosyası.' };
  }
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return { ok: false, code: 'CORRUPT_JPEG', error: 'JPEG başlangıç imzası (SOI) geçersiz.' };
  }

  const outChunks = [buffer.subarray(0, 2)]; // SOI (FF D8)
  let offset = 2;
  let strippedBytes = 0;
  let sawSos = false;
  let sawEoi = false;

  while (offset < buffer.length) {
    // 0xFF işaretleyici baytını bul
    if (buffer[offset] !== 0xff) {
      return { ok: false, code: 'CORRUPT_JPEG', error: 'Bozuk JPEG segment yapısı.' };
    }
    // Ardışık dolgu 0xFF baytlarını atla
    while (offset < buffer.length && buffer[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= buffer.length) {
      return { ok: false, code: 'CORRUPT_JPEG', error: 'JPEG dosyası beklenmedik biçimde kesilmiş.' };
    }

    const marker = buffer[offset];
    offset += 1;

    // EOI (End of Image)
    if (marker === 0xd9) {
      outChunks.push(Buffer.from([0xff, 0xd9]));
      sawEoi = true;
      break;
    }

    // Uzunluk alanı olmayan tekil işaretleyiciler (TEM / RST0..RST7)
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      outChunks.push(Buffer.from([0xff, marker]));
      continue;
    }

    // Tekrarlı SOI veya geçersiz 0x00 baytı bozuk kabul edilir
    if (marker === 0x00 || marker === 0xd8) {
      return { ok: false, code: 'CORRUPT_JPEG', error: 'Bozuk JPEG işaretleyicisi.' };
    }

    // 2 baytlık segment uzunluğunu oku (bu uzunluk kendi 2 baytını da kapsar)
    if (offset + 2 > buffer.length) {
      return { ok: false, code: 'CORRUPT_JPEG', error: 'JPEG segment uzunluğu eksik.' };
    }
    const segLen = buffer.readUInt16BE(offset);
    if (segLen < 2 || offset + segLen > buffer.length) {
      return { ok: false, code: 'CORRUPT_JPEG', error: 'JPEG segment boyutu taşmış veya bozuk.' };
    }

    // SOS (Start of Scan, 0xDA): bundan sonrası tarama verisi + EOI'dir
    if (marker === 0xda) {
      sawSos = true;
      const tail = buffer.subarray(offset - 2);
      // Tarama verisinin sonunda EOI (FF D9) bulunduğunu doğrula
      let eoiPos = -1;
      for (let i = tail.length - 2; i >= 2; i -= 1) {
        if (tail[i] === 0xff && tail[i + 1] === 0xd9) {
          eoiPos = i;
          break;
        }
      }
      if (eoiPos < 0) {
        return { ok: false, code: 'CORRUPT_JPEG', error: 'JPEG bitiş imzası (EOI) bulunamadı.' };
      }
      outChunks.push(tail.subarray(0, eoiPos + 2));
      sawEoi = true;
      break;
    }

    // APP1 (EXIF/GPS/XMP = 0xE1) ve APP13 (IPTC/Photoshop = 0xED) segmentlerini SİL
    if (marker === 0xe1 || marker === 0xed) {
      strippedBytes += 2 + segLen;
      offset += segLen;
      continue;
    }

    // Diğer geçerli segmentleri (APP0, DQT, SOF, DHT, APP2 vb.) koru
    outChunks.push(Buffer.from([0xff, marker]));
    outChunks.push(buffer.subarray(offset, offset + segLen));
    offset += segLen;
  }

  if (!sawSos || !sawEoi) {
    return { ok: false, code: 'CORRUPT_JPEG', error: 'Eksik veya bozuk JPEG görüntü verisi.' };
  }

  return {
    ok: true,
    buffer: Buffer.concat(outChunks),
    strippedBytes,
  };
}

/**
 * TXT dosyasının geçerli UTF-8 metin olduğunu ve gizli ikili/HTML/SVG içeriği taşımadığını doğrular.
 */
function validateTxtBuffer(buffer) {
  if (buffer.includes(0x00)) {
    return { ok: false, code: 'INVALID_TXT', error: 'Metin dosyası NUL baytı içeremez.' };
  }
  // Bilinen tehlikeli ikili/arşiv/yürütülebilir imzaları reddet (MZ, PK, Rar!, 7z, ELF)
  if (
    (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) ||
    (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) ||
    (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'Rar!') ||
    (buffer.length >= 4 && buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46)
  ) {
    return { ok: false, code: 'INVALID_TXT', error: 'Metin dosyası geçersiz ikili veri içeriyor.' };
  }
  let decoded;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (_) {
    return { ok: false, code: 'INVALID_TXT', error: 'Metin dosyası geçerli UTF-8 biçiminde değil.' };
  }
  return { ok: true, text: decoded };
}

/**
 * PDF içinde otomatik çalışan /JavaScript veya /Launch aksiyonları varsa reddeder.
 */
function validatePdfSafety(buffer) {
  const latin = buffer.toString('latin1');
  if (/\/JavaScript\b/i.test(latin) || /\/Launch\b/i.test(latin)) {
    return {
      ok: false,
      code: 'PDF_UNSAFE_ACTION',
      error: 'Güvenlik nedeniyle betik veya çalıştırma komutu içeren PDF dosyaları kabul edilmez.',
    };
  }
  return { ok: true };
}

/**
 * Sohbet dosya yüklemesini tüm güvenlik kurallarıyla doğrular ve gerekiyorsa JPEG EXIF temizler.
 */
function validateChatAttachmentBuffer(buffer, originalName = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { ok: false, code: 'EMPTY_FILE', error: 'Boş dosya yüklenemez.' };
  }

  const declaredExt = extractDeclaredExtension(originalName);
  if (!declaredExt) {
    return {
      ok: false,
      code: 'DISALLOWED_TYPE',
      error: 'Bu dosya türü desteklenmiyor. İzin verilenler: PNG, JPG, GIF, WEBP, PDF, TXT, MP4, WEBM.',
    };
  }

  // SVG veya HTML uzantısı/içeriği sızmasına karşı ön koruma
  const headSample = buffer.subarray(0, Math.min(buffer.length, 512)).toString('utf8').toLowerCase();
  if (declaredExt !== 'txt' && (headSample.includes('<svg') || headSample.includes('<!doctype html') || headSample.includes('<html'))) {
    return {
      ok: false,
      code: 'DISALLOWED_TYPE',
      error: 'Güvenlik nedeniyle SVG ve HTML dosyaları kabul edilmez.',
    };
  }

  const detectedMagic = detectMagicType(buffer);
  let resolvedType = detectedMagic;

  if (declaredExt === 'txt') {
    // .txt olarak gönderilen dosya gerçekte başka bir ikili format (PNG, PDF, ZIP vb.) ise reddet
    if (detectedMagic !== null) {
      return {
        ok: false,
        code: 'EXT_CONTENT_MISMATCH',
        error: 'Dosya uzantısı ile gerçek içeriği birbiriyle uyuşmuyor.',
      };
    }
    const txtCheck = validateTxtBuffer(buffer);
    if (!txtCheck.ok) return txtCheck;
    resolvedType = 'txt';
  } else {
    if (!detectedMagic) {
      return {
        ok: false,
        code: 'INVALID_MAGIC',
        error: 'Dosya içeriği doğrulanamadı veya desteklenmeyen format.',
      };
    }
    if (detectedMagic !== declaredExt) {
      return {
        ok: false,
        code: 'EXT_CONTENT_MISMATCH',
        error: 'Dosya uzantısı ile gerçek içeriği birbiriyle uyuşmuyor.',
      };
    }
  }

  const spec = TYPE_SPECS[resolvedType];
  if (!spec) {
    return { ok: false, code: 'DISALLOWED_TYPE', error: 'Desteklenmeyen dosya türü.' };
  }

  if (buffer.length > spec.maxBytes) {
    const mb = Math.round((spec.maxBytes / (1024 * 1024)) * 10) / 10;
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      error: `Bu dosya türü için en fazla ${mb} MB yüklenebilir.`,
    };
  }

  let finalBuffer = buffer;
  let strippedExifBytes = 0;
  let txtPreview = null;

  if (resolvedType === 'pdf') {
    const pdfCheck = validatePdfSafety(buffer);
    if (!pdfCheck.ok) return pdfCheck;
  } else if (resolvedType === 'jpg') {
    const stripped = stripJpegMetadata(buffer);
    if (!stripped.ok) return stripped;
    finalBuffer = stripped.buffer;
    strippedExifBytes = stripped.strippedBytes;
  } else if (resolvedType === 'txt') {
    const rawStr = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    txtPreview = rawStr.replace(/\r\n?/g, '\n').slice(0, 500);
  }

  const fileId = crypto.randomBytes(16).toString('hex'); // 32 hex
  const storedName = `${fileId}.${spec.ext}`;
  const cleanOriginalName = sanitizeOriginalFilename(originalName, spec.ext);

  return {
    ok: true,
    id: fileId,
    storedName,
    ext: spec.ext,
    mimeType: spec.mimeType,
    category: spec.category,
    size: finalBuffer.length,
    originalName: cleanOriginalName,
    buffer: finalBuffer,
    strippedExifBytes,
    txtPreview,
  };
}

/**
 * Volume / disk doluluk oranını kontrol eder (%90 eşiğini aşarsa yeni yüklemeyi reddeder).
 */
function checkVolumeDiskSpace(targetDir, incomingBytes = 0, threshold = chatConfig.FILES.DISK_USAGE_THRESHOLD) {
  try {
    const statFn = diskCheckOverrideFn || (typeof fs.statfsSync === 'function' ? fs.statfsSync : null);
    if (!statFn) return { ok: true, usedRatio: 0 };
    const st = statFn(targetDir);
    const totalBytes = Number(st.blocks) * Number(st.bsize);
    const availBytes = Number(st.bavail) * Number(st.bsize);
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
      return { ok: true, usedRatio: 0 };
    }
    const remainingAfter = Math.max(0, availBytes - Math.max(0, Number(incomingBytes) || 0));
    const usedRatio = 1 - remainingAfter / totalBytes;
    if (usedRatio >= threshold) {
      return {
        ok: false,
        code: 'DISK_FULL',
        usedRatio,
        error: 'Sunucu depolama alanı dolmak üzere olduğu için şu anda yeni dosya yüklenemiyor.',
      };
    }
    return { ok: true, usedRatio };
  } catch (_) {
    return { ok: true, usedRatio: 0 };
  }
}

function setDiskCheckOverrideForTests(fn) {
  diskCheckOverrideFn = typeof fn === 'function' ? fn : null;
}

module.exports = {
  TYPE_SPECS,
  sanitizeOriginalFilename,
  extractDeclaredExtension,
  detectMagicType,
  stripJpegMetadata,
  validateTxtBuffer,
  validatePdfSafety,
  validateChatAttachmentBuffer,
  checkVolumeDiskSpace,
  setDiskCheckOverrideForTests,
};
