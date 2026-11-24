# 🌐 Piyade World | Piyade Dünyası — Oyuncu Topluluğu Web Portalı

Bu proje, **Piyade World (Piyade Dünyası)** Discord sunucusu için geliştirilmiş, iki dilli (**TR / EN**), **Roblox**, **CS2**, **Zula** ve **TLauncher (Minecraft)** oyuncularını bir araya getiren ince ön yüz (**Thin Client**) web sitesidir.

Tüm kalıcı üye verileri, oyun bazlı kayıt başvuruları ve disiplin/uyarı işlemleri doğrudan Discord botunun sunduğu **REST API** servisi üzerinden gerçek zamanlı olarak yönetilir.

---

## 🏗️ Mimari ve Temel Özellikler

- **İnce Ön Yüz (Thin Client):** Web sitesi kendi veritabanını tutmaz; Bot REST API (`services/botApiClient.js`) ile `Authorization: Bearer <API_SECRET>` üzerinden haberleşir.
- **Merkezi Marka ve SEO Yapılandırması (`config/brand.config.js` & `config/site.config.js`):** Marka kimliği (**Piyade World**, **Piyade Dünyası**, **Piyade** ve marka takma adları), Discord davet bağlantısı (`DISCORD_INVITE_URL`), çok dilli `hreflang` / `canonical` bağlantıları, Open Graph / Twitter kartları ve yapılandırılmış JSON-LD (`Organization`, `WebSite`, `WebPage`, `BreadcrumbList`, `FAQPage`) şemaları tek kaynaktan yönetilir.
- **İki Dilli Altyapı (`middlewares/i18n.js` & `locales/`):** `locales/` klasöründeki JSON dosyaları otomatik algılanır (`tr.json`, `en.json`). Dil seçici bu listeden dinamik olarak üretilir. Başvurular yalnızca gönderildiği andaki site diliyle (`lang`) bota iletilir.
- **Oyun Bazlı Kayıt ve Yedek Liste (`config/games.config.js`):** Oyun listesi birincil olarak Bot API `GET /api/games` yanıtından alınıp 5 dakika bellekte önbelleklenir; bot erişilemezse veya yanıt uyumlu değilse 4 oyunlu yedek yapılandırma (`roblox`, `cs2`, `zula`, `minecraft`) devreye girer.
- **Roblox Hesap Doğrulama Proxy'si (`GET /kayit/roblox-kontrol`):** Girişli oturum + CSRF doğrulaması + kullanıcı başına dakikada 10 istek sınırı ile Bot API üzerinden Roblox kullanıcı adı/ID kontrolü yapar; `FOUND`, `NOT_FOUND`, `BANNED`, `TEMPORARY_ERROR` ve `alreadyRegistered` durumlarını kart içinde gösterir.
- **Güvenlik ve Performans:**
  - Discord OAuth2 (`state` doğrulamalı) giriş ve kalıcı dosya tabanlı oturum deposu (`services/sessionStore.js`).
  - Oturum tabanlı CSRF koruması (`middlewares/csrf.js`), tek kullanımlık Idempotency anahtarları (`middlewares/idempotency.js`) ve uç nokta bazlı Rate Limiter (`middlewares/rateLimiter.js`).
  - Çift gönderim engelleme, Post-Redirect-Get (PRG) başarı akışı ve JavaScript kapalı tarayıcılarda da çalışan tek sayfa fallback desteği.
  - Kanıt görsellerinde yalnızca RAM (`multer.memoryStorage`) ve magic-byte (`PNG`, `JPG`, `WEBP`, maks. 5 MB; `SVG` reddedilir) doğrulaması.

---

## 📄 Sayfalar ve Rotalar

| Rota | Erişim Seviyesi | Açıklama |
| :--- | :--- | :--- |
| `GET /` | Herkese Açık | Anasayfa (Piyade World / Piyade Dünyası Hero, oyun evreni kartları, özellikler ve SSS) |
| `GET /kurallar` | Herkese Açık | Genel Kurallar ve Disiplin Yönetmeliği (`M1–M13`, `D1–D3`, `Y1–Y5`) |
| `GET /etkilesim` | Herkese Açık | 🎯 Atış & Gökyüzü (Nexus UI Dart Rating ve Meteors) |
| `GET /kayit` / `POST /kayit` | Herkese Açık / Girişli | 3 adımlı oyun bazlı kayıt başvurusu (oyunlar, cinsiyet, anket, Orbital Loader & PRG) |
| `GET /kayit/roblox-kontrol` | Girişli (CSRF + 10/dk) | Roblox hesap kontrol proxy uç noktası (JSON) |
| `GET /profil` | Kayıtlı Üye+ | Kişisel profil, oyun hesapları + kopyalama düğmeleri ve disiplin durumu |
| `GET /yonetim/uyeler` | Yönetmenlik / Developer | Üye arama, kayıt/oyun bilgisi ve disiplin sicili inceleme |
| `GET /yonetim/uyeler/:id` | Yönetmenlik / Developer | Tekil üye detay, kayıtlı oyunlar ve sicil geçmişi |
| `GET /yonetim/uyari` / `POST /yonetim/uyari` | Yönetmenlik / Developer | Sözlü veya resmi disiplin uyarısı ve kanıt yükleme (Orbital Loader) |
| `POST /geri-bildirim` | Sunucudaki Girişli Üyeler | Sağ alt Geri Bildirim hapı (Feedback Pill) |
| `GET /health` | Sistem | Sunucu, oturum deposu ve Bot API sağlık kontrolü |

---

## 🤖 Bağlı Bot REST API Uç Noktaları

| Bot API Uç Noktası | Kullanım |
| :--- | :--- |
| `GET /api/games` | Desteklenen oyun listesi, etiketler, doğrulama kuralları (5 dk cache + `games.config.js` yedek) |
| `GET /api/roblox/lookup?query=` | Roblox hesap durumu (`FOUND`, `NOT_FOUND`, `BANNED`, `TEMPORARY_ERROR`, `alreadyRegistered`) |
| `GET /api/register/status/:id` | Kullanıcının mevcut kayıt / bekleyen / reddedilen başvuru durumu |
| `POST /api/register` | `{ name, gender, games: [{ id, username }], lang }` başvurusu gönderimi ve hata kodları |
| `GET /api/member/:id/profile` | Profilim sayfası (`displayName`, `registration.games`, disiplin bilgileri) |
| `GET /api/member/:id/activity` | Giriş yapmış üyenin yalnızca kendi aylık etkinlik verisi (bot tarafından gruplanmış) |
| `GET /api/stats/summary` | Anonim `activeThisMonth`, `playingNow`, `uncertainCount`, `computedAt`, `families` (+ eski alanlar) |
| `GET /api/stats/top-games` | Anonim aile bazlı en çok oynanan oyun sıralaması (`group=family`, 60 sn bellek önbellekli) |
| `GET /api/admin/members` & `/:id` | Yönetim üye listesi ve detayında oyun hesapları |

---

## 📊 Canlı İstatistikler, Roblox Gruplama ve Deploy Sırası

### 1. "Bu ay aktif" ve "Şu an oyunda" Gösterimi
- **Hero ve Üst Şerit Tek Kaynak**: Anasayfa Hero alanı ve üst şerit/kenar çubuğu birebir aynı bot yanıtından (`GET /api/stats/summary`) beslenir; site tarafında ayrıca toplama/çarpma yapılmaz.
- **`Bu ay aktif` (`activeThisMonth`)**: Kayıtlı, sunucuda hâlâ bulunan, bot olmayan, takibi açık ve bu ay en az `1 dk` (`MIN_ACTIVE_MINUTES`) süresi olan benzersiz üye sayısı.
- **`Şu an oyunda` (`playingNow`)**: Kayıtlı, takibi açık ve canlı Discord presence ile doğrulanmış aktif oyun oturumu bulunan benzersiz üye sayısı (küçük rozet olarak yanında gösterilir).
- **Son Güncelleme & Çevrimdışı Dayanıklılığı**: Bot yanıtındaki `computedAt` göreli olarak (`"Son güncelleme: ..."`) gösterilir. Site bellek önbelleği **en fazla 60 sn** tutulur. Bot erişilemez veya bozuk yanıt döndürürse site çökmez, bellekteki son iyi veriyi sessiz `"veri güncellenemedi"` ibaresiyle korur.

### 2. Süre Biçimi ve Bot Tarafı Süre Güvenceleri
- Bot tarafında süreler delta esaslı (`lastCheckpointAt`), 120 sn boşluk sınırlı (`MAX_DELTA_SEC`), tek-saat ve ay-sınırı (B3) korumalı hesaplanır; Discord `timestamps.start` ve `STOP_GRACE_SEC` süreye eklenmez.
- Site genelindeki süre biçimleyici (`utils/formatDuration.js`, `public/js/top-games.js`, `public/js/activity-panel.js`) bot ile birebir aynı kuralı uygular (`0 dk`, `1 dk'dan az`, `1 sa`, `1 sa 59 dk`, `41 sa 47 dk`) ve `NaN`/`Infinity`/`undefined` değerlerini asla ekrana basmaz.

### 3. Roblox Aile Gruplama ve `SHOW_FAMILY_BREAKDOWN`
- Site kendi oyun/aile eşleme listesini **tutmaz**; botun `activity.config.js` üzerinden gruplayıp döndürdüğü `families` dizisini doğrudan gösterir.
- Tüm Roblox oyunları tek **`🧱 Roblox`** satırında toplanır (`"Roblox (diğer)"` etiketi artık gösterilmez); Minecraft, CS2 ve Zula ayrı satırlarında kalır.
- Bot tarafında `SHOW_FAMILY_BREAKDOWN: true` açılırsa, site tasarımı bozmadan ilgili satırın altında en çok 5 alt oyun + `+N diğer` kırılım satırını otomatik gösterir (varsayılan kapalıdır).
- Sol menüdeki **"🎮 Etkinliğim"** paneli yalnızca giriş yapmış kayıtlı üyenin kendi oturum kimliğinden (`req.session.user.id`) veri çeker; dışarıdan başka kullanıcı ID'si kabul etmez.

### 4. Bot-Site Sözleşmesi ve Deploy Sırası
- **DEPLOY SIRASI: Önce `tsb.piyade.bot` (Bot), sonra `piyade.team.site` (Site) deploy edilmelidir.**
- Her iki yönde geriye dönük uyumluluk vardır: yeni site eski botla karşılaşırsa (`activeThisMonth`/`families` yoksa) sessizce eski `activeRegisteredCount`/`games` gösterimine düşer; eski site de yeni bottaki korunan eski alanlarla çalışmaya devam eder.
- CSS/JS değişikliklerinde `config/site.config.js` içindeki `ASSET_VERSION` (`2.2.0-<8-hex>`) otomatik yenilenir ve tarayıcı önbelleğini temizler.

### 5. Sorun Giderme (Sayı/Süre Tuhaf Görünüyorsa)
- **Hero/Üst şeritte `"veri güncellenemedi"` veya `👥 —` görüyorsanız**: `/health` ucundan `botApi` durumunu ve `BOT_API_URL` / `API_SECRET` eşleşmesini kontrol edin.
- **Sayı beklediğinizden farklıysa**: Discord'da Developer olarak `/aktivitem` -> `🛠️ Sistem Durumu` panelinden `activeThisMonth`, `playingNow`, `belirsiz` ve `Süre Sağlığı` satırlarına bakın.
- **Sıralama saatleri yüksek görünüyorsa**: Gösterilen değer kişi başı ortalama değil, **tüm aktif oyuncuların bu ayki toplam süresidir** (AFK açık kalan oyunlar dahil).
- **Değişiklikler tarayıcıda görünmüyorsa**: Sayfa kaynağında `/css/style.css?v=2.2.0-...` sürüm kodunun yenilendiğini doğrulayın (`npm test` ve `npm run verify:clean`).

---

## ⚙️ Çevre Değişkenleri (`.env`)

```env
PORT=3001
NODE_ENV=development
BASE_URL=http://localhost:3001
SITE_NAME=Piyade World

BOT_API_URL=http://localhost:3000
API_SECRET=super_secret_piyade_bot_api_key_2026

DISCORD_CLIENT_ID=123456789012345678
DISCORD_CLIENT_SECRET=your_discord_client_secret_here
SESSION_SECRET=piyade_session_secret_change_me_in_production_key_123456

# Opsiyonel
RAILWAY_VOLUME_MOUNT_PATH=/data
DISCORD_INVITE_URL=https://discord.gg/davet_kodunuz
GOOGLE_SITE_VERIFICATION=

# Oyun Bazlı Discord Rol ID'leri (config/games.config.js)
GAME_ROLE_ROBLOX=
GAME_ROLE_CS2=
GAME_ROLE_ZULA=
GAME_ROLE_MINECRAFT=
```

---

## 🚀 Kurulum ve Doğrulama

```bash
# Bağımlılıkları yükle
npm install

# Geliştirme modunda başlat
npm run dev

# Üretim modunda başlat
npm start

# Birim ve sözleşme testlerini çalıştır (Node yerleşik node:test)
npm test

# Railway temiz kurulum ve açılış doğrulama testini çalıştır
npm run verify:clean
```

---

## 🧹 Volume / Disk Temizlik Notu

> **Not:** Volume'daki eski veriler elle silinebilir (`data/warriors.json`, `data/warriors.json.bak`, `data/roblox-avatars-cache.json` ve varsa eski özel görseller). Bu dosyalara ait kodlar projeden tamamen kaldırılmıştır; uygulama açılışında veya çalışma zamanında bu dosyalar okunmaz ve yazılmaz.
