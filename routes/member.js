const express = require('express');
const router = express.Router();
const botApiClient = require('../services/botApiClient');
const { requireRegisteredMember } = require('../middlewares/auth');
const { verifyCsrfToken } = require('../middlewares/csrf');
const { formActionLimiter } = require('../middlewares/rateLimiter');

/**
 * GET /profil
 * Kullanıcının kişisel klan profili, Roblox bilgileri, Tryout kademesi, VS istatistikleri ve Ceza puanı.
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
 * GET /tryout
 * 37 kademeli Tryout sıralama tablosu.
 */
router.get('/tryout', requireRegisteredMember, async (req, res, next) => {
  try {
    const tryoutData = await botApiClient.getTryoutLeaderboard();

    return res.render('pages/tryout', {
      title: req.t('tryout.pageTitle'),
      leaderboard: tryoutData.leaderboard || [],
      total: tryoutData.total || 0,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /takviye
 * Acil Takviye / Yardım çağrısı sayfası (aktif kayıtlı üye sayısı ve cooldown gösterimli).
 */
router.get('/takviye', requireRegisteredMember, async (req, res, next) => {
  try {
    const helpStatus = await botApiClient.getHelpStatus(req.session.user.id);

    const flashSuccess = req.session.flashSuccess || null;
    const flashError = req.session.flashError || null;
    delete req.session.flashSuccess;
    delete req.session.flashError;

    return res.render('pages/help', {
      title: req.t('help.pageTitle'),
      helpStatus,
      flashSuccess,
      flashError,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /takviye
 * Acil Takviye çağrısını Bot REST API'sine (POST /api/help/call) gönderir.
 */
router.post('/takviye', requireRegisteredMember, formActionLimiter, verifyCsrfToken, async (req, res) => {
  try {
    const result = await botApiClient.triggerHelpCall(req.session.user.id);
    req.session.flashSuccess = result.message || req.t('help.msgCallSuccess');
  } catch (err) {
    const rawCode = String(
      (err && err.details && (err.details.code || err.details.error)) || (err && err.message) || ''
    );
    if (rawCode === 'OTHER_CLAN_HELP_DISABLED' || rawCode.includes('OTHER_CLAN_HELP_DISABLED')) {
      req.session.flashError = req.t('help.errOtherClanHelpDisabled');
    } else {
      req.session.flashError = err.message;
    }
  }

  return res.redirect('/takviye');
});

module.exports = router;
