const express = require('express');
const router = express.Router();

const serversConfig = require('../config/servers.config');
const { getServerDirectory } = require('../services/serverDirectory');
const { requireSiteMember } = require('../middlewares/auth');

function applyNoIndex(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req && typeof req.applySeo === 'function') {
    req.applySeo({ noindex: true, isPublic: false });
  }
}

/**
 * GET /sunucular — Giriş yapmış TÜM üyeler (Discord kayıtlı veya aktif Google/Site üyesi)
 * SSR ile tam kart HTML'ini basar; önbellek 5 dk'dan eskiyse arka planda tek-uçuş tazeleme başlatır.
 */
router.get('/', requireSiteMember, (req, res) => {
  applyNoIndex(req, res);

  const dir = getServerDirectory();
  dir.refreshInBackgroundIfStale();

  const lang = req.lang === 'en' ? 'en' : 'tr';
  const payload = dir.getPublicServerCards();
  const etag = dir.computePublicEtag(payload);
  const carouselConfig = serversConfig.getClientCarouselConfig(lang);

  return res.render('pages/servers', {
    title: req.t('servers.pageTitle'),
    isServersPage: true,
    servers: payload.servers,
    featuredIndex: payload.featuredIndex,
    updatedAt: payload.updatedAt,
    refreshCooldownLeftMs: payload.refreshCooldownLeftMs,
    initialEtag: etag,
    carouselConfig,
    formatCreatedMonth: (iso) => serversConfig.formatCreatedMonth(iso, lang),
    langPrefix: req.langPrefix ? `/${req.langPrefix}` : '',
  });
});

/**
 * GET /sunucular/api/liste — Yalnızca üyelere açık, ETag/If-None-Match (304) destekli canlı liste.
 * Gizli, flagged ve iç yönetim alanları (note, addedBy, addedAt, consecutiveFailures) HİÇ dönmez.
 */
router.get('/api/liste', requireSiteMember, (req, res) => {
  applyNoIndex(req, res);
  res.setHeader('Cache-Control', 'private, no-cache');

  const dir = getServerDirectory();
  const payload = dir.getPublicServerCards();
  const etag = dir.computePublicEtag(payload);

  const ifNoneMatch = typeof req.headers['if-none-match'] === 'string' ? req.headers['if-none-match'].trim() : '';
  if (ifNoneMatch && (ifNoneMatch === etag || ifNoneMatch === etag.replace(/^W\//, ''))) {
    res.setHeader('ETag', etag);
    return res.status(304).end();
  }

  res.setHeader('ETag', etag);
  return res.json({
    ok: true,
    servers: payload.servers,
    featuredIndex: payload.featuredIndex,
    updatedAt: payload.updatedAt,
    refreshCooldownLeftMs: payload.refreshCooldownLeftMs,
  });
});

/**
 * POST /sunucular/api/yenile — Üye tetikli tazeleme (GLOBAL 60 sn bekleme + tek-uçuş kilitli + CSRF)
 */
router.post('/api/yenile', requireSiteMember, async (req, res) => {
  applyNoIndex(req, res);
  res.setHeader('Cache-Control', 'no-store');

  const dir = getServerDirectory();
  try {
    const result = await dir.triggerMemberRefresh();
    if (result.cooldown) {
      res.setHeader('Retry-After', String(result.retryAfterSec));
      return res.status(429).json({
        ok: false,
        code: 'COOLDOWN_ACTIVE',
        retryAfterSec: result.retryAfterSec,
        retryAfterMs: result.retryAfterMs,
        error: req.t('servers.errCooldown').replace('{sec}', String(result.retryAfterSec)),
      });
    }

    const payload = dir.getPublicServerCards();
    const etag = dir.computePublicEtag(payload);
    res.setHeader('ETag', etag);

    return res.json({
      ok: true,
      etag,
      servers: payload.servers,
      featuredIndex: payload.featuredIndex,
      updatedAt: payload.updatedAt,
      refreshCooldownLeftMs: payload.refreshCooldownLeftMs,
    });
  } catch (err) {
    console.error('[SUNUCULAR] Üye tazeleme hatası:', err && err.message ? err.message : err);
    return res.status(500).json({
      ok: false,
      code: 'REFRESH_FAILED',
      error: req.t('servers.errRefreshFailed'),
    });
  }
});

module.exports = router;
