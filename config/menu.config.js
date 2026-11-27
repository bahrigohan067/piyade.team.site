/**
 * Modüler Menü Yapılandırması (TR / EN Çok Dilli Tek Kaynak)
 *
 * Yeni bir sayfa veya menü sekmesi eklemek için yalnızca aşağıdaki
 * MENU_ITEMS dizisine yeni bir obje eklemek yeterlidir.
 *
 * minLevel değerleri:
 * - "public"      : Herkese açık
 * - "registered"  : Kayıtlı Üye (1559604702143062016) ve üstü
 * - "yonetmenlik" : Yönetmenlik (1559614111128490044) ve Developer (1561777507223601353)
 * - "developer"   : Sadece Developer (1561777507223601353)
 */

const appConfig = require('./app.config');
const chatConfig = require('./chat.config');
const { hasMinLevel, isRegisteredMember, isManagement, isDeveloper, isCommunityOfficial } = require('./roles.config');

const MENU_ITEMS = [
  // ==========================================
  // 1. HERKESE AÇIK MENÜLER
  // ==========================================
  {
    id: 'home',
    title: 'Anasayfa',
    titleEn: 'Home',
    path: '/',
    icon: 'home',
    section: 'public',
    minLevel: 'public',
    identities: ['discord', 'google'],
    showWhenLoggedIn: true,
    showWhenLoggedOut: true,
    description: 'Topluluk anasayfası ve canlı aktif üye istatistikleri',
    descriptionEn: 'Community homepage and live member statistics',
  },
  {
    id: 'rules',
    title: 'Genel Kurallar',
    titleEn: 'Rules',
    path: '/kurallar',
    icon: 'book',
    section: 'public',
    minLevel: 'public',
    identities: ['discord', 'google'],
    showWhenLoggedIn: true,
    showWhenLoggedOut: true,
    description: 'Sunucu katılım, düzen ve yetkili kuralları',
    descriptionEn: 'Server participant, channel order, and staff rules',
  },
  {
    id: 'interactive',
    title: '🎯 Atış & Gökyüzü',
    titleEn: '🎯 Dart & Sky',
    path: '/etkilesim',
    icon: 'sparkles',
    section: 'public',
    minLevel: 'public',
    identities: ['discord', 'google'],
    showWhenLoggedIn: true,
    showWhenLoggedOut: true,
    badge: 'Yeni',
    badgeEn: 'New',
    badgeClass: 'badge-primary',
    description: 'İnteraktif Dart Rating atış poligonu ve dilek gökyüzü',
    descriptionEn: 'Interactive Dart Rating range and meteor wish sky',
  },
  {
    id: 'register',
    title: 'Kayıt Ol',
    titleEn: 'Register',
    path: '/kayit',
    icon: 'user-plus',
    section: 'public',
    minLevel: 'public',
    identities: ['discord'],
    showWhenLoggedIn: true,
    showWhenLoggedOut: true,
    hideIfAlreadyRegistered: true,
    description: 'Topluluğa kayıt olarak sunucu üye rollerinizi alın',
    descriptionEn: 'Register to the community and receive your member roles',
  },

  // ==========================================
  // 2. KAYITLI ÜYE / SİTE ÜYESİ MENÜLERİ
  // ==========================================
  {
    id: 'profile',
    title: 'Profilim',
    titleEn: 'My Profile',
    path: '/profil',
    icon: 'user',
    section: 'member',
    minLevel: 'registered',
    identities: ['discord', 'google'],
    showWhenLoggedIn: true,
    showWhenLoggedOut: false,
    description: 'Kişisel topluluk profiliniz ve oyun hesaplarınız',
    descriptionEn: 'Your personal community profile and game accounts',
  },
  {
    id: 'servers',
    title: '🌐 Sunucularımız',
    titleEn: '🌐 Our Servers',
    path: '/sunucular',
    icon: 'globe',
    section: 'member',
    minLevel: 'registered',
    identities: ['discord', 'google'],
    showWhenLoggedIn: true,
    showWhenLoggedOut: false,
    description: 'Piyade adıyla bağlantılı topluluk Discord sunucuları',
    descriptionEn: 'Community Discord servers affiliated with Piyade',
  },
  {
    id: 'chat',
    title: '💬 Sohbet',
    titleEn: '💬 Chat',
    path: '/sohbet',
    icon: 'message-circle',
    section: 'member',
    minLevel: 'registered',
    identities: ['discord', 'google'],
    showWhenLoggedIn: true,
    showWhenLoggedOut: false,
    requiresChatEnabled: true,
    hasUnreadBadge: true,
    description: 'Kayıtlı üyelerle birebir özel mesajlaşma',
    descriptionEn: 'Private one-to-one messaging with registered members',
  },

  // ==========================================
  // 3. YÖNETİM MENÜLERİ (YALNIZCA DISCORD + İLGİLİ ROL)
  // ==========================================
  {
    id: 'admin-warn',
    title: 'Uyarı Ver',
    titleEn: 'Issue Warning',
    path: '/yonetim/uyari',
    icon: 'shield-alert',
    section: 'admin',
    minLevel: 'yonetmenlik',
    identities: ['discord'],
    showWhenLoggedIn: true,
    showWhenLoggedOut: false,
    badge: 'Yönetim',
    badgeEn: 'Staff',
    badgeClass: 'badge-warning',
    description: 'Üyelere sözlü veya resmi disiplin cezası uygula',
    descriptionEn: 'Issue verbal or official disciplinary warnings to members',
  },
  {
    id: 'admin-members',
    title: 'Üye Bilgileri',
    titleEn: 'Member Records',
    path: '/yonetim/uyeler',
    icon: 'users',
    section: 'admin',
    minLevel: 'yonetmenlik',
    identities: ['discord'],
    showWhenLoggedIn: true,
    showWhenLoggedOut: false,
    badge: 'Yönetim',
    badgeEn: 'Staff',
    badgeClass: 'badge-warning',
    description: 'Üye arama, profil detayları ve sicil geçmişi görüntüleme',
    descriptionEn: 'Search members, inspect profiles, and review disciplinary history',
  },
  {
    id: 'chat-moderation',
    title: '🛡️ Moderasyon',
    titleEn: '🛡️ Moderation',
    path: '/sohbet/moderasyon',
    icon: 'shield',
    section: 'admin',
    minLevel: 'community_official',
    identities: ['discord'],
    showWhenLoggedIn: true,
    showWhenLoggedOut: false,
    requiresChatEnabled: true,
    badge: 'Sohbet',
    badgeEn: 'Chat',
    badgeClass: 'badge-primary',
    description: 'Sohbet rapor vakaları, yaptırımlar ve denetim kaydı',
    descriptionEn: 'Chat report cases, sanctions, and audit log',
  },
  {
    id: 'admin-reports',
    title: '🛡️ Site Bildirimleri',
    titleEn: '🛡️ Site Reports',
    path: '/yonetim/bildirimler',
    icon: 'shield-alert',
    section: 'admin',
    minLevel: 'yonetmenlik',
    identities: ['discord'],
    showWhenLoggedIn: true,
    showWhenLoggedOut: false,
    badge: 'Yasal',
    badgeEn: 'Legal',
    badgeClass: 'badge-warning',
    description: 'Yasa dışı içerik, Telif/DMCA ve KVKK gizlilik ihlali bildirimleri',
    descriptionEn: 'Illegal content, Copyright/DMCA, and privacy violation reports',
  },
  {
    id: 'admin-servers',
    title: '🌐 Sunucular',
    titleEn: '🌐 Servers',
    path: '/yonetim/sunucular',
    icon: 'globe',
    section: 'admin',
    minLevel: 'developer',
    identities: ['discord'],
    showWhenLoggedIn: true,
    showWhenLoggedOut: false,
    badge: 'Developer',
    badgeEn: 'Developer',
    badgeClass: 'badge-danger',
    description: 'Sunucularımız vitrinindeki Discord davet kartlarını yönet',
    descriptionEn: 'Manage Discord invite cards shown on the Our Servers showcase',
  },
  {
    id: 'admin-kvkk',
    title: '📋 KVKK Başvuruları',
    titleEn: '📋 KVKK Requests',
    path: '/yonetim/kvkk',
    icon: 'shield',
    section: 'admin',
    minLevel: 'developer',
    identities: ['discord'],
    showWhenLoggedIn: true,
    showWhenLoggedOut: false,
    badge: 'Developer',
    badgeEn: 'Developer',
    badgeClass: 'badge-danger',
    description: 'KVKK m.11 başvuruları, 30 günlük süre takibi ve denetim kaydı',
    descriptionEn: 'KVKK Article 11 applications, 30-day deadline tracker, and audit log',
  },
];

/**
 * Kullanıcının mevcut oturum, kimlik türü (discord | google) ve rol bilgilerine göre görebileceği menü öğelerini seçili dilde filtreler.
 * @param {object|null} user - Oturumdaki kullanıcı nesnesi (req.session.user)
 * @param {string} [lang='tr'] - Dil kodu ('tr' | 'en')
 * @returns {Array} Görünür menü öğeleri
 */
function getVisibleMenuItems(user, lang = 'tr') {
  const isLogged = Boolean(user && user.id);
  const identityKind = isLogged ? (user.kind === 'google' ? 'google' : 'discord') : null;
  const isGoogle = identityKind === 'google';
  const userLevel = user?.level || 'none';
  const userRoles = isGoogle ? [] : (user?.roles || []);
  const registered = isLogged && (isGoogle ? true : isRegisteredMember(userRoles, userLevel, user?.registered));
  const management = isLogged && !isGoogle && isManagement(userRoles, userLevel);
  const developer = isLogged && !isGoogle && isDeveloper(userRoles, userLevel);
  const communityOfficial = isLogged && !isGoogle && isCommunityOfficial(userRoles);
  const isEn = lang === 'en';

  const chatEnabled = appConfig.isChatEnabled();
  const chatGoogleEnabled = chatConfig.isChatGoogleMembersEnabled();

  return MENU_ITEMS.filter((item) => {
    if (item.requiresChatEnabled && !chatEnabled) return false;
    if (item.id === 'chat' && isGoogle && !chatGoogleEnabled) return false;
    if (isLogged && !item.showWhenLoggedIn) return false;
    if (!isLogged && !item.showWhenLoggedOut) return false;

    if (isLogged && Array.isArray(item.identities) && !item.identities.includes(identityKind)) {
      return false;
    }

    if (item.hideIfAlreadyRegistered && registered) {
      return false;
    }

    if (item.minLevel === 'public') return true;
    if (!isLogged) return false;

    if (item.minLevel === 'registered') {
      return registered;
    }

    // Yönetim / moderasyon öğeleri SADECE Discord kimliğine açılır
    if (isGoogle) return false;

    if (item.minLevel === 'community_official') {
      return communityOfficial || (chatConfig.isModPanelAlsoDeveloper() && developer);
    }

    if (item.minLevel === 'yonetmenlik') {
      return management;
    }

    if (item.minLevel === 'developer') {
      return developer;
    }

    return hasMinLevel(userLevel, item.minLevel);
  }).map((item) => ({
    ...item,
    title: isEn ? item.titleEn || item.title : item.title,
    badge: isEn ? item.badgeEn || item.badge : item.badge,
    description: isEn ? item.descriptionEn || item.description : item.description,
  }));
}

module.exports = {
  MENU_ITEMS,
  getVisibleMenuItems,
};
