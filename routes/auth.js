const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const discordAuthService = require('../services/discordAuthService');
const { botApiClient, BotApiUnavailableError } = require('../services/botApiClient');
const { authLimiter } = require('../middlewares/rateLimiter');

/**
 * GET /auth/discord
 * Discord OAuth2 Giriş Akışını Başlatır
 */
router.get('/discord', authLimiter, (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  const authorizeUrl = discordAuthService.getAuthorizeUrl(state);
  res.redirect(authorizeUrl);
});

/**
 * GET /auth/discord/callback
 * Discord OAuth2 Dönüş Noktası
 */
router.get('/discord/callback', authLimiter, async (req, res, next) => {
  const { code, state, error, error_description } = req.query;

  // Kullanıcı iptal ettiyse
  if (error) {
    console.warn('[OAUTH2 İPTAL]:', error, error_description);
    return res.redirect('/?auth_error=' + encodeURIComponent(error_description || error));
  }

  // Kod veya State doğrulaması
  if (!code) {
    return res.status(400).render('errors/500', {
      title: 'Yetkilendirme Hatası',
      message: 'Discord tarafından yetkilendirme kodu dönmedi.',
    });
  }

  if (state && req.session.oauthState && state !== req.session.oauthState) {
    return res.status(403).render('errors/403', {
      title: 'Güvenlik Uyarısı (403)',
      message: 'OAuth2 durum doğrulaması eşleşmedi. Lütfen tekrar giriş yapınız.',
    });
  }

  try {
    // 1. Kodu Access Token ile takas et
    const tokenData = await discordAuthService.exchangeCode(code);

    // 2. Discord Kullanıcı Profilini al
    const discordUser = await discordAuthService.fetchUserProfile(tokenData.access_token);

    // 3. Bot API'den kullanıcının sunucudaki güncel rollerini al
    let rolesData = null;
    let inGuild = false;

    try {
      rolesData = await botApiClient.getMemberRoles(discordUser.id);
      inGuild = true;
    } catch (err) {
      if (err.status === 404) {
        // Kullanıcı sunucuda üye değil
        console.log(`[OAUTH2 BİLGİ] Kullanıcı (${discordUser.username}) sunucuda bulunamadı.`);
        inGuild = false;
      } else if (err instanceof BotApiUnavailableError) {
        console.warn(`[OAUTH2 UYARI] Bot API çevrimdışı, roller alınamadı.`);
      } else {
        console.warn(`[OAUTH2 ROL ALMA HATASI]:`, err.message);
      }
    }

    // 4. Kullanıcıyı Oturuma Kaydet
    req.session.user = {
      id: discordUser.id,
      username: discordUser.username,
      globalName: discordUser.globalName,
      displayName: rolesData?.displayName || discordUser.globalName || discordUser.username,
      avatarUrl: rolesData?.avatarUrl || discordUser.avatarUrl,
      level: rolesData?.level || (inGuild ? 'member' : 'guest'),
      roles: rolesData?.roles || [],
      inGuild,
      lastRoleSync: Date.now(),
    };

    delete req.session.oauthState;

    // 5. Önceden gitmek istediği URL'ye veya profile yönlendir
    const redirectUrl = req.session.returnTo || '/profil';
    delete req.session.returnTo;

    return res.redirect(redirectUrl);
  } catch (err) {
    console.error('[OAUTH2 CALLBACK HATASI]:', err);
    return next(err);
  }
});

/**
 * GET /auth/logout
 * Oturumu Kapatır
 */
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('[ÇIKIŞ HATASI]:', err);
    }
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

module.exports = router;
