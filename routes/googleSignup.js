const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();

const authConfig = require('../config/auth.config');
const gamesConfig = require('../config/games.config');
const consentsConfig = require('../config/consents.config');
const botApiClient = require('../services/botApiClient');
const googleAuthService = require('../services/googleAuthService');
const { parseFrontmatter } = require('../utils/markdownRenderer');
const {
  getMemberStore,
  generateMemberId,
  toUnifiedGoogleId,
} = require('../services/memberStore');
const { getChatStore } = require('../services/chatStore');
const { buildGoogleSessionUser, setRememberCookie } = require('../middlewares/auth');
const { verifyCsrfToken, verifyCsrfRequest } = require('../middlewares/csrf');
const { generateIdempotencyKey, consumeIdempotencyKey } = require('../middlewares/idempotency');
const { googleSignupLimiter, robloxLookupLimiter } = require('../middlewares/rateLimiter');
const { validateNickname } = require('../utils/nicknameValidator');

function markPrivateNoIndex(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.locals.disableFeedbackPill = true;
  if (typeof req.applySeo === 'function') {
    req.applySeo({ noindex: true, isPublic: false });
  } else if (res.locals && res.locals.seo) {
    res.locals.seo.noindex = true;
    res.locals.seo.isPublic = false;
  }
}

function getValidPendingGoogle(req) {
  const pending = req.session && req.session.pendingGoogle;
  if (!pending || !pending.sub) return null;
  if (Date.now() - (Number(pending.createdAt) || 0) > authConfig.PENDING_GOOGLE_TTL_MS) {
    delete req.session.pendingGoogle;
    return null;
  }
  return pending;
}

function formatMsg(template, vars = {}) {
  let out = String(template || '');
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v ?? ''));
  }
  return out;
}

function localizeGameUsernameError(req, gameDef, valResult) {
  const lang = req.lang === 'en' ? 'en' : 'tr';
  const gameTitle = gamesConfig.pickLocalizedGameField(gameDef.name, lang, gameDef.id);
  const min = (gameDef.validate && gameDef.validate.min) || 2;
  const max = (gameDef.validate && gameDef.validate.max) || 32;

  if (valResult.reason === 'EMPTY') {
    return formatMsg(req.t('register.errGameUsernameRequired'), { game: gameTitle });
  }
  if (gameDef.validate && gameDef.validate.regex && gameDef.id === 'minecraft') {
    return formatMsg(req.t('register.errMinecraftUsername'), { game: gameTitle, min, max });
  }
  if (valResult.reason === 'REGEX_MISMATCH') {
    return formatMsg(req.t('register.errGameUsernamePattern'), { game: gameTitle, min, max });
  }
  return formatMsg(req.t('register.errGameUsernameLength'), { game: gameTitle, min, max });
}

function localizeNicknameError(req, reason) {
  if (reason === 'MENTION') return req.t('googleSignup.errNickMention');
  if (reason === 'INVITE' || reason === 'LINK') return req.t('googleSignup.errNickLink');
  if (reason === 'PROFANITY') return req.t('googleSignup.errNickProfanity');
  return req.t('googleSignup.errNickLength');
}

function buildEmptySignupForm(gamesList) {
  const usernames = {};
  for (const g of gamesList || []) {
    usernames[g.id] = '';
  }
  return {
    ageGroup: '',
    parentConsent: false,
    consentKvkk: false,
    consentRules: false,
    consentA: false,
    consentB: true,
    consentC: false,
    games: [],
    nickname: '',
    usernames,
    robloxVerifiedUser: null,
  };
}

function extractSignupForm(body, gamesList) {
  const b = body && typeof body === 'object' ? body : {};
  const rawGamesInput = b.games !== undefined ? b.games : b['games[]'];
  const rawGamesArr = Array.isArray(rawGamesInput)
    ? rawGamesInput
    : typeof rawGamesInput === 'string' && rawGamesInput.trim() !== ''
      ? [rawGamesInput]
      : [];
  const rawGameIds = rawGamesArr.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean);

  const usernames = {};
  const bodyUsernames = b.usernames && typeof b.usernames === 'object' ? b.usernames : {};
  for (const g of gamesList || []) {
    const rawVal = bodyUsernames[g.id] !== undefined ? bodyUsernames[g.id] : b[`username_${g.id}`];
    usernames[g.id] = gamesConfig.normalizeWhitespace(typeof rawVal === 'string' ? rawVal : '');
  }

  const isTruthy = (v) => v === true || v === 'true' || v === '1' || v === 'on' || v === 'yes';

  return {
    ageGroup: String(b.ageGroup || '').trim(),
    parentConsent: isTruthy(b.parentConsent),
    consentKvkk: isTruthy(b.consent_kvkk_notice),
    consentRules: isTruthy(b.consent_general_rules),
    consentA: isTruthy(b.consent_chat_moderation_review),
    consentB: isTruthy(b.consent_chat_profile_game_usernames),
    consentC: isTruthy(b.consent_international_data_transfer),
    rawGameIds,
    games: [...new Set(rawGameIds)],
    nickname: gamesConfig.normalizeWhitespace(typeof b.nickname === 'string' ? b.nickname : ''),
    usernames,
  };
}

function getKvkkNoticeVersion(lang) {
  try {
    const safeLang = lang === 'en' ? 'en' : 'tr';
    const filePath = path.join(__dirname, '..', 'content', 'legal', safeLang, 'kvkk-aydinlatma.md');
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = parseFrontmatter(raw);
      if (parsed && parsed.meta && parsed.meta.version) {
        return String(parsed.meta.version);
      }
    }
  } catch (_) {}
  return '1.1';
}

function buildRenderLocals(req, {
  gamesList,
  formData,
  fieldErrors = {},
  globalError = null,
  focusFieldId = null,
  idempotencyKey = '',
}) {
  const lang = req.lang === 'en' ? 'en' : 'tr';
  return {
    title: req.t('googleSignup.pageTitle'),
    isGoogleSignupPage: true,
    gamesList: gamesList || [],
    explicitConsents: consentsConfig.getExplicitConsents(lang),
    kvkkVersion: getKvkkNoticeVersion(lang),
    formData: formData || buildEmptySignupForm(gamesList),
    fieldErrors: fieldErrors || {},
    globalError,
    focusFieldId,
    idempotencyKey,
  };
}

/**
 * GET /uye-ol
 * Yalnızca oturumda geçici Google kimliği (pendingGoogle) bulunan yeni kişiler erişebilir.
 */
router.get('/uye-ol', async (req, res) => {
  markPrivateNoIndex(req, res);
  if (req.session && req.session.user && req.session.user.id) {
    return res.redirect('/');
  }
  const pending = getValidPendingGoogle(req);
  if (!pending) {
    return res.redirect('/giris');
  }

  const guestActorId = googleAuthService.deriveSiteGuestActorId(pending.sub);
  const { games: gamesList } = await botApiClient.getGames({
    actorType: 'site-guest',
    actorId: guestActorId,
  });

  return res.render(
    'pages/google-signup',
    buildRenderLocals(req, {
      gamesList,
      formData: buildEmptySignupForm(gamesList),
      idempotencyKey: generateIdempotencyKey(req),
    })
  );
});

/**
 * GET /uye-ol/roblox-kontrol
 * Sihirbazda Roblox hesabını site-guest aktörüyle (X-Actor-Id = g_<hmac32>) doğrular.
 */
router.get('/uye-ol/roblox-kontrol', verifyCsrfRequest, robloxLookupLimiter, async (req, res) => {
  markPrivateNoIndex(req, res);
  const pending = getValidPendingGoogle(req);
  if (!pending) {
    return res.status(401).json({
      code: 'AUTH_REQUIRED',
      status: 'TEMPORARY_ERROR',
      message: req.t('googleSignup.errSessionExpired'),
    });
  }

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

  const guestActorId = googleAuthService.deriveSiteGuestActorId(pending.sub);
  const result = await botApiClient.lookupRobloxAccount(cleanQuery, {
    actorType: 'site-guest',
    actorId: guestActorId,
  });

  let alreadyRegistered = Boolean(result.alreadyRegistered);
  if (result.status === 'FOUND' && result.user && result.user.id) {
    if (getMemberStore().findByRobloxId(result.user.id)) {
      alreadyRegistered = true;
    }
  }

  let message = '';
  if (result.status === 'FOUND') {
    message = alreadyRegistered
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
    alreadyRegistered,
    message,
  });
});

/**
 * POST /uye-ol
 * 4 adımlı Google site üyeliğini sunucu tarafında doğrular, bot erişimini ve Roblox benzersizliğini
 * teyit eder, claim yazar, üyeyi kaydeder ve pw_remember ile oturumu açar.
 */
router.post('/uye-ol', googleSignupLimiter, verifyCsrfToken, async (req, res) => {
  markPrivateNoIndex(req, res);
  if (req.session && req.session.user && req.session.user.id) {
    return res.redirect('/');
  }
  const pending = getValidPendingGoogle(req);
  if (!pending) {
    return res.redirect('/giris');
  }

  const lang = req.lang === 'en' ? 'en' : 'tr';
  const guestActorId = googleAuthService.deriveSiteGuestActorId(pending.sub);
  const { games: gamesList } = await botApiClient.getGames({
    actorType: 'site-guest',
    actorId: guestActorId,
  });
  const gamesById = new Map(gamesList.map((g) => [g.id, g]));
  const extracted = extractSignupForm(req.body, gamesList);

  const renderError = (statusCode, { fieldErrors = {}, globalError = null, focusFieldId = null }) =>
    res.status(statusCode).render(
      'pages/google-signup',
      buildRenderLocals(req, {
        gamesList,
        formData: extracted,
        fieldErrors,
        globalError,
        focusFieldId,
        idempotencyKey: generateIdempotencyKey(req),
      })
    );

  // 1) Çift gönderim (Idempotency) kontrolü
  const idem = consumeIdempotencyKey(req);
  if (!idem.valid) {
    return renderError(409, { globalError: req.t('errors.duplicateSubmission') });
  }

  // 2) Adım 0 — Yaş grubu ve ayrılmış rıza/onay kontrolleri
  const fieldErrors = {};
  let focusFieldId = null;

  if (extracted.ageGroup === 'under_13') {
    fieldErrors.ageGroup = req.t('googleSignup.errUnder13');
    focusFieldId = focusFieldId || 'age-under-13';
  } else if (extracted.ageGroup === '13_17') {
    if (!extracted.parentConsent) {
      fieldErrors.parentConsent = req.t('googleSignup.errParentConsentRequired');
      focusFieldId = focusFieldId || 'parentConsentCheck';
    }
  } else if (extracted.ageGroup !== '18_plus') {
    fieldErrors.ageGroup = req.t('googleSignup.errAgeRequired');
    focusFieldId = focusFieldId || 'age-18-plus';
  }

  if (!extracted.consentKvkk) {
    fieldErrors.consentKvkk = req.t('googleSignup.errKvkkRequired');
    focusFieldId = focusFieldId || 'consentKvkkCheck';
  }
  if (!extracted.consentC) {
    fieldErrors.consentC = req.t('googleSignup.errTransferRequired');
    focusFieldId = focusFieldId || 'consentCCheck';
  }
  if (!extracted.consentRules) {
    fieldErrors.consentRules = req.t('googleSignup.errRulesRequired');
    focusFieldId = focusFieldId || 'consentRulesCheck';
  }

  // 3) Adım 1 — Oyun seçimi (1-4 geçerli oyun)
  if (extracted.rawGameIds.length === 0) {
    fieldErrors.games = req.t('register.errNoGameSelected');
    focusFieldId = focusFieldId || 'gsStep1Games';
  } else if (extracted.rawGameIds.length > gamesConfig.MAX_REGISTRATION_GAMES) {
    fieldErrors.games = formatMsg(req.t('register.errTooManyGames'), {
      max: gamesConfig.MAX_REGISTRATION_GAMES,
    });
    focusFieldId = focusFieldId || 'gsStep1Games';
  } else if (new Set(extracted.rawGameIds).size !== extracted.rawGameIds.length) {
    fieldErrors.games = req.t('register.errDuplicateGame');
    focusFieldId = focusFieldId || 'gsStep1Games';
  } else if (extracted.rawGameIds.some((id) => !gamesById.has(id))) {
    fieldErrors.games = req.t('register.errInvalidGame');
    focusFieldId = focusFieldId || 'gsStep1Games';
  }

  // 4) Adım 2 — Takma ad ve seçili oyunların kullanıcı adları
  const nickCheck = validateNickname(extracted.nickname);
  extracted.nickname = nickCheck.value;
  if (!nickCheck.ok) {
    fieldErrors.nickname = localizeNicknameError(req, nickCheck.reason);
    focusFieldId = focusFieldId || 'gsNickname';
  }

  const selectedIdSet = new Set(extracted.games);
  const selectedGamesInOrder = gamesList.filter((g) => selectedIdSet.has(g.id));
  if (!fieldErrors.games) {
    for (const gameDef of selectedGamesInOrder) {
      const valResult = gamesConfig.validateGameUsername(gameDef, extracted.usernames[gameDef.id]);
      extracted.usernames[gameDef.id] = valResult.value;
      if (!valResult.ok) {
        fieldErrors[`game_${gameDef.id}`] = localizeGameUsernameError(req, gameDef, valResult);
        focusFieldId = focusFieldId || `gs-username-${gameDef.id}`;
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return renderError(400, { fieldErrors, focusFieldId });
  }

  const memberStore = getMemberStore();

  // 5) googleSub yasak ve tekillik kontrolü
  if (memberStore.isGoogleSubBanned(pending.sub)) {
    req.session.googleBlockedInfo = { status: 'banned', reason: '' };
    return req.session.save(() => res.redirect('/giris/askida'));
  }
  if (memberStore.findByGoogleSub(pending.sub)) {
    return renderError(409, { globalError: req.t('googleSignup.errGoogleAlreadyRegistered') });
  }

  // 6) Bot canlılık kontrolü: bot kapalıysa benzersizliği korumak için üyelik oluşturma ENGELLENİR
  const hasRobloxSelected = selectedGamesInOrder.some((g) => g.id === 'roblox');
  let verifiedRoblox = null;

  if (hasRobloxSelected) {
    const rbResult = await botApiClient.lookupRobloxAccount(extracted.usernames.roblox, {
      actorType: 'site-service',
      actorId: 'site',
    });
    if (rbResult.offline) {
      return renderError(503, { globalError: req.t('googleSignup.errBotOffline') });
    }
    if (rbResult.status === 'NOT_FOUND') {
      return renderError(400, {
        fieldErrors: { game_roblox: req.t('register.errRobloxNotFound') },
        focusFieldId: 'gs-username-roblox',
      });
    }
    if (rbResult.status === 'BANNED') {
      return renderError(400, {
        fieldErrors: { game_roblox: req.t('register.errRobloxBanned') },
        focusFieldId: 'gs-username-roblox',
      });
    }
    if (rbResult.status !== 'FOUND' || !rbResult.user || !rbResult.user.id) {
      return renderError(503, {
        fieldErrors: { game_roblox: req.t('register.errRobloxLookupFailed') },
        focusFieldId: 'gs-username-roblox',
      });
    }
    if (rbResult.alreadyRegistered || memberStore.findByRobloxId(rbResult.user.id)) {
      return renderError(409, {
        fieldErrors: { game_roblox: req.t('register.errRobloxAlreadyRegistered') },
        focusFieldId: 'gs-username-roblox',
      });
    }
    verifiedRoblox = rbResult.user;
  } else {
    const reachable = await botApiClient.isBotReachable();
    if (!reachable) {
      return renderError(503, { globalError: req.t('googleSignup.errBotOffline') });
    }
  }

  // 7) Üye ID'sini üret, Roblox seçiliyse bota site-claims yaz (409 -> üye OLUŞMAZ!)
  const memberId = generateMemberId();
  let claimAcquired = false;

  if (verifiedRoblox) {
    const claimRes = await botApiClient.claimSiteRobloxId(verifiedRoblox.id, memberId);
    if (!claimRes.ok) {
      if (claimRes.conflict) {
        return renderError(409, {
          fieldErrors: { game_roblox: req.t('register.errRobloxAlreadyRegistered') },
          focusFieldId: 'gs-username-roblox',
        });
      }
      return renderError(503, { globalError: req.t('googleSignup.errBotOffline') });
    }
    claimAcquired = true;
  }

  // 8) Onay kayıtlarını kimlik + sürüm + zaman biçiminde hazırla
  const nowTs = Date.now();
  const recordedConsents = [
    { id: 'kvkk_notice', version: getKvkkNoticeVersion(lang), at: nowTs },
    { id: 'general_rules', version: '1.0', at: nowTs },
  ];
  if (extracted.ageGroup === '13_17' && extracted.parentConsent) {
    recordedConsents.push({ id: 'parent_guardian_consent', version: '1.0', at: nowTs });
  }
  const consentA = consentsConfig.getExplicitConsentById('chat_moderation_review');
  const consentB = consentsConfig.getExplicitConsentById('chat_profile_game_usernames');
  const consentC = consentsConfig.getExplicitConsentById('international_data_transfer');

  if (extracted.consentA && consentA) {
    recordedConsents.push({ id: consentA.id, version: consentA.version, at: nowTs });
  }
  if (extracted.consentB && consentB) {
    recordedConsents.push({ id: consentB.id, version: consentB.version, at: nowTs });
  }
  if (extracted.consentC && consentC) {
    recordedConsents.push({ id: consentC.id, version: consentC.version, at: nowTs });
  }

  const finalGames = selectedGamesInOrder.map((g) => {
    if (g.id === 'roblox' && verifiedRoblox) {
      return {
        id: 'roblox',
        username: verifiedRoblox.username || extracted.usernames.roblox,
        robloxId: String(verifiedRoblox.id),
        robloxAvatarUrl: verifiedRoblox.avatarUrl || '',
        robloxProfileUrl: verifiedRoblox.profileUrl || `https://www.roblox.com/users/${verifiedRoblox.id}/profile`,
      };
    }
    return {
      id: g.id,
      username: extracted.usernames[g.id],
    };
  });

  const createRes = memberStore.createMember({
    id: memberId,
    googleSub: pending.sub,
    email: pending.email,
    emailVerified: true,
    googleName: pending.googleName || '',
    nickname: extracted.nickname,
    games: finalGames,
    ageGroup: extracted.ageGroup,
    consents: recordedConsents,
    privacy: {
      showGamesInChat: Boolean(extracted.consentB),
    },
    status: 'active',
    nowMs: nowTs,
  });

  if (!createRes.ok) {
    if (claimAcquired && verifiedRoblox) {
      await botApiClient.releaseSiteRobloxClaim(verifiedRoblox.id, memberId).catch(() => null);
    }
    const errMsg =
      createRes.code === 'ROBLOX_ALREADY_REGISTERED'
        ? req.t('register.errRobloxAlreadyRegistered')
        : req.t('googleSignup.errCreateFailed');
    return renderError(409, { globalError: errMsg });
  }

  const createdMember = createRes.member;

  // Madde A onaylandıysa sohbet ilk kullanım onayını da uyumlu şekilde kaydet
  if (extracted.consentA) {
    try {
      const unifiedId = toUnifiedGoogleId(createdMember.id);
      if (unifiedId) {
        getChatStore().recordConsent(unifiedId);
      }
    } catch (_) {}
  }

  // 9) Geçici kimliği sil, Google oturumu ve pw_remember çerezini aç, / sayfasına Hoş geldin ile yönlendir
  delete req.session.pendingGoogle;
  req.session.identity = { kind: 'google', memberId: createdMember.id };
  req.session.user = buildGoogleSessionUser(createdMember);

  const remember = memberStore.createRememberToken(createdMember.id, {
    userAgent: req.get('user-agent') || '',
  });
  req.session.rememberSelector = remember.selector;
  setRememberCookie(res, remember.cookieValue);

  req.session.welcomeFlash = {
    displayName: createdMember.displayName,
  };

  return req.session.save(() => {
    return res.redirect(303, '/');
  });
});

module.exports = router;
