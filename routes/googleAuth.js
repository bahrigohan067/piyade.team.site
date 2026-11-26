const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const authConfig = require('../config/auth.config');
const googleAuthService = require('../services/googleAuthService');
const { getMemberStore } = require('../services/memberStore');
const {
  isGoogleSession,
  buildGoogleSessionUser,
  setRememberCookie,
  clearRememberCookie,
} = require('../middlewares/auth');
const { verifyCsrfToken } = require('../middlewares/csrf');
const { authLimiter } = require('../middlewares/rateLimiter');

const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

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

function timingSafeStringEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function isSafeRelativeRedirect(target) {
  if (typeof target !== 'string') return false;
  const trimmed = target.trim();
  return (
    trimmed.startsWith('/') &&
    !trimmed.startsWith('//') &&
    !trimmed.includes('\r') &&
    !trimmed.includes('\n') &&
    !trimmed.startsWith('/auth/') &&
    !trimmed.startsWith('/giris')
  );
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

function renderGoogleError(req, res, statusCode, errorType, { statusReason = '' } = {}) {
  markPrivateNoIndex(req, res);
  const titleMap = {
    cancelled: 'googleAuth.errCancelledTitle',
    state_mismatch: 'googleAuth.errStateTitle',
    missing_code: 'googleAuth.errTokenTitle',
    email_not_verified: 'googleAuth.errEmailUnverifiedTitle',
    token_invalid: 'googleAuth.errTokenTitle',
    reauth_mismatch: 'googleAuth.errReauthMismatchTitle',
    account_suspended: 'googleAuth.accountSuspendedTitle',
    account_banned: 'googleAuth.accountBannedTitle',
    discord_link_conflict: 'googleAuth.linkConflictTitle',
    google_disabled: 'googleAuth.errDisabledTitle',
  };
  const titleKey = titleMap[errorType] || 'googleAuth.errTokenTitle';
  return res.status(statusCode).render('pages/google-status-error', {
    title: req.t(titleKey),
    errorType,
    statusReason,
  });
}

/**
 * GET /giris
 * Yeni giriş merkezi: Discord ile giriş ve (yapılandırılmışsa) Google ile devam et.
 */
router.get('/giris', (req, res) => {
  markPrivateNoIndex(req, res);
  if (req.session && req.session.user && req.session.user.id) {
    return res.redirect('/');
  }
  return res.render('pages/login-center', {
    title: req.t('googleAuth.loginCenterPageTitle'),
    googleEnabled: authConfig.isGoogleEnabled(),
  });
});

/**
 * GET /giris/askida
 * Askıya alınmış veya yasaklanmış Google site üyeleri için bilgilendirme ve yasal başvuru bağlantısı.
 */
router.get('/giris/askida', (req, res) => {
  markPrivateNoIndex(req, res);
  const blocked = (req.session && req.session.googleBlockedInfo) || { status: 'suspended', reason: '' };
  const errorType = blocked.status === 'banned' ? 'account_banned' : 'account_suspended';
  return renderGoogleError(req, res, 403, errorType, { statusReason: blocked.reason || '' });
});

/**
 * GET /auth/google
 * PKCE (S256) + state + nonce üreterek Google OIDC yetkilendirme ekranına yönlendirir.
 * ?purpose=reauth_delete parametresi yalnızca oturumlu Google üyesinin hesap silme yeniden doğrulaması içindir.
 */
router.get('/auth/google', authLimiter, (req, res) => {
  markPrivateNoIndex(req, res);
  if (!authConfig.isGoogleEnabled()) {
    return renderGoogleError(req, res, 404, 'google_disabled');
  }

  let purpose = 'login';
  if (req.query.purpose === 'reauth_delete') {
    if (!isGoogleSession(req)) {
      return res.redirect('/giris');
    }
    purpose = 'reauth_delete';
  }

  const params = googleAuthService.generateOAuthSecurityParams();
  req.session.googleOauth = {
    state: params.state,
    nonce: params.nonce,
    codeVerifier: params.codeVerifier,
    purpose,
    createdAt: Date.now(),
  };

  const authUrl = googleAuthService.getAuthorizationUrl({
    state: params.state,
    nonce: params.nonce,
    codeChallenge: params.codeChallenge,
    lang: req.lang === 'en' ? 'en' : 'tr',
  });

  return req.session.save(() => {
    return res.redirect(authUrl);
  });
});

/**
 * GET /auth/google/callback
 * Google'dan dönen authorization code'u PKCE ile takas eder, id_token imzasını JWKS üzerinden doğrular
 * ve kullanıcıyı uygun dala yönlendirir:
 *  - reauth_delete: hesap silme onayı için 10 dk zaman damgası yazar
 *  - (a) kayıtlı Google üyesi: active -> giriş + pw_remember; suspended/banned -> /giris/askida
 *  - (b) linkedDiscordId bağlıysa: otomatik /auth/discord
 *  - (c) yeni kişi: yalnızca oturumda geçici kimlik -> /giris/discord-var-mi
 */
router.get('/auth/google/callback', authLimiter, async (req, res) => {
  markPrivateNoIndex(req, res);
  if (!authConfig.isGoogleEnabled()) {
    return renderGoogleError(req, res, 404, 'google_disabled');
  }

  const { code, state, error } = req.query;
  const savedOauth = req.session ? req.session.googleOauth : null;
  if (req.session) {
    delete req.session.googleOauth;
  }

  if (error) {
    return req.session.save(() => renderGoogleError(req, res, 200, 'cancelled'));
  }

  const isExpiredState =
    !savedOauth || Date.now() - (Number(savedOauth.createdAt) || 0) > OAUTH_STATE_TTL_MS;

  if (
    isExpiredState ||
    !state ||
    !savedOauth.state ||
    !timingSafeStringEqual(String(state), String(savedOauth.state))
  ) {
    return req.session.save(() => renderGoogleError(req, res, 403, 'state_mismatch'));
  }

  if (!code || typeof code !== 'string') {
    return req.session.save(() => renderGoogleError(req, res, 400, 'missing_code'));
  }

  let verified;
  try {
    const tokenData = await googleAuthService.exchangeCodeForTokens({
      code,
      codeVerifier: savedOauth.codeVerifier,
    });
    verified = await googleAuthService.verifyIdToken(tokenData.id_token, {
      expectedNonce: savedOauth.nonce,
    });
  } catch (err) {
    if (err && err.code === 'EMAIL_NOT_VERIFIED') {
      return req.session.save(() => renderGoogleError(req, res, 403, 'email_not_verified'));
    }
    return req.session.save(() => renderGoogleError(req, res, 400, 'token_invalid'));
  }

  const memberStore = getMemberStore();

  // 0) Hesap silme için yeniden Google doğrulaması
  if (savedOauth.purpose === 'reauth_delete') {
    if (!isGoogleSession(req)) {
      return res.redirect('/giris');
    }
    const memberId =
      (req.session.identity && req.session.identity.memberId) ||
      (req.session.user && req.session.user.memberId);
    const currentMember = memberId ? memberStore.findById(memberId) : null;
    if (!currentMember || currentMember.googleSub !== verified.sub) {
      return req.session.save(() => renderGoogleError(req, res, 403, 'reauth_mismatch'));
    }
    req.session.googleDeleteReauthAt = Date.now();
    return req.session.save(() => {
      return res.redirect('/profil#hesap-sil');
    });
  }

  // Yasaklı googleSub özet kontrolü
  if (memberStore.isGoogleSubBanned(verified.sub)) {
    const banInfo = memberStore.getGoogleSubBanInfo(verified.sub);
    req.session.googleBlockedInfo = {
      status: 'banned',
      reason: (banInfo && banInfo.reason) || '',
    };
    clearRememberCookie(res);
    return req.session.save(() => res.redirect('/giris/askida'));
  }

  // (a) Mevcut Google site üyesi varsa
  const existingMember = memberStore.findByGoogleSub(verified.sub);
  if (existingMember) {
    if (existingMember.status !== 'active') {
      req.session.googleBlockedInfo = {
        status: existingMember.status,
        reason: existingMember.statusReason || '',
      };
      clearRememberCookie(res);
      return req.session.save(() => res.redirect('/giris/askida'));
    }

    const updatedRes = memberStore.updateMember(existingMember.id, { lastLoginAt: Date.now() });
    const freshMember = (updatedRes && updatedRes.member) || existingMember;

    req.session.identity = { kind: 'google', memberId: freshMember.id };
    req.session.user = buildGoogleSessionUser(freshMember);
    delete req.session.pendingGoogle;
    delete req.session.googleBlockedInfo;

    const remember = memberStore.createRememberToken(freshMember.id, {
      userAgent: req.get('user-agent') || '',
    });
    req.session.rememberSelector = remember.selector;
    setRememberCookie(res, remember.cookieValue);

    const target = isSafeRelativeRedirect(req.session.returnTo) ? req.session.returnTo : '/';
    delete req.session.returnTo;

    return req.session.save(() => {
      return res.redirect(target);
    });
  }

  // (b) googleSub daha önce bir Discord hesabına bağlandıysa -> otomatik Discord girişi
  const linkedDiscordId = memberStore.findLinkedDiscordByGoogleSub(verified.sub);
  if (linkedDiscordId) {
    delete req.session.pendingGoogle;
    req.session.authNotice = 'discord_continue';
    return req.session.save(() => {
      return res.redirect('/auth/discord');
    });
  }

  // (c) Yeni kişi: yalnızca oturumda geçici kimlik sakla (DB'ye yazma), /giris/discord-var-mi'ye git
  req.session.pendingGoogle = {
    sub: verified.sub,
    email: verified.email,
    emailVerified: true,
    googleName: verified.name || '',
    linkToDiscord: false,
    createdAt: Date.now(),
  };

  return req.session.save(() => {
    return res.redirect('/giris/discord-var-mi');
  });
});

/**
 * GET /giris/discord-var-mi
 * Google ile ilk kez gelen kullanıcıya "Discord hesabın var mı?" sorusunu sorar.
 */
router.get('/giris/discord-var-mi', (req, res) => {
  markPrivateNoIndex(req, res);
  if (req.session && req.session.user && req.session.user.id) {
    return res.redirect('/');
  }
  const pending = getValidPendingGoogle(req);
  if (!pending) {
    return res.redirect('/giris');
  }
  return res.render('pages/google-has-discord', {
    title: req.t('googleAuth.hasDiscordPageTitle'),
    pendingEmailMasked: maskEmailForOwnPreview(pending.email),
  });
});

/**
 * POST /giris/discord-var-mi/bagla
 * "Evet, Discord hesabım var" seçeneği: oturumdaki geçici Google kimliğini bağlanacak olarak işaretler
 * ve mevcut Discord OAuth akışını başlatır.
 */
router.post('/giris/discord-var-mi/bagla', verifyCsrfToken, (req, res) => {
  markPrivateNoIndex(req, res);
  const pending = getValidPendingGoogle(req);
  if (!pending) {
    return res.redirect('/giris');
  }
  req.session.pendingGoogle.linkToDiscord = true;
  return req.session.save(() => {
    return res.redirect('/auth/discord');
  });
});

function maskEmailForOwnPreview(email) {
  const clean = String(email || '').trim();
  const atIdx = clean.indexOf('@');
  if (atIdx <= 1) return clean;
  const local = clean.slice(0, atIdx);
  const domain = clean.slice(atIdx);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***${domain}`;
}

module.exports = router;
