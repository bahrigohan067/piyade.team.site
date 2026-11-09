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

const { hasMinLevel, isRegisteredMember, isManagement } = require('./roles.config');

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
    showWhenLoggedIn: true,
    showWhenLoggedOut: true,
    description: 'Piyade Team klan tanıtımı ve aktif üye istatistikleri',
    descriptionEn: 'Piyade Team clan overview and live member statistics',
  },
  {
    id: 'rules',
    title: 'Genel Kurallar',
    titleEn: 'Rules',
    path: '/kurallar',
    icon: 'book',
    section: 'public',
    minLevel: 'public',
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
    showWhenLoggedIn: true,
    showWhenLoggedOut: true,
    hideIfAlreadyRegistered: true,
    description: 'Roblox ve Discord hesabınızı eşleştirerek klana katılın',
    descriptionEn: 'Link your Roblox and Discord accounts to join the clan',
  },

  // ==========================================
  // 2. KAYITLI ÜYE MENÜLERİ (1559604702143062016+)
  // ==========================================
  {
    id: 'profile',
    title: 'Profilim',
    titleEn: 'My Profile',
    path: '/profil',
    icon: 'user',
    section: 'member',
    minLevel: 'registered',
    showWhenLoggedIn: true,
    showWhenLoggedOut: false,
    description: 'Kişisel klan profiliniz, Roblox bilgileriniz ve sicil puanınız',
    descriptionEn: 'Your personal clan profile, Roblox info, and disciplinary record',
  },
  {
    id: 'tryout',
    title: 'Tryout Tablosu',
    titleEn: 'Tryout Leaderboard',
    path: '/tryout',
    icon: 'trophy',
    section: 'member',
    minLevel: 'registered',
    showWhenLoggedIn: true,
    showWhenLoggedOut: false,
    description: '37 kademeli Tryout sıralaması ve oyuncu seviyeleri',
    descriptionEn: '37-tier Tryout rankings and player evaluations',
  },
  {
    id: 'emergency-help',
    title: 'Acil Takviye',
    titleEn: 'Emergency Backup',
    path: '/takviye',
    icon: 'bell',
    section: 'member',
    minLevel: 'registered',
    showWhenLoggedIn: true,
    showWhenLoggedOut: false,
    badge: 'Canlı',
    badgeEn: 'Live',
    badgeClass: 'badge-danger',
    description: 'Oyun içi acil destek ve takviye çağrı sistemi',
    descriptionEn: 'In-game emergency backup and reinforcement call system',
  },

  // ==========================================
  // 3. YÖNETİM MENÜLERİ (Yönetmenlik + Developer)
  // ==========================================
  {
    id: 'admin-warn',
    title: 'Uyarı Ver',
    titleEn: 'Issue Warning',
    path: '/yonetim/uyari',
    icon: 'shield-alert',
    section: 'admin',
    minLevel: 'yonetmenlik',
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
    showWhenLoggedIn: true,
    showWhenLoggedOut: false,
    badge: 'Yönetim',
    badgeEn: 'Staff',
    badgeClass: 'badge-warning',
    description: 'Üye arama, profil detayları ve sicil geçmişi görüntüleme',
    descriptionEn: 'Search members, inspect profiles, and review disciplinary history',
  },
];

/**
 * Kullanıcının mevcut oturum ve rol bilgilerine göre görebileceği menü öğelerini seçili dilde filtreler.
 * @param {object|null} user - Oturumdaki kullanıcı nesnesi (req.session.user)
 * @param {string} [lang='tr'] - Dil kodu ('tr' | 'en')
 * @returns {Array} Görünür menü öğeleri
 */
function getVisibleMenuItems(user, lang = 'tr') {
  const isLogged = Boolean(user && user.id);
  const userLevel = user?.level || 'none';
  const userRoles = user?.roles || [];
  const registered = isLogged && isRegisteredMember(userRoles, userLevel);
  const management = isLogged && isManagement(userRoles, userLevel);
  const isEn = lang === 'en';

  return MENU_ITEMS.filter((item) => {
    if (isLogged && !item.showWhenLoggedIn) return false;
    if (!isLogged && !item.showWhenLoggedOut) return false;

    if (item.hideIfAlreadyRegistered && registered) {
      return false;
    }

    if (item.minLevel === 'public') return true;
    if (!isLogged) return false;

    if (item.minLevel === 'registered') {
      return registered;
    }

    if (item.minLevel === 'yonetmenlik') {
      return management;
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
