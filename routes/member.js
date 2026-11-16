const express = require('express');
const router = express.Router();
const botApiClient = require('../services/botApiClient');
const { requireRegisteredMember } = require('../middlewares/auth');

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

module.exports = router;
