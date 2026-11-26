const appConfig = require('../config/app.config');
const authConfig = require('../config/auth.config');
const brandConfig = require('../config/brand.config');
const chatConfig = require('../config/chat.config');
const legalConfig = require('../config/legal.config');
const { isRegisteredMember, isManagement, isDeveloper, isCommunityOfficial } = require('../config/roles.config');
const { getVisibleMenuItems } = require('../config/menu.config');
const botApiClient = require('../services/botApiClient');
const { getMemberStore, toUnifiedGoogleId } = require('../services/memberStore');
const { formatDuration, formatRelativeUpdated } = require('../utils/formatDuration');

/**
 * İstek başlığındaki ham Cookie dizesinden belirli bir çerez değerini güvenli biçimde okur.
 */
function parseCookie(req, cookieName) {
  const header = req && req.headers && typeof req.headers.cookie === 'string' ? req.headers.cookie : '';
  if (!header || !cookieName) return '';
  const parts = header.split(';');
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = part.slice(0, eqIdx).trim();
    if (key !== cookieName) continue;
    const rawVal = part.slice(eqIdx + 1).trim();
    try {
      return decodeURIComponent(rawVal);
    } catch (_) {
      return rawVal;
    }
  }
  return '';
}

function setRememberCookie(res, cookieValue) {
  if (!res || typeof res.cookie !== 'function' || !cookieValue) return;
  res.cookie(authConfig.REMEMBER_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: appConfig.IS_PROD,
    sameSite: 'lax',
    path: '/',
    maxAge: authConfig.REMEMBER_TTL_MS,
  });
}

function clearRememberCookie(res) {
  if (!res || typeof res.clearCookie !== 'function') return;
  res.clearCookie(authConfig.REMEMBER_COOKIE_NAME, {
    httpOnly: true,
    secure: appConfig.IS_PROD,
    sameSite: 'lax',
    path: '/',
  });
}

function getSessionIdentityKind(req) {
  if (!req || !req.session) return null;
  if (req.session.identity && (req.session.identity.kind === 'google' || req.session.identity.kind === 'discord')) {
    return req.session.identity.kind;
  }
  if (req.session.user && req.session.user.kind === 'google') {
    return 'google';
  }
  if (req.session.user && req.session.user.id) {
    return 'discord';
  }
  return null;
}

function isGoogleSession(req) {
  return getSessionIdentityKind(req) === 'google';
}

function isDiscordSession(req) {
  return getSessionIdentityKind(req) === 'discord';
}

function buildGoogleSessionUser(member) {
  const unifiedId = toUnifiedGoogleId(member.id);
  const games = Array.isArray(member.games) ? member.games : [];
  const rbGame = games.find((g) => g && g.id === 'roblox') || null;
  const displayName = member.displayName || member.nickname || 'Üye';
  const initialSource = String(member.nickname || displayName || 'P').trim();
  const initial = (initialSource.charAt(0) || 'P').toUpperCase();
  return {
    id: unifiedId,
    memberId: member.id,
    kind: 'google',
    nickname: member.nickname,
    displayName,
    avatarUrl: rbGame && rbGame.robloxAvatarUrl ? rbGame.robloxAvatarUrl : null,
    initial,
    badges: ['site_member'],
    roles: [],
    level: 'site_member',
    highestRolePosition: 0,
    registered: true,
    inGuild: false,
    status: member.status || 'active',
    createdAt: member.createdAt || Date.now(),
  };
}

function buildUnifiedUserLocal(user) {
  if (!user || !user.id) return null;
  if (user.kind === 'google') {
    return {
      id: user.id,
      memberId: user.memberId || null,
      kind: 'google',
      displayName: user.displayName || user.nickname || 'Üye',
      avatarUrl: user.avatarUrl || null,
      initial: user.initial || String(user.displayName || 'P').trim().charAt(0).toUpperCase() || 'P',
      badges: Array.isArray(user.badges) && user.badges.length > 0 ? [...user.badges] : ['site_member'],
    };
  }
  const badges = [];
  if (isDeveloper(user.roles, user.level)) badges.push('developer');
  else if (isManagement(user.roles, user.level)) badges.push('management');
  else if (isRegisteredMember(user.roles, user.level, user.registered)) badges.push('registered');
  if (isCommunityOfficial(user.roles)) badges.push('community_official');
  return {
    id: String(user.id),
    kind: 'discord',
    displayName: user.displayName || user.username || String(user.id),
    avatarUrl: user.avatarUrl || null,
    badges,
  };
}

function wantsJson(req) {
  return Boolean(
    req &&
      (req.xhr ||
        (typeof req.get === 'function' && req.get('X-Requested-With') === 'XMLHttpRequest') ||
        (req.headers && req.headers.accept && req.headers.accept.includes('application/json')) ||
        (req.path && req.path.startsWith('/api/')))
  );
}

/**
 * Her istekte kullanıcının oturumunu kontrol eder.
 * - Oturum boşsa ve geçerli pw_remember çerezi varsa Google üye oturumunu otomatik açar ve çerezi döndürür.
 * - Google oturumlarında üyenin güncel durumunu (active/suspended/banned) kontrol eder.
 * - Discord oturumlarında son rol senkronizasyonunun üzerinden 60 saniye geçtiyse Bot REST API'den taze rolleri çeker.
 * - Her iki kimlik türü için ortak res.locals.user nesnesini oluşturur.
 */
async function syncRolesMiddleware(req, res, next) {
  res.locals.user = null;
  res.locals.currentUser = null;
  res.locals.userKind = null;
  res.locals.isGoogleMember = false;
  res.locals.isDiscordMember = false;
  res.locals.isRegistered = false;
  res.locals.isManagement = false;
  res.locals.isDeveloper = false;
  res.locals.isCommunityOfficial = false;
  res.locals.googleAuthEnabled = authConfig.isGoogleEnabled();
  res.locals.chatEnabled = appConfig.isChatEnabled();
  res.locals.legalFooterLinks = legalConfig.FOOTER_LEGAL_LINKS;
  res.locals.visibleMenus = getVisibleMenuItems(null, req.lang || 'tr');
  res.locals.currentPath = req.path;
  res.locals.activeStats = botApiClient.getLastKnownActiveStats();
  res.locals.formatDuration = formatDuration;
  res.locals.formatRelativeUpdated = formatRelativeUpdated;
  res.locals.welcomeFlash = null;
  res.locals.authNotice = null;
  botApiClient.refreshActiveStatsInBackground();

  // Tek kullanımlık bildirimleri yalnızca normal HTML GET sayfalarında tüket
  if (
    req.session &&
    req.method === 'GET' &&
    !wantsJson(req) &&
    !req.path.startsWith('/auth/') &&
    !req.path.startsWith('/lang/') &&
    req.path !== '/health'
  ) {
    if (req.session.welcomeFlash) {
      res.locals.welcomeFlash = req.session.welcomeFlash;
      delete req.session.welcomeFlash;
    }
    if (req.session.authNotice) {
      res.locals.authNotice = req.session.authNotice;
      delete req.session.authNotice;
    }
  }

  // 1) Oturum boşsa pw_remember çerezi ile otomatik Google üye girişi ve döndürme
  if (
    req.session &&
    (!req.session.user || !req.session.user.id) &&
    req.path !== '/auth/logout' &&
    req.path !== '/health'
  ) {
    const rawRemember = parseCookie(req, authConfig.REMEMBER_COOKIE_NAME);
    if (rawRemember) {
      try {
        const memberStore = getMemberStore();
        const result = memberStore.consumeAndRotateRememberToken(rawRemember, {
          userAgent: typeof req.get === 'function' ? req.get('user-agent') || '' : '',
        });
        if (result.ok && result.member) {
          req.session.identity = { kind: 'google', memberId: result.member.id };
          req.session.user = buildGoogleSessionUser(result.member);
          req.session.rememberSelector = result.selector;
          setRememberCookie(res, result.rotatedCookieValue);
        } else {
          clearRememberCookie(res);
          if (result.reason === 'MEMBER_INACTIVE' && result.memberStatus) {
            req.session.googleBlockedInfo = { status: result.memberStatus, reason: '' };
          }
        }
      } catch (_) {
        clearRememberCookie(res);
      }
    }
  }

  if (!req.session || !req.session.user || !req.session.user.id) {
    return next();
  }

  // 2) Google Site Üyesi Oturumu (ASLA yetkili sayılmaz, Discord Bot API'den rol çekilmez)
  if (isGoogleSession(req)) {
    const memberId =
      (req.session.identity && req.session.identity.memberId) || req.session.user.memberId;
    const memberStore = getMemberStore();
    const freshMember = memberId ? memberStore.findById(memberId) : null;

    if (!freshMember) {
      delete req.session.user;
      delete req.session.identity;
      delete req.session.rememberSelector;
      clearRememberCookie(res);
      return next();
    }

    if (freshMember.status !== 'active') {
      const blockedInfo = {
        status: freshMember.status,
        reason: freshMember.statusReason || '',
      };
      delete req.session.user;
      delete req.session.identity;
      delete req.session.rememberSelector;
      req.session.googleBlockedInfo = blockedInfo;
      clearRememberCookie(res);

      const allowedWhenBlocked =
        req.path === '/giris/askida' ||
        req.path.startsWith('/yasal') ||
        req.path.startsWith('/bildir') ||
        req.path.startsWith('/lang') ||
        req.path === '/auth/logout' ||
        req.path === '/health';
      if (!allowedWhenBlocked) {
        if (wantsJson(req)) {
          return res.status(403).json({
            ok: false,
            code: freshMember.status === 'banned' ? 'ACCOUNT_BANNED' : 'ACCOUNT_SUSPENDED',
            error: req.t ? req.t('googleAuth.accountRestrictedTitle') : 'Hesabınız kısıtlandı.',
          });
        }
        return res.redirect('/giris/askida');
      }
      return next();
    }

    const sessionUser = buildGoogleSessionUser(freshMember);
    req.session.identity = { kind: 'google', memberId: freshMember.id };
    req.session.user = sessionUser;

    res.locals.currentUser = sessionUser;
    res.locals.user = buildUnifiedUserLocal(sessionUser);
    res.locals.userKind = 'google';
    res.locals.isGoogleMember = true;
    res.locals.isDiscordMember = false;
    res.locals.isRegistered = true;
    res.locals.isManagement = false;
    res.locals.isDeveloper = false;
    res.locals.isCommunityOfficial = false;
    res.locals.visibleMenus = getVisibleMenuItems(sessionUser, req.lang || 'tr');
    return next();
  }

  // 3) Mevcut Discord Oturumu (davranış %100 korunur)
  const user = req.session.user;
  user.kind = 'discord';
  req.session.identity = { kind: 'discord', discordId: String(user.id) };

  const now = Date.now();
  const lastSync = user.rolesSyncedAt || 0;

  // 60 saniyede bir Bot API'den rolleri yenile
  if (now - lastSync >= appConfig.ROLE_SYNC_INTERVAL_MS) {
    try {
      const rolesData = await botApiClient.getMemberRoles(user.id);
      user.roles = rolesData.roles || [];
      user.level = rolesData.level || 'unregistered';
      user.highestRolePosition = rolesData.highestRolePosition || 0;
      user.displayName = rolesData.displayName || user.username;
      user.avatarUrl = rolesData.avatarUrl || user.avatarUrl;
      user.registered = typeof rolesData.registered === 'boolean' ? rolesData.registered : undefined;
      user.inGuild = true;
      user.rolesSyncedAt = now;
    } catch (err) {
      if (err.statusCode === 404) {
        // Kullanıcı Discord sunucusundan çıkmış veya henüz katılmamış
        user.roles = [];
        user.level = 'none';
        user.highestRolePosition = 0;
        user.registered = false;
        user.inGuild = false;
        user.rolesSyncedAt = now;
      } else if (err.isOffline) {
        res.locals.botOfflineWarning = true;
        res.locals.activeStats = botApiClient.getLastKnownActiveStats();
      }
    }
  }

  res.locals.currentUser = user;
  res.locals.user = buildUnifiedUserLocal(user);
  res.locals.userKind = 'discord';
  res.locals.isDiscordMember = true;
  res.locals.isGoogleMember = false;
  res.locals.isRegistered = isRegisteredMember(user.roles, user.level, user.registered);
  res.locals.isManagement = isManagement(user.roles, user.level);
  res.locals.isDeveloper = isDeveloper(user.roles, user.level);
  res.locals.isCommunityOfficial = isCommunityOfficial(user.roles);
  res.locals.visibleMenus = getVisibleMenuItems(user, req.lang || 'tr');

  return next();
}

function markNoIndex(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req && typeof req.applySeo === 'function') {
    req.applySeo({ noindex: true, isPublic: false });
  } else if (res.locals && res.locals.seo) {
    res.locals.seo.noindex = true;
    res.locals.seo.isPublic = false;
  }
}

/**
 * Sadece Discord ile giriş yapmış kullanıcıların erişebileceği rotalar için.
 */
function requireLogin(req, res, next) {
  markNoIndex(req, res);
  if (!req.session || !req.session.user || !req.session.user.id) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/discord');
  }
  return next();
}

/**
 * Yalnızca Discord kimliğine sahip oturumlara izin verir.
 * Google site üyesi oturumları bu rotalara erişemez (403).
 */
function requireDiscordMember(req, res, next) {
  markNoIndex(req, res);
  if (!req.session || !req.session.user || !req.session.user.id) {
    if (wantsJson(req)) {
      return res.status(401).json({
        ok: false,
        code: 'AUTH_REQUIRED',
        error: req.t ? req.t('errors.discordOnlyMsg') : 'Discord ile giriş yapmanız gerekiyor.',
      });
    }
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/discord');
  }

  if (isGoogleSession(req)) {
    res.locals.disableFeedbackPill = true;
    const msg = req.t
      ? req.t('errors.discordOnlyMsg')
      : 'Bu bölüm yalnızca Discord ile giriş yapmış sunucu üyelerine açıktır.';
    if (wantsJson(req)) {
      return res.status(403).json({ ok: false, code: 'DISCORD_ONLY', error: msg });
    }
    const siteName = brandConfig.getSiteName ? brandConfig.getSiteName() : 'Piyade';
    return res.status(403).render('errors/403', {
      title: req.t ? req.t('errors.403Title') : `Yetkisiz Erişim — ${siteName}`,
      message: msg,
    });
  }

  return next();
}

/**
 * Hem kayıtlı Discord üyelerine hem de aktif Google site üyelerine izin verir.
 */
function requireSiteMember(req, res, next) {
  markNoIndex(req, res);
  if (!req.session || !req.session.user || !req.session.user.id) {
    if (wantsJson(req)) {
      return res.status(401).json({
        ok: false,
        code: 'AUTH_REQUIRED',
        error: req.t ? req.t('chat.errAuthRequired') : 'Oturum açmanız gerekiyor.',
      });
    }
    req.session.returnTo = req.originalUrl;
    return res.redirect(authConfig.isGoogleEnabled() ? '/giris' : '/auth/discord');
  }

  if (isGoogleSession(req)) {
    return next();
  }

  const user = req.session.user;
  if (!isRegisteredMember(user.roles, user.level, user.registered)) {
    if (wantsJson(req)) {
      return res.status(403).json({
        ok: false,
        code: 'NOT_REGISTERED',
        error: req.t ? req.t('chat.errNotRegistered') : 'Önce kayıt olmanız gerekiyor.',
      });
    }
    const siteName = brandConfig.getSiteName ? brandConfig.getSiteName() : 'Piyade';
    return res.status(403).render('pages/not-registered', {
      title: req.t ? req.t('notRegistered.pageTitle') : `Önce Kayıt Ol — ${siteName}`,
      inGuild: Boolean(user.inGuild),
    });
  }

  return next();
}

/**
 * Kayıtlı Üye (1559604702143062016) ve üstü yetkiye sahip Discord kullanıcıları için middleware.
 * Sunucuda olmayan veya sadece Kayıtsız olan kullanıcıya "Önce Kayıt Ol" ekranını gösterir.
 */
function requireRegisteredMember(req, res, next) {
  markNoIndex(req, res);
  if (!req.session || !req.session.user || !req.session.user.id) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/discord');
  }

  if (isGoogleSession(req)) {
    res.locals.disableFeedbackPill = true;
    const msg = req.t
      ? req.t('errors.discordOnlyMsg')
      : 'Bu bölüm yalnızca Discord ile giriş yapmış kayıtlı üyelere açıktır.';
    if (wantsJson(req)) {
      return res.status(403).json({ ok: false, code: 'DISCORD_ONLY', error: msg });
    }
    const siteName = brandConfig.getSiteName ? brandConfig.getSiteName() : 'Piyade';
    return res.status(403).render('errors/403', {
      title: req.t ? req.t('errors.403Title') : `Yetkisiz Erişim — ${siteName}`,
      message: msg,
    });
  }

  const user = req.session.user;
  if (!isRegisteredMember(user.roles, user.level, user.registered)) {
    const siteName = brandConfig.getSiteName ? brandConfig.getSiteName() : 'Piyade';
    return res.status(403).render('pages/not-registered', {
      title: req.t ? req.t('notRegistered.pageTitle') : `Önce Kayıt Ol — ${siteName}`,
      inGuild: Boolean(user.inGuild),
    });
  }

  return next();
}

/**
 * Yönetim (Yönetmenlik 1559614111128490044 + Developer 1561777507223601353) rotaları için sunucu tarafı yetki kontrolü.
 * Google oturumları ASLA yetkili sayılmaz.
 */
function requireManagement(req, res, next) {
  markNoIndex(req, res);
  if (!req.session || !req.session.user || !req.session.user.id) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/discord');
  }

  const user = req.session.user;
  if (isGoogleSession(req) || !isManagement(user.roles, user.level)) {
    res.locals.disableFeedbackPill = true;
    const msg = req.t
      ? req.t('errors.403DefaultMsg')
      : 'Bu yönetim paneline erişmek için Yönetmenlik veya Developer yetkisine sahip olmanız gerekmektedir.';
    if (wantsJson(req)) {
      return res.status(403).json({ ok: false, error: msg });
    }
    const siteName = brandConfig.getSiteName ? brandConfig.getSiteName() : 'Piyade';
    return res.status(403).render('errors/403', {
      title: req.t ? req.t('errors.403Title') : `Yetkisiz Erişim — ${siteName}`,
      message: msg,
    });
  }

  return next();
}

/**
 * Madde 5: Yönetim POST işlemlerinde (uyarı ver, kanıt yükle) rolü Bot API'den TAZE doğrular (önbellek kullanmaz).
 * Google oturumları doğrudan 403 ile reddedilir.
 * Kullanıcı Discord sunucusundan çıktıysa veya yönetim yetkisi alındıysa oturumu derhal sonlandırır.
 */
async function requireFreshManagement(req, res, next) {
  markNoIndex(req, res);
  if (!req.session || !req.session.user || !req.session.user.id) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/discord');
  }

  if (isGoogleSession(req)) {
    const msg = req.t
      ? req.t('errors.403DefaultMsg')
      : 'Bu yönetim paneline erişmek için Yönetmenlik veya Developer yetkisine sahip olmanız gerekmektedir.';
    if (wantsJson(req)) {
      return res.status(403).json({ ok: false, error: msg });
    }
    return res.status(403).render('errors/403', {
      title: req.t ? req.t('errors.403Title') : 'Yetkisiz Erişim',
      message: msg,
      disableFeedbackPill: true,
    });
  }

  const actorId = req.session.user.id;

  try {
    const freshRolesData = await botApiClient.getMemberRoles(actorId);
    const roles = freshRolesData.roles || [];
    const level = freshRolesData.level || 'unregistered';

    // Oturum verisini taze bilgiyle güncelle
    req.session.user.roles = roles;
    req.session.user.level = level;
    req.session.user.highestRolePosition = freshRolesData.highestRolePosition || 0;
    req.session.user.registered = typeof freshRolesData.registered === 'boolean' ? freshRolesData.registered : undefined;
    req.session.user.inGuild = true;
    req.session.user.rolesSyncedAt = Date.now();

    if (!isManagement(roles, level)) {
      const revokedMsg = req.t
        ? req.t('errors.sessionRevokedNoPermission')
        : 'Yönetim yetkiniz kaldırıldığı için bu işlemi gerçekleştiremezsiniz. Oturumunuz sonlandırıldı.';
      const isJsonReq = wantsJson(req);

      // Kullanıcının yönetim yetkisi alınmış -> Oturumu sonlandır!
      return req.session.destroy(() => {
        res.clearCookie('piyade.sid');
        res.locals.currentUser = null;
        if (isJsonReq) {
          return res.status(403).json({
            ok: false,
            error: revokedMsg,
            sessionRevoked: true,
          });
        }
        return res.status(403).render('errors/403', {
          title: req.t ? req.t('errors.403Title') : 'Yetkisiz Erişim',
          message: revokedMsg,
          disableFeedbackPill: true,
        });
      });
    }

    req.freshActorRoles = freshRolesData;
    return next();
  } catch (err) {
    if (err.statusCode === 404) {
      const leftMsg = req.t
        ? req.t('errors.sessionRevokedNotInGuild')
        : 'Discord sunucusundan ayrıldığınız için oturumunuz güvenlik amacıyla sonlandırıldı.';
      const isJsonReq = wantsJson(req);

      // Kullanıcı sunucudan çıkmış -> Oturumu sonlandır!
      return req.session.destroy(() => {
        res.clearCookie('piyade.sid');
        res.locals.currentUser = null;
        if (isJsonReq) {
          return res.status(403).json({
            ok: false,
            error: leftMsg,
            sessionRevoked: true,
          });
        }
        return res.status(403).render('errors/403', {
          title: req.t ? req.t('errors.403Title') : 'Oturum Sonlandırıldı',
          message: leftMsg,
          disableFeedbackPill: true,
        });
      });
    }
    return next(err);
  }
}

/**
 * Parça 4: Sohbet moderasyon paneli için her istekte Bot API'den TAZE Community Official rolü doğrular.
 * Google oturumları ve yetkisiz herkes 404 alır.
 */
async function requireFreshCommunityOfficial(req, res, next) {
  markNoIndex(req, res);
  if (!req.session || !req.session.user || !req.session.user.id || isGoogleSession(req)) {
    return next('router');
  }
  const actorId = String(req.session.user.id);
  try {
    const freshRolesData = await botApiClient.getMemberRoles(actorId);
    const roles = freshRolesData.roles || [];
    const level = freshRolesData.level || 'unregistered';

    req.session.user.roles = roles;
    req.session.user.level = level;
    req.session.user.highestRolePosition = freshRolesData.highestRolePosition || 0;
    req.session.user.registered = typeof freshRolesData.registered === 'boolean' ? freshRolesData.registered : undefined;
    req.session.user.inGuild = true;
    req.session.user.rolesSyncedAt = Date.now();

    const allowed =
      isCommunityOfficial(roles) ||
      (chatConfig.isModPanelAlsoDeveloper() && isDeveloper(roles, level));

    if (!allowed) {
      return next('router');
    }

    req.freshActorRoles = freshRolesData;
    return next();
  } catch (err) {
    if (err && err.statusCode === 404) {
      return next('router');
    }
    return next(err);
  }
}

/**
 * Parça 4: Denetim kaydı (salt okunur /sohbet/moderasyon/denetim) için taze rol doğrulaması.
 * Google oturumları ve yetkisiz herkes 404 alır.
 */
async function requireFreshModAuditViewer(req, res, next) {
  markNoIndex(req, res);
  if (!req.session || !req.session.user || !req.session.user.id || isGoogleSession(req)) {
    return next('router');
  }
  const actorId = String(req.session.user.id);
  try {
    const freshRolesData = await botApiClient.getMemberRoles(actorId);
    const roles = freshRolesData.roles || [];
    const level = freshRolesData.level || 'unregistered';

    req.session.user.roles = roles;
    req.session.user.level = level;
    req.session.user.inGuild = true;
    req.session.user.rolesSyncedAt = Date.now();

    const isOfficial = isCommunityOfficial(roles);
    const isDev = isDeveloper(roles, level);
    if (!isOfficial && !isDev) {
      return next('router');
    }
    req.freshActorRoles = freshRolesData;
    req.modAuditReadOnly = !isOfficial && !chatConfig.isModPanelAlsoDeveloper();
    return next();
  } catch (err) {
    if (err && err.statusCode === 404) {
      return next('router');
    }
    return next(err);
  }
}

/**
 * KVKK Yönetici Paneli (/yonetim/kvkk): Her istekte Bot API'den TAZE Developer rolü doğrular.
 * Google oturumları ve Developer dışındaki herkes 404 alır.
 */
async function requireFreshDeveloper(req, res, next) {
  markNoIndex(req, res);
  if (!req.session || !req.session.user || !req.session.user.id || isGoogleSession(req)) {
    return next('router');
  }
  const actorId = String(req.session.user.id);
  try {
    const freshRolesData = await botApiClient.getMemberRoles(actorId);
    const roles = freshRolesData.roles || [];
    const level = freshRolesData.level || 'unregistered';

    req.session.user.roles = roles;
    req.session.user.level = level;
    req.session.user.highestRolePosition = freshRolesData.highestRolePosition || 0;
    req.session.user.registered = typeof freshRolesData.registered === 'boolean' ? freshRolesData.registered : undefined;
    req.session.user.inGuild = true;
    req.session.user.rolesSyncedAt = Date.now();

    if (!isDeveloper(roles, level)) {
      return next('router');
    }
    req.freshActorRoles = freshRolesData;
    return next();
  } catch (err) {
    if (err && err.statusCode === 404) {
      return next('router');
    }
    return next(err);
  }
}

/**
 * Yönetim İhlal Bildirim Paneli (/yonetim/bildirimler): Her istekte Bot API'den TAZE
 * Developer veya Yönetmenlik rolü doğrular. Google oturumları ve yetkisiz herkes 404 alır.
 */
async function requireFreshManagementOr404(req, res, next) {
  markNoIndex(req, res);
  if (!req.session || !req.session.user || !req.session.user.id || isGoogleSession(req)) {
    return next('router');
  }
  const actorId = String(req.session.user.id);
  try {
    const freshRolesData = await botApiClient.getMemberRoles(actorId);
    const roles = freshRolesData.roles || [];
    const level = freshRolesData.level || 'unregistered';

    req.session.user.roles = roles;
    req.session.user.level = level;
    req.session.user.highestRolePosition = freshRolesData.highestRolePosition || 0;
    req.session.user.registered = typeof freshRolesData.registered === 'boolean' ? freshRolesData.registered : undefined;
    req.session.user.inGuild = true;
    req.session.user.rolesSyncedAt = Date.now();

    if (!isManagement(roles, level)) {
      return next('router');
    }
    req.freshActorRoles = freshRolesData;
    return next();
  } catch (err) {
    if (err && err.statusCode === 404) {
      return next('router');
    }
    return next(err);
  }
}

module.exports = {
  parseCookie,
  setRememberCookie,
  clearRememberCookie,
  getSessionIdentityKind,
  isGoogleSession,
  isDiscordSession,
  buildGoogleSessionUser,
  buildUnifiedUserLocal,
  syncRolesMiddleware,
  requireLogin,
  requireDiscordMember,
  requireSiteMember,
  requireRegisteredMember,
  requireManagement,
  requireFreshManagement,
  requireFreshCommunityOfficial,
  requireFreshModAuditViewer,
  requireFreshDeveloper,
  requireFreshManagementOr404,
};
