const express = require('express');
const router = express.Router();
const authConfig = require('../config/auth.config');
const gamesConfig = require('../config/games.config');
const consentsConfig = require('../config/consents.config');
const botApiClient = require('../services/botApiClient');
const { getMemberStore, toUnifiedGoogleId } = require('../services/memberStore');
const { getChatStore } = require('../services/chatStore');
const { getSiteWarningStore } = require('../services/siteWarningStore');
const { chatSseHub } = require('../services/chatSseHub');
const {
  requireSiteMember,
  isGoogleSession,
  buildGoogleSessionUser,
  clearRememberCookie,
} = require('../middlewares/auth');
const { isRegisteredMember } = require('../config/roles.config');
const { verifyCsrfToken, verifyCsrfRequest } = require('../middlewares/csrf');
const { activityApiLimiter, robloxLookupLimiter } = require('../middlewares/rateLimiter');
const { validateNickname } = require('../utils/nicknameValidator');

function wantsJson(req) {
  return Boolean(
    req.xhr ||
      req.get('X-Requested-With') === 'XMLHttpRequest' ||
      (req.headers.accept && req.headers.accept.includes('application/json'))
  );
}

function formatMsg(template, vars = {}) {
  let out = String(template || '');
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v ?? ''));
  }
  return out;
}

function requireGoogleProfileMember(req, res, next) {
  if (!isGoogleSession(req)) {
    if (wantsJson(req)) {
      return res.status(403).json({ ok: false, code: 'GOOGLE_ONLY', error: 'Bu işlem yalnızca site üyeleri içindir.' });
    }
    return res.redirect('/profil');
  }
  const memberId =
    (req.session.identity && req.session.identity.memberId) ||
    (req.session.user && req.session.user.memberId);
  const member = memberId ? getMemberStore().findById(memberId) : null;
  if (!member || member.status !== 'active') {
    return res.redirect('/giris');
  }
  req.googleMember = member;
  return next();
}

async function renderGoogleProfilePage(req, res, member, { statusCode = 200, flash = null, deleteError = null } = {}) {
  const lang = req.lang === 'en' ? 'en' : 'tr';
  const memberStore = getMemberStore();
  const { games: gamesList } = await botApiClient.getGames({
    actorType: 'site-service',
    actorId: 'site',
  });
  const gamesById = new Map(gamesList.map((g) => [g.id, g]));
  const enrichedGames = (Array.isArray(member.games) ? member.games : []).map((g) => {
    const def = gamesById.get(g.id);
    return {
      ...g,
      emoji: (def && def.emoji) || '🎮',
      name: (def && def.name) || { tr: g.id, en: g.id },
      profileUrl:
        g.robloxProfileUrl ||
        (g.id === 'roblox' && g.robloxId ? `https://www.roblox.com/users/${g.robloxId}/profile` : null),
    };
  });

  const rememberSessions = memberStore.listRememberSessions(member.id, {
    currentSelector: (req.session && req.session.rememberSelector) || '',
  });
  const explicitConsents = consentsConfig.getExplicitConsents(lang);
  const memberConsentMap = new Map(
    (Array.isArray(member.consents) ? member.consents : []).map((c) => [c.id, c])
  );
  const deleteReauthAt = (req.session && Number(req.session.googleDeleteReauthAt)) || 0;
  const deleteReauthValid =
    deleteReauthAt > 0 && Date.now() - deleteReauthAt <= authConfig.DELETE_REAUTH_MAX_AGE_MS;

  return res.status(statusCode).render('pages/profile-google', {
    title: req.t('profile.pageTitle'),
    isGoogleProfilePage: true,
    member,
    enrichedGames,
    gamesList,
    rememberSessions,
    explicitConsents,
    memberConsentMap,
    deleteReauthValid,
    googleAuthEnabled: authConfig.isGoogleEnabled(),
    profileFlash: flash,
    deleteError,
  });
}

/**
 * GET /profil
 * - Discord kayıtlı üyesi: mevcut Discord profil sayfası (disiplin & kayıt) AYNEN korunur.
 * - Google site üyesi: Google üye profili (oyunlar, düzenleme, gizlilik, rızalarım, oturumlarım, hesabımı sil).
 */
router.get('/profil', requireSiteMember, async (req, res, next) => {
  try {
    if (isGoogleSession(req)) {
      const memberId =
        (req.session.identity && req.session.identity.memberId) || req.session.user.memberId;
      const member = memberId ? getMemberStore().findById(memberId) : null;
      if (!member) {
        return res.redirect('/giris');
      }
      const flash = req.session.profileFlash || null;
      delete req.session.profileFlash;
      return renderGoogleProfilePage(req, res, member, { flash });
    }

    const profileData = await botApiClient.getMemberProfile(req.session.user.id);
    return res.render('pages/profile', {
      title: req.t('profile.pageTitle'),
      profile: profileData,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /profil/roblox-kontrol
 * Google üyesinin profil düzenlerken yeni Roblox hesabını (kendi claim'ini yoksayarak) doğrulaması.
 */
router.get(
  '/profil/roblox-kontrol',
  requireSiteMember,
  requireGoogleProfileMember,
  verifyCsrfRequest,
  robloxLookupLimiter,
  async (req, res) => {
    const member = req.googleMember;
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

    const result = await botApiClient.lookupRobloxAccount(cleanQuery, {
      actorType: 'site-service',
      actorId: 'site',
      ignoreOwnerRef: member.id,
    });

    let alreadyRegistered = Boolean(result.alreadyRegistered);
    if (result.status === 'FOUND' && result.user && result.user.id) {
      if (getMemberStore().findByRobloxId(result.user.id, { excludeMemberId: member.id })) {
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
  }
);

/**
 * POST /profil/duzenle
 * Google üyesinin takma adını ve oyun kullanıcı adlarını günceller; Roblox değişirse yeniden doğrular ve claim'i günceller.
 */
router.post(
  '/profil/duzenle',
  requireSiteMember,
  requireGoogleProfileMember,
  verifyCsrfToken,
  async (req, res) => {
    const member = req.googleMember;
    const memberStore = getMemberStore();
    const lang = req.lang === 'en' ? 'en' : 'tr';
    const { games: gamesList } = await botApiClient.getGames({
      actorType: 'site-service',
      actorId: 'site',
    });
    const gamesById = new Map(gamesList.map((g) => [g.id, g]));

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const nickCheck = validateNickname(body.nickname);
    if (!nickCheck.ok) {
      const msgKey =
        nickCheck.reason === 'MENTION'
          ? 'googleSignup.errNickMention'
          : nickCheck.reason === 'LINK' || nickCheck.reason === 'INVITE'
            ? 'googleSignup.errNickLink'
            : nickCheck.reason === 'PROFANITY'
              ? 'googleSignup.errNickProfanity'
              : 'googleSignup.errNickLength';
      return renderGoogleProfilePage(req, res, member, {
        statusCode: 400,
        flash: { type: 'danger', text: req.t(msgKey) },
      });
    }

    const rawGamesInput = body.games !== undefined ? body.games : body['games[]'];
    const rawArr = Array.isArray(rawGamesInput)
      ? rawGamesInput
      : typeof rawGamesInput === 'string' && rawGamesInput.trim()
        ? [rawGamesInput]
        : [];
    const selectedIds = [...new Set(rawArr.map((x) => String(x || '').trim().toLowerCase()).filter((id) => gamesById.has(id)))];
    if (selectedIds.length === 0 || selectedIds.length > gamesConfig.MAX_REGISTRATION_GAMES) {
      return renderGoogleProfilePage(req, res, member, {
        statusCode: 400,
        flash: { type: 'danger', text: req.t('register.errNoGameSelected') },
      });
    }

    const bodyUsernames = body.usernames && typeof body.usernames === 'object' ? body.usernames : {};
    const selectedGamesInOrder = gamesList.filter((g) => selectedIds.includes(g.id));
    const validatedUsernames = {};
    for (const gDef of selectedGamesInOrder) {
      const rawU = bodyUsernames[gDef.id] !== undefined ? bodyUsernames[gDef.id] : body[`username_${gDef.id}`];
      const vRes = gamesConfig.validateGameUsername(gDef, rawU);
      if (!vRes.ok) {
        const gName = gamesConfig.pickLocalizedGameField(gDef.name, lang, gDef.id);
        const min = (gDef.validate && gDef.validate.min) || 2;
        const max = (gDef.validate && gDef.validate.max) || 32;
        const errText =
          gDef.id === 'minecraft' && vRes.reason === 'REGEX_MISMATCH'
            ? formatMsg(req.t('register.errMinecraftUsername'), { game: gName, min, max })
            : formatMsg(req.t('register.errGameUsernameLength'), { game: gName, min, max });
        return renderGoogleProfilePage(req, res, member, {
          statusCode: 400,
          flash: { type: 'danger', text: errText },
        });
      }
      validatedUsernames[gDef.id] = vRes.value;
    }

    const oldRobloxGame = (Array.isArray(member.games) ? member.games : []).find((g) => g && g.id === 'roblox') || null;
    const oldRobloxId = oldRobloxGame && oldRobloxGame.robloxId ? String(oldRobloxGame.robloxId) : null;
    const wantsRoblox = selectedIds.includes('roblox');
    let nextRobloxUser = null;

    if (wantsRoblox) {
      const rbLookup = await botApiClient.lookupRobloxAccount(validatedUsernames.roblox, {
        actorType: 'site-service',
        actorId: 'site',
        ignoreOwnerRef: member.id,
      });
      if (rbLookup.offline) {
        return renderGoogleProfilePage(req, res, member, {
          statusCode: 503,
          flash: { type: 'danger', text: req.t('googleSignup.errBotOffline') },
        });
      }
      if (rbLookup.status === 'NOT_FOUND') {
        return renderGoogleProfilePage(req, res, member, {
          statusCode: 400,
          flash: { type: 'danger', text: req.t('register.errRobloxNotFound') },
        });
      }
      if (rbLookup.status === 'BANNED') {
        return renderGoogleProfilePage(req, res, member, {
          statusCode: 400,
          flash: { type: 'danger', text: req.t('register.errRobloxBanned') },
        });
      }
      if (rbLookup.status !== 'FOUND' || !rbLookup.user || !rbLookup.user.id) {
        return renderGoogleProfilePage(req, res, member, {
          statusCode: 503,
          flash: { type: 'danger', text: req.t('register.errRobloxLookupFailed') },
        });
      }
      const newRbId = String(rbLookup.user.id);
      if (
        rbLookup.alreadyRegistered ||
        memberStore.findByRobloxId(newRbId, { excludeMemberId: member.id })
      ) {
        return renderGoogleProfilePage(req, res, member, {
          statusCode: 409,
          flash: { type: 'danger', text: req.t('register.errRobloxAlreadyRegistered') },
        });
      }
      if (newRbId !== oldRobloxId) {
        const claimRes = await botApiClient.claimSiteRobloxId(newRbId, member.id);
        if (!claimRes.ok) {
          const codeStatus = claimRes.conflict ? 409 : 503;
          const text = claimRes.conflict
            ? req.t('register.errRobloxAlreadyRegistered')
            : req.t('googleSignup.errBotOffline');
          return renderGoogleProfilePage(req, res, member, {
            statusCode: codeStatus,
            flash: { type: 'danger', text },
          });
        }
      }
      nextRobloxUser = rbLookup.user;
    }

    const updatedGames = selectedGamesInOrder.map((gDef) => {
      if (gDef.id === 'roblox' && nextRobloxUser) {
        return {
          id: 'roblox',
          username: nextRobloxUser.username || validatedUsernames.roblox,
          robloxId: String(nextRobloxUser.id),
          robloxAvatarUrl: nextRobloxUser.avatarUrl || '',
          robloxProfileUrl:
            nextRobloxUser.profileUrl || `https://www.roblox.com/users/${nextRobloxUser.id}/profile`,
        };
      }
      return {
        id: gDef.id,
        username: validatedUsernames[gDef.id],
      };
    });

    const upd = memberStore.updateMember(member.id, {
      nickname: nickCheck.value,
      games: updatedGames,
    });
    if (!upd.ok) {
      if (nextRobloxUser && String(nextRobloxUser.id) !== oldRobloxId) {
        await botApiClient.releaseSiteRobloxClaim(nextRobloxUser.id, member.id).catch(() => null);
      }
      return renderGoogleProfilePage(req, res, member, {
        statusCode: 409,
        flash: { type: 'danger', text: req.t('register.errRobloxAlreadyRegistered') },
      });
    }

    // Eski Roblox kimliği değiştiyse veya kaldırıldıysa eski claim'i bırak
    if (oldRobloxId && (!nextRobloxUser || String(nextRobloxUser.id) !== oldRobloxId)) {
      await botApiClient.releaseSiteRobloxClaim(oldRobloxId, member.id).catch(() => null);
    }

    req.session.user = buildGoogleSessionUser(upd.member);
    req.session.profileFlash = { type: 'success', text: req.t('googleProfile.flashUpdated') };
    return req.session.save(() => res.redirect(303, '/profil'));
  }
);

/**
 * POST /profil/gizlilik
 * "Oyun kullanıcı adlarımı sohbet profilimde göster" gizlilik anahtarını günceller.
 */
router.post(
  '/profil/gizlilik',
  requireSiteMember,
  requireGoogleProfileMember,
  verifyCsrfToken,
  (req, res) => {
    const member = req.googleMember;
    const memberStore = getMemberStore();
    const rawVal = req.body && req.body.showGamesInChat;
    const enabled = rawVal === true || rawVal === 'true' || rawVal === '1' || rawVal === 'on';

    if (enabled) {
      const consentB = consentsConfig.getExplicitConsentById('chat_profile_game_usernames');
      memberStore.grantConsent(member.id, 'chat_profile_game_usernames', (consentB && consentB.version) || '1.0');
    } else {
      memberStore.updateMember(member.id, { privacy: { showGamesInChat: false } });
    }

    req.session.profileFlash = {
      type: 'success',
      text: enabled ? req.t('googleProfile.flashGamesShown') : req.t('googleProfile.flashGamesHidden'),
    };
    return req.session.save(() => res.redirect(303, '/profil#gizlilik'));
  }
);

/**
 * POST /profil/riza
 * Rızalarım bölümünden tekil açık rıza maddelerini geri çeker veya yeniden verir.
 */
router.post(
  '/profil/riza',
  requireSiteMember,
  requireGoogleProfileMember,
  verifyCsrfToken,
  (req, res) => {
    const member = req.googleMember;
    const memberStore = getMemberStore();
    const consentId = String((req.body && req.body.consentId) || '').trim();
    const action = String((req.body && req.body.action) || '').trim();
    const consentDef = consentsConfig.getExplicitConsentById(consentId);

    if (!consentDef || !['withdraw', 'grant'].includes(action)) {
      req.session.profileFlash = { type: 'danger', text: req.t('googleProfile.errInvalidConsentAction') };
      return req.session.save(() => res.redirect(303, '/profil#rizalarim'));
    }

    if (action === 'withdraw') {
      memberStore.withdrawConsent(member.id, consentId);
      let flashText = req.t('googleProfile.flashConsentWithdrawnGeneric');
      if (consentId === 'chat_profile_game_usernames') {
        flashText = req.t('googleProfile.flashConsentBWithdrawn');
      } else if (consentId === 'chat_moderation_review') {
        flashText = req.t('googleProfile.flashConsentAWithdrawn');
      } else if (consentId === 'international_data_transfer') {
        flashText = req.t('googleProfile.flashConsentCWithdrawn');
      }
      req.session.profileFlash = { type: 'warning', text: flashText };
    } else {
      memberStore.grantConsent(member.id, consentId, consentDef.version);
      if (consentId === 'chat_moderation_review') {
        try {
          const uid = toUnifiedGoogleId(member.id);
          if (uid) getChatStore().recordConsent(uid);
        } catch (_) {}
      }
      req.session.profileFlash = { type: 'success', text: req.t('googleProfile.flashConsentGranted') };
    }

    return req.session.save(() => res.redirect(303, '/profil#rizalarim'));
  }
);

/**
 * POST /profil/oturum-kapat
 * Tek bir hatırlanan cihaz oturumunu iptal eder.
 */
router.post(
  '/profil/oturum-kapat',
  requireSiteMember,
  requireGoogleProfileMember,
  verifyCsrfToken,
  (req, res) => {
    const member = req.googleMember;
    const selector = String((req.body && req.body.selector) || '').trim();
    const revoked = getMemberStore().revokeRememberSelector(selector, { expectedMemberId: member.id });
    if (revoked && req.session.rememberSelector === selector) {
      delete req.session.rememberSelector;
      clearRememberCookie(res);
    }
    req.session.profileFlash = {
      type: 'success',
      text: req.t('googleProfile.flashSessionRevoked'),
    };
    return req.session.save(() => res.redirect(303, '/profil#oturumlarim'));
  }
);

/**
 * POST /profil/tum-oturumlari-kapat
 * Üyenin tüm cihazlardaki pw_remember oturumlarını iptal eder.
 */
router.post(
  '/profil/tum-oturumlari-kapat',
  requireSiteMember,
  requireGoogleProfileMember,
  verifyCsrfToken,
  (req, res) => {
    const member = req.googleMember;
    getMemberStore().revokeAllRememberTokensForMember(member.id);
    delete req.session.rememberSelector;
    clearRememberCookie(res);
    req.session.profileFlash = {
      type: 'success',
      text: req.t('googleProfile.flashAllSessionsRevoked'),
    };
    return req.session.save(() => res.redirect(303, '/profil#oturumlarim'));
  }
);

/**
 * POST /profil/hesap-sil
 * Hesap adını birebir yazdırma + son 10 dakika içinde yeniden Google doğrulaması ister.
 * Üye kaydı, hatırlama kayıtları, sohbet profili, kendi mesajları/korunmayan dosyaları,
 * engelleme listeleri ve Roblox claim'i silinir; geriye yalnızca kimliksiz denetim satırı kalır.
 */
router.post(
  '/profil/hesap-sil',
  requireSiteMember,
  requireGoogleProfileMember,
  verifyCsrfToken,
  async (req, res) => {
    const member = req.googleMember;
    const deleteReauthAt = (req.session && Number(req.session.googleDeleteReauthAt)) || 0;
    const hasFreshReauth =
      deleteReauthAt > 0 && Date.now() - deleteReauthAt <= authConfig.DELETE_REAUTH_MAX_AGE_MS;

    if (!hasFreshReauth) {
      const msg = req.t('googleProfile.errDeleteReauthRequired');
      if (wantsJson(req)) {
        return res.status(403).json({ ok: false, code: 'REAUTH_REQUIRED', error: msg });
      }
      return renderGoogleProfilePage(req, res, member, { statusCode: 403, deleteError: msg });
    }

    const confirmName = String((req.body && req.body.confirmDisplayName) || '').trim();
    if (!confirmName || confirmName !== String(member.displayName || '').trim()) {
      const msg = req.t('googleProfile.errDeleteNameMismatch');
      if (wantsJson(req)) {
        return res.status(400).json({ ok: false, code: 'CONFIRM_NAME_MISMATCH', error: msg });
      }
      return renderGoogleProfilePage(req, res, member, { statusCode: 400, deleteError: msg });
    }

    const unifiedId = toUnifiedGoogleId(member.id);
    const rbGame = (Array.isArray(member.games) ? member.games : []).find((g) => g && g.id === 'roblox');
    const robloxId = rbGame && rbGame.robloxId ? String(rbGame.robloxId) : null;

    // 1) Roblox claim'ini bottan bırak
    if (robloxId) {
      await botApiClient.releaseSiteRobloxClaim(robloxId, member.id).catch(() => null);
    }

    // 2) Canlı SSE bağlantılarını kes ve sohbet izlerini (profil, kendi mesajları/dosyaları, engelleme listeleri) temizle
    if (unifiedId) {
      try {
        chatSseHub.disconnectUser(unifiedId, 'account_deleted');
      } catch (_) {}
      try {
        getChatStore().purgeUserData(unifiedId);
      } catch (_) {}
    }

    // 2.5) Site üyesi uyarı kayıtlarındaki kişisel bağlantıları ve kanıt dosyalarını kaldır (yalnızca kimliksiz denetim satırı kalır)
    try {
      getSiteWarningStore().purgePersonalLinksForDeletedMember(member.id);
    } catch (_) {}

    // 3) Üye kaydını ve tüm hatırlama kayıtlarını sil (yalnızca kimliksiz account_deleted denetim satırı kalır)
    getMemberStore().deleteMember(member.id);

    // 4) Oturumu ve çerezleri yok et
    return req.session.destroy(() => {
      res.clearCookie('piyade.sid');
      clearRememberCookie(res);
      if (wantsJson(req)) {
        return res.json({ ok: true, deleted: true });
      }
      return res.redirect(303, '/?notice=account_deleted');
    });
  }
);

/**
 * GET /api/me/activity
 * Giriş yapmış ve kayıtlı Discord kullanıcısının yalnızca KENDİ (req.session.user.id) aylık oyun etkinliğini döndürür.
 * Google site üyeleri için 403 DISCORD_ONLY döner.
 */
router.get('/api/me/activity', (req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (!req.session || !req.session.user || !req.session.user.id) {
    return res.status(401).json({
      ok: false,
      code: 'UNAUTHENTICATED',
      error: req.t ? req.t('activityPanel.unauthenticated') : 'Oturum açmanız gerekiyor.',
    });
  }

  if (isGoogleSession(req)) {
    return res.status(403).json({
      ok: false,
      code: 'DISCORD_ONLY',
      error: req.t ? req.t('errors.discordOnlyMsg') : 'Etkinliğim paneli yalnızca Discord üyelerine açıktır.',
    });
  }

  const user = req.session.user;
  if (!isRegisteredMember(user.roles, user.level, user.registered)) {
    return res.status(403).json({
      ok: false,
      code: 'NOT_REGISTERED',
      error: req.t ? req.t('activityPanel.notRegisteredDesc') : 'Etkinliğini görmek için kayıt ol.',
    });
  }

  return next();
}, activityApiLimiter, async (req, res) => {
  try {
    const lang = req.lang === 'en' ? 'en' : 'tr';
    const data = await botApiClient.getMemberActivity(req.session.user.id, lang);
    return res.json({
      ok: true,
      ...data,
    });
  } catch (err) {
    const status = err && err.statusCode === 404 && err.errorCategory !== 'ENDPOINT_MISSING' ? 404 : 503;
    return res.status(status).json({
      ok: false,
      code: status === 404 ? 'NOT_IN_GUILD' : 'BOT_UNAVAILABLE',
      error: req.t ? req.t('activityPanel.errorLoad') : 'Etkinlik bilgisi şu an alınamadı.',
    });
  }
});

module.exports = router;
