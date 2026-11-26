const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const authConfig = require('../config/auth.config');
const discordAuthService = require('../services/discordAuthService');
const botApiClient = require('../services/botApiClient');
const { getMemberStore } = require('../services/memberStore');
const { parseCookie, clearRememberCookie } = require('../middlewares/auth');
const { authLimiter } = require('../middlewares/rateLimiter');
const { chatSseHub } = require('../services/chatSseHub');

function isSafeRelativeRedirect(target) {
  if (typeof target !== 'string') return false;
  const trimmed = target.trim();
  return trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.includes('\r') && !trimmed.includes('\n');
}

/**
 * GET /auth/discord
 * Kullanıcıyı Discord OAuth2 (scope: identify) yetkilendirme ekranına yönlendirir.
 * Madde 4: Rastgele "state" üretir ve yönlendirme öncesi oturuma kaydeder.
 */
router.get('/discord', authLimiter, (req, res) => {
  const state = crypto.randomBytes(24).toString('hex');
  req.session.oauthState = state;

  const authorizeUrl = discordAuthService.getAuthorizationUrl(state);
  req.session.save(() => {
    return res.redirect(authorizeUrl);
  });
});

/**
 * GET /auth/discord/callback
 * Discord'dan dönen "code" ve "state" parametrelerini alır.
 * Madde 4: "state" oturumdaki değerle eşleşmezse veya eksikse HTTP 403 döndürür.
 * Google -> "Evet, Discord hesabım var" akışı varsa googleSub <-> discordId kalıcı bağını kurar.
 */
router.get('/discord/callback', authLimiter, async (req, res, next) => {
  const { code, state, error } = req.query;

  if (error) {
    if (req.session && req.session.pendingGoogle) {
      req.session.pendingGoogle.linkToDiscord = false;
    }
    return res.redirect('/?error=discord_auth_cancelled');
  }

  // Madde 4: Zorunlu OAuth2 State Doğrulaması (Eksik veya eşleşmeyen state -> 403)
  const expectedState = req.session ? req.session.oauthState : null;
  if (req.session) {
    delete req.session.oauthState;
  }

  if (
    !state ||
    !expectedState ||
    typeof state !== 'string' ||
    typeof expectedState !== 'string' ||
    state !== expectedState
  ) {
    res.locals.disableFeedbackPill = true;
    return res.status(403).render('errors/403', {
      title: req.t ? req.t('errors.403Title') : 'Yetkisiz Erişim (403)',
      message: req.t
        ? req.t('errors.oauthStateMismatch')
        : 'Güvenlik doğrulaması başarısız (OAuth2 state parametresi eşleşmedi veya süresi doldu). Lütfen tekrar giriş yapınız.',
    });
  }

  if (!code) {
    return res.redirect('/');
  }

  try {
    // 1. Kodu Access Token ile değiştir
    const tokenData = await discordAuthService.exchangeCodeForToken(code);

    // 2. Access Token ile Discord kullanıcı kimliğini çek
    const discordUser = await discordAuthService.fetchDiscordUser(tokenData.access_token);

    // 2.5) Google -> Discord kalıcı bağlama akışı varsa çakışma kontrolü yap ve bağı kaydet
    const pendingGoogle = req.session && req.session.pendingGoogle;
    if (pendingGoogle && pendingGoogle.linkToDiscord && pendingGoogle.sub) {
      const isFreshPending =
        Date.now() - (Number(pendingGoogle.createdAt) || 0) <= authConfig.PENDING_GOOGLE_TTL_MS;
      delete req.session.pendingGoogle;

      if (isFreshPending) {
        const memberStore = getMemberStore();
        const linkRes = memberStore.linkGoogleToDiscord(pendingGoogle.sub, discordUser.id);
        if (!linkRes.ok) {
          res.locals.disableFeedbackPill = true;
          res.setHeader('X-Robots-Tag', 'noindex, nofollow');
          if (typeof req.applySeo === 'function') {
            req.applySeo({ noindex: true, isPublic: false });
          }
          return req.session.save(() => {
            return res.status(409).render('pages/google-status-error', {
              title: req.t('googleAuth.linkConflictTitle'),
              errorType: 'discord_link_conflict',
              statusReason: '',
            });
          });
        }
        req.session.authNotice = 'google_linked_success';
      }
    }

    // 3. Kullanıcının sunucudaki rollerini Bot REST API'den çek (/api/member/:id/roles)
    let roles = [];
    let level = 'none';
    let highestRolePosition = 0;
    let registered = undefined;
    let inGuild = false;
    let displayName = discordUser.global_name || discordUser.username;

    try {
      const memberRoleData = await botApiClient.getMemberRoles(discordUser.id);
      roles = memberRoleData.roles || [];
      level = memberRoleData.level || 'unregistered';
      highestRolePosition = memberRoleData.highestRolePosition || 0;
      displayName = memberRoleData.displayName || displayName;
      if (typeof memberRoleData.registered === 'boolean') {
        registered = memberRoleData.registered;
      }
      inGuild = true;
    } catch (roleErr) {
      if (roleErr.statusCode === 404) {
        inGuild = false;
        level = 'none';
      } else {
        throw roleErr;
      }
    }

    // 4. Oturuma kullanıcı bilgilerini kaydet (Access token istemciye asla gönderilmez)
    req.session.identity = {
      kind: 'discord',
      discordId: String(discordUser.id),
    };
    req.session.user = {
      id: discordUser.id,
      kind: 'discord',
      username: discordUser.username,
      displayName,
      avatarUrl: discordAuthService.buildAvatarUrl(discordUser),
      roles,
      level,
      highestRolePosition,
      registered,
      inGuild,
      rolesSyncedAt: Date.now(),
    };

    const rawReturnTo = req.session.returnTo || '/';
    const returnTo = isSafeRelativeRedirect(rawReturnTo) ? rawReturnTo : '/';
    delete req.session.returnTo;

    return req.session.save(() => {
      res.redirect(returnTo);
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /auth/logout
 * Kullanıcının oturumunu (ve varsa Google pw_remember çerezini/kaydını) güvenli şekilde sonlandırır.
 */
router.get('/logout', (req, res) => {
  const uid = req.session && req.session.user && req.session.user.id;
  if (uid) {
    chatSseHub.disconnectUser(uid, 'logout');
  }

  try {
    const memberStore = getMemberStore();
    const rawRemember = parseCookie(req, authConfig.REMEMBER_COOKIE_NAME);
    if (rawRemember) {
      memberStore.revokeRememberTokenByCookieValue(rawRemember);
    } else if (req.session && req.session.rememberSelector) {
      memberStore.revokeRememberSelector(req.session.rememberSelector);
    }
  } catch (_) {}

  req.session.destroy(() => {
    res.clearCookie('piyade.sid');
    clearRememberCookie(res);
    res.redirect('/');
  });
});

module.exports = router;
