const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const discordAuthService = require('../services/discordAuthService');
const botApiClient = require('../services/botApiClient');
const { authLimiter } = require('../middlewares/rateLimiter');

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
 */
router.get('/discord/callback', authLimiter, async (req, res, next) => {
  const { code, state, error } = req.query;

  if (error) {
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

    // 3. Kullanıcının sunucudaki rollerini Bot REST API'den çek (/api/member/:id/roles)
    let roles = [];
    let level = 'none';
    let highestRolePosition = 0;
    let inGuild = false;
    let displayName = discordUser.global_name || discordUser.username;

    try {
      const memberRoleData = await botApiClient.getMemberRoles(discordUser.id);
      roles = memberRoleData.roles || [];
      level = memberRoleData.level || 'unregistered';
      highestRolePosition = memberRoleData.highestRolePosition || 0;
      displayName = memberRoleData.displayName || displayName;
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
    req.session.user = {
      id: discordUser.id,
      username: discordUser.username,
      displayName,
      avatarUrl: discordAuthService.buildAvatarUrl(discordUser),
      roles,
      level,
      highestRolePosition,
      inGuild,
      rolesSyncedAt: Date.now(),
    };

    const returnTo = req.session.returnTo || '/';
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
 * Kullanıcının oturumunu güvenli şekilde sonlandırır.
 */
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('piyade.sid');
    res.redirect('/');
  });
});

module.exports = router;
