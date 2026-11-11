const express = require('express');
const feedbackConfig = require('../config/feedback.config');
const botApiClient = require('../services/botApiClient');
const { verifyCsrfToken } = require('../middlewares/csrf');
const {
  generateIdempotencyKey,
  beginIdempotentOperation,
  commitIdempotentOperation,
  rollbackIdempotentOperation,
} = require('../middlewares/idempotency');

const router = express.Router();

// Kullanıcı başına 10 dakikada 3, 24 saatte 10 geri bildirim sınırı (in-memory sliding window)
const userFeedbackHistory = new Map();

const pruneTimer = setInterval(() => {
  const now = Date.now();
  const dayMs = feedbackConfig.rateLimit.dayWindowMs;
  for (const [uid, timestamps] of userFeedbackHistory.entries()) {
    const active = timestamps.filter((t) => now - t < dayMs);
    if (active.length === 0) userFeedbackHistory.delete(uid);
    else userFeedbackHistory.set(uid, active);
  }
}, 10 * 60 * 1000);
if (pruneTimer.unref) pruneTimer.unref();

function checkAndRecordUserRateLimit(userId) {
  const now = Date.now();
  const { tenMinWindowMs, tenMinMax, dayWindowMs, dayMax } = feedbackConfig.rateLimit;
  const list = (userFeedbackHistory.get(userId) || []).filter((t) => now - t < dayWindowMs);

  const recentTenMin = list.filter((t) => now - t < tenMinWindowMs);
  if (recentTenMin.length >= tenMinMax || list.length >= dayMax) {
    userFeedbackHistory.set(userId, list);
    return { allowed: false, timestamp: null };
  }

  list.push(now);
  userFeedbackHistory.set(userId, list);
  return { allowed: true, timestamp: now };
}

function rollbackUserRateLimit(userId, timestamp) {
  if (!timestamp) return;
  const list = userFeedbackHistory.get(userId);
  if (!Array.isArray(list)) return;
  const idx = list.lastIndexOf(timestamp);
  if (idx !== -1) list.splice(idx, 1);
}

/**
 * POST /geri-bildirim
 * Feedback Pill'den gelen mesajı doğrular ve Bot REST API'sine iletir.
 * Güvenlik ve gizlilik gereği gönderilen mesaj metni sunucu loglarına YAZILMAZ.
 */
router.post('/', verifyCsrfToken, async (req, res) => {
  if (!feedbackConfig.enabled) {
    return res.status(404).json({ code: 'INVALID' });
  }

  // 1. Oturum ve sunucu üyeliği kontrolü (yalnızca req.session.user üzerinden)
  const user = req.session && req.session.user;
  if (!user || !user.id) {
    return res.status(401).json({ code: 'SESSION_EXPIRED' });
  }
  if (!user.inGuild) {
    console.info(`[FEEDBACK] user=${user.id} code=NOT_IN_GUILD`);
    return res.status(403).json({ code: 'NOT_IN_GUILD' });
  }

  // 2. Mesaj doğrulaması (boşluk yığını spam koruması dahil)
  const rawMessage = req.body && typeof req.body.message === 'string' ? req.body.message : '';
  const trimmed = rawMessage.trim();
  const compactNonSpaceLen = trimmed.replace(/\s+/g, '').length;

  if (trimmed.length === 0) {
    return res.status(400).json({ code: 'TOO_SHORT', applied: false });
  }
  if (trimmed.length < feedbackConfig.minLength || compactNonSpaceLen < 2) {
    console.info(`[FEEDBACK] user=${user.id} code=TOO_SHORT`);
    return res.status(400).json({ code: 'TOO_SHORT', applied: false });
  }
  if (trimmed.length > feedbackConfig.maxLength) {
    console.info(`[FEEDBACK] user=${user.id} code=TOO_LONG`);
    return res.status(400).json({ code: 'TOO_LONG', applied: false });
  }

  // 3. Tek kullanımlık idempotency anahtarı kontrolü
  const idem = beginIdempotentOperation(req);
  if (!idem.valid) {
    if (idem.reason === 'DUPLICATE') {
      console.info(`[FEEDBACK] user=${user.id} code=DUPLICATE`);
      return res.status(409).json({ code: 'DUPLICATE' });
    }
    console.info(`[FEEDBACK] user=${user.id} code=INVALID`);
    return res.status(400).json({
      code: 'INVALID',
      applied: false,
      nextIdempotencyKey: generateIdempotencyKey(req),
    });
  }

  // 4. Kullanıcı bazlı hız sınırı (10 dk: 3, 24 sa: 10)
  const rateCheck = checkAndRecordUserRateLimit(String(user.id));
  if (!rateCheck.allowed) {
    rollbackIdempotentOperation(idem.key);
    console.info(`[FEEDBACK] user=${user.id} code=RATE_LIMITED`);
    return res.status(429).json({
      code: 'RATE_LIMITED',
      applied: false,
    });
  }

  // 5. Sayfa ve dil temizliği
  const safePage = feedbackConfig.sanitizeSafePagePath(req.body && req.body.page);
  const lang = req.lang === 'en' ? 'en' : 'tr';

  try {
    await botApiClient.sendFeedback({
      actorId: String(user.id),
      message: trimmed,
      page: safePage,
      lang,
    });

    commitIdempotentOperation(req, idem.key);
    const nextKey = generateIdempotencyKey(req);
    if (req.session) {
      req.session.feedbackPendingIdemKey = nextKey;
    }

    console.info(`[FEEDBACK] user=${user.id} code=OK`);
    return res.status(200).json({
      success: true,
      nextIdempotencyKey: nextKey,
    });
  } catch (err) {
    rollbackIdempotentOperation(idem.key);
    rollbackUserRateLimit(String(user.id), rateCheck.timestamp);

    if (err && err.statusCode === 404) {
      user.inGuild = false;
      console.info(`[FEEDBACK] user=${user.id} code=NOT_IN_GUILD`);
      return res.status(403).json({ code: 'NOT_IN_GUILD' });
    }

    if (err && err.statusCode === 429) {
      console.info(`[FEEDBACK] user=${user.id} code=RATE_LIMITED`);
      return res.status(429).json({
        code: 'RATE_LIMITED',
        applied: false,
      });
    }

    if (err && (err.isOffline || err.statusCode === 401 || err.statusCode >= 500)) {
      console.info(`[FEEDBACK] user=${user.id} code=BOT_UNAVAILABLE`);
      return res.status(503).json({
        code: 'BOT_UNAVAILABLE',
        applied: false,
        nextIdempotencyKey: idem.key,
      });
    }

    console.info(`[FEEDBACK] user=${user.id} code=INVALID`);
    return res.status(400).json({
      code: 'INVALID',
      applied: false,
      nextIdempotencyKey: idem.key,
    });
  }
});

module.exports = router;
module.exports._resetRateLimiterForTests = () => userFeedbackHistory.clear();
