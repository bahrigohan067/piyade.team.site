const path = require('path');
const express = require('express');
const router = express.Router();
const siteConfig = require('../config/site.config');
const brandConfig = require('../config/brand.config');
const { getGroupedRules } = require('../rules');
const botApiClient = require('../services/botApiClient');
const warriorsStore = require('../services/warriorsStore');
const robloxAvatarService = require('../services/robloxAvatarService');
const { requireLogin } = require('../middlewares/auth');
const { verifyCsrfToken } = require('../middlewares/csrf');
const { formActionLimiter } = require('../middlewares/rateLimiter');
const { generateIdempotencyKey, consumeIdempotencyKey } = require('../middlewares/idempotency');

/**
 * GET /favicon.ico
 * Tarayıcıların otomatik istediği kök favicon isteğini doğrudan 200 OK ile sunar.
 */
router.get('/favicon.ico', (req, res) => {
  const icoPath = path.join(__dirname, '..', 'public', brandConfig.PATHS.faviconIco.replace(/^\/+/, ''));
  res.setHeader('Content-Type', 'image/x-icon');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  return res.sendFile(icoPath);
});

/**
 * GET /robots.txt
 * Arama motoru botları için tarama izinleri ve dinamik Sitemap adresi.
 * Yalnızca herkese açık sayfalar taranabilir; yönetim, profil, tryout, takviye ve auth kapalıdır.
 */
router.get('/robots.txt', (req, res) => {
  res.removeHeader('X-Robots-Tag');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  const baseUrl = siteConfig.getBaseUrl();
  const lines = [
    'User-agent: *',
    'Allow: /',
    'Allow: /tr',
    'Allow: /en',
    'Allow: /kurallar',
    'Allow: /kayit',
    'Allow: /etkilesim',
    'Disallow: /yonetim',
    'Disallow: /profil',
    'Disallow: /tryout',
    'Disallow: /takviye',
    'Disallow: /yardim',
    'Disallow: /auth',
    'Disallow: /lang',
    'Disallow: /health',
    '',
    `Sitemap: ${baseUrl}/sitemap.xml`,
    '',
  ];

  return res.send(lines.join('\n'));
});

/**
 * GET /sitemap.xml
 * BASE_URL üzerinden dinamik üretilen, yalnızca herkese açık sayfaları ve dil alternatiflerini (hreflang) içeren site haritası.
 */
router.get('/sitemap.xml', (req, res) => {
  res.removeHeader('X-Robots-Tag');
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  const baseUrl = siteConfig.getBaseUrl();
  const today = new Date().toISOString().split('T')[0];

  const routeConfigs = [
    { path: '/', priority: '1.0', changefreq: 'daily' },
    { path: '/kurallar', priority: '0.9', changefreq: 'weekly' },
    { path: '/kayit', priority: '0.9', changefreq: 'weekly' },
    { path: '/etkilesim', priority: '0.8', changefreq: 'monthly' },
  ];

  const urlEntries = [];

  for (const item of routeConfigs) {
    const alternates = siteConfig.buildAlternateUrls(baseUrl, item.path);
    const variants = [
      alternates.xDefault,
      alternates.tr,
      alternates.en,
    ];

    for (const loc of variants) {
      urlEntries.push(
        [
          '  <url>',
          `    <loc>${loc}</loc>`,
          `    <lastmod>${today}</lastmod>`,
          `    <changefreq>${item.changefreq}</changefreq>`,
          `    <priority>${item.priority}</priority>`,
          `    <xhtml:link rel="alternate" hreflang="tr" href="${alternates.tr}" />`,
          `    <xhtml:link rel="alternate" hreflang="en" href="${alternates.en}" />`,
          `    <xhtml:link rel="alternate" hreflang="x-default" href="${alternates.xDefault}" />`,
          '  </url>',
        ].join('\n')
      );
    }
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urlEntries,
    '</urlset>',
    '',
  ].join('\n');

  return res.send(xml);
});

/**
 * GET /
 * Anasayfa: Klan tanıtımı ve canlı aktif üye istatistikleri.
 */
router.get('/', async (req, res) => {
  let activeStats = {
    activeRegisteredCount: null,
    botOnline: false,
  };

  try {
    const [helpData, healthData] = await Promise.all([
      botApiClient.getHelpStatus(req.session?.user?.id || null).catch(() => null),
      botApiClient.checkHealth().catch(() => null),
    ]);

    if (helpData && typeof helpData.activeRegisteredCount === 'number') {
      activeStats.activeRegisteredCount = helpData.activeRegisteredCount;
      activeStats.botOnline = true;
    }
    if (!healthData || healthData.status !== 'ok') {
      activeStats.botOnline = false;
    } else {
      activeStats.botOnline = true;
    }
  } catch (_) {
    activeStats.botOnline = false;
    activeStats.activeRegisteredCount = null;
  }

  let topWarriors = [];
  try {
    const rawWarriors = warriorsStore.getWarriors();
    topWarriors = await robloxAvatarService.enrichWarriorsForDisplay(rawWarriors);
  } catch (err) {
    console.warn('[HOME] Savaşçılar verisi yüklenemedi, seed fallback:', err.message);
    topWarriors = warriorsStore.getWarriors().map((w, idx) => ({
      ...w,
      rank: idx + 1,
      avatarUrl: null,
      robloxProfileUrl: null,
      isCustomImage: false,
      isPlaceholder: true,
    }));
  }

  return res.render('pages/home', {
    title: res.locals.seo ? res.locals.seo.title : req.t('home.pageTitle'),
    activeStats,
    topWarriors,
  });
});

/**
 * GET /kurallar
 * Genel Kurallar (M1-M13, D1-D3, Y1-Y5) - tek bir rules.js dosyasından beslenir (TR/EN).
 */
router.get('/kurallar', (req, res) => {
  const groupedRules = getGroupedRules(req.lang || 'tr');

  return res.render('pages/rules', {
    title: res.locals.seo ? res.locals.seo.title : req.t('rules.pageTitle'),
    groupedRules,
  });
});

/**
 * GET /etkilesim
 * Anasayfa dışı özel interaktif bileşenler sayfası (Dart Rating, Meteors, Scroll Reveal Text).
 */
router.get('/etkilesim', (req, res) => {
  return res.render('pages/interactive', {
    title: res.locals.seo ? res.locals.seo.title : req.t('interactive.pageTitle'),
  });
});

/**
 * GET /kayit
 * Site içi kayıt formu ve başvuru durumu ekranı.
 */
router.get('/kayit', async (req, res, next) => {
  const user = req.session?.user;
  const pageTitle = res.locals.seo ? res.locals.seo.title : req.t('register.pageTitle');

  // Kullanıcı henüz Discord ile giriş yapmamışsa
  if (!user || !user.id) {
    return res.render('pages/register', {
      title: pageTitle,
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
      title: pageTitle,
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
router.post('/kayit', requireLogin, formActionLimiter, verifyCsrfToken, async (req, res, next) => {
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
    if (err && err.isOffline) {
      return next(err);
    }
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
