const chatConfig = require('../config/chat.config');

/**
 * ==============================================================================
 * 🛡️ YEREL OTOMATİK İŞARETLEYİCİ (HARİCİ SERVİS YOK — MESAJI ASLA ENGELLEMEZ)
 * ==============================================================================
 * - Botun src/utils/profanityFilter.js normalizasyon yaklaşımına uyumludur:
 *   Türkçe karakter katlama, leetspeak çözümleme, tekrar harf sıkıştırma ve
 *   aralıklı harf (o.ç / a m k) birleştirme.
 * - Mesaj içeriğini ASLA konsola veya herhangi bir log dosyasına yazmaz.
 * - Görsel/video içeriklerini taramaz (onlar için kullanıcı rapor yolu vardır).
 * ==============================================================================
 */

const TR_CHAR_MAP = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  İ: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
  â: 'a',
  î: 'i',
  û: 'u',
};

const LEET_MAP = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  '$': 's',
  '!': 'i',
  '|': 'i',
};

// Temel ağır küfür / hakaret kökleri (normalize edilmiş ASCII küçük harf)
const PROFANITY_TERMS = [
  'amk',
  'aq',
  'amq',
  'amina',
  'aminakoy',
  'amcik',
  'orospu',
  'oruspu',
  'pic',
  'siktir',
  'sikeyim',
  'sikerim',
  'sikik',
  'yarrak',
  'yarak',
  'gavat',
  'kahpe',
  'ibne',
  'pezevenk',
  'gotveren',
  'anneni',
  'oc',
  'fuck',
  'fucker',
  'fucking',
  'bitch',
  'motherfucker',
  'asshole',
  'cunt',
  'nigger',
  'faggot',
  'retard',
  'slut',
  'whore',
];

// Şiddet / tehdit / kendine zarar kalıpları (YÜKSEK ÖNCELİK)
const THREAT_PATTERNS = [
  /\b(seni\s+oldur|oldurecegim|oldururum|gebertirim|gebertecegim|kafana\s+sik|evini\s+bas|adresini\s+bul|doxx|doxla)\b/i,
  /\b(kill\s+you|i\s+will\s+kill|murder\s+you|shoot\s+you|bomb\s+you|go\s+die|kill\s+yourself|kys)\b/i,
  /\b(intihar\s+et|kendini\s+oldur|geber\s+git)\b/i,
];

// Discord davet bağlantıları
const DISCORD_INVITE_RE = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/[a-z0-9-]{2,}/i;

// Şüpheli / oltalama / kısaltılmış harici bağlantılar
const SUSPICIOUS_LINK_RE =
  /https?:\/\/(?:(?:bit\.ly|tinyurl\.com|t\.co|cutt\.ly|rb\.gy|grabify\.link|iplogger\.org|2no\.co)\b|(?:[a-z0-9-]+\.)?(?:free-?nitro|free-?robux|steamcommunlty|dlscord|discorcl|roblox-?gift|robux-?free)[a-z0-9.-]*|\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?)/i;

// Kişisel iletişim bilgisi (telefon numarası / e-posta — DÜŞÜK ÖNCELİK)
const EMAIL_RE = /\b[a-z0-9._%+-]{2,}@[a-z0-9.-]{2,}\.[a-z]{2,}\b/i;
const PHONE_RE = /(?:\+?90[\s.-]?|0[\s.-]?)?5\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b|\+\d{1,3}[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/;

function foldTurkish(str) {
  let out = '';
  for (const ch of String(str || '').toLowerCase()) {
    out += TR_CHAR_MAP[ch] || ch;
  }
  return out;
}

function normalizeForProfanity(raw) {
  let s = foldTurkish(raw);
  // Leetspeak dönüştür
  let decoded = '';
  for (const ch of s) {
    decoded += LEET_MAP[ch] || ch;
  }
  // Harf dışı karakterleri boşluğa çevir
  const spaced = decoded.replace(/[^a-z]+/g, ' ').trim();
  // Tekrarlı harfleri (örn. siiiiktir -> siktir) tekilleştir
  const collapsedWords = spaced
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/(.)\1{2,}/g, '$1'));

  // Tek harfli aralıklı yazımları birleştir (örn. "a m k" -> "amk", "s i k t i r" -> "siktir")
  const mergedRuns = [];
  let run = '';
  for (const tok of collapsedWords) {
    if (tok.length === 1) {
      run += tok;
    } else {
      if (run.length >= 2) mergedRuns.push(run);
      run = '';
      mergedRuns.push(tok);
    }
  }
  if (run.length >= 2) mergedRuns.push(run);

  // Ayrıca tüm noktalamalar atılmış düzleştirilmiş kopya (kısa kökler hariç >=4 karakter kökler için)
  const squashed = collapsedWords.join('');

  return {
    words: [...new Set([...collapsedWords, ...mergedRuns])],
    squashed,
    foldedRaw: spaced,
  };
}

function hasProfanity(raw) {
  const { words, squashed } = normalizeForProfanity(raw);
  if (words.length === 0) return false;
  const wordSet = new Set(words);
  for (const term of PROFANITY_TERMS) {
    if (wordSet.has(term)) return true;
    // 5+ karakterlik belirgin küfür kökleri birleşik yazılmışsa (örn: siktirgit, orospucocugu) yakala
    if (term.length >= 5) {
      for (const w of words) {
        if (w.includes(term)) return true;
      }
      if (squashed.includes(term)) return true;
    }
  }
  return false;
}

const PRIORITY_RANK = { low: 1, normal: 2, high: 3, critical: 4 };

/**
 * Mesaj metnini yerel güvenlik kurallarına göre tarar.
 * Mesajı ENGELLEMEZ; yalnızca moderasyon kuyruğu için kategori ve öncelik döndürür.
 */
function scanMessageText(rawText) {
  if (!chatConfig.MODERATION.AUTO_FILTER_ENABLED) {
    return { flagged: false, categories: [], primaryCategory: null, priority: 'normal' };
  }
  const text = typeof rawText === 'string' ? rawText.trim() : '';
  if (!text) {
    return { flagged: false, categories: [], primaryCategory: null, priority: 'normal' };
  }

  const cfg = chatConfig.MODERATION.AUTO_FILTER_CATEGORIES || {};
  const matched = [];

  const checkCat = (catId, condition) => {
    const catCfg = cfg[catId];
    if (!catCfg || catCfg.enabled === false) return;
    if (condition) {
      matched.push({ id: catId, priority: catCfg.priority || 'normal' });
    }
  };

  const folded = foldTurkish(text);
  checkCat('threat', THREAT_PATTERNS.some((re) => re.test(folded)));
  checkCat('profanity', hasProfanity(text));
  checkCat('discord_invite', DISCORD_INVITE_RE.test(text));
  checkCat('suspicious_link', SUSPICIOUS_LINK_RE.test(text));
  checkCat('pii_contact', EMAIL_RE.test(text) || PHONE_RE.test(text));

  if (matched.length === 0) {
    return { flagged: false, categories: [], primaryCategory: null, priority: 'normal' };
  }

  matched.sort((a, b) => (PRIORITY_RANK[b.priority] || 2) - (PRIORITY_RANK[a.priority] || 2));
  return {
    flagged: true,
    categories: matched.map((m) => m.id),
    primaryCategory: matched[0].id,
    priority: matched[0].priority,
  };
}

module.exports = {
  scanMessageText,
  normalizeForProfanity,
  hasProfanity,
};
