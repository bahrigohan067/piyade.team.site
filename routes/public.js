const path = require('path');
const express = require('express');
const router = express.Router();
const siteConfig = require('../config/site.config');
const brandConfig = require('../config/brand.config');
const gamesConfig = require('../config/games.config');
const { getGroupedRules } = require('../rules');
const botApiClient = require('../services/botApiClient');
const { requireLogin } = require('../middlewares/auth');
const { verifyCsrfToken, verifyCsrfRequest } = require('../middlewares/csrf');
const { formActionLimiter, robloxLookupLimiter, publicStatsLimiter } = require('../middlewares/rateLimiter');
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
 * Yalnızca herkese açık sayfalar taranabilir; yönetim, profil ve auth kapalıdır.
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
    'Disallow: /auth',
    'Disallow: /lang',
    'Disallow: /health',
    'Disallow: /geri-bildirim',
    'Disallow: /kayit/roblox-kontrol',
    'Disallow: /api',
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
 * Anasayfa: Topluluk tanıtımı, canlı aktif oyuncu (activeThisMonth / playingNow) istatistikleri
 * ve bot tarafından aile bazlı gruplanmış en çok oynanan oyunlar sıralaması.
 * Hero alanı ve üst şerit birebir AYNI activeStats nesnesinden beslenir (sitede ayrı hesap yapılmaz).
 */
router.get('/', async (req, res) => {
  const lang = req.lang === 'en' ? 'en' : 'tr';
  let activeStats = {
    activeThisMonth: null,
    activeRegisteredCount: null,
    playingNow: null,
    playingCount: 0,
    uncertainCount: 0,
    computedAt: null,
    legacyMode: false,
    botOnline: false,
    stale: false,
    refreshFailed: false,
  };
  let topGames = {
    scope: 'month',
    group: 'family',
    month: '',
    since: null,
    updatedAt: Date.now(),
    computedAt: null,
    totalSeconds: 0,
    families: [],
    games: [],
    legacyMode: false,
    stale: false,
    refreshFailed: false,
    preparing: false,
    offline: false,
  };

  try {
    const [summaryData, topGamesData] = await Promise.all([
      botApiClient.getServerStatsSummary({ timeoutMs: 2500, lang }).catch(() => null),
      botApiClient
        .getTopGames({ scope: 'month', limit: 8, lang, group: 'family', timeoutMs: 2500 })
        .catch(() => null),
    ]);

    if (summaryData && typeof summaryData === 'object') {
      activeStats = {
        activeThisMonth:
          typeof summaryData.activeThisMonth === 'number' ? summaryData.activeThisMonth : null,
        activeRegisteredCount:
          typeof summaryData.activeRegisteredCount === 'number'
            ? summaryData.activeRegisteredCount
            : typeof summaryData.activeThisMonth === 'number'
              ? summaryData.activeThisMonth
              : null,
        playingNow: typeof summaryData.playingNow === 'number' ? summaryData.playingNow : null,
        playingCount:
          typeof summaryData.playingNow === 'number'
            ? summaryData.playingNow
            : Number(summaryData.playingCount) || 0,
        uncertainCount: Number(summaryData.uncertainCount) || 0,
        computedAt: summaryData.computedAt || null,
        legacyMode: Boolean(summaryData.legacyMode),
        botOnline: Boolean(summaryData.botOnline),
        stale: Boolean(summaryData.stale),
        refreshFailed: Boolean(summaryData.refreshFailed),
      };
    } else {
      const lastKnown = botApiClient.getLastKnownActiveStats();
      activeStats = { ...lastKnown, botOnline: false, stale: true, refreshFailed: true };
    }

    if (topGamesData && typeof topGamesData === 'object') {
      topGames = topGamesData;
    }
  } catch (_) {
    const lastKnown = botApiClient.getLastKnownActiveStats();
    activeStats = { ...lastKnown, botOnline: false, stale: true, refreshFailed: true };
  }

  // Hero ve üst şerit (header/sidebar) birebir aynı activeStats referansını kullanır
  res.locals.activeStats = activeStats;

  return res.render('pages/home', {
    title: res.locals.seo ? res.locals.seo.title : req.t('home.pageTitle'),
    activeStats,
    topGames,
  });
});

/**
 * GET /api/stats/top-games
 * Anasayfa "Sunucuda En Çok Oynanan Oyunlar" sekme geçişleri için herkese açık anonim JSON proxy.
 */
router.get('/api/stats/top-games', publicStatsLimiter, async (req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'public, max-age=60');

  const scope = req.query.scope === 'all' ? 'all' : 'month';
  const group = req.query.group === 'game' ? 'game' : 'family';
  const lang =
    req.query.lang === 'en' ? 'en' : req.query.lang === 'tr' ? 'tr' : req.lang === 'en' ? 'en' : 'tr';
  const rawLimit = Number.parseInt(String(req.query.limit ?? 8), 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(12, Math.max(1, rawLimit)) : 8;

  try {
    const data = await botApiClient.getTopGames({
      scope,
      group,
      lang,
      limit,
    });
    return res.json({
      ok: true,
      ...data,
    });
  } catch (_) {
    return res.status(503).json({
      ok: false,
      scope,
      group,
      families: [],
      games: [],
      totalSeconds: 0,
      stale: true,
      refreshFailed: true,
      offline: true,
    });
  }
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
 * Anasayfa dışı özel interaktif bileşenler sayfası (Dart Rating, Meteors).
 */
router.get('/etkilesim', (req, res) => {
  return res.render('pages/interactive', {
    title: res.locals.seo ? res.locals.seo.title : req.t('interactive.pageTitle'),
  });
});

function formatLocaleMessage(template, vars = {}) {
  let out = String(template || '');
  for (const [key, val] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{${key}\\}`, 'g'), String(val ?? ''));
  }
  return out;
}

function resolveRegisterPath(req) {
  return req.langPrefix ? `/${req.langPrefix}/kayit` : '/kayit';
}

function buildEmptyRegisterFormData(gamesList) {
  const usernames = {};
  for (const g of gamesList || []) {
    usernames[g.id] = '';
  }
  return {
    games: [],
    gender: '',
    name: '',
    usernames,
  };
}

function extractRawSubmittedFormData(body, gamesList) {
  const safeBody = body && typeof body === 'object' ? body : {};
  const rawGamesInput = safeBody.games !== undefined ? safeBody.games : safeBody['games[]'];
  const rawGamesArr = Array.isArray(rawGamesInput)
    ? rawGamesInput
    : typeof rawGamesInput === 'string' && rawGamesInput.trim() !== ''
      ? [rawGamesInput]
      : [];

  const cleanedGameIds = rawGamesArr
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean);

  const usernames = {};
  const bodyUsernames =
    safeBody.usernames && typeof safeBody.usernames === 'object' ? safeBody.usernames : {};

  for (const g of gamesList || []) {
    const rawVal =
      bodyUsernames[g.id] !== undefined
        ? bodyUsernames[g.id]
        : safeBody[`username_${g.id}`];
    usernames[g.id] = gamesConfig.normalizeWhitespace(typeof rawVal === 'string' ? rawVal : '');
  }

  return {
    rawGameIds: cleanedGameIds,
    games: [...new Set(cleanedGameIds)],
    gender: String(safeBody.gender || '').trim().toLowerCase(),
    name: gamesConfig.normalizeWhitespace(typeof safeBody.name === 'string' ? safeBody.name : ''),
    usernames,
  };
}

function localizeGameUsernameError(req, gameDef, valResult) {
  const lang = req.lang === 'en' ? 'en' : 'tr';
  const gameTitle = gamesConfig.pickLocalizedGameField(gameDef.name, lang, gameDef.id);
  const min = (gameDef.validate && gameDef.validate.min) || 2;
  const max = (gameDef.validate && gameDef.validate.max) || 32;

  if (valResult.reason === 'EMPTY') {
    return formatLocaleMessage(req.t('register.errGameUsernameRequired'), { game: gameTitle });
  }
  if (gameDef.validate && gameDef.validate.regex && gameDef.id === 'minecraft') {
    return formatLocaleMessage(req.t('register.errMinecraftUsername'), {
      game: gameTitle,
      min,
      max,
    });
  }
  if (valResult.reason === 'REGEX_MISMATCH') {
    return formatLocaleMessage(req.t('register.errGameUsernamePattern'), {
      game: gameTitle,
      min,
      max,
    });
  }
  return formatLocaleMessage(req.t('register.errGameUsernameLength'), {
    game: gameTitle,
    min,
    max,
  });
}

function isLegacyBotError(err) {
  if (!err || !(err instanceof botApiClient.BotApiError)) return false;
  if (err.errorCategory === 'ENDPOINT_MISSING' || err.statusCode === 501) {
    return true;
  }
  const details = err.details && typeof err.details === 'object' ? err.details : {};
  const hasKnownCode = Boolean(details.code || details.errorCode);
  if (!hasKnownCode && err.statusCode === 400) {
    const msg = `${details.error || ''} ${details.message || ''} ${err.message || ''}`;
    if (/realName|robloxInput|registrationType/i.test(msg)) {
      return true;
    }
  }
  return false;
}

function applyBotErrorToForm(err, req, gamesList) {
  const details = err && err.details && typeof err.details === 'object' ? err.details : {};
  const nestedDetails = details.details && typeof details.details === 'object' ? details.details : details;
  const rawCode = String(details.code || details.errorCode || '').trim().toUpperCase();
  const lang = req.lang === 'en' ? 'en' : 'tr';

  const fieldErrors = {};
  let globalError = null;
  let focusFieldId = null;

  switch (rawCode) {
    case 'NO_GAME_SELECTED':
      fieldErrors.games = req.t('register.errNoGameSelected');
      focusFieldId = 'step1-games';
      break;
    case 'NAME_INVALID':
      fieldErrors.name = req.t('register.errNameLength');
      focusFieldId = 'regName';
      break;
    case 'GAME_USERNAME_INVALID': {
      const targetId = String(nestedDetails.game || details.game || '').trim().toLowerCase();
      const targetGame = (gamesList || []).find((g) => g.id === targetId);
      if (targetGame) {
        const gameTitle = gamesConfig.pickLocalizedGameField(targetGame.name, lang, targetGame.id);
        fieldErrors[`game_${targetId}`] = formatLocaleMessage(
          req.t('register.errBotGameUsernameInvalid'),
          {
            game: gameTitle,
            min: (targetGame.validate && targetGame.validate.min) || 2,
            max: (targetGame.validate && targetGame.validate.max) || 32,
          }
        );
        focusFieldId = `username-${targetId}`;
      } else {
        globalError = req.t('register.errGenericRegistration');
      }
      break;
    }
    case 'ROBLOX_NOT_FOUND':
      fieldErrors.game_roblox = req.t('register.errRobloxNotFound');
      focusFieldId = 'username-roblox';
      break;
    case 'ROBLOX_BANNED':
      fieldErrors.game_roblox = req.t('register.errRobloxBanned');
      focusFieldId = 'username-roblox';
      break;
    case 'ROBLOX_LOOKUP_FAILED':
      fieldErrors.game_roblox = req.t('register.errRobloxLookupFailed');
      focusFieldId = 'username-roblox';
      break;
    case 'ROBLOX_ALREADY_REGISTERED':
      fieldErrors.game_roblox = req.t('register.errRobloxAlreadyRegistered');
      focusFieldId = 'username-roblox';
      break;
    case 'ALREADY_REGISTERED':
      globalError = req.t('register.errAlreadyRegistered');
      break;
    default:
      globalError = req.t('register.errGenericRegistration');
      break;
  }

  return { fieldErrors, globalError, focusFieldId };
}

function buildRegisterRenderLocals(req, {
  gamesList,
  gamesSource,
  state,
  statusData = null,
  flashSuccess = null,
  formData = null,
  fieldErrors = {},
  globalError = null,
  focusFieldId = null,
  idempotencyKey = '',
}) {
  return {
    title: resTitle(req),
    siteName: brandConfig.getSiteName(),
    discordInviteUrl: brandConfig.getDiscordInviteUrl(),
    gamesList: gamesList || [],
    gamesSource: gamesSource || 'fallback',
    state,
    statusData,
    flashSuccess,
    formActionUrl: resolveRegisterPath(req),
    formData: formData || buildEmptyRegisterFormData(gamesList),
    fieldErrors: fieldErrors || {},
    globalError,
    focusFieldId,
    idempotencyKey,
    isRegisterPage: true,
  };
}

function resTitle(req) {
  if (req.t) {
    return req.t('register.pageTitle');
  }
  return 'Kayıt Ol';
}

function ensureAuthForLookupApi(req, res, next) {
  if (!req.session || !req.session.user || !req.session.user.id) {
    return res.status(401).json({
      code: 'AUTH_REQUIRED',
      status: 'TEMPORARY_ERROR',
      error: req.t ? req.t('register.errAuthRequired') : 'Oturum açmanız gerekiyor.',
    });
  }
  return next();
}

/**
 * GET /kayit/roblox-kontrol
 * Kullanıcının girdiği Roblox adını Bot API (/api/roblox/lookup) üzerinden anlık doğrular.
 * Giriş gerekli, CSRF kontrollü ve kullanıcı başına dakikada 10 istekle sınırlıdır.
 */
router.get(
  '/kayit/roblox-kontrol',
  ensureAuthForLookupApi,
  verifyCsrfRequest,
  robloxLookupLimiter,
  async (req, res) => {
    const cleanQuery = gamesConfig.normalizeWhitespace(
      typeof req.query.query === 'string' ? req.query.query : ''
    );

    if (!cleanQuery || cleanQuery.length > 100) {
      return res.status(400).json({
        status: 'NOT_FOUND',
        user: null,
        alreadyRegistered: false,
        message: req.t('register.robloxLookupInvalidQuery'),
      });
    }

    const result = await botApiClient.lookupRobloxAccount(cleanQuery);
    let message = '';

    if (result.status === 'FOUND') {
      message = result.alreadyRegistered
        ? req.t('register.robloxLookupAlreadyRegistered')
        : req.t('register.robloxLookupFound');
    } else if (result.status === 'NOT_FOUND') {
      message = req.t('register.robloxLookupNotFound');
    } else if (result.status === 'BANNED') {
      message = req.t('register.robloxLookupBanned');
    } else {
      message = req.t('register.robloxLookupTempError');
    }

    return res.json({
      status: result.status,
      user: result.user || null,
      alreadyRegistered: Boolean(result.alreadyRegistered),
      message,
    });
  }
);

/**
 * GET /kayit
 * Herkese açık, indekslenebilir oyun bazlı kayıt başvuru ve durum sayfası.
 */
router.get('/kayit', async (req, res, next) => {
  const user = req.session?.user;
  const { games: gamesList, source: gamesSource } = await botApiClient.getGames();
  const pageTitle = res.locals.seo ? res.locals.seo.title : req.t('register.pageTitle');

  // Kullanıcı henüz Discord ile giriş yapmamışsa
  if (!user || !user.id) {
    return res.render('pages/register', {
      ...buildRegisterRenderLocals(req, {
        gamesList,
        gamesSource,
        state: 'login_required',
      }),
      title: pageTitle,
    });
  }

  // PRG tek kullanımlık başarı mesajı varsa göster (F5 yenilemesinde tekrar POST edilmez)
  const flashSuccess = req.session && req.session.registerFlashSuccess
    ? req.session.registerFlashSuccess
    : null;
  if (flashSuccess) {
    delete req.session.registerFlashSuccess;
    return res.render('pages/register', {
      ...buildRegisterRenderLocals(req, {
        gamesList,
        gamesSource,
        state: 'submitted_success',
        flashSuccess,
      }),
      title: pageTitle,
    });
  }

  try {
    const statusData = await botApiClient.getRegistrationStatus(user.id);

    if (statusData.incompatibleBot || statusData.state === 'unavailable') {
      return res.render('pages/register', {
        ...buildRegisterRenderLocals(req, {
          gamesList,
          gamesSource,
          state: 'unavailable',
          statusData,
        }),
        title: pageTitle,
      });
    }

    let resolvedState = 'form';
    if (statusData.registered || statusData.state === 'approved') {
      resolvedState = 'approved';
    } else if (statusData.state === 'pending') {
      resolvedState = 'pending';
    } else if (statusData.state === 'rejected') {
      resolvedState = 'rejected';
    }

    return res.render('pages/register', {
      ...buildRegisterRenderLocals(req, {
        gamesList,
        gamesSource,
        state: resolvedState,
        statusData,
        idempotencyKey:
          resolvedState === 'form' || resolvedState === 'rejected'
            ? generateIdempotencyKey(req)
            : '',
      }),
      title: pageTitle,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /kayit
 * Oyun bazlı kayıt başvurusunu sunucu tarafında doğrular ve Bot REST API'sine (POST /api/register) iletir.
 * CSRF, tekil idempotency anahtarı, hız sınırı ve PRG deseni uygular.
 */
router.post('/kayit', requireLogin, formActionLimiter, verifyCsrfToken, async (req, res, next) => {
  const user = req.session.user;
  const lang = req.lang === 'en' ? 'en' : 'tr';
  const { games: gamesList, source: gamesSource } = await botApiClient.getGames();
  const gamesById = new Map(gamesList.map((g) => [g.id, g]));
  const pageTitle = res.locals.seo ? res.locals.seo.title : req.t('register.pageTitle');

  const extracted = extractRawSubmittedFormData(req.body, gamesList);
  const formData = {
    games: extracted.games,
    gender: extracted.gender,
    name: extracted.name,
    usernames: extracted.usernames,
  };

  async function renderFormError(statusCode, { fieldErrors = {}, globalError = null, focusFieldId = null, forceState = null }) {
    const currentStatus = await botApiClient
      .getRegistrationStatus(user.id)
      .catch(() => ({ state: 'none', registered: false }));

    let nextState = forceState;
    if (!nextState) {
      if (currentStatus.incompatibleBot || currentStatus.state === 'unavailable') {
        nextState = 'unavailable';
      } else if (currentStatus.registered || currentStatus.state === 'approved') {
        nextState = 'approved';
      } else if (currentStatus.state === 'pending') {
        nextState = 'pending';
      } else if (currentStatus.state === 'rejected') {
        nextState = 'rejected';
      } else {
        nextState = 'form';
      }
    }

    return res.status(statusCode).render('pages/register', {
      ...buildRegisterRenderLocals(req, {
        gamesList,
        gamesSource,
        state: nextState,
        statusData: currentStatus,
        formData,
        fieldErrors,
        globalError,
        focusFieldId,
        idempotencyKey:
          nextState === 'form' || nextState === 'rejected'
            ? generateIdempotencyKey(req)
            : '',
      }),
      title: pageTitle,
    });
  }

  // 1) Tek kullanımlık Idempotency kontrolü
  const idemCheck = consumeIdempotencyKey(req);
  if (!idemCheck.valid) {
    return renderFormError(409, {
      globalError: req.t('errors.duplicateSubmission'),
    });
  }

  // 2) Sunucu tarafı doğrulama
  const fieldErrors = {};
  let focusFieldId = null;

  // 2a) Oyun seçimi: en az 1, en çok 4, tekrar yok, yalnızca etkin listeden
  const rawGameIds = extracted.rawGameIds;
  if (rawGameIds.length === 0) {
    fieldErrors.games = req.t('register.errNoGameSelected');
    focusFieldId = focusFieldId || 'step1-games';
  } else if (rawGameIds.length > gamesConfig.MAX_REGISTRATION_GAMES) {
    fieldErrors.games = formatLocaleMessage(req.t('register.errTooManyGames'), {
      max: gamesConfig.MAX_REGISTRATION_GAMES,
    });
    focusFieldId = focusFieldId || 'step1-games';
  } else if (new Set(rawGameIds).size !== rawGameIds.length) {
    fieldErrors.games = req.t('register.errDuplicateGame');
    focusFieldId = focusFieldId || 'step1-games';
  } else if (rawGameIds.some((id) => !gamesById.has(id))) {
    fieldErrors.games = req.t('register.errInvalidGame');
    focusFieldId = focusFieldId || 'step1-games';
  }

  // 2b) Cinsiyet doğrulaması ('male' | 'female')
  if (extracted.gender !== 'male' && extracted.gender !== 'female') {
    fieldErrors.gender = req.t('register.errSelectGender');
    focusFieldId = focusFieldId || 'gender-male';
  }

  // 2c) İsim / Takma ad doğrulaması (2 - 32 karakter)
  if (extracted.name.length < 2 || extracted.name.length > 32) {
    fieldErrors.name = req.t('register.errNameLength');
    focusFieldId = focusFieldId || 'regName';
  }

  // 2d) Seçili oyunların kullanıcı adı kuralları (oyun sırasıyla)
  const selectedIdSet = new Set(extracted.games);
  const selectedGamesInOrder = gamesList.filter((g) => selectedIdSet.has(g.id));

  if (!fieldErrors.games) {
    for (const gameDef of selectedGamesInOrder) {
      const valResult = gamesConfig.validateGameUsername(gameDef, extracted.usernames[gameDef.id]);
      formData.usernames[gameDef.id] = valResult.value;
      if (!valResult.ok) {
        fieldErrors[`game_${gameDef.id}`] = localizeGameUsernameError(req, gameDef, valResult);
        focusFieldId = focusFieldId || `username-${gameDef.id}`;
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return renderFormError(400, { fieldErrors, focusFieldId });
  }

  // 3) Bot API'sine gönderim
  const gamesPayload = selectedGamesInOrder.map((gameDef) => ({
    id: gameDef.id,
    username: formData.usernames[gameDef.id],
  }));

  try {
    await botApiClient.submitRegistration({
      discordId: user.id,
      name: formData.name,
      gender: formData.gender,
      games: gamesPayload,
      lang,
    });

    req.session.registerFlashSuccess = {
      name: formData.name,
      games: selectedGamesInOrder.map((gameDef) => ({
        id: gameDef.id,
        emoji: gameDef.emoji,
        name: gameDef.name,
        username: formData.usernames[gameDef.id],
      })),
    };

    return res.redirect(303, resolveRegisterPath(req));
  } catch (err) {
    if (err && err.isOffline) {
      return next(err);
    }
    if (isLegacyBotError(err)) {
      return renderFormError(503, { forceState: 'unavailable' });
    }
    const mapped = applyBotErrorToForm(err, req, gamesList);
    const httpStatus =
      err && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 400;
    return renderFormError(httpStatus, mapped);
  }
});

module.exports = router;
