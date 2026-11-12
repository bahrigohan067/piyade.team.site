const appConfig = require('./app.config');
const brandConfig = require('./brand.config');

/**
 * Piyade Clan | TSB — Merkezi Marka, SEO ve Yapılandırılmış Veri (JSON-LD) Konfigürasyonu.
 * Resmi marka adı, sosyal medya bağlantıları, sayfa bazlı başlık/açıklamalar ve
 * anasayfa SEO tanıtım metni tek bir kaynaktan yönetilir.
 */
const BRAND_NAME = 'Piyade Clan | TSB';
const SHORT_BRAND_NAME = 'Piyade Clan';
const ALTERNATE_NAME = 'Piyade Team';
const CLAN_TAG = '﹝πB1﹞ Piyade Clan | TSB';
const ASSET_VERSION = '1.4.0';

const PUBLIC_ROUTE_PATHS = ['/', '/kurallar', '/kayit', '/etkilesim'];

const PUBLIC_PAGES_SEO = {
  '/': {
    tr: {
      title: 'Piyade Clan | TSB – Roblox The Strongest Battlegrounds Klanı',
      description:
        '﹝πB1﹞ Piyade Clan | TSB, Roblox The Strongest Battlegrounds Türkiye topluluğunun resmi klan portalıdır. 37 kademeli Tryout, turnuva ve aktif kayıt sistemi.',
    },
    en: {
      title: 'Piyade Clan | TSB – Roblox The Strongest Battlegrounds Clan',
      description:
        '﹝πB1﹞ Piyade Clan | TSB is the official Roblox The Strongest Battlegrounds clan portal featuring a 37-tier Tryout ranking system, events, and registration.',
    },
  },
  '/kurallar': {
    tr: {
      title: 'Genel Kurallar ve Disiplin Yönetmeliği | Piyade Clan | TSB',
      description:
        'Piyade Clan | TSB resmi sunucu ve klan kuralları. Katılımcı (M1-M13), düzen (D1-D3) ve yetkili (Y1-Y5) disiplin maddelerini, ceza puanlarını hemen inceleyin.',
    },
    en: {
      title: 'Official Clan Rules & Code of Conduct | Piyade Clan | TSB',
      description:
        'Official Piyade Clan | TSB community rules and disciplinary code. Review participant (M1-M13), order (D1-D3), and staff (Y1-Y5) regulations and penalty points.',
    },
  },
  '/kayit': {
    tr: {
      title: 'Klana Kayıt Ol – Roblox Başvuru Formu | Piyade Clan | TSB',
      description:
        'Piyade Clan | TSB Roblox klanına katılmak için Discord hesabınızla giriş yapın, Roblox profilinizi doğrulayın ve resmi üyelik başvurunuzu anında iletin.',
    },
    en: {
      title: 'Join the Clan – Roblox Registration Form | Piyade Clan | TSB',
      description:
        'Apply to join Piyade Clan | TSB on Roblox The Strongest Battlegrounds. Sign in with Discord, verify your Roblox account, and track your status online now.',
    },
  },
  '/etkilesim': {
    tr: {
      title: 'Atış Poligonu ve İnteraktif Deneyim | Piyade Clan | TSB',
      description:
        'Piyade Clan | TSB üyeleri için özel tasarlanan interaktif Dart Rating nişan poligonu, dilek gökyüzü meteor yağmuru ve klan manifestosu deneyim sayfasıdır.',
    },
    en: {
      title: 'Dart Range & Interactive Clan Experience | Piyade Clan | TSB',
      description:
        'Explore the interactive Piyade Clan | TSB experience page featuring the physics-based Dart Rating target range, falling star night sky, and clan manifesto.',
    },
  },
};

/**
 * Anasayfada sunucu tarafında görünür HTML olarak basılan özgün klan tanıtım metni (185+ kelime).
 * "﹝πB1﹞ Piyade Clan | TSB" etiketi açıklama içinde doğal şekilde yalnızca bir kez geçer.
 */
const HOME_SEO_INTRO = {
  tr: {
    badge: 'Resmi Klan Tanıtımı',
    heading: 'Piyade Clan | TSB Hakkında — Disiplin, Rekabet ve Taktiksel Üstünlük',
    paragraphs: [
      'Piyade Clan | TSB (bilinen diğer adıyla Piyade Team), Roblox platformunun en rekabetçi dövüş ve arena oyunu olan The Strongest Battlegrounds (TSB) oyuncuları için kurulmuş, disiplin ve takım ruhunu merkeze alan resmi bir Türk klan topluluğudur. Oyun içi ve Discord topluluğumuzda ﹝πB1﹞ Piyade Clan | TSB sancağı altında bir araya gelen üyelerimiz, bireysel mekanik yeteneklerini kurumsal bir hiyerarşi ve adil değerlendirme sistemiyle geliştirir.',
      'Klanımızın temelini 37 kademeli resmi Tryout derecelendirme sistemi oluşturur. Low Weak seviyesinden başlayarak Mid ve High Strong kademelerine kadar uzanan bu yapı sayesinde her oyuncunun kombo hakimiyeti, refleks hızı, oyun okuma becerisi ve düello performansı deneyimli gözetmenler tarafından şeffaf biçimde ölçülür. Düzenli olarak gerçekleştirilen klan içi VS turnuvaları, taktiksel antrenman lobileri ve puanlı liderlik sıralamaları sayesinde üyelerimiz her hafta kendilerini üst kademelere taşıma fırsatı bulur.',
      'Sadece oyun içi başarıyla yetinmeyen Piyade Clan | TSB, üyelerinin güvenliğini ve huzurunu korumak adına otomatikleşmiş 5 dakikalık Acil Takviye çağrı sistemine ve adil bir disiplin yönetmeliğine sahiptir. Herhangi bir oyun sunucusunda haksız takım (teaming) veya toksik saldırıyla karşılaşan kayıtlı üyelerimiz, web portalımız üzerinden tek tıkla destek çağrısı oluşturarak aktif klan arkadaşlarını anında yanına çağırabilir. Siz de Discord hesabınızla giriş yapıp Roblox profilinizi doğrulayarak bu seçkin kadroda yerinizi alabilirsiniz.',
    ],
  },
  en: {
    badge: 'Official Clan Overview',
    heading: 'About Piyade Clan | TSB — Discipline, Competition, and Tactical Excellence',
    paragraphs: [
      'Piyade Clan | TSB (also known as Piyade Team) is an official competitive gaming clan and community built for dedicated players of Roblox The Strongest Battlegrounds (TSB). Uniting skilled fighters under the ﹝πB1﹞ Piyade Clan | TSB banner, our organization combines mechanical mastery with structured hierarchy, transparent progression, and unwavering camaraderie.',
      'At the core of our competitive structure lies our official 37-tier Tryout ranking system. Ranging from Low Weak tiers all the way up to elite High Strong ranks, every member is evaluated by certified instructors on combo execution, movement precision, reaction speed, and 1v1 duel consistency. Weekly internal VS tournaments, sparring lobbies, and tracked win/loss leaderboards ensure that dedicated players always have a clear path to climb the ranks.',
      'Beyond individual skill, Piyade Clan | TSB protects its members through a real-time Emergency Backup dispatch system and a clear Code of Conduct. Whenever a verified clan member faces unfair teaming in public servers, a single click on our web portal alerts online teammates on Discord to join the server immediately. Sign in with Discord and verify your Roblox profile today to apply for membership.',
    ],
  },
};

function getBaseUrl() {
  return (process.env.BASE_URL || appConfig.BASE_URL || 'http://localhost:3001').trim().replace(/\/+$/, '');
}

function getGoogleSiteVerification() {
  return (process.env.GOOGLE_SITE_VERIFICATION || appConfig.GOOGLE_SITE_VERIFICATION || '').trim();
}

/**
 * JSON-LD "sameAs" alanı için doğrulanmış sosyal medya / topluluk linklerini döndürür.
 * Tanımlı değilse boş dizi döner (sahte link basılmaz).
 */
function getSocialLinks() {
  const candidates = [
    process.env.DISCORD_INVITE_URL,
    process.env.ROBLOX_GROUP_URL,
    process.env.YOUTUBE_URL,
    process.env.TIKTOK_URL,
  ];
  return candidates
    .map((u) => (typeof u === 'string' ? u.trim() : ''))
    .filter((u) => /^https?:\/\/\S+/i.test(u));
}

function normalizeRoutePath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return '/';
  const withoutQuery = rawPath.split('?')[0].trim();
  const stripped = withoutQuery.replace(/^\/(tr|en)(?=\/|$)/i, '') || '/';
  const cleaned = stripped.length > 1 ? stripped.replace(/\/+$/, '') : '/';
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
}

function isPublicIndexablePath(routePath) {
  const normalized = normalizeRoutePath(routePath);
  return PUBLIC_ROUTE_PATHS.includes(normalized);
}

function buildAlternateUrls(baseUrl, normalizedPath) {
  const suffix = normalizedPath === '/' ? '' : normalizedPath;
  return {
    tr: `${baseUrl}/tr${suffix}`,
    en: `${baseUrl}/en${suffix}`,
    xDefault: `${baseUrl}${normalizedPath}`,
  };
}

/**
 * Her istek için sayfa başlığı, meta açıklama, canonical, hreflang, Open Graph ve
 * JSON-LD verilerini üretir.
 */
function buildPageSeo(req, overrides = {}) {
  const baseUrl = getBaseUrl();
  const lang = (overrides.lang || (req && req.lang) || 'tr') === 'en' ? 'en' : 'tr';
  const normalizedPath = normalizeRoutePath(overrides.routePath || (req && req.canonicalRoutePath) || (req && req.path) || '/');
  const isPublic = overrides.isPublic !== undefined ? Boolean(overrides.isPublic) : isPublicIndexablePath(normalizedPath);
  const noindex = overrides.noindex !== undefined ? Boolean(overrides.noindex) : !isPublic;

  const pageMetaGroup = PUBLIC_PAGES_SEO[normalizedPath] || PUBLIC_PAGES_SEO['/'];
  const localizedMeta = pageMetaGroup[lang] || pageMetaGroup.tr;

  const title = overrides.title || localizedMeta.title || BRAND_NAME;
  const description = overrides.description || localizedMeta.description;

  const alternateUrls = buildAlternateUrls(baseUrl, normalizedPath);
  const langPrefixUsed = req && req.langPrefix ? req.langPrefix : null;

  let canonicalUrl = alternateUrls.xDefault;
  if (lang === 'en') {
    canonicalUrl = alternateUrls.en;
  } else if (langPrefixUsed === 'tr') {
    canonicalUrl = alternateUrls.tr;
  }

  return {
    brandName: BRAND_NAME,
    shortBrandName: SHORT_BRAND_NAME,
    alternateName: ALTERNATE_NAME,
    clanTag: CLAN_TAG,
    assetVersion: ASSET_VERSION,
    baseUrl,
    normalizedPath,
    htmlLang: lang,
    title,
    description,
    canonicalUrl,
    alternateUrls,
    ogType: 'website',
    ogLocale: lang === 'en' ? 'en_US' : 'tr_TR',
    ogLocaleAlternate: lang === 'en' ? 'tr_TR' : 'en_US',
    ogImageUrl: `${baseUrl}${brandConfig.ASSETS.ogImage}`,
    logoUrl: `${baseUrl}${brandConfig.ASSETS.icon512}`,
    noindex,
    isPublic: isPublic && !noindex,
    googleSiteVerification: getGoogleSiteVerification(),
    sameAs: getSocialLinks(),
    homeSeoIntro: HOME_SEO_INTRO[lang] || HOME_SEO_INTRO.tr,
  };
}

module.exports = {
  BRAND_NAME,
  SHORT_BRAND_NAME,
  ALTERNATE_NAME,
  CLAN_TAG,
  ASSET_VERSION,
  PUBLIC_ROUTE_PATHS,
  PUBLIC_PAGES_SEO,
  HOME_SEO_INTRO,
  getBaseUrl,
  getGoogleSiteVerification,
  getSocialLinks,
  normalizeRoutePath,
  isPublicIndexablePath,
  buildAlternateUrls,
  buildPageSeo,
};
