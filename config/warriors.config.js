/**
 * Piyade Clan | TSB — "Klanın Zirvesi" (En Güçlü 6 Savaşçı) ve Nexus 3D Carousel Yapılandırması.
 * Sıralama yönetimin seçimidir; kill sayısına göre ASLA otomatik sıralama yapılmaz.
 */

const SEED_WARRIORS = [
  {
    id: 'w01b4e1',
    robloxUsername: 'Bacon_Exe1341',
    kills: 13500,
    order: 1,
    imageMode: 'roblox',
    customImageFile: null,
    robloxUserId: null,
  },
  {
    id: 'w02k9r0',
    robloxUsername: '1000korona',
    kills: 46583,
    order: 2,
    imageMode: 'roblox',
    customImageFile: null,
    robloxUserId: null,
  },
  {
    id: 'w03a2d8',
    robloxUsername: 'anooood20008',
    kills: 25837,
    order: 3,
    imageMode: 'roblox',
    customImageFile: null,
    robloxUserId: null,
  },
  {
    id: 'w04n6s1',
    robloxUsername: 'Ananassuyu61651',
    kills: 7232,
    order: 4,
    imageMode: 'roblox',
    customImageFile: null,
    robloxUserId: null,
  },
  {
    id: 'w05u7r5',
    robloxUsername: 'urasnn',
    kills: 19428,
    order: 5,
    imageMode: 'roblox',
    customImageFile: null,
    robloxUserId: null,
  },
  {
    id: 'w06e9l4',
    robloxUsername: 'eli1047292919',
    kills: 7555,
    order: 6,
    imageMode: 'roblox',
    customImageFile: null,
    robloxUserId: null,
  },
];

// Roblox kullanıcı adı kuralı: 3-20 karakter, harf/rakam/alt çizgi, başta/sonda _ yok, en fazla bir _
const ROBLOX_USERNAME_REGEX = /^(?!_)(?!.*_.*_)(?!.*_$)[A-Za-z0-9_]{3,20}$/;

// Özel yüklenen görseller için rastgele dosya adı kuralı: 32 hex + png|jpg|webp
const CUSTOM_IMAGE_FILENAME_REGEX = /^[a-f0-9]{32}\.(png|jpg|webp)$/;

const LIMITS = {
  minWarriors: 3,
  maxWarriors: 8,
  defaultCount: 6,
  minKills: 0,
  maxKills: 999999999,
  maxCustomImageBytes: 2 * 1024 * 1024, // 2 MB
  robloxTimeoutMs: 5000, // 5 saniye
  robloxCacheTtlMs: 6 * 60 * 60 * 1000, // 6 saat
  robloxFailureBackoffMs: 60 * 1000, // Hata sonrası kısa bekleme
  maxHistoryEntries: 100,
  displayHistoryCount: 20,
  maxSavePerMinute: 10,
};

// Nexus UI 3D Card Carousel bileşeni varsayılan parametreleri
const CAROUSEL_DEFAULTS = {
  itemWidth: 180,
  itemHeight: 236,
  mobileBreakpoint: 640,
  mobileItemWidth: 148,
  mobileItemHeight: 196,
  perspective: 1100,
  radius: null, // null -> kenar kenara otomatik yarıçap
  autoRotate: false,
  autoSpeed: 1,
  scrollSpeed: 1,
  direction: 'cw', // 'cw' | 'ccw'
  autoplay: false,
  enableSound: true,
  showOrderNote: true,
};

module.exports = {
  SEED_WARRIORS,
  ROBLOX_USERNAME_REGEX,
  CUSTOM_IMAGE_FILENAME_REGEX,
  LIMITS,
  CAROUSEL_DEFAULTS,
};
