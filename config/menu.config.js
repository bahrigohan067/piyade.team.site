/**
 * menu.config.js - Modüler Menü Yapılandırması
 * 
 * Yeni bir sayfa eklemek için yalnızca aşağıdaki diziye yeni bir nesne
 * eklemek yeterlidir. Sistem otomatik olarak navbar, side menü ve yetki
 * denetimlerini bu yapılandırma üzerinden yürütür.
 */

const { isRegisteredMember, isManagement, isDeveloper } = require('./roles.config');

const MENU_ITEMS = [
  // ==========================================
  // HERKESE AÇIK MENÜLER
  // ==========================================
  {
    id: 'home',
    title: 'Anasayfa',
    path: '/',
    icon: 'house',
    category: 'public',
    minLevel: 'public',
    description: 'Klan tanıtımı ve güncel sunucu durumu',
    visible: () => true,
  },
  {
    id: 'rules',
    title: 'Genel Kurallar',
    path: '/kurallar',
    icon: 'book-bookmark',
    category: 'public',
    minLevel: 'public',
    description: 'M, D ve Y kural maddeleri ve ceza cetveli',
    visible: () => true,
  },
  {
    id: 'interactive',
    title: '🎯 Atış & Gökyüzü',
    path: '/etkilesim',
    icon: 'crosshair',
    category: 'public',
    minLevel: 'public',
    badge: 'Nexus',
    badgeClass: 'badge-primary',
    description: 'Dart rating, meteor gökyüzü ve interaktif efektler',
    visible: () => true,
  },
  {
    id: 'register',
    title: 'Kayıt Ol',
    path: '/kayit',
    icon: 'user-plus',
    category: 'public',
    minLevel: 'public',
    description: 'Roblox doğrulamalı klan kayıt başvurusu',
    // Kayıtlı üyeler için menüde ayrıca gösterilmeye devam edebilir veya durumunu gösterir
    visible: () => true,
  },

  // ==========================================
  // ÜYE MENÜLERİ (Kayıtlı Üye ve Üstü)
  // ==========================================
  {
    id: 'profile',
    title: 'Profilim',
    path: '/profil',
    icon: 'id-card',
    category: 'member',
    minLevel: 'registered',
    description: 'Discord, Roblox, Tryout ve VS istatistiklerim',
    visible: (user) => Boolean(user && isRegisteredMember(user.roles, user.level)),
  },
  {
    id: 'tryout',
    title: 'Tryout Tablosu',
    path: '/tryout',
    icon: 'trophy',
    category: 'member',
    minLevel: 'registered',
    description: '37 aşamalı seviye değerlendirme sıralaması',
    visible: (user) => Boolean(user && isRegisteredMember(user.roles, user.level)),
  },
  {
    id: 'takviye',
    title: 'Acil Takviye',
    path: '/takviye',
    icon: 'shield-halved',
    category: 'member',
    minLevel: 'registered',
    badge: 'Acil',
    badgeClass: 'badge-danger',
    description: 'Oyunda baskın anında tek tıkla klandan yardım çağır',
    visible: (user) => Boolean(user && isRegisteredMember(user.roles, user.level)),
  },

  // ==========================================
  // YÖNETİM MENÜLERİ (Yönetmenlik & Developer)
  // ==========================================
  {
    id: 'admin_warn',
    title: 'Uyarı Ver',
    path: '/yonetim/uyari',
    icon: 'triangle-exclamation',
    category: 'management',
    minLevel: 'management',
    badge: 'Yönetim',
    badgeClass: 'badge-warning',
    description: 'Üyelere sözlü/resmi uyarı uygulama ve kanıt ekleme',
    visible: (user) => Boolean(user && isManagement(user.roles, user.level)),
  },
  {
    id: 'admin_members',
    title: 'Üye Bilgileri',
    path: '/yonetim/uyeler',
    icon: 'users-gear',
    category: 'management',
    minLevel: 'management',
    badge: 'Yönetim',
    badgeClass: 'badge-warning',
    description: 'Üye arama, sicil geçmişi, Roblox ve detaylı kayıt kartları',
    visible: (user) => Boolean(user && isManagement(user.roles, user.level)),
  },
];

/**
 * Kullanıcının yetkisine göre erişebileceği menüleri filtreler
 * @param {object|null} user - Oturumdaki kullanıcı nesnesi
 * @returns {Array<object>}
 */
function getVisibleMenus(user) {
  return MENU_ITEMS.filter((item) => {
    try {
      return item.visible(user);
    } catch {
      return false;
    }
  });
}

/**
 * Menüleri kategorilere ayırarak döndürür
 * @param {object|null} user
 */
function getCategorizedMenus(user) {
  const visible = getVisibleMenus(user);
  return {
    public: visible.filter((m) => m.category === 'public'),
    member: visible.filter((m) => m.category === 'member'),
    management: visible.filter((m) => m.category === 'management'),
  };
}

module.exports = {
  MENU_ITEMS,
  getVisibleMenus,
  getCategorizedMenus,
};
