const appConfig = require('../config/app.config');
const { botApiClient, BotApiUnavailableError } = require('../services/botApiClient');
const {
  isRegisteredMember,
  isManagement,
  isDeveloper,
  isOnlyUnregistered,
} = require('../config/roles.config');
const { getCategorizedMenus, getVisibleMenus } = require('../config/menu.config');

/**
 * Oturum açmış kullanıcının rollerini her 60 saniyede bir
 * Bot REST API'sinden (/api/member/:id/roles) güncelleyen middleware.
 * Discord access token'ı yerine doğrudan güncel sunucu verisi kullanılır.
 */
async function syncRolesMiddleware(req, res, next) {
  const user = req.session?.user;

  if (user && user.id) {
    const now = Date.now();
    const lastSync = user.lastRoleSync || 0;
    const intervalMs = appConfig.ROLE_SYNC_INTERVAL_SEC * 1000;

    // 60 saniye dolduysa veya ilk kez senkronize ediliyorsa
    if (now - lastSync >= intervalMs) {
      try {
        const rolesData = await botApiClient.getMemberRoles(user.id);
        user.roles = rolesData.roles || [];
        user.level = rolesData.level || 'member';
        user.displayName = rolesData.displayName || user.username;
        user.avatarUrl = rolesData.avatarUrl || user.avatarUrl;
        user.inGuild = true;
        user.lastRoleSync = now;
      } catch (err) {
        if (err.status === 404) {
          // Kullanıcı sunucuda değil
          user.inGuild = false;
          user.roles = [];
          user.level = 'guest';
          user.lastRoleSync = now;
        } else if (err instanceof BotApiUnavailableError) {
          // Bot API çevrimdışıysa mevcut oturum rollerini koru
          console.warn(`[ROL SENKRONİZASYON UYARISI] Bot API çevrimdışı, mevcut roller korundu.`);
        } else {
          console.warn(`[ROL SENKRONİZASYON HATASI] (${user.id}):`, err.message);
        }
      }
    }
  }

  // Tüm şablonlarda (views) kullanılacak genel değişkenleri ayarla
  res.locals.currentUser = user || null;
  res.locals.user = user || null;
  res.locals.menuCategories = getCategorizedMenus(user || null);
  res.locals.visibleMenus = getVisibleMenus(user || null);
  res.locals.isRegistered = user ? isRegisteredMember(user.roles, user.level) : false;
  res.locals.isManagement = user ? isManagement(user.roles, user.level) : false;
  res.locals.isDeveloper = user ? isDeveloper(user.roles, user.level) : false;
  res.locals.isOnlyUnregistered = user ? isOnlyUnregistered(user.roles) : false;
  res.locals.currentPath = req.path;

  next();
}

/**
 * Giriş yapılmasını zorunlu kılan middleware
 */
function requireAuth(req, res, next) {
  if (!req.session?.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/discord');
  }
  next();
}

/**
 * Kayıtlı Üye (1559604702143062016 ve üstü) olmayı zorunlu kılan middleware.
 * Sunucuda olmayan veya sadece Kayıtsız rolünde olanlara "Önce kayıt ol" ekranını sunar.
 */
function requireRegisteredMember(req, res, next) {
  if (!req.session?.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/discord');
  }

  const user = req.session.user;
  const hasAccess = isRegisteredMember(user.roles, user.level);

  if (!hasAccess) {
    // Sunucuda yok veya yalnızca kayıtsız
    return res.status(403).render('pages/not-registered', {
      title: 'Kayıt Gerekli | Piyade Team',
      inGuild: Boolean(user.inGuild),
      user,
    });
  }

  next();
}

/**
 * Yönetim Menüleri için Yetki Kontrolü
 * Sadece Yönetmenlik (1559614111128490044) ve Developer (1561777507223601353) erişebilir.
 */
function requireManagement(req, res, next) {
  if (!req.session?.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/discord');
  }

  const user = req.session.user;
  const hasAccess = isManagement(user.roles, user.level);

  if (!hasAccess) {
    return res.status(403).render('errors/403', {
      title: 'Erişim Engellendi (403)',
      message: 'Bu sayfaya yalnızca Yönetmenlik veya Developer yetkisine sahip kullanıcılar erişebilir.',
    });
  }

  next();
}

/**
 * Sadece Developer yetkisi gerektiren durumlar için kontrol
 */
function requireDeveloper(req, res, next) {
  if (!req.session?.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/discord');
  }

  const user = req.session.user;
  const hasAccess = isDeveloper(user.roles, user.level);

  if (!hasAccess) {
    return res.status(403).render('errors/403', {
      title: 'Developer Yetkisi Gerekli (403)',
      message: 'Bu alana yalnızca Kurucu / Developer rolüne sahip yetkililer erişebilir.',
    });
  }

  next();
}

module.exports = {
  syncRolesMiddleware,
  requireAuth,
  requireRegisteredMember,
  requireManagement,
  requireDeveloper,
};
