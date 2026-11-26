/**
 * Sohbet (Chat) Merkezi Yapılandırma ve Profil Halkası Palet Verileri
 * Not: Halka palet renkleri (RING_PRESETS) veri olarak yalnızca bu dosyada tanımlanır;
 * arayüzün geri kalan tüm renkleri public/css/theme.css değişkenlerinden gelir.
 */

const POLICY_VERSION = '3.0';
const RETENTION_DAYS = 30;

const LIMITS = Object.freeze({
  MAX_MESSAGE_LENGTH: 4000,
  MAX_MESSAGES_PER_MIN: 30,
  MAX_GROUP_MESSAGES_PER_MIN: 12,
  GROUP_DUPLICATE_WINDOW_MS: 15 * 1000,
  MAX_NEW_CONVERSATIONS_PER_DAY: 10,
  MAX_SSE_CONNECTIONS_PER_USER: 5,
  SSE_HEARTBEAT_MS: 25 * 1000,
  DIRECTORY_CACHE_TTL_MS: 60 * 1000,
  PROFILE_CARD_CACHE_TTL_MS: 60 * 1000,
  ROBLOX_AVATAR_REFRESH_MS: 6 * 60 * 60 * 1000,
  MAX_ANIMATED_DIRECTORY_RINGS: 12,
  DEFAULT_PAGE_LIMIT: 40,
  MAX_PAGE_LIMIT: 100,
  MAX_MEMORY_MESSAGES_PER_CONV: 120,
  MAX_REPORT_NOTE_LENGTH: 500,
  MAX_REPORTS_PER_DAY: 10,
  TYPING_THROTTLE_MS: 3000,
});

// Zorunlu ortak sohbet grupları (listede en üstte sabit, ayrılamaz)
const GROUPS = Object.freeze([
  Object.freeze({
    id: 'genel',
    icon: '🌐',
    name: Object.freeze({
      tr: 'Genel Sohbet',
      en: 'General Chat',
    }),
    description: Object.freeze({
      tr: 'Tüm kayıtlı Discord ve site üyelerinin ortak sohbet odası. Burada yazılanlar sohbete erişimi olan herkese görünür.',
      en: 'Shared chat room for all registered Discord and site members. Messages here are visible to everyone with chat access.',
    }),
    allowAttachments: true,
  }),
]);

const DEFAULT_GROUP_ID = 'genel';
const GROUP_MAP = new Map(GROUPS.map((g) => [g.id, g]));

function getGroupById(groupId) {
  if (typeof groupId !== 'string') return null;
  return GROUP_MAP.get(groupId.trim().toLowerCase()) || null;
}

function makeGroupConvId(groupId) {
  const grp = getGroupById(groupId);
  return grp ? `group:${grp.id}` : null;
}

function parseGroupConvId(convId) {
  if (typeof convId !== 'string') return null;
  const trimmed = convId.trim();
  if (!trimmed.startsWith('group:')) return null;
  const rawId = trimmed.slice('group:'.length);
  const grp = getGroupById(rawId);
  return grp ? grp.id : null;
}

function isGroupConvId(convId) {
  return Boolean(parseGroupConvId(convId));
}

// Parça 3 (Dosya Gönderme) sınırları ve yapılandırması
const FILES = Object.freeze({
  MAX_FILES_PER_MESSAGE: 5,
  MAX_UPLOADS_PER_MIN: 10,
  DAILY_QUOTA_BYTES: 200 * 1024 * 1024, // 200 MB / kullanıcı / gün
  MAX_IMAGE_BYTES: 8 * 1024 * 1024,     // 8 MB (png/jpg/webp/gif)
  MAX_PDF_BYTES: 10 * 1024 * 1024,      // 10 MB (pdf)
  MAX_TXT_BYTES: 1 * 1024 * 1024,       // 1 MB (txt)
  MAX_VIDEO_BYTES: 50 * 1024 * 1024,    // 50 MB (mp4/webm)
  MAX_FILENAME_LENGTH: 80,
  DISK_USAGE_THRESHOLD: 0.9,            // %90 dolulukta yeni yüklemeleri reddet
  TMP_TTL_MS: 60 * 60 * 1000,           // Yarım kalan tmp dosyaları 1 saatte temizlenir
});

// Parça 4 (Moderasyon ve Güvenlik) yapılandırması
const MODERATION = Object.freeze({
  REPORT_CONTEXT_MESSAGES: 30,
  AUTOFLAG_CONTEXT_RADIUS: 5,
  CASE_REVIEW_LOCK_MS: 10 * 60 * 1000,          // 10 dk inceleme kilidi
  CLOSED_CASE_RETENTION_DAYS: 7,                // Kapanan vaka kanıtı en geç 7 günde silinir
  OPEN_CASE_MAX_DAYS: 90,                       // Açık vaka en çok 90 gün tutulur
  SANCTION_RETENTION_DAYS: 365,                 // Yaptırım kaydı (içeriksiz) 1 yıl
  MODLOG_RETENTION_DAYS: 365,                   // Denetim kaydı (içeriksiz) 1 yıl
  HIGH_VOLUME_VIEWS_PER_HOUR: 30,               // 1 saatte 30+ vaka açma -> yoğun erişim işareti
  AUTO_FILTER_ENABLED: true,
  AUTO_FILTER_CATEGORIES: Object.freeze({
    profanity: { enabled: true, priority: 'normal' },
    threat: { enabled: true, priority: 'high' },
    discord_invite: { enabled: true, priority: 'normal' },
    suspicious_link: { enabled: true, priority: 'normal' },
    pii_contact: { enabled: true, priority: 'low' },
  }),
});

function isChatEnabled(envObj = process.env) {
  const raw = String(envObj && envObj.CHAT_ENABLED !== undefined ? envObj.CHAT_ENABLED : '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function isChatGoogleMembersEnabled(envObj = process.env) {
  const raw = String(
    envObj && envObj.CHAT_GOOGLE_MEMBERS_ENABLED !== undefined ? envObj.CHAT_GOOGLE_MEMBERS_ENABLED : ''
  )
    .trim()
    .toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  return true;
}

/**
 * Ortam değişkeninden (CHAT_GROUP_ADMIN_DISCORD_IDS) grup yöneticisi Discord ID listesini okur.
 * Hiçbir Discord kimliği kod içine sabit yazılmaz.
 */
function getChatGroupAdminDiscordIds(envObj = process.env) {
  const raw = String(
    envObj && envObj.CHAT_GROUP_ADMIN_DISCORD_IDS !== undefined ? envObj.CHAT_GROUP_ADMIN_DISCORD_IDS : ''
  ).trim();
  const ids = new Set();
  if (!raw) return ids;
  for (const part of raw.split(',')) {
    const clean = part.trim();
    if (/^\d{15,25}$/.test(clean)) {
      ids.add(clean);
    }
  }
  return ids;
}

/**
 * Bir kullanıcının Discord kimliği grup yöneticisi listesinde mi kontrol eder (rozet gösterimi için).
 */
function isDiscordIdGroupAdmin(userId, envObj = process.env) {
  const clean = String(userId || '').trim();
  if (!/^\d{15,25}$/.test(clean)) return false;
  return getChatGroupAdminDiscordIds(envObj).has(clean);
}

/**
 * Aktif oturumun grup yöneticisi olup olmadığını YALNIZCA Discord oturumu ve Discord ID ile doğrular.
 * Google oturumları veya kullanıcı adı eşleşmesi ASLA grup yöneticisi sayılmaz.
 */
function isChatGroupAdmin(req, envObj = process.env) {
  if (!req || !req.session || !req.session.user) return false;
  if (req.session.identity && req.session.identity.kind === 'google') return false;
  if (req.session.user.kind === 'google') return false;
  const uid = String(req.session.user.id || '').trim();
  if (!/^\d{15,25}$/.test(uid)) return false;
  if (req.session.identity && req.session.identity.kind === 'discord') {
    const identId = String(req.session.identity.discordId || '').trim();
    if (identId && identId !== uid) return false;
  }
  return getChatGroupAdminDiscordIds(envObj).has(uid);
}

function isModPanelAlsoDeveloper(envObj = process.env) {
  const raw = String(
    envObj && envObj.MOD_PANEL_ALSO_DEVELOPER !== undefined ? envObj.MOD_PANEL_ALSO_DEVELOPER : ''
  )
    .trim()
    .toLowerCase();
  return raw === 'true' || raw === '1';
}

// ============================================================================
// PROFİL HALKASI KATEGORİLERİ VE 40 HAZIR PALET (VERİ)
// ============================================================================

const RING_CATEGORIES = Object.freeze([
  { id: 'classic', name: { tr: 'Klasik', en: 'Classic' } },
  { id: 'neon', name: { tr: 'Neon', en: 'Neon' } },
  { id: 'sunset', name: { tr: 'Gün Batımı', en: 'Sunset' } },
  { id: 'galaxy', name: { tr: 'Galaksi', en: 'Galaxy' } },
  { id: 'metal', name: { tr: 'Metal', en: 'Metallic' } },
  { id: 'nature', name: { tr: 'Doğa', en: 'Nature' } },
  { id: 'element', name: { tr: 'Buz & Ateş', en: 'Ice & Fire' } },
  { id: 'pastel', name: { tr: 'Pastel', en: 'Pastel' } },
  { id: 'rainbow', name: { tr: 'Gökkuşağı', en: 'Rainbow' } },
  { id: 'gaming', name: { tr: 'Oyun', en: 'Gaming' } },
  { id: 'animated', name: { tr: 'Animasyonlu', en: 'Animated' } },
]);

const DEFAULT_RING_ID = 'classic-google';

const RING_PRESETS = Object.freeze([
  // 1. KLASİK (5)
  {
    id: 'classic-google',
    category: 'classic',
    type: 'static',
    name: { tr: 'Dört Renk Pro', en: 'Four-Color Pro' },
    colors: ['#4285F4', '#EA4335', '#FBBC05', '#34A853'],
  },
  {
    id: 'classic-obsidian-violet',
    category: 'classic',
    type: 'static',
    name: { tr: 'Obsidyen Mor', en: 'Obsidian Violet' },
    colors: ['#8B5CF6', '#A855F7', '#3B82F6'],
  },
  {
    id: 'classic-royal-blue',
    category: 'classic',
    type: 'static',
    name: { tr: 'Kraliyet Mavisi', en: 'Royal Blue' },
    colors: ['#1D4ED8', '#3B82F6', '#38BDF8'],
  },
  {
    id: 'classic-crimson-gold',
    category: 'classic',
    type: 'static',
    name: { tr: 'Kızıl Altın', en: 'Crimson Gold' },
    colors: ['#DC2626', '#F59E0B', '#B91C1C'],
  },
  {
    id: 'classic-monochrome',
    category: 'classic',
    type: 'static',
    name: { tr: 'Monokrom', en: 'Monochrome' },
    colors: ['#F8FAFC', '#94A3B8', '#475569'],
  },

  // 2. NEON (5)
  {
    id: 'neon-cyber-pink',
    category: 'neon',
    type: 'static',
    name: { tr: 'Siber Pembe', en: 'Cyber Pink' },
    colors: ['#FF007F', '#D946EF', '#00F5FF'],
  },
  {
    id: 'neon-electric-cyan',
    category: 'neon',
    type: 'static',
    name: { tr: 'Elektrik Camgöbeği', en: 'Electric Cyan' },
    colors: ['#00F5FF', '#06B6D4', '#3B82F6'],
  },
  {
    id: 'neon-acid-lime',
    category: 'neon',
    type: 'static',
    name: { tr: 'Asit Limon', en: 'Acid Lime' },
    colors: ['#A3E635', '#22C55E', '#10B981'],
  },
  {
    id: 'neon-synthwave',
    category: 'neon',
    type: 'static',
    name: { tr: 'Synthwave', en: 'Synthwave' },
    colors: ['#F43F5E', '#C026D3', '#6366F1', '#22D3EE'],
  },
  {
    id: 'neon-laser-violet',
    category: 'neon',
    type: 'static',
    name: { tr: 'Lazer Mor', en: 'Laser Violet' },
    colors: ['#A855F7', '#EC4899', '#6366F1'],
  },

  // 3. GÜN BATIMI (4)
  {
    id: 'sunset-miami',
    category: 'sunset',
    type: 'static',
    name: { tr: 'Akşam Kızılı', en: 'Miami Dusk' },
    colors: ['#FF512F', '#F09819', '#DD2476'],
  },
  {
    id: 'sunset-sahara',
    category: 'sunset',
    type: 'static',
    name: { tr: 'Sahra Altını', en: 'Saharan Gold' },
    colors: ['#F59E0B', '#EA580C', '#FDE047'],
  },
  {
    id: 'sunset-peach',
    category: 'sunset',
    type: 'static',
    name: { tr: 'Şeftali Mercan', en: 'Peach Coral' },
    colors: ['#FB7185', '#FDBA74', '#F43F5E'],
  },
  {
    id: 'sunset-twilight',
    category: 'sunset',
    type: 'static',
    name: { tr: 'Alacakaranlık', en: 'Twilight Rose' },
    colors: ['#7C3AED', '#DB2777', '#F97316'],
  },

  // 4. GALAKSİ / AURORA (4)
  {
    id: 'galaxy-aurora',
    category: 'galaxy',
    type: 'static',
    name: { tr: 'Kuzey Işıkları', en: 'Aurora Borealis' },
    colors: ['#2DD4BF', '#38BDF8', '#818CF8', '#C084FC'],
  },
  {
    id: 'galaxy-nebula',
    category: 'galaxy',
    type: 'static',
    name: { tr: 'Derin Nebula', en: 'Deep Nebula' },
    colors: ['#4C1D95', '#9333EA', '#EC4899', '#3B82F6'],
  },
  {
    id: 'galaxy-cosmic',
    category: 'galaxy',
    type: 'static',
    name: { tr: 'Kozmik Toz', en: 'Cosmic Dust' },
    colors: ['#312E81', '#6366F1', '#A78BFA', '#F472B6'],
  },
  {
    id: 'galaxy-starlight',
    category: 'galaxy',
    type: 'static',
    name: { tr: 'Yıldız Işığı', en: 'Starlight' },
    colors: ['#0EA5E9', '#6366F1', '#E0E7FF'],
  },

  // 5. METAL (4)
  {
    id: 'metal-gold',
    category: 'metal',
    type: 'static',
    name: { tr: '24 Ayar Altın', en: '24K Gold' },
    colors: ['#FDE68A', '#F59E0B', '#B45309', '#FEF3C7'],
  },
  {
    id: 'metal-silver',
    category: 'metal',
    type: 'static',
    name: { tr: 'Parlak Gümüş', en: 'Polished Silver' },
    colors: ['#F8FAFC', '#CBD5E1', '#64748B', '#E2E8F0'],
  },
  {
    id: 'metal-bronze',
    category: 'metal',
    type: 'static',
    name: { tr: 'Antik Bronz', en: 'Antique Bronze' },
    colors: ['#FED7AA', '#C2410C', '#7C2D12', '#FDBA74'],
  },
  {
    id: 'metal-rose-gold',
    category: 'metal',
    type: 'static',
    name: { tr: 'Pembe Altın', en: 'Rose Gold' },
    colors: ['#FBCFE8', '#F472B6', '#BE185D', '#FCE7F3'],
  },

  // 6. DOĞA (3)
  {
    id: 'nature-emerald',
    category: 'nature',
    type: 'static',
    name: { tr: 'Zümrüt Orman', en: 'Emerald Forest' },
    colors: ['#059669', '#10B981', '#34D399', '#065F46'],
  },
  {
    id: 'nature-ocean',
    category: 'nature',
    type: 'static',
    name: { tr: 'Derin Okyanus', en: 'Deep Ocean' },
    colors: ['#0369A1', '#06B6D4', '#22D3EE', '#1E3A8A'],
  },
  {
    id: 'nature-sakura',
    category: 'nature',
    type: 'static',
    name: { tr: 'Kiraz Çiçeği', en: 'Sakura Bloom' },
    colors: ['#FDA4AF', '#F472B6', '#FDE68A', '#FB7185'],
  },

  // 7. BUZ / ATEŞ (4)
  {
    id: 'element-glacier',
    category: 'element',
    type: 'static',
    name: { tr: 'Buzul Kristali', en: 'Glacier Frost' },
    colors: ['#E0F2FE', '#38BDF8', '#0284C7', '#BAE6FD'],
  },
  {
    id: 'element-magma',
    category: 'element',
    type: 'static',
    name: { tr: 'Volkanik Lav', en: 'Volcanic Magma' },
    colors: ['#EF4444', '#F97316', '#FACC15', '#991B1B'],
  },
  {
    id: 'element-ice-fire',
    category: 'element',
    type: 'static',
    name: { tr: 'Buz ve Ateş', en: 'Ice & Fire' },
    colors: ['#38BDF8', '#0284C7', '#F97316', '#EF4444'],
  },
  {
    id: 'element-plasma',
    category: 'element',
    type: 'static',
    name: { tr: 'Plazma Alevi', en: 'Plasma Flame' },
    colors: ['#F43F5E', '#A855F7', '#38BDF8'],
  },

  // 8. PASTEL (3)
  {
    id: 'pastel-cotton',
    category: 'pastel',
    type: 'static',
    name: { tr: 'Pamuk Şeker', en: 'Cotton Candy' },
    colors: ['#F9A8D4', '#C4B5FD', '#93C5FD'],
  },
  {
    id: 'pastel-mint',
    category: 'pastel',
    type: 'static',
    name: { tr: 'Nane Ferahlığı', en: 'Mint Sorbet' },
    colors: ['#6EE7B7', '#67E8F9', '#A5B4FC'],
  },
  {
    id: 'pastel-sherbet',
    category: 'pastel',
    type: 'static',
    name: { tr: 'Pastel Şerbet', en: 'Sunset Sherbet' },
    colors: ['#FDE68A', '#FDBA74', '#FDA4AF', '#DDD6FE'],
  },

  // 9. GÖKKUŞAĞI (2)
  {
    id: 'rainbow-spectrum',
    category: 'rainbow',
    type: 'static',
    name: { tr: 'Tam Spektrum', en: 'Full Spectrum' },
    colors: ['#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#A855F7'],
  },
  {
    id: 'rainbow-prism',
    category: 'rainbow',
    type: 'static',
    name: { tr: 'Prizma Işığı', en: 'Prism Light' },
    colors: ['#F472B6', '#FBBF24', '#34D399', '#60A5FA', '#C084FC'],
  },

  // 10. OYUN TEMALI DÜZ DEGRADELER (4 — marka logosu yok, yalnızca renk hissi)
  {
    id: 'gaming-blocky',
    category: 'gaming',
    type: 'static',
    name: { tr: 'Blok Kırmızısı', en: 'Block Crimson' },
    colors: ['#E11D48', '#F43F5E', '#94A3B8', '#1E293B'],
  },
  {
    id: 'gaming-overworld',
    category: 'gaming',
    type: 'static',
    name: { tr: 'Piksel Zümrüt', en: 'Overworld Emerald' },
    colors: ['#22C55E', '#16A34A', '#92400E', '#4ADE80'],
  },
  {
    id: 'gaming-tactical',
    category: 'gaming',
    type: 'static',
    name: { tr: 'Taktik Kehribar', en: 'Tactical Amber' },
    colors: ['#F59E0B', '#D97706', '#334155', '#38BDF8'],
  },
  {
    id: 'gaming-desert',
    category: 'gaming',
    type: 'static',
    name: { tr: 'Çöl Operasyonu', en: 'Desert Ops' },
    colors: ['#CA8A04', '#65A30D', '#B45309', '#FACC15'],
  },

  // 11. ANİMASYONLU (6 — spin & pulse)
  {
    id: 'anim-google-spin',
    category: 'animated',
    type: 'spin',
    name: { tr: 'Dönen Pro Halka', en: 'Spinning Pro Ring' },
    colors: ['#4285F4', '#EA4335', '#FBBC05', '#34A853'],
  },
  {
    id: 'anim-aurora-spin',
    category: 'animated',
    type: 'spin',
    name: { tr: 'Dönen Aurora', en: 'Orbital Aurora' },
    colors: ['#2DD4BF', '#38BDF8', '#A855F7', '#EC4899'],
  },
  {
    id: 'anim-rainbow-spin',
    category: 'animated',
    type: 'spin',
    name: { tr: 'Dönen Gökkuşağı', en: 'Hyper Rainbow Spin' },
    colors: ['#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#A855F7'],
  },
  {
    id: 'anim-cyber-pulse',
    category: 'animated',
    type: 'pulse',
    name: { tr: 'Siber Nabız', en: 'Cyber Pulse' },
    colors: ['#D946EF', '#8B5CF6', '#06B6D4'],
  },
  {
    id: 'anim-solar-pulse',
    category: 'animated',
    type: 'pulse',
    name: { tr: 'Güneş Nabzı', en: 'Solar Pulse' },
    colors: ['#F59E0B', '#EF4444', '#EC4899'],
  },
  {
    id: 'anim-chrome-spin',
    category: 'animated',
    type: 'spin',
    name: { tr: 'Sıvı Krom', en: 'Liquid Chrome Spin' },
    colors: ['#F8FAFC', '#94A3B8', '#38BDF8', '#C084FC'],
  },
]);

const RING_PRESET_MAP = new Map(RING_PRESETS.map((p) => [p.id, p]));
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function isValidHexColor(val) {
  return typeof val === 'string' && HEX_COLOR_RE.test(val.trim());
}

function getRingPresetById(id) {
  if (typeof id !== 'string') return null;
  return RING_PRESET_MAP.get(id.trim()) || null;
}

/**
 * Kullanıcıdan gelen halka seçimini sunucu tarafında sıkı biçimde doğrular.
 * CSS enjeksiyonunu önlemek için yalnızca 6 haneli #RRGGBB hex değerlerine veya kayıtlı preset ID'lerine izin verir.
 */
function validateRingSelection({ ringId, ring } = {}) {
  if (ringId === 'custom' || (ring && typeof ring === 'object' && (!ringId || ringId === 'custom'))) {
    const rawColors = Array.isArray(ring?.colors) ? ring.colors : [];
    if (rawColors.length < 2 || rawColors.length > 4) {
      return { valid: false, error: 'Özel halka için 2 ile 4 arasında renk seçmelisiniz.' };
    }
    const cleanColors = [];
    for (const c of rawColors) {
      if (!isValidHexColor(c)) {
        return { valid: false, error: 'Geçersiz renk kodu. Yalnızca #RRGGBB biçimi kabul edilir.' };
      }
      cleanColors.push(c.trim().toUpperCase());
    }
    const animated = ring?.type === 'spin' || ring?.spin === true;
    return {
      valid: true,
      ringId: 'custom',
      ring: {
        type: animated ? 'spin' : 'static',
        colors: cleanColors,
      },
    };
  }

  const preset = getRingPresetById(ringId);
  if (!preset) {
    return { valid: false, error: 'Geçersiz profil halkası seçimi.' };
  }
  return {
    valid: true,
    ringId: preset.id,
    ring: null,
  };
}

/**
 * Bir profil kaydından istemcide çizilecek güvenli halka nesnesini üretir.
 */
function resolveEffectiveRing(profile) {
  if (profile && profile.ringId === 'custom' && profile.ring && Array.isArray(profile.ring.colors)) {
    const validColors = profile.ring.colors.filter(isValidHexColor).slice(0, 4);
    if (validColors.length >= 2) {
      return {
        id: 'custom',
        type: profile.ring.type === 'spin' ? 'spin' : 'static',
        colors: validColors,
      };
    }
  }
  const preset = getRingPresetById(profile?.ringId) || RING_PRESET_MAP.get(DEFAULT_RING_ID);
  return {
    id: preset.id,
    type: preset.type,
    colors: [...preset.colors],
  };
}

/**
 * Nebula Glass Card için üyenin kendi profil halkasından 3 nebula rengi türetir.
 * Halka 3'ten az renk içeriyorsa (veya tek renkliyse) verilen tema yedek renkleriyle tamamlar.
 */
function extractNebulaHuesFromRing(ring, fallbackHues = null) {
  const defaults =
    Array.isArray(fallbackHues) && fallbackHues.length >= 3
      ? fallbackHues.slice(0, 3)
      : ['var(--color-accent)', 'var(--color-primary)', 'var(--dart-bullseye-start)'];

  const rawColors = ring && Array.isArray(ring.colors) ? ring.colors : [];
  const picked = [];
  for (const c of rawColors) {
    if (isValidHexColor(c)) {
      const norm = c.trim().toUpperCase();
      if (!picked.includes(norm)) {
        picked.push(norm);
        if (picked.length === 3) break;
      }
    }
  }
  let fbIdx = 0;
  while (picked.length < 3) {
    picked.push(defaults[fbIdx % defaults.length]);
    fbIdx += 1;
  }
  return picked;
}

module.exports = {
  POLICY_VERSION,
  RETENTION_DAYS,
  LIMITS,
  FILES,
  MODERATION,
  GROUPS,
  DEFAULT_GROUP_ID,
  RING_CATEGORIES,
  RING_PRESETS,
  DEFAULT_RING_ID,
  getGroupById,
  makeGroupConvId,
  parseGroupConvId,
  isGroupConvId,
  isChatEnabled,
  isChatGoogleMembersEnabled,
  getChatGroupAdminDiscordIds,
  isDiscordIdGroupAdmin,
  isChatGroupAdmin,
  isModPanelAlsoDeveloper,
  isValidHexColor,
  getRingPresetById,
  validateRingSelection,
  resolveEffectiveRing,
  extractNebulaHuesFromRing,
};
