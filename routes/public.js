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
 * Bot API'den dönen kayıt hata kodlarını yerelleştirilmiş mesajlara dönüştürür.
 * Ham bot hata metnini asla kullanıcıya göstermez.
 */
function mapBotRegistrationError(err, req) {
  const details = err && err.details && typeof err.details === 'object' ? err.details : {};
  const rawCode = String(details.code || details.errorCode || details.error || err?.message || '').trim();
  const upper = rawCode.toUpperCase();

  if (upper === 'CLAN_REQUIRED' || upper.includes('CLAN_REQUIRED')) {
    return { message: req.t('register.errClanRequired'), clanOwnError: false };
  }
  if (upper === 'CLAN_INVALID' || upper.includes('CLAN_INVALID')) {
    return { message: req.t('register.errClanInvalid'), clanOwnError: false };
  }
  if (upper === 'CLAN_BLOCKED' || upper.includes('CLAN_BLOCKED')) {
    return { message: req.t('register.errClanBlocked'), clanOwnError: false };
  }
  if (upper === 'CLAN_IS_OWN' || upper.includes('CLAN_IS_OWN')) {
    return { message: req.t('register.errClanIsOwn'), clanOwnError: true };
  }
  if (upper === 'ALREADY_REGISTERED' || upper.includes('ALREADY_REGISTERED')) {
    return { message: req.t('register.errAlreadyRegistered'), clanOwnError: false };
  }

  return { message: req.t('register.errGenericRegistration'), clanOwnError: false };
}

/**
 * GET /kayit
 * Site içi kayıt türü seçimi (Adım 1), başvuru formu (Adım 2) ve başvuru durumu ekranı.
 */
router.get('/kayit', async (req, res, next) => {
  const user = req.session?.user;
  const hasTurQuery = Boolean(req.query && req.query.tur !== undefined);
  const rawTur = hasTurQuery ? String(req.query.tur || '').trim().toLowerCase() : '';
  const validTur = rawTur === 'piyade' || rawTur === 'baska' ? rawTur : null;

  // ?tur=... varyantlarına noindex uygula; kanonik adres her zaman /kayit kalır
  if (hasTurQuery && typeof req.applySeo === 'function') {
    req.applySeo({ noindex: true, keepCanonical: true });
  }

  const pageTitle = res.locals.seo ? res.locals.seo.title : req.t('register.pageTitle');
  const emptyFormData = { realName: '', gender: '', robloxInput: '', clanName: '' };

  // Kullanıcı henüz Discord ile giriş yapmamışsa
  if (!user || !user.id) {
    return res.render('pages/register', {
      title: pageTitle,
      state: 'login_required',
      step: 'login',
      tur: null,
      statusData: null,
      formData: emptyFormData,
      error: null,
      clanOwnError: false,
      success: null,
      idempotencyKey: '',
    });
  }

  try {
    const statusData = await botApiClient.getRegistrationStatus(user.id);

    return res.render('pages/register', {
      title: pageTitle,
      state: statusData.state || 'none',
      step: validTur ? 'form' : 'select',
      tur: validTur,
      statusData,
      formData: emptyFormData,
      error: null,
      clanOwnError: false,
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
  const { realName, gender, robloxInput, tur, clanName } = req.body || {};

  const rawTur = String(tur || '').trim().toLowerCase();
  const validTur = rawTur === 'piyade' || rawTur === 'baska' ? rawTur : null;
  const cleanName = String(realName || '').trim();
  const cleanGender = String(gender || '').trim();
  const cleanRoblox = String(robloxInput || '').trim();
  const cleanClan = String(clanName || '').trim();
  const formData = {
    realName: cleanName,
    gender: cleanGender,
    robloxInput: cleanRoblox,
    clanName: cleanClan,
  };

  // Madde 6: Idempotency (Çift Gönderim) Kontrolü
  const idemCheck = consumeIdempotencyKey(req);
  if (!idemCheck.valid) {
    const currentStatus = await botApiClient.getRegistrationStatus(user.id).catch(() => ({ state: 'none' }));
    return res.status(409).render('pages/register', {
      title: req.t('register.pageTitle'),
      state: currentStatus.state || 'none',
      step: validTur ? 'form' : 'select',
      tur: validTur,
      statusData: currentStatus,
      formData,
      error: req.t('errors.duplicateSubmission'),
      clanOwnError: false,
      success: null,
      idempotencyKey: generateIdempotencyKey(req),
    });
  }

  // tur doğrula ('piyade' -> 'own', 'baska' -> 'other'); geçersiz veya yoksa seçim ekranına dön
  if (!validTur) {
    const currentStatus = await botApiClient.getRegistrationStatus(user.id).catch(() => ({ state: 'none' }));
    return res.status(400).render('pages/register', {
      title: req.t('register.pageTitle'),
      state: currentStatus.state || 'none',
      step: 'select',
      tur: null,
      statusData: currentStatus,
      formData,
      error: null,
      clanOwnError: false,
      success: null,
      idempotencyKey: generateIdempotencyKey(req),
    });
  }

  if (cleanName.length < 2 || cleanName.length > 32) {
    const currentStatus = await botApiClient.getRegistrationStatus(user.id).catch(() => ({ state: 'none' }));
    return res.status(400).render('pages/register', {
      title: req.t('register.pageTitle'),
      state: currentStatus.state || 'none',
      step: 'form',
      tur: validTur,
      statusData: currentStatus,
      formData,
      error: req.t('register.errRealNameLength'),
      clanOwnError: false,
      success: null,
      idempotencyKey: generateIdempotencyKey(req),
    });
  }

  if (cleanGender !== 'Erkek' && cleanGender !== 'Kız') {
    const currentStatus = await botApiClient.getRegistrationStatus(user.id).catch(() => ({ state: 'none' }));
    return res.status(400).render('pages/register', {
      title: req.t('register.pageTitle'),
      state: currentStatus.state || 'none',
      step: 'form',
      tur: validTur,
      statusData: currentStatus,
      formData,
      error: req.t('register.errSelectGender'),
      clanOwnError: false,
      success: null,
      idempotencyKey: generateIdempotencyKey(req),
    });
  }

  if (!cleanRoblox) {
    const currentStatus = await botApiClient.getRegistrationStatus(user.id).catch(() => ({ state: 'none' }));
    return res.status(400).render('pages/register', {
      title: req.t('register.pageTitle'),
      state: currentStatus.state || 'none',
      step: 'form',
      tur: validTur,
      statusData: currentStatus,
      formData,
      error: req.t('register.errRobloxRequired'),
      clanOwnError: false,
      success: null,
      idempotencyKey: generateIdempotencyKey(req),
    });
  }

  if (validTur === 'baska') {
    if (!cleanClan) {
      const currentStatus = await botApiClient.getRegistrationStatus(user.id).catch(() => ({ state: 'none' }));
      return res.status(400).render('pages/register', {
        title: req.t('register.pageTitle'),
        state: currentStatus.state || 'none',
        step: 'form',
        tur: 'baska',
        statusData: currentStatus,
        formData,
        error: req.t('register.errClanRequired'),
        clanOwnError: false,
        success: null,
        idempotencyKey: generateIdempotencyKey(req),
      });
    }
    if (cleanClan.length < 2 || cleanClan.length > 32) {
      const currentStatus = await botApiClient.getRegistrationStatus(user.id).catch(() => ({ state: 'none' }));
      return res.status(400).render('pages/register', {
        title: req.t('register.pageTitle'),
        state: currentStatus.state || 'none',
        step: 'form',
        tur: 'baska',
        statusData: currentStatus,
        formData,
        error: req.t('register.errClanInvalid'),
        clanOwnError: false,
        success: null,
        idempotencyKey: generateIdempotencyKey(req),
      });
    }
  }

  const registrationType = validTur === 'baska' ? 'other' : 'own';

  try {
    const result = await botApiClient.submitRegistration({
      discordId: user.id,
      realName: cleanName,
      gender: cleanGender,
      robloxInput: cleanRoblox,
      registrationType,
      clanName: registrationType === 'other' ? cleanClan : null,
    });

    const updatedStatus = await botApiClient.getRegistrationStatus(user.id).catch(() => ({
      state: 'pending',
      application: result.application || {
        realName: cleanName,
        robloxUsername: cleanRoblox,
        type: registrationType,
        registrationType,
        clan: registrationType === 'other' ? cleanClan : null,
        clanName: registrationType === 'other' ? cleanClan : null,
      },
    }));

    if (updatedStatus && updatedStatus.application && !updatedStatus.application.type) {
      updatedStatus.application.type = registrationType;
      updatedStatus.application.registrationType = registrationType;
      if (registrationType === 'other' && cleanClan && !updatedStatus.application.clan) {
        updatedStatus.application.clan = cleanClan;
        updatedStatus.application.clanName = cleanClan;
      }
    }

    const successMsg =
      registrationType === 'other'
        ? req.t('register.msgOtherClanSubmittedSuccess')
        : result.message || req.t('register.msgSubmittedSuccess');

    return res.render('pages/register', {
      title: req.t('register.pageTitle'),
      state: updatedStatus.state || 'pending',
      step: 'form',
      tur: validTur,
      statusData: updatedStatus,
      formData,
      error: null,
      clanOwnError: false,
      success: successMsg,
      idempotencyKey: generateIdempotencyKey(req),
    });
  } catch (err) {
    if (err && err.isOffline) {
      return next(err);
    }
    const mappedErr = mapBotRegistrationError(err, req);
    const currentStatus = await botApiClient.getRegistrationStatus(user.id).catch(() => ({ state: 'none' }));
    return res.status(err.statusCode || 400).render('pages/register', {
      title: req.t('register.pageTitle'),
      state: currentStatus.state || 'none',
      step: 'form',
      tur: validTur,
      statusData: currentStatus,
      formData,
      error: mappedErr.message,
      clanOwnError: mappedErr.clanOwnError,
      success: null,
      idempotencyKey: generateIdempotencyKey(req),
    });
  }
});

module.exports = router;
