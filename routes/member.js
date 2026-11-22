const express = require('express');
const router = express.Router();
const botApiClient = require('../services/botApiClient');
const { requireRegisteredMember } = require('../middlewares/auth');
const { isRegisteredMember } = require('../config/roles.config');
const { activityApiLimiter } = require('../middlewares/rateLimiter');

/**
 * GET /profil
 * Kullanıcının kişisel topluluk profili, kayıt bilgileri ve disiplin durumu.
 */
router.get('/profil', requireRegisteredMember, async (req, res, next) => {
  try {
    const profileData = await botApiClient.getMemberProfile(req.session.user.id);

    return res.render('pages/profile', {
      title: req.t('profile.pageTitle'),
      profile: profileData,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/me/activity
 * Giriş yapmış ve kayıtlı kullanıcının yalnızca KENDİ (req.session.user.id) aylık oyun etkinliğini JSON olarak döndürür.
 * Dışarıdan ID parametresi kesinlikle kabul etmez.
 */
router.get('/api/me/activity', (req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (!req.session || !req.session.user || !req.session.user.id) {
    return res.status(401).json({
      ok: false,
      code: 'UNAUTHENTICATED',
      error: req.t ? req.t('activityPanel.unauthenticated') : 'Oturum açmanız gerekiyor.',
    });
  }

  const user = req.session.user;
  if (!isRegisteredMember(user.roles, user.level, user.registered)) {
    return res.status(403).json({
      ok: false,
      code: 'NOT_REGISTERED',
      error: req.t ? req.t('activityPanel.notRegisteredDesc') : 'Etkinliğini görmek için kayıt ol.',
    });
  }

  return next();
}, activityApiLimiter, async (req, res) => {
  try {
    const lang = req.lang === 'en' ? 'en' : 'tr';
    const data = await botApiClient.getMemberActivity(req.session.user.id, lang);
    return res.json({
      ok: true,
      ...data,
    });
  } catch (err) {
    const status = err && err.statusCode === 404 && err.errorCategory !== 'ENDPOINT_MISSING' ? 404 : 503;
    return res.status(status).json({
      ok: false,
      code: status === 404 ? 'NOT_IN_GUILD' : 'BOT_UNAVAILABLE',
      error: req.t ? req.t('activityPanel.errorLoad') : 'Etkinlik bilgisi şu an alınamadı.',
    });
  }
});

module.exports = router;
