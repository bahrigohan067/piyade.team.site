const crypto = require('crypto');

const CONSUMED_KEY_TTL_MS = 15 * 60 * 1000; // 15 dakika
const consumedKeys = new Map();

function pruneConsumedKeys() {
  const now = Date.now();
  for (const [key, timestamp] of consumedKeys.entries()) {
    if (now - timestamp > CONSUMED_KEY_TTL_MS) {
      consumedKeys.delete(key);
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

module.exports = {
  generateIdempotencyKey,
  consumeIdempotencyKey,
};
