/**
 * Piyade Team Discord Sunucusu Rol Yapılandırması
 */

const ROLES = {
  // Kayıtsız Üye Rolü
  UNREGISTERED: '1559604540997636147',

  // Kayıtlı Üye Rolü (Üye menülerine erişim için minimum rol)
  REGISTERED: '1559604702143062016',

  // Diğer Klan Rolü (Başka klandan kayıtlı üyeler; üye menülerine erişebilir, yönetim yetkisi yoktur)
  OTHER_CLAN: '1570460155437518960',

  // Kurucu / Developer Rolü (En üst düzey yönetim)
  DEVELOPER: '1561777507223601353',

  // Yönetmenlik / Üst Yönetim Rolü
  YONETMENLIK: '1559614111128490044',

  // Kayıt Yetkilisi
  STAFF_REGISTRATION: '1559625308737507358',

  // VS Talep Yetkilisi
  STAFF_VS: '1559892661547307038',

  // Mesaj Denetimcisi
  STAFF_MESSAGE: '1563914587273953363',

  // Askıda (Jail) Rolü
  SUSPENDED: '1563922256525000895',
};

// Yönetim menülerine erişebilecek yetkili rolleri
const MANAGEMENT_ROLES = [
  ROLES.DEVELOPER,
  ROLES.YONETMENLIK,
];

/**
 * Kullanıcı roller listesinde belirli bir rolün olup olmadığını denetler
 * @param {Array<string|object>} roles - Rol ID dizisi veya { id: string } objeleri dizisi
 * @param {string} roleId - Aranacak rol ID
 * @returns {boolean}
 */
function hasRole(roles, roleId) {
  if (!Array.isArray(roles) || !roleId) return false;
  return roles.some((r) => {
    if (typeof r === 'string') return r === roleId;
    if (r && typeof r === 'object' && r.id) return r.id === roleId;
    return false;
  });
}

/**
 * Kullanıcının yönetim (Developer veya Yönetmenlik) yetkisine sahip olup olmadığını denetler
 */
function isManagement(roles, userLevel) {
  if (userLevel === 'developer' || userLevel === 'yonetmenlik') return true;
  return MANAGEMENT_ROLES.some((roleId) => hasRole(roles, roleId));
}

/**
 * Kullanıcının Developer olup olmadığını denetler
 */
function isDeveloper(roles, userLevel) {
  if (userLevel === 'developer') return true;
  return hasRole(roles, ROLES.DEVELOPER);
}

/**
 * Kullanıcının Kayıtlı Üye (Kayıtlı Üye 1559604702143062016, Diğer Klan 1570460155437518960 veya üstü) olup olmadığını denetler.
 * Öncelik: Bot /api/member/:id/roles yanıtındaki registered alanı varsa onu kullanır; yoksa yerel rol kontrolüne düşer.
 */
function isRegisteredMember(roles, userLevel, registeredFlag) {
  if (registeredFlag === true) return true;
  if (isManagement(roles, userLevel)) return true;
  if (hasRole(roles, ROLES.REGISTERED) || hasRole(roles, ROLES.OTHER_CLAN)) return true;
  if (typeof registeredFlag === 'boolean') return registeredFlag;
  return false;
}

/**
 * Kullanıcının yalnızca Kayıtsız rolünde olup olmadığını veya hiç kaydı olmadığını denetler
 */
function isOnlyUnregistered(roles, registeredFlag) {
  if (registeredFlag === true) return false;
  if (!Array.isArray(roles) || roles.length === 0) return true;
  const hasReg = hasRole(roles, ROLES.REGISTERED) || hasRole(roles, ROLES.OTHER_CLAN);
  const hasMgmt = MANAGEMENT_ROLES.some((id) => hasRole(roles, id));
  if (hasReg || hasMgmt) return false;
  return hasRole(roles, ROLES.UNREGISTERED);
}

const LEVEL_RANK = {
  public: 0,
  none: 0,
  unregistered: 0,
  registered: 1,
  yonetmenlik: 2,
  developer: 3,
};

/**
 * Kullanıcının seviye dizisinin minimum gerekli seviyeyi karşılayıp karşılamadığını denetler.
 */
function hasMinLevel(userLevel, minLevel) {
  if (minLevel === 'public') return true;
  const currentRank = LEVEL_RANK[userLevel] ?? 0;
  const requiredRank = LEVEL_RANK[minLevel] ?? 99;
  return currentRank >= requiredRank;
}

module.exports = {
  ROLES,
  MANAGEMENT_ROLES,
  hasRole,
  hasMinLevel,
  isManagement,
  isDeveloper,
  isRegisteredMember,
  isOnlyUnregistered,
};
