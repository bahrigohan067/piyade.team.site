require('dotenv').config();

function cleanEnv(val, fallback = '') {
  if (val === undefined || val === null) return fallback;
  return String(val).trim().replace(/^['"]+|['"]+$/g, '');
}

const config = {
  // Sunucu Portu
  PORT: parseInt(process.env.PORT, 10) || 3001,

  // Çalışma Ortamı
  NODE_ENV: cleanEnv(process.env.NODE_ENV, 'development'),
  IS_PRODUCTION: cleanEnv(process.env.NODE_ENV) === 'production',

  // Sitenin Yayın Adresi (Örn: https://piyade-site.up.railway.app veya http://localhost:3001)
  BASE_URL: cleanEnv(process.env.BASE_URL, 'http://localhost:3001').replace(/\/+$/, ''),

  // Bot REST API Adresi (Örn: https://piyade-bot.up.railway.app veya http://localhost:3000)
  BOT_API_URL: cleanEnv(process.env.BOT_API_URL, 'http://localhost:3000').replace(/\/+$/, ''),

  // Bot REST API Güvenlik Anahtarı (Authorization: Bearer <API_SECRET>)
  API_SECRET: cleanEnv(process.env.API_SECRET, ''),

  // Discord OAuth2 Bilgileri
  DISCORD_CLIENT_ID: cleanEnv(process.env.DISCORD_CLIENT_ID, ''),
  DISCORD_CLIENT_SECRET: cleanEnv(process.env.DISCORD_CLIENT_SECRET, ''),

  // Oturum (Session) Şifreleme Anahtarı
  SESSION_SECRET: cleanEnv(process.env.SESSION_SECRET, 'piyade_team_super_secret_session_key_2026'),

  // Bot API İstek Zaman Aşımı (ms)
  API_TIMEOUT_MS: 7000,

  // Roller Önbellek Yenileme Süresi (saniye)
  ROLE_SYNC_INTERVAL_SEC: 60,
};

module.exports = config;
