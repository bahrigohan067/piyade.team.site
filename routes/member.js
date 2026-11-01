const express = require('express');
const router = express.Router();
const { botApiClient, BotApiUnavailableError, BotApiError } = require('../services/botApiClient');
const { requireRegisteredMember } = require('../middlewares/auth');
const { formLimiter } = require('../middlewares/rateLimiter');

// Rotalar Kayıtlı Üye (1559604702143062016 ve üstü) kontrolünden geçer

/**
 * GET /profil
 * Profilim: Discord bilgileri, Roblox linki/bilgileri, Tryout seviyesi, VS puan/kill ve ceza durumu
 */
router.get('/profil', requireRegisteredMember, async (req, res, next) => {
  const user = req.session.user;

  try {
    const profile = await botApiClient.getMemberProfile(user.id);

    res.render('pages/profile', {
      title: 'Profilim | Piyade Team',
      profile,
      user,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /tryout
 * Tryout Tablosu: 37 aşamalı seviye değerlendirme tablosu ve sıralama
 */
router.get('/tryout', requireRegisteredMember, async (req, res, next) => {
  try {
    const leaderboardData = await botApiClient.getTryoutLeaderboard();

    res.render('pages/tryout', {
      title: 'Tryout Sıralama Tablosu | Piyade Team',
      leaderboard: leaderboardData.leaderboard || [],
      total: leaderboardData.total || 0,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /takviye
 * Acil Takviye Paneli: Aktif üye sayısı, cooldown ve çağrı durumu
 */
router.get('/takviye', requireRegisteredMember, async (req, res, next) => {
  const user = req.session.user;

  try {
    const helpStatus = await botApiClient.getHelpStatus(user.id);

    res.render('pages/help', {
      title: 'Acil Takviye Çağrısı | Piyade Team',
      helpStatus,
      user,
      flashSuccess: req.session.helpSuccess || null,
      flashError: req.session.helpError || null,
    });

    req.session.helpSuccess = null;
    req.session.helpError = null;
  } catch (err) {
    next(err);
  }
});

/**
 * POST /takviye
 * Acil Takviye Çağrısı Gönderimi (5 dakika cooldown)
 */
router.post('/takviye', requireRegisteredMember, formLimiter, async (req, res, next) => {
  const user = req.session.user;

  try {
    const result = await botApiClient.triggerHelpCall(user.id);

    const message = result.message || 'Acil takviye çağrısı başarıyla yayınlandı ve klan üyelerine iletildi!';
    req.session.helpSuccess = message;

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, message, result });
    }

    return res.redirect('/takviye');
  } catch (err) {
    console.error('[ACİL TAKVİYE HATASI]:', err.message);

    let errorMsg = 'Takviye çağrısı yapılırken bir hata oluştu.';
    let remainingSeconds = 0;

    if (err instanceof BotApiError) {
      errorMsg = err.message;
      if (err.data?.cooldown) {
        remainingSeconds = err.data.remainingSeconds || 0;
      }
    } else if (err instanceof BotApiUnavailableError) {
      errorMsg = 'Bot API servisine şu anda ulaşılamıyor. Lütfen daha sonra tekrar deneyiniz.';
    }

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(err.status || 400).json({
        error: errorMsg,
        remainingSeconds,
      });
    }

    req.session.helpError = errorMsg;
    return res.redirect('/takviye');
  }
});

module.exports = router;
