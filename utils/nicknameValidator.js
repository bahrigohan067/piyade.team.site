const gamesConfig = require('../config/games.config');
const chatAutoFilter = require('../services/chatAutoFilter');

const MENTION_RE = /<@[!&]?\d+>|@everyone|@here|(?:^|\s)@[A-Za-z0-9_.-]{2,}/i;
const DISCORD_INVITE_RE =
  /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/[a-z0-9-]{2,}/i;
const URL_OR_DOMAIN_RE =
  /(?:https?:\/\/\S+|www\.[a-z0-9-]+\.[a-z]{2,}|\b[a-z0-9-]{2,}\.(?:com|net|org|gg|io|me|tv|xyz|co|ly|info|site|app|dev|link|tr|uk|de|fr|ru|tk|ml|ga|cf|gq|pro|online|store|shop|club|live|fun|page|to|in|cc)\b(?:\/\S*)?)/i;

/**
 * Metin içinde harici bağlantı, URL, davet veya çıplak alan adı olup olmadığını kontrol eder.
 * Yeni Google üyelerinin ilk 24 saatlik bağlantı sınırında ve takma ad doğrulamasında kullanılır.
 */
function containsExternalLink(rawText) {
  const text = typeof rawText === 'string' ? rawText.trim() : '';
  if (!text) return false;
  if (DISCORD_INVITE_RE.test(text)) return true;
  if (URL_OR_DOMAIN_RE.test(text)) return true;
  return false;
}

/**
 * Site üyesi takma adını doğrular (2-32 karakter; mention, bağlantı, davet ve küfür/hakaret reddi).
 */
function validateNickname(rawNickname) {
  const clean = gamesConfig.normalizeWhitespace(typeof rawNickname === 'string' ? rawNickname : '');
  if (clean.length < 2 || clean.length > 32) {
    return { ok: false, reason: 'LENGTH', value: clean };
  }
  if (MENTION_RE.test(clean)) {
    return { ok: false, reason: 'MENTION', value: clean };
  }
  if (DISCORD_INVITE_RE.test(clean)) {
    return { ok: false, reason: 'INVITE', value: clean };
  }
  if (containsExternalLink(clean)) {
    return { ok: false, reason: 'LINK', value: clean };
  }
  if (chatAutoFilter.hasProfanity(clean)) {
    return { ok: false, reason: 'PROFANITY', value: clean };
  }
  const scan = chatAutoFilter.scanMessageText(clean);
  if (
    scan.flagged &&
    scan.categories.some((c) => ['profanity', 'threat', 'discord_invite', 'suspicious_link'].includes(c))
  ) {
    return { ok: false, reason: 'PROFANITY', value: clean };
  }
  return { ok: true, value: clean };
}

module.exports = {
  containsExternalLink,
  validateNickname,
};
