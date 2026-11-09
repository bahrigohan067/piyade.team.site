const appConfig = require('../config/app.config');
const { isRegisteredMember, isManagement, isDeveloper } = require('../config/roles.config');
const { getVisibleMenuItems } = require('../config/menu.config');
const botApiClient = require('../services/botApiClient');

/**
 * Her istekte kullanıcının oturumunu kontrol eder.
 * Giriş yapmışsa ve son rol senkronizasyonunun üzerinden 60 saniye geçtiyse
 * Bot REST API'den (/api/member/:id/roles) taze rolleri çeker.
 */
async function syncRolesMiddleware(req, res, next) {
  res.locals.currentUser = null;
  res.locals.visibleMenus = getVisibleMenuItems(null, req.lang || 'tr');
  res.locals.currentPath = req.path;
  res.locals.activeStats = botApiClient.getLastKnownActiveStats();

  if (!req.session || !req.session.user || !req.session.user.id) {
    return next();
  }

  const user = req.session.user;
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
      user.inGuild = true;
      user.rolesSyncedAt = now;
    } catch (err) {
      if (err.statusCode === 404) {
        // Kullanıcı Discord sunucusundan çıkmış veya henüz katılmamış
        user.roles = [];
        user.level = 'none';
        user.highestRolePosition = 0;
        user.inGuild = false;
        user.rolesSyncedAt = now;
      } else if (err.isOffline) {
        res.locals.botOfflineWarning = true;
        res.locals.activeStats = botApiClient.getLastKnownActiveStats();
      }
    }
  }

  res.locals.currentUser = user;
  res.locals.isRegistered = isRegisteredMember(user.roles, user.level);
  res.locals.isManagement = isManagement(user.roles, user.level);
  res.locals.isDeveloper = isDeveloper(user.roles, user.level);
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
 * Kayıtlı Üye (1559604702143062016) ve üstü yetkiye sahip kullanıcılar için middleware.
 * Sunucuda olmayan veya sadece Kayıtsız olan kullanıcıya "Önce Kayıt Ol" ekranını gösterir.
 */
function requireRegisteredMember(req, res, next) {
  markNoIndex(req, res);
  if (!req.session || !req.session.user || !req.session.user.id) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/discord');
  }

  const user = req.session.user;
  if (!isRegisteredMember(user.roles, user.level)) {
    return res.status(403).render('pages/not-registered', {
      title: req.t ? req.t('notRegistered.pageTitle') : 'Önce Kayıt Ol — Piyade Clan | TSB',
      inGuild: Boolean(user.inGuild),
    });
  }

  return next();
}

/**
 * Yönetim (Yönetmenlik 1559614111128490044 + Developer 1561777507223601353) rotaları için sunucu tarafı yetki kontrolü.
 */
function requireManagement(req, res, next) {
  markNoIndex(req, res);
  if (!req.session || !req.session.user || !req.session.user.id) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/discord');
  }

  const user = req.session.user;
  if (!isManagement(user.roles, user.level)) {
    return res.status(403).render('errors/403', {
      title: req.t ? req.t('errors.403Title') : 'Yetkisiz Erişim — Piyade Clan | TSB',
      message: req.t
        ? req.t('errors.403DefaultMsg')
        : 'Bu yönetim paneline erişmek için Yönetmenlik veya Developer yetkisine sahip olmanız gerekmektedir.',
    });
  }

  return next();
}

/**
 * Madde 5: Yönetim POST işlemlerinde (uyarı ver, kanıt yükle) rolü Bot API'den TAZE doğrular (önbellek kullanmaz).
 * Kullanıcı Discord sunucusundan çıktıysa veya yönetim yetkisi alındıysa oturumu derhal sonlandırır.
 */
async function requireFreshManagement(req, res, next) {
  markNoIndex(req, res);
  if (!req.session || !req.session.user || !req.session.user.id) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/discord');
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
    req.session.user.inGuild = true;
    req.session.user.rolesSyncedAt = Date.now();

    if (!isManagement(roles, level)) {
      // Kullanıcının yönetim yetkisi alınmış -> Oturumu sonlandır!
      return req.session.destroy(() => {
        res.clearCookie('piyade.sid');
        res.locals.currentUser = null;
        return res.status(403).render('errors/403', {
          title: req.t ? req.t('errors.403Title') : 'Yetkisiz Erişim',
          message: req.t
            ? req.t('errors.sessionRevokedNoPermission')
            : 'Yönetim yetkiniz kaldırıldığı için bu işlemi gerçekleştiremezsiniz. Oturumunuz sonlandırıldı.',
        });
      });
    }

    req.freshActorRoles = freshRolesData;
    return next();
  } catch (err) {
    if (err.statusCode === 404) {
      // Kullanıcı sunucudan çıkmış -> Oturumu sonlandır!
      return req.session.destroy(() => {
        res.clearCookie('piyade.sid');
        res.locals.currentUser = null;
        return res.status(403).render('errors/403', {
          title: req.t ? req.t('errors.403Title') : 'Oturum Sonlandırıldı',
          message: req.t
            ? req.t('errors.sessionRevokedNotInGuild')
            : 'Discord sunucusundan ayrıldığınız için oturumunuz güvenlik amacıyla sonlandırıldı.',
        });
      });
    }
    return next(err);
  }
}

module.exports = {
  syncRolesMiddleware,
  requireLogin,
  requireRegisteredMember,
  requireManagement,
  requireFreshManagement,
};
