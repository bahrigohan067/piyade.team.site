const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const path = require('path');
const appConfig = require('./config/app.config');

// Middleware'ler
const csrfProtection = require('./middlewares/csrf');
const { syncRolesMiddleware } = require('./middlewares/auth');
const { generalLimiter } = require('./middlewares/rateLimiter');
const { notFoundHandler, globalErrorHandler } = require('./middlewares/errorHandler');

// Rotalar
const publicRoutes = require('./routes/public');
const authRoutes = require('./routes/auth');
const memberRoutes = require('./routes/member');
const adminRoutes = require('./routes/admin');

function createApp() {
  const app = express();

  // 1. Ters Proxy Desteği (Railway, Nginx veya Cloudflare arkasında HTTPS ve IP tespiti)
  app.set('trust proxy', 1);

  // 2. Şablon Motoru (EJS)
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  // 3. Güvenlik Başlıkları (Helmet)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'https:', 'https://cdn.discordapp.com', 'https://www.roblox.com'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: appConfig.IS_PRODUCTION ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );

  // 4. Statik Dosyalar
  app.use(express.static(path.join(__dirname, 'public')));

  // 5. Gövde Ayrıştırıcıları (Body Parsers)
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(express.json({ limit: '2mb' }));

  // 6. Güvenli Oturum (Session) Yönetimi
  app.use(
    session({
      name: 'piyade.sid',
      secret: appConfig.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true, // XSS koruması (JS ile cookie okunamaz)
        secure: appConfig.IS_PRODUCTION, // Sadece HTTPS üzerinde iletilir (Prod)
        sameSite: 'lax', // CSRF koruması ve OAuth dönüş uyumluluğu
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 gün oturum süresi
      },
    })
  );

  // 7. Genel İstek Sınırlandırıcısı (Rate Limiter)
  app.use(generalLimiter);

  // 8. CSRF Koruması
  app.use(csrfProtection);

  // 9. Rol Senkronizasyonu & Ortak View Değişkenleri (Her 60 saniyede bir Bot API'den güncellenir)
  app.use(syncRolesMiddleware);

  // 10. Rota Tanımları
  app.use('/', publicRoutes);
  app.use('/auth', authRoutes);
  app.use('/', memberRoutes);
  app.use('/yonetim', adminRoutes);

  // 11. 404 Bulunamadı Yakalayıcısı
  app.use(notFoundHandler);

  // 12. Global Hata Yakalayıcı (Bot API Çevrimdışı ve 500 Sayfaları)
  app.use(globalErrorHandler);

  return app;
}

// Doğrudan çalıştırıldığında sunucuyu dinlemeye başla
if (require.main === module) {
  const app = createApp();
  const server = app.listen(appConfig.PORT, () => {
    console.log('==================================================');
    console.log(`🚀 Piyade Team Web Sitesi Aktif! Port: ${appConfig.PORT}`);
    console.log(`🌐 Base URL: ${appConfig.BASE_URL}`);
    console.log(`🤖 Bot API Hedefi: ${appConfig.BOT_API_URL}`);
    console.log(`🔒 Güvenlik: Helmet, CSRF, Secure Cookie ve Rate Limit Devrede`);
    console.log('==================================================');
  });

  // Nazik Kapatma (Graceful Shutdown)
  const shutdown = () => {
    console.log('\n🛑 Sunucu kapatılıyor...');
    server.close(() => {
      console.log('✅ Bağlantılar sonlandırıldı.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { createApp };
