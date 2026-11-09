const express = require('express');
const router = express.Router();
const { getGroupedRules } = require('../rules');
const botApiClient = require('../services/botApiClient');
const { requireLogin } = require('../middlewares/auth');
const { verifyCsrfToken } = require('../middlewares/csrf');
const { formActionLimiter } = require('../middlewares/rateLimiter');
const { generateIdempotencyKey, consumeIdempotencyKey } = require('../middlewares/idempotency');

/**
 * GET /
 * Anasayfa: Klan tanıtımı ve canlı aktif üye istatistikleri.
 */
router.get('/', async (req, res) => {
  let activeStats = {
    activeRegisteredCount: 0,
    botOnline: true,
  };

  try {
    const [helpData, healthData] = await Promise.all([
      botApiClient.getHelpStatus(req.session?.user?.id || null).catch(() => null),
      botApiClient.checkHealth().catch(() => null),
    ]);

    if (helpData && typeof helpData.activeRegisteredCount === 'number') {
      activeStats.activeRegisteredCount = helpData.activeRegisteredCount;
    }
    if (!healthData || healthData.status !== 'ok') {
      activeStats.botOnline = false;
    }
  } catch (_) {
    activeStats.botOnline = false;
  }

  return res.render('pages/home', {
    title: req.t('home.pageTitle'),
    activeStats,
  });
});

/**
 * GET /kurallar
 * Genel Kurallar (M1-M13, D1-D3, Y1-Y5) - tek bir rules.js dosyasından beslenir (TR/EN).
 */
router.get('/kurallar', (req, res) => {
  const groupedRules = getGroupedRules(req.lang || 'tr');

  return res.render('pages/rules', {
    title: req.t('rules.pageTitle'),
    groupedRules,
  });
});

/**
 * GET /etkilesim
 * Anasayfa dışı özel interaktif bileşenler sayfası (Dart Rating, Meteors, Scroll Reveal Text).
 */
router.get('/etkilesim', (req, res) => {
  return res.render('pages/interactive', {
    title: req.t('interactive.pageTitle'),
  });
});

/**
 * GET /kayit
 * Site içi kayıt formu ve başvuru durumu ekranı.
 */
router.get('/kayit', async (req, res, next) => {
  const user = req.session?.user;

  // Kullanıcı henüz Discord ile giriş yapmamışsa
  if (!user || !user.id) {
    return res.render('pages/register', {
      title: req.t('register.pageTitle'),
      state: 'login_required',
      statusData: null,
      error: null,
      success: null,
      idempotencyKey: '',
    });
  }

  try {
    const statusData = await botApiClient.getRegistrationStatus(user.id);

    return res.render('pages/register', {
      title: req.t('register.pageTitle'),
      state: statusData.state || 'none',
      statusData,
      error: null,
      success: null,
      idempotencyKey: generateIdempotencyKey(req),
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /kayit
 * Kayıt başvurusunu Bot REST API'sine (POST /api/register) iletir.
 * Madde 6: Tekil idempotency anahtarı ile çift gönderimi engeller.
 */
router.post('/kayit', requireLogin, formActionLimiter, verifyCsrfToken, async (req, res) => {
  const user = req.session.user;
  const { realName, gender, robloxInput } = req.body;

  // Madde 6: Idempotency (Çift Gönderim) Kontrolü
  const idemCheck = consumeIdempotencyKey(req);
  if (!idemCheck.valid) {
    const currentStatus = await botApiClient.getRegistrationStatus(user.id).catch(() => ({ state: 'none' }));
    return res.status(409).render('pages/register', {
      title: req.t('register.pageTitle'),
      state: currentStatus.state || 'none',
      statusData: currentStatus,
      error: req.t('errors.duplicateSubmission'),
      success: null,
      idempotencyKey: generateIdempotencyKey(req),
    });
  }

  const cleanName = String(realName || '').trim();
  const cleanGender = String(gender || '').trim();
  const cleanRoblox = String(robloxInput || '').trim();

  if (cleanName.length < 2 || cleanName.length > 32) {
    const currentStatus = await botApiClient.getRegistrationStatus(user.id).catch(() => ({ state: 'none' }));
    return res.status(400).render('pages/register', {
      title: req.t('register.pageTitle'),
      state: currentStatus.state || 'none',
      statusData: currentStatus,
      error: req.t('register.errRealNameLength'),
      success: null,
      idempotencyKey: generateIdempotencyKey(req),
    });
  }

  if (cleanGender !== 'Erkek' && cleanGender !== 'Kız') {
    const currentStatus = await botApiClient.getRegistrationStatus(user.id).catch(() => ({ state: 'none' }));
    return res.status(400).render('pages/register', {
      title: req.t('register.pageTitle'),
      state: currentStatus.state || 'none',
      statusData: currentStatus,
      error: req.t('register.errSelectGender'),
      success: null,
      idempotencyKey: generateIdempotencyKey(req),
    });
  }

  if (!cleanRoblox) {
    const currentStatus = await botApiClient.getRegistrationStatus(user.id).catch(() => ({ state: 'none' }));
    return res.status(400).render('pages/register', {
      title: req.t('register.pageTitle'),
      state: currentStatus.state || 'none',
      statusData: currentStatus,
      error: req.t('register.errRobloxRequired'),
      success: null,
      idempotencyKey: generateIdempotencyKey(req),
    });
  }

  try {
    const result = await botApiClient.submitRegistration({
      discordId: user.id,
      realName: cleanName,
      gender: cleanGender,
      robloxInput: cleanRoblox,
    });

    const updatedStatus = await botApiClient.getRegistrationStatus(user.id).catch(() => ({
      state: 'pending',
      application: result.application,
    }));

    return res.render('pages/register', {
      title: req.t('register.pageTitle'),
      state: updatedStatus.state || 'pending',
      statusData: updatedStatus,
      error: null,
      success: result.message || req.t('register.msgSubmittedSuccess'),
      idempotencyKey: generateIdempotencyKey(req),
    });
  } catch (err) {
    const currentStatus = await botApiClient.getRegistrationStatus(user.id).catch(() => ({ state: 'none' }));
    return res.status(err.statusCode || 400).render('pages/register', {
      title: req.t('register.pageTitle'),
      state: currentStatus.state || 'none',
      statusData: currentStatus,
      error: err.message,
      success: null,
      idempotencyKey: generateIdempotencyKey(req),
    });
  }
});

module.exports = router;
