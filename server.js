const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');

const appConfig = require('./config/app.config');
const siteConfig = require('./config/site.config');
const PersistentSessionStore = require('./services/sessionStore');
const botApiClient = require('./services/botApiClient');
const { compressionMiddleware } = require('./middlewares/compression');
const { globalLimiter } = require('./middlewares/rateLimiter');
const { i18nMiddleware, handleLanguageSwitch } = require('./middlewares/i18n');
const { csrfProtection } = require('./middlewares/csrf');
const { syncRolesMiddleware } = require('./middlewares/auth');
const { notFoundHandler, globalErrorHandler } = require('./middlewares/errorHandler');

// Rotalar
const publicRoutes = require('./routes/public');
const authRoutes = require('./routes/auth');
const memberRoutes = require('./routes/member');
const adminRoutes = require('./routes/admin');

function createServerApp() {
  const app = express();

  // Madde 2: Railway ve Reverse Proxy arkasında güvenli çerezlerin (secure cookie) ve IP rate limit'in çalışması için
  app.set('trust proxy', 1);

  // EJS Şablon Motoru Ayarları
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  // Madde 10: Güvenlik Başlıkları (Helmet CSP — img-src sadece Discord CDN ve Roblox Avatar CDN)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: [
            "'self'",
            'data:',
            'https://cdn.discordapp.com',
            'https://tr.rbxcdn.com',
            'https://t0.rbxcdn.com',
            'https://t1.rbxcdn.com',
            'https://t2.rbxcdn.com',
            'https://t3.rbxcdn.com',
            'https://t4.rbxcdn.com',
            'https://t5.rbxcdn.com',
            'https://t6.rbxcdn.com',
            'https://t7.rbxcdn.com',
            'https://t8.rbxcdn.com',
            'https://t9.rbxcdn.com',
            'https://*.rbxcdn.com',
          ],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          scriptSrcAttr: ["'unsafe-inline'"],
          connectSrc: ["'self'"],
        },
      },
    })
  );

  // Gzip / Brotli Yanıt Sıkıştırması (Core Web Vitals / Hız)
  app.use(compressionMiddleware);

  // Statik Dosyalar (CSS, JS, Görseller — uzun süreli önbellek başlıkları ile)
  app.use(
    express.static(path.join(__dirname, 'public'), {
      etag: true,
      lastModified: true,
      setHeaders(res, filePath) {
        const reqUrl = (res.req && res.req.originalUrl) || '';
        const normalizedFile = String(filePath || '').replace(/\\/g, '/');
        if (
          reqUrl.includes('?v=') ||
          normalizedFile.includes('/public/vendor/') ||
          normalizedFile.includes('/public/images/')
        ) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
        }
      },
    })
  );

  // Gövde Ayrıştırıcılar (Form & JSON)
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(express.json({ limit: '2mb' }));

  // Global Rate Limiter
  app.use(globalLimiter);

  // Madde 3: Kalıcı Oturum Deposu (PersistentSessionStore — Production'da MemoryStore kullanılmaz)
  const sessionStore = new PersistentSessionStore({
    ttlMs: 24 * 60 * 60 * 1000,
  });
  app.locals.sessionStore = sessionStore;

  // Oturum Yönetimi (express-session: httpOnly + secure cookie)
  app.use(
    session({
      name: 'piyade.sid',
      store: sessionStore,
      secret: appConfig.SESSION_SECRET || 'dev-fallback-session-secret-min-16-chars',
      resave: false,
      saveUninitialized: false,
      proxy: true,
      cookie: {
        httpOnly: true,
        secure: appConfig.IS_PROD,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 24 Saat
      },
    })
  );

  // Çok Dilli (TR / EN) Dil Algılama ve Çerez Middleware'i
  app.use(i18nMiddleware);

  // Dil Değiştirme Uç Noktası (Tercihi 1 yıl çerezde saklar)
  app.get('/lang/:code', handleLanguageSwitch);

  // CSRF Koruması
  app.use(csrfProtection);

  // Her İstek İçin Oturum & 60 Saniyelik Bot API Rol Senkronizasyonu
  app.use(syncRolesMiddleware);

  // Madde 2: Sağlık Kontrolü (/health) — Sunucunun ayakta olduğunu ve BOT_API_URL erişim durumunu gösterir (Secret içermez)
  app.get('/health', async (req, res) => {
    const botProbe = await botApiClient.probeBotApiStatus();
    const storeCheck = sessionStore.testWriteAccess();

    return res.json({
      status: 'ok',
      service: 'piyade-team-web',
      sunucu: 'ayakta',
      botApi: botProbe.statusText, // "ulaşıldı" | "ulaşılamadı" | "yetki hatası (API_SECRET uyuşmuyor)"
      botApiSebepSinifi: botProbe.category,
      botApiAciklama: botProbe.explanation,
      oturumDeposu: storeCheck.writable ? 'yazılabilir' : 'yazılamıyor',
      oturumDeposuAciklama: storeCheck.writable ? 'Oturum klasörüne başarıyla yazılabiliyor.' : storeCheck.reason,
      timestamp: Date.now(),
    });
  });

  // Sayfa Rotaları
  app.use('/auth', authRoutes);
  app.use('/', publicRoutes);
  app.use('/', memberRoutes);
  app.use('/yonetim', adminRoutes);

  // 404 ve Global Hata Yakalayıcılar
  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  return app;
}

if (require.main === module) {
  // Madde 14: Açılışta zorunlu ortam değişkenlerini doğrula (eksik/hatalı varsa secret loglamadan durdur)
  appConfig.assertValidEnvOnStartup();

  const app = createServerApp();
  app.listen(appConfig.PORT, () => {
    console.log('====================================================');
    console.log(`🌐 ${siteConfig.BRAND_NAME} Web Sitesi Aktif!`);
    console.log(`📍 Adres: http://localhost:${appConfig.PORT}`);
    console.log('====================================================');

    // Madde 5: Oturum deposunun (Railway Volume veya yerel klasör) yazılabilirliğini açılışta test et ve logla
    if (app.locals.sessionStore) {
      app.locals.sessionStore.logStartupWriteCheck();
    }

    // Madde 3: Açılışta BOT_API_URL'e bir kez test isteği at ve sonucu (başarılı/başarısız + sebep sınıfı) loga yaz
    botApiClient.runStartupConnectivityTest().catch(() => null);
  });
}

module.exports = { createServerApp };
