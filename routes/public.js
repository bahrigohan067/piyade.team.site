const express = require('express');
const router = express.Router();
const { botApiClient, BotApiUnavailableError, BotApiError } = require('../services/botApiClient');
const { getGroupedRules } = require('../config/rules.config');
const { requireAuth } = require('../middlewares/auth');
const { formLimiter } = require('../middlewares/rateLimiter');

/**
 * GET /
 * Anasayfa - Klan tanıtımı ve güncel aktif üye sayısı
 */
router.get('/', async (req, res, next) => {
  try {
    let activeStats = { activeRegisteredCount: 0, onlineMembersCount: 0 };
    try {
      const helpStatus = await botApiClient.getHelpStatus(req.session?.user?.id || null);
      activeStats = {
        activeRegisteredCount: helpStatus.activeRegisteredCount || 0,
        onlineMembersCount: helpStatus.onlineMembersCount || 0,
      };
    } catch (apiErr) {
      // Anasayfa açılırken bot API çevrimdışı olsa bile sayfa düşmesin, varsayılan istatistikle açılsın
      console.warn('[ANASAYFA UYARI] Bot API istatistiği alınamadı:', apiErr.message);
    }

    res.render('pages/home', {
      title: 'Piyade Team | The Strongest Battlegrounds',
      activeStats,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /kurallar
 * Genel Kurallar - M1–M13, D1–D3, Y1–Y5 (rules.config.js'den beslenir)
 */
router.get('/kurallar', (req, res) => {
  const groupedRules = getGroupedRules();
  res.render('pages/rules', {
    title: 'Genel Kurallar | Piyade Team',
    groupedRules,
  });
});

/**
 * GET /etkilesim
 * Menü: Dart Rating, Meteors ve Scroll Reveal İnteraktif Alanı
 */
router.get('/etkilesim', (req, res) => {
  res.render('pages/interactive', {
    title: '🎯 Atış & Gökyüzü | Piyade Team',
  });
});

/**
 * GET /once-kayit-ol
 * Sunucuda olmayan veya sadece Kayıtsız rolünde olanlar için bilgilendirme ekranı
 */
router.get('/once-kayit-ol', (req, res) => {
  res.render('pages/not-registered', {
    title: 'Kayıt Olmanız Gerekiyor | Piyade Team',
    user: req.session?.user || null,
    inGuild: req.session?.user?.inGuild ?? false,
  });
});

/**
 * GET /kayit
 * Site içi Kayıt Başvuru Ekranı
 * Önce Discord ile giriş istenir, ardından kullanıcının mevcut başvuru durumu sorgulanır.
 */
router.get('/kayit', async (req, res, next) => {
  const user = req.session?.user;

  // 1. Kullanıcı henüz Discord ile giriş yapmamışsa
  if (!user) {
    return res.render('pages/register', {
      title: 'Kayıt Ol | Piyade Team',
      state: 'login_required',
      user: null,
      statusData: null,
      error: null,
      success: null,
    });
  }

  // 2. Kullanıcı Discord ile giriş yapmışsa, Bot API'den başvuru durumunu al
  try {
    const statusData = await botApiClient.getRegistrationStatus(user.id);

    res.render('pages/register', {
      title: 'Kayıt Başvurusu | Piyade Team',
      state: statusData.status, // 'approved' | 'pending' | 'rejected' | 'unregistered'
      user,
      statusData,
      error: req.session.registerError || null,
      success: req.session.registerSuccess || null,
    });

    // Flash mesajları temizle
    req.session.registerError = null;
    req.session.registerSuccess = null;
  } catch (err) {
    if (err instanceof BotApiUnavailableError) {
      return next(err);
    }
    // API hatası durumunda formu yine de göster
    res.render('pages/register', {
      title: 'Kayıt Ol | Piyade Team',
      state: 'unregistered',
      user,
      statusData: null,
      error: `Durum sorgulanamadı: ${err.message}`,
      success: null,
    });
  }
});

/**
 * POST /kayit
 * Site içi Kayıt Formu Gönderimi
 */
router.post('/kayit', requireAuth, formLimiter, async (req, res, next) => {
  const user = req.session.user;
  const { realName, gender, robloxInput } = req.body;

  try {
    // 1. Girdi Kontrolleri
    if (!realName || realName.trim().length < 2 || realName.trim().length > 32) {
      req.session.registerError = 'Gerçek adınız 2 ila 32 karakter arasında olmalıdır.';
      return res.redirect('/kayit');
    }

    if (!gender) {
      req.session.registerError = 'Lütfen cinsiyet seçimi yapınız.';
      return res.redirect('/kayit');
    }

    if (!robloxInput || robloxInput.trim().length < 1) {
      req.session.registerError = 'Lütfen Roblox kullanıcı adınızı, ID\'nizi veya profil bağlantınızı giriniz.';
      return res.redirect('/kayit');
    }

    // 2. Bot API'ye Başvuru İsteği Gönder (POST /api/register)
    const result = await botApiClient.createRegistration({
      discordId: user.id,
      realName: realName.trim(),
      gender: gender.trim(),
      robloxInput: robloxInput.trim(),
    });

    req.session.registerSuccess =
      result.message || 'Kayıt başvurunuz başarıyla oluşturuldu ve yetkili onayına gönderildi!';

    // JSON isteği ise JSON döndür, normal form ise yönlendir
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, message: req.session.registerSuccess, result });
    }

    return res.redirect('/kayit');
  } catch (err) {
    console.error('[KAYIT FORMU HATASI]:', err.message);
    const errorMsg =
      err instanceof BotApiError
        ? err.message
        : err instanceof BotApiUnavailableError
        ? 'Bot API servisine şu anda ulaşılamıyor. Lütfen daha sonra tekrar deneyiniz.'
        : `Başvuru sırasında hata oluştu: ${err.message}`;

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(err.status || 400).json({ error: errorMsg });
    }

    req.session.registerError = errorMsg;
    return res.redirect('/kayit');
  }
});

module.exports = router;
