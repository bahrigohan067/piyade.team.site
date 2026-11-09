require('dotenv').config();

const REQUIRED_ENV_KEYS = [
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'SESSION_SECRET',
  'BASE_URL',
  'BOT_API_URL',
  'API_SECRET',
];

function isValidHttpUrl(value) {
  if (!value || typeof value !== 'string') return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

/**
 * Ortam değişkenlerini (env) doğrular.
 * Secret değerlerini ASLA konsola veya loglara yazmaz; yalnızca hangi değişkenin eksik/hatalı olduğunu bildirir.
 *
 * @param {NodeJS.ProcessEnv} [envObj=process.env]
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateEnvConfig(envObj = process.env) {
  const errors = [];

  for (const key of REQUIRED_ENV_KEYS) {
    const val = envObj[key];
    if (!val || String(val).trim() === '') {
      errors.push(`${key}: Boş veya tanımlanmamış (Zorunlu değişken).`);
    }
  }

  if (envObj.BASE_URL && !isValidHttpUrl(envObj.BASE_URL)) {
    errors.push('BASE_URL: Geçerli bir http:// veya https:// adresi olmalıdır (Örn: https://site.up.railway.app).');
  }

  if (envObj.BOT_API_URL && !isValidHttpUrl(envObj.BOT_API_URL)) {
    errors.push(
      'BOT_API_URL: Geçerli bir http:// veya https:// adresi olmalıdır (Örn: http://bot.railway.internal:3000).'
    );
  }

  if (envObj.SESSION_SECRET && String(envObj.SESSION_SECRET).trim().length < 16) {
    errors.push('SESSION_SECRET: Güvenlik için en az 16 karakter uzunluğunda olmalıdır.');
  }

  if (envObj.PORT !== undefined && String(envObj.PORT).trim() !== '') {
    const portNum = Number(envObj.PORT);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      errors.push('PORT: 1 ile 65535 arasında geçerli bir tam sayı olmalıdır.');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Uygulama açılışında ortam değişkenlerini kontrol eder.
 * Eksik veya hatalı değişken varsa secret değerlerini sızdırmadan anlaşılır hata mesajıyla uygulamayı durdurur.
 */
function assertValidEnvOnStartup(envObj = process.env) {
  const { valid, errors } = validateEnvConfig(envObj);
  if (!valid) {
    console.error('================================================================');
    console.error('❌ [BAŞLATMA HATASI] Ortam Değişkenleri (ENV) Eksik veya Hatalı!');
    console.error('================================================================');
    errors.forEach((errMsg) => {
      console.error(`  • ${errMsg}`);
    });
    console.error('----------------------------------------------------------------');
    console.error('Lütfen .env dosyanızı veya Railway Variables ayarlarınızı kontrol edin.');
    console.error('Güvenlik gereği gizli anahtar (secret) değerleri loglanmamıştır.');
    console.error('================================================================');
    process.exit(1);
  }
}

const appConfig = {
  PORT: parseInt(process.env.PORT, 10) || 3001,
  NODE_ENV: process.env.NODE_ENV || 'development',
  IS_PROD: process.env.NODE_ENV === 'production',

  // Site Temel URL'si (OAuth2 Redirect için)
  BASE_URL: (process.env.BASE_URL || 'http://localhost:3001').replace(/\/+$/, ''),

  // Discord OAuth2 Ayarları (Sadece sunucu tarafında kullanılır)
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID || '',
  DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET || '',
  DISCORD_REDIRECT_URI: `${(process.env.BASE_URL || 'http://localhost:3001').replace(/\/+$/, '')}/auth/discord/callback`,

  // Oturum Güvenliği
  SESSION_SECRET: process.env.SESSION_SECRET || '',

  // Bot REST API Bağlantısı (Asla istemciye sızdırılmaz)
  BOT_API_URL: (process.env.BOT_API_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  API_SECRET: process.env.API_SECRET || '',

  // Rol Yenileme Süresi (Her 60 saniyede bir bot API'den taze rol çekilir)
  ROLE_SYNC_INTERVAL_MS: 60 * 1000,

  // İstek Zaman Aşımı (8 saniye - Madde 8)
  API_TIMEOUT_MS: 8000,

  // Doğrulama yardımcıları
  validateEnvConfig,
  assertValidEnvOnStartup,
};

module.exports = appConfig;
