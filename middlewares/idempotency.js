const crypto = require('crypto');

const CONSUMED_KEY_TTL_MS = 15 * 60 * 1000; // 15 dakika
const IN_FLIGHT_TTL_MS = 60 * 1000; // 1 dakika (takılı kilit koruması)
const consumedKeys = new Map();
const inFlightKeys = new Map();

function pruneConsumedKeys() {
  const now = Date.now();
  for (const [key, timestamp] of consumedKeys.entries()) {
    if (now - timestamp > CONSUMED_KEY_TTL_MS) {
      consumedKeys.delete(key);
    }
  }
  for (const [key, timestamp] of inFlightKeys.entries()) {
    if (now - timestamp > IN_FLIGHT_TTL_MS) {
      inFlightKeys.delete(key);
    }
  }
}

/**
 * Form render edilirken tek kullanımlık idempotency anahtarı üretir ve oturuma kaydeder.
 */
function generateIdempotencyKey(req) {
  const key = crypto.randomUUID();

  if (req && req.session) {
    if (!Array.isArray(req.session.issuedIdempotencyKeys)) {
      req.session.issuedIdempotencyKeys = [];
    }
    req.session.issuedIdempotencyKeys.push(key);
    // Oturum şişmesini önlemek için son 25 anahtarı tut
    if (req.session.issuedIdempotencyKeys.length > 25) {
      req.session.issuedIdempotencyKeys = req.session.issuedIdempotencyKeys.slice(-25);
    }
  }

  return key;
}

/**
 * Form POST edildiğinde gelen _idempotencyKey değerini kontrol eder ve tüketir.
 * Aynı anahtar ikinci kez gönderilirse çift gönderim (duplicate) olarak reddeder.
 *
 * @returns {{ valid: boolean, key: string|null }}
 */
function consumeIdempotencyKey(req) {
  pruneConsumedKeys();

  const rawKey =
    (req.body && req.body._idempotencyKey) ||
    (req.query && req.query._idempotencyKey) ||
    req.headers['x-idempotency-key'] ||
    null;

  if (!rawKey || typeof rawKey !== 'string' || rawKey.trim().length < 8) {
    return { valid: false, key: null };
  }

  const key = rawKey.trim();

  // Daha önce kullanılmış mı?
  if (consumedKeys.has(key)) {
    return { valid: false, key };
  }

  if (req.session && Array.isArray(req.session.consumedIdempotencyKeys)) {
    if (req.session.consumedIdempotencyKeys.includes(key)) {
      return { valid: false, key };
    }
  }

  // Oturumda üretilen anahtarlardan biri mi kontrol et (oturum varsa)
  if (
    req.session &&
    Array.isArray(req.session.issuedIdempotencyKeys) &&
    req.session.issuedIdempotencyKeys.length > 0
  ) {
    const idx = req.session.issuedIdempotencyKeys.indexOf(key);
    if (idx === -1) {
      return { valid: false, key };
    }
    req.session.issuedIdempotencyKeys.splice(idx, 1);
  }

  // Anahtarı tüketilmiş olarak işaretle
  consumedKeys.set(key, Date.now());
  if (req.session) {
    if (!Array.isArray(req.session.consumedIdempotencyKeys)) {
      req.session.consumedIdempotencyKeys = [];
    }
    req.session.consumedIdempotencyKeys.push(key);
    if (req.session.consumedIdempotencyKeys.length > 50) {
      req.session.consumedIdempotencyKeys = req.session.consumedIdempotencyKeys.slice(-50);
    }
  }

  return { valid: true, key };
}

/**
 * İki aşamalı idempotency: işlem başlamadan anahtarı kilitle (in-flight), yalnızca başarılıysa
 * kalıcı tüket (commit), ağ/sunucu uygulanmadı hatalarında kilidi geri al (rollback) ki aynı anahtar
 * zaman aşımı sonrası tekrar güvenle kullanılabilsin.
 */
function beginIdempotentOperation(req) {
  pruneConsumedKeys();

  const rawKey =
    (req.body && req.body._idempotencyKey) ||
    (req.query && req.query._idempotencyKey) ||
    req.headers['x-idempotency-key'] ||
    null;

  if (!rawKey || typeof rawKey !== 'string' || rawKey.trim().length < 8) {
    return { valid: false, reason: 'MISSING', key: null };
  }

  const key = rawKey.trim();

  if (consumedKeys.has(key) || inFlightKeys.has(key)) {
    return { valid: false, reason: 'DUPLICATE', key };
  }

  if (req.session && Array.isArray(req.session.consumedIdempotencyKeys)) {
    if (req.session.consumedIdempotencyKeys.includes(key)) {
      return { valid: false, reason: 'DUPLICATE', key };
    }
  }

  if (
    req.session &&
    Array.isArray(req.session.issuedIdempotencyKeys) &&
    req.session.issuedIdempotencyKeys.length > 0
  ) {
    if (!req.session.issuedIdempotencyKeys.includes(key)) {
      return { valid: false, reason: 'DUPLICATE', key };
    }
  }

  inFlightKeys.set(key, Date.now());
  return { valid: true, reason: 'OK', key };
}

function commitIdempotentOperation(req, key) {
  if (!key) return;
  inFlightKeys.delete(key);
  consumedKeys.set(key, Date.now());

  if (req && req.session) {
    if (Array.isArray(req.session.issuedIdempotencyKeys)) {
      const idx = req.session.issuedIdempotencyKeys.indexOf(key);
      if (idx !== -1) req.session.issuedIdempotencyKeys.splice(idx, 1);
    }
    if (!Array.isArray(req.session.consumedIdempotencyKeys)) {
      req.session.consumedIdempotencyKeys = [];
    }
    if (!req.session.consumedIdempotencyKeys.includes(key)) {
      req.session.consumedIdempotencyKeys.push(key);
      if (req.session.consumedIdempotencyKeys.length > 50) {
        req.session.consumedIdempotencyKeys = req.session.consumedIdempotencyKeys.slice(-50);
      }
    }
    if (req.session.feedbackPendingIdemKey === key) {
      delete req.session.feedbackPendingIdemKey;
    }
  }
}

function rollbackIdempotentOperation(key) {
  if (!key) return;
  inFlightKeys.delete(key);
}

module.exports = {
  generateIdempotencyKey,
  consumeIdempotencyKey,
  beginIdempotentOperation,
  commitIdempotentOperation,
  rollbackIdempotentOperation,
};
