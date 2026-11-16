# 🌐 Piyade — Oyuncu Topluluğu Web Portalı

Bu proje, **Piyade** Discord sunucusu için geliştirilmiş, iki dilli (**TR / EN**), **Roblox**, **Zula**, **TLauncher (Minecraft)** ve **CS2** oyuncularını bir araya getiren ince ön yüz (**Thin Client**) web sitesidir.

Tüm kalıcı üye verileri, kayıt başvuruları ve disiplin/uyarı işlemleri doğrudan Discord botunun sunduğu **REST API** servisi üzerinden gerçek zamanlı olarak yönetilir.

---

## 🏗️ Mimari ve Temel Özellikler

- **İnce Ön Yüz (Thin Client):** Web sitesi kendi veritabanını tutmaz; Bot REST API (`services/botApiClient.js`) ile `Authorization: Bearer <API_SECRET>` üzerinden haberleşir.
- **Merkezi Marka Yapılandırması (`config/brand.config.js`):** Marka adı (`SITE_NAME`, varsayılan `"Piyade"`), Discord davet bağlantısı (`DISCORD_INVITE_URL`) ve tüm marka görselleri/ikonları tek kaynaktan yönetilir.
- **İki Dilli Altyapı (`middlewares/i18n.js` & `locales/`):** `locales/` klasöründeki JSON dosyaları otomatik algılanır (`tr.json`, `en.json`). Dil seçici bu listeden dinamik olarak üretilir.
- **Oyun Bazlı Hazırlık İskeleti (`config/games.config.js`):** İleride devreye alınacak oyun bazlı roller ve oyun bazlı kayıt sistemi için `roblox`, `zula`, `minecraft` (`TLauncher (Minecraft)`) ve `cs2` (`CS2`) kayıtlarını içeren yapılandırma iskeleti hazırdır.
- **Güvenlik ve Performans:**
  - Discord OAuth2 (`state` doğrulamalı) giriş ve kalıcı dosya tabanlı oturum deposu (`services/sessionStore.js`).
  - Oturum tabanlı CSRF koruması (`middlewares/csrf.js`), tek kullanımlık Idempotency anahtarları (`middlewares/idempotency.js`) ve uç nokta bazlı Rate Limiter (`middlewares/rateLimiter.js`).
  - Kanıt görsellerinde yalnızca RAM (`multer.memoryStorage`) ve magic-byte (`PNG`, `JPG`, `WEBP`, maks. 5 MB; `SVG` reddedilir) doğrulaması.

---

## 📄 Sayfalar ve Rotalar

| Rota | Erişim Seviyesi | Açıklama |
| :--- | :--- | :--- |
| `GET /` | Herkese Açık | Anasayfa (geçici sade Hero alanı ve topluluk bağlantıları) |
| `GET /kurallar` | Herkese Açık | Genel Kurallar ve Disiplin Yönetmeliği (`M1–M13`, `D1–D3`, `Y1–Y5`) |
| `GET /etkilesim` | Herkese Açık | 🎯 Atış & Gökyüzü (Nexus UI Dart Rating ve Meteors) |
| `GET /kayit` / `POST /kayit` | Herkese Açık / Girişli | Topluluk Kayıt Başvurusu (geçici temel kayıt formu) |
| `GET /profil` | Kayıtlı Üye+ | Kişisel profil, Discord/kayıt bilgileri ve disiplin durumu |
| `GET /yonetim/uyeler` | Yönetmenlik / Developer | Üye arama, kayıt ve disiplin sicili inceleme |
| `GET /yonetim/uyeler/:id` | Yönetmenlik / Developer | Tekil üye detay ve sicil geçmişi (denetim loglu) |
| `GET /yonetim/uyari` / `POST /yonetim/uyari` | Yönetmenlik / Developer | Sözlü veya resmi disiplin uyarısı ve kanıt yükleme (Orbital Loader) |
| `POST /geri-bildirim` | Sunucudaki Girişli Üyeler | Sağ alt Geri Bildirim hapı (Feedback Pill) |
| `GET /health` | Sistem | Sunucu, oturum deposu ve Bot API sağlık kontrolü |

---

## ⚙️ Çevre Değişkenleri (`.env`)

```env
PORT=3001
NODE_ENV=development
BASE_URL=http://localhost:3001
SITE_NAME=Piyade

BOT_API_URL=http://localhost:3000
API_SECRET=super_secret_piyade_bot_api_key_2026

DISCORD_CLIENT_ID=123456789012345678
DISCORD_CLIENT_SECRET=your_discord_client_secret_here
SESSION_SECRET=piyade_session_secret_change_me_in_production_key_123456

# Opsiyonel
RAILWAY_VOLUME_MOUNT_PATH=/data
DISCORD_INVITE_URL=https://discord.gg/davet_kodunuz
GOOGLE_SITE_VERIFICATION=

# İleriye Hazırlık: Oyun Bazlı Discord Rol ID'leri (config/games.config.js)
GAME_ROLE_ROBLOX=
GAME_ROLE_ZULA=
GAME_ROLE_MINECRAFT=
GAME_ROLE_CS2=
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

# Railway temiz kurulum ve açılış doğrulama testini çalıştır
npm run verify:clean
```

---

## 🧹 Volume / Disk Temizlik Notu

> **Not:** Volume'daki eski veriler elle silinebilir (`data/warriors.json`, `data/warriors.json.bak`, `data/roblox-avatars-cache.json` ve varsa eski özel görseller). Bu dosyalara ait kodlar projeden tamamen kaldırılmıştır; uygulama açılışında veya çalışma zamanında bu dosyalar okunmaz ve yazılmaz.
