/**
 * Oyun kayıt yapılandırması ve yedek (fallback) oyun listesi.
 * Birincil kaynak Bot API (GET /api/games) yanıtıdır; bot erişilemezse
 * veya uyumlu yanıt dönmezse buradaki 4 oyunlu liste kullanılır.
 */

const MAX_REGISTRATION_GAMES = 4;

function resolveGameRoleId(envKey, envObj = process.env) {
  const raw = envObj && typeof envObj[envKey] === 'string' ? envObj[envKey].trim() : '';
  return raw || null;
}

function normalizeWhitespace(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeLocalizedPair(input, fallbackPair) {
  if (typeof input === 'string' && input.trim()) {
    const clean = input.trim();
    return { tr: clean, en: clean };
  }
  const src = input && typeof input === 'object' ? input : {};
  const fb = fallbackPair && typeof fallbackPair === 'object' ? fallbackPair : { tr: '', en: '' };
  const tr = typeof src.tr === 'string' && src.tr.trim() ? src.tr.trim() : (fb.tr || '');
  const en = typeof src.en === 'string' && src.en.trim() ? src.en.trim() : (fb.en || tr || '');
  return { tr, en };
}

function sanitizeRegexString(rawRegex, fallbackRegex = null) {
  if (rawRegex === null || rawRegex === undefined || rawRegex === '') {
    return fallbackRegex || null;
  }
  if (typeof rawRegex !== 'string' || rawRegex.length > 200) {
    return fallbackRegex || null;
  }
  try {
    // Sadece geçerli düzenli ifade sözdizimini kabul et
    new RegExp(rawRegex);
    return rawRegex;
  } catch {
    return fallbackRegex || null;
  }
}

function getGamesConfig(envObj = process.env) {
  return [
    {
      id: 'roblox',
      emoji: '🧱',
      name: { tr: 'Roblox', en: 'Roblox' },
      short: { tr: 'Roblox', en: 'Roblox' },
      buttonLabel: { tr: '🧱 Roblox', en: '🧱 Roblox' },
      usernameLabel: {
        tr: 'Roblox kullanıcı adın (veya profil linkin / ID)',
        en: 'Roblox username (or profile link / ID)',
      },
      usernamePlaceholder: {
        tr: 'Örn: @kullaniciadi veya profil linki',
        en: 'e.g. @username or profile link',
      },
      validate: {
        min: 3,
        max: 100,
        regex: null,
      },
      verifier: 'roblox',
      icon: '',
      enabled: true,
      roleId: resolveGameRoleId('GAME_ROLE_ROBLOX', envObj),
    },
    {
      id: 'cs2',
      emoji: '🔫',
      name: { tr: 'CS2', en: 'CS2' },
      short: { tr: 'CS2', en: 'CS2' },
      buttonLabel: { tr: '🔫 CS2', en: '🔫 CS2' },
      usernameLabel: {
        tr: 'CS2 / Steam kullanıcı adın',
        en: 'CS2 / Steam username',
      },
      usernamePlaceholder: {
        tr: 'Örn: PiyadeOyuncu',
        en: 'e.g. PiyadePlayer',
      },
      validate: {
        min: 2,
        max: 32,
        regex: null,
      },
      verifier: null,
      icon: '',
      enabled: true,
      roleId: resolveGameRoleId('GAME_ROLE_CS2', envObj),
    },
    {
      id: 'zula',
      emoji: '🪖',
      name: { tr: 'Zula', en: 'Zula' },
      short: { tr: 'Zula', en: 'Zula' },
      buttonLabel: { tr: '🪖 Zula', en: '🪖 Zula' },
      usernameLabel: {
        tr: 'Zula oyun içi adın',
        en: 'Zula in-game name',
      },
      usernamePlaceholder: {
        tr: 'Örn: PiyadeKomando',
        en: 'e.g. PiyadeCommando',
      },
      validate: {
        min: 2,
        max: 32,
        regex: null,
      },
      verifier: null,
      icon: '',
      enabled: true,
      roleId: resolveGameRoleId('GAME_ROLE_ZULA', envObj),
    },
    {
      id: 'minecraft',
      emoji: '⛏️',
      name: { tr: 'Minecraft', en: 'Minecraft' },
      short: { tr: 'Minecraft', en: 'Minecraft' },
      buttonLabel: { tr: '⛏️ Minecraft', en: '⛏️ Minecraft' },
      usernameLabel: {
        tr: 'Minecraft (TLauncher) kullanıcı adın',
        en: 'Minecraft (TLauncher) username',
      },
      usernamePlaceholder: {
        tr: 'Örn: Steve_06 (3-16 harf, rakam veya _)',
        en: 'e.g. Steve_06 (3-16 letters, digits or _)',
      },
      validate: {
        min: 3,
        max: 16,
        regex: '^[A-Za-z0-9_]{3,16}$',
      },
      verifier: null,
      icon: '',
      enabled: true,
      roleId: resolveGameRoleId('GAME_ROLE_MINECRAFT', envObj),
    },
  ];
}

const GAMES = getGamesConfig();

function getFallbackGameById(id) {
  const cleanId = typeof id === 'string' ? id.trim().toLowerCase() : '';
  return GAMES.find((item) => item.id === cleanId) || null;
}

function normalizeGameDefinition(rawGame, fallbackMap = null) {
  if (!rawGame || typeof rawGame !== 'object') return null;
  const id = typeof rawGame.id === 'string' ? rawGame.id.trim().toLowerCase() : '';
  if (!/^[a-z0-9_-]{1,32}$/.test(id)) return null;
  if (rawGame.enabled === false) return null;

  const fb =
    (fallbackMap && fallbackMap.get(id)) ||
    getFallbackGameById(id) || {
      id,
      emoji: '🎮',
      name: { tr: id.toUpperCase(), en: id.toUpperCase() },
      short: { tr: id.toUpperCase(), en: id.toUpperCase() },
      buttonLabel: { tr: id.toUpperCase(), en: id.toUpperCase() },
      usernameLabel: {
        tr: `${id} kullanıcı adın`,
        en: `${id} username`,
      },
      usernamePlaceholder: {
        tr: 'Kullanıcı adını yaz',
        en: 'Enter your username',
      },
      validate: { min: 2, max: 32, regex: null },
      verifier: null,
      icon: '',
      enabled: true,
      roleId: null,
    };

  const emoji =
    typeof rawGame.emoji === 'string' && rawGame.emoji.trim()
      ? rawGame.emoji.trim().slice(0, 12)
      : fb.emoji;

  const name = normalizeLocalizedPair(rawGame.name, fb.name);
  const short = normalizeLocalizedPair(rawGame.short, name);
  const defaultBtnPair = {
    tr: `${emoji} ${name.tr}`.trim(),
    en: `${emoji} ${name.en}`.trim(),
  };
  const buttonLabel = normalizeLocalizedPair(rawGame.buttonLabel, fb.buttonLabel || defaultBtnPair);
  const usernameLabel = normalizeLocalizedPair(rawGame.usernameLabel, fb.usernameLabel);
  const usernamePlaceholder = normalizeLocalizedPair(
    rawGame.usernamePlaceholder,
    fb.usernamePlaceholder
  );

  const rawVal = rawGame.validate && typeof rawGame.validate === 'object' ? rawGame.validate : {};
  const minRaw = Number(rawVal.min);
  const maxRaw = Number(rawVal.max);
  const min = Number.isInteger(minRaw) && minRaw >= 1 && minRaw <= 100 ? minRaw : fb.validate.min;
  const max =
    Number.isInteger(maxRaw) && maxRaw >= min && maxRaw <= 200 ? maxRaw : Math.max(min, fb.validate.max);
  const regex = sanitizeRegexString(rawVal.regex, fb.validate.regex);

  const verifier =
    rawGame.verifier === 'roblox'
      ? 'roblox'
      : rawGame.verifier === null
        ? null
        : fb.verifier;

  return {
    id,
    emoji,
    name,
    short,
    buttonLabel,
    usernameLabel,
    usernamePlaceholder,
    validate: {
      min,
      max,
      regex,
    },
    verifier,
    icon: typeof rawGame.icon === 'string' ? rawGame.icon.trim() : fb.icon || '',
    enabled: true,
    roleId: fb.roleId || null,
  };
}

function normalizeGamesList(rawGames, envObj = process.env) {
  const fallbackList = getGamesConfig(envObj);
  if (!Array.isArray(rawGames) || rawGames.length === 0) {
    return fallbackList.slice(0, MAX_REGISTRATION_GAMES);
  }

  const fallbackMap = new Map(fallbackList.map((g) => [g.id, g]));
  const seenIds = new Set();
  const normalized = [];

  for (const raw of rawGames) {
    const item = normalizeGameDefinition(raw, fallbackMap);
    if (!item || seenIds.has(item.id)) continue;
    seenIds.add(item.id);
    normalized.push(item);
    if (normalized.length >= MAX_REGISTRATION_GAMES) break;
  }

  return normalized.length > 0 ? normalized : fallbackList.slice(0, MAX_REGISTRATION_GAMES);
}

function pickLocalizedGameField(fieldObj, lang = 'tr', fallback = '') {
  if (typeof fieldObj === 'string') return fieldObj;
  if (!fieldObj || typeof fieldObj !== 'object') return fallback;
  if (lang === 'en') return fieldObj.en || fieldObj.tr || fallback;
  return fieldObj.tr || fieldObj.en || fallback;
}

function validateGameUsername(game, rawValue) {
  const clean = normalizeWhitespace(typeof rawValue === 'string' ? rawValue : '');
  const min = game && game.validate && Number.isInteger(game.validate.min) ? game.validate.min : 2;
  const max = game && game.validate && Number.isInteger(game.validate.max) ? game.validate.max : 32;
  const regexStr = game && game.validate && game.validate.regex ? game.validate.regex : null;

  if (!clean) {
    return { ok: false, reason: 'EMPTY', value: '' };
  }
  if (clean.length < min) {
    return { ok: false, reason: 'TOO_SHORT', value: clean, min, max };
  }
  if (clean.length > max) {
    return { ok: false, reason: 'TOO_LONG', value: clean, min, max };
  }
  if (regexStr) {
    try {
      const re = new RegExp(regexStr);
      if (!re.test(clean)) {
        return { ok: false, reason: 'REGEX_MISMATCH', value: clean, min, max, regex: regexStr };
      }
    } catch {
      // Yedek güvenlik: geçersiz regex varsa sadece min/max kontrolü geçerli
    }
  }
  return { ok: true, value: clean };
}

module.exports = {
  GAMES,
  MAX_REGISTRATION_GAMES,
  getGamesConfig,
  getFallbackGameById,
  normalizeWhitespace,
  normalizeGameDefinition,
  normalizeGamesList,
  pickLocalizedGameField,
  validateGameUsername,
};
