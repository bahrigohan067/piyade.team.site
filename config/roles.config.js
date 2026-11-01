/**
 * Piyade Team Discord Sunucusu Rol Yapılandırması
 */

const ROLES = {
  // Kayıtsız Üye Rolü
  UNREGISTERED: '1559604540997636147',

  // Kayıtlı Üye Rolü (Üye menülerine erişim için minimum rol)
  REGISTERED: '1559604702143062016',

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
 * Kullanıcının Kayıtlı Üye (veya üstü) olup olmadığını denetler
 */
function isRegisteredMember(roles, userLevel) {
  if (isManagement(roles, userLevel)) return true;
  return hasRole(roles, ROLES.REGISTERED);
}

/**
 * Kullanıcının yalnızca Kayıtsız rolünde olup olmadığını veya hiç kaydı olmadığını denetler
 */
function isOnlyUnregistered(roles) {
  if (!Array.isArray(roles) || roles.length === 0) return true;
  const hasReg = hasRole(roles, ROLES.REGISTERED);
  const hasMgmt = MANAGEMENT_ROLES.some((id) => hasRole(roles, id));
  if (hasReg || hasMgmt) return false;
  return hasRole(roles, ROLES.UNREGISTERED);
}

module.exports = {
  ROLES,
  MANAGEMENT_ROLES,
  hasRole,
  isManagement,
  isDeveloper,
  isRegisteredMember,
  isOnlyUnregistered,
};
