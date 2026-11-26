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
| `GET /giris` & `/giris/discord-var-mi` | Herkese Açık (`noindex`) | Giriş merkezi (Discord + Google ile devam et) ve Discord hesap bağlama seçimi |
| `GET /auth/google` & `/callback` | Herkese Açık (`noindex`) | Google OAuth2/OIDC (PKCE S256 + JWKS doğrulama) giriş ve yeniden doğrulama akışı |
| `GET /uye-ol` & `POST /uye-ol` | Geçici Google Oturumu (`noindex`) | 4 adımlı doğrudan site üyesi kayıt sihirbazı (yaş/rızalar, oyunlar, Roblox doğrulama, özet) |
| `GET /profil` | Kayıtlı Discord Üyesi & Google Site Üyesi | Kişisel profil (Discord üyeleri için kayıt + disiplin; Google üyeleri için oyunlar, gizlilik, rızalarım, oturumlarım ve hesabımı sil) |
| `GET /yonetim/uyeler` | Yönetmenlik / Developer | Üye arama, kayıt/oyun bilgisi ve disiplin sicili inceleme |
| `GET /yonetim/uyeler/:id` | Yönetmenlik / Developer | Tekil üye detay, kayıtlı oyunlar ve sicil geçmişi |
| `GET /yonetim/uyari` / `POST /yonetim/uyari` | Yönetmenlik / Developer (taze rol) | Discord üyelerine sözlü/resmi uyarı + alt panelde **Site (Google) Üyelerine Uyarı Ver** ve sicil önizleme/iptal (Orbital Loader) |
| `POST /yonetim/site-uyari` & `/:id/iptal` & `/kanit/:f` | Yönetmenlik / Developer (taze Discord rolü) | Google site üyelerine M/D uyarısı verme, iptal/yeniden hesaplama ve yalnızca yetkililere açık kanıt sunumu (`noindex`) |
| `GET/POST /api/uyari-bildirimleri/*` | Google Site Üyesi (aktif veya askıda) | Kapatılabilir uyarı bildirim kartı ve canlı SSE bildirim akışı (kanıt göstermez) |
| `POST /geri-bildirim` | Sunucudaki Girişli Üyeler | Sağ alt Geri Bildirim hapı (Feedback Pill) |
| `GET /sohbet` | Kayıtlı Üye+ (`CHAT_ENABLED=true`) | Birebir özel sohbet, dosya eki, emoji, 44 profil halkası (`noindex`) |
| `GET /sohbet/gizlilik` | Herkese Açık (`CHAT_ENABLED=true`) | Sohbet gizlilik, 30 günlük saklama ve moderasyon politikası (`noindex`) |
| `GET /sohbet/moderasyon` | Yalnızca Community Official (taze rol) | Rapor / otomatik işaret vakaları, **Site Bildirimleri** sekmesi, yaptırımlar ve denetim kaydı (diğer rollere `404`) |
| `GET /sohbet/moderasyon/denetim` | Community Official / Developer (taze rol) | Salt okunur denetim kaydı (Developer vaka içeriklerine erişemez) |
| `GET /yasal/:slug` | Herkese Açık (indekslenebilir) | 8 yasal belge (`kvkk-aydinlatma`, `acik-riza`, `gizlilik-politikasi`, `cerez-politikasi`, `kvkk-basvuru`, `kunye`, `telif-dmca`, `kotuye-kullanim`) |
| `POST /yasal/kvkk-basvuru` & `/sorgula` | Herkese Açık (3/gün/IP) | KVKK m.11 başvuru formu (`KVKK-YYYY-XXXXX`) ve yalnızca durum gösteren `noindex` sorgulama |
| `GET /bildir` / `POST /bildir` & `/sorgula` | Herkese Açık (5/saat/IP) | 10 kategorili kötüye kullanım / DMCA / KVKK ihlal bildirim tuş takımı (`RPT-YYYY-XXXXX`) |
| `GET /yonetim/kvkk` | Yalnızca Developer (taze rol) | KVKK başvuruları, 30 günlük süre/gecikme takibi ve içeriksiz denetim kaydı (diğerlerine `404`) |
| `GET /yonetim/bildirimler` | Developer & Yönetmenlik (taze rol) | Yasa dışı içerik, Telif/DMCA, KVKK ve genel site bildirimleri ile bulanık kanıt inceleme (diğerlerine `404`) |
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
| `GET /api/directory` & `POST /api/directory/lookup` | Sohbet üye rehberi ve toplu profil/Roblox avatar çözümleme (60 sn bellek önbellekli) |
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

# Google ile Devam Et (Opsiyonel — boşsa Google düğmesi gizlenir ve açılışta tek satır uyarı verilir)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
NEW_MEMBER_RESTRICTION_HOURS=24

# Sohbet Sistemi Özellik Bayrakları (Varsayılan KAPALI)
CHAT_ENABLED=false
CHAT_GOOGLE_MEMBERS_ENABLED=true
# Genel Sohbet grubu yöneticilerinin virgülle ayrılmış Discord ID listesi (koda sabit yazılmaz)
CHAT_GROUP_ADMIN_DISCORD_IDS=
MOD_PANEL_ALSO_DEVELOPER=false

# Oyun Bazlı Discord Rol ID'leri (config/games.config.js)
GAME_ROLE_ROBLOX=
GAME_ROLE_CS2=
GAME_ROLE_ZULA=
GAME_ROLE_MINECRAFT=

# Yasal Sayfalar, KVKK & Künye (Boş bırakılan alanlar "[Doldurulacak: ...]" görünür)
LEGAL_CONTROLLER_NAME=
LEGAL_ADDRESS=
LEGAL_EMAIL=
LEGAL_PHONE=
LEGAL_KEP=
LEGAL_REGISTRY_NO=
LEGAL_TAX_NO=
LEGAL_VERBIS_STATUS=
LEGAL_REVIEWED=false
LEGAL_KVKK_RETENTION_DAYS=1095
LEGAL_REPORT_RETENTION_DAYS=365
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

## 💬 Sohbet Sistemi: Genel Sohbet Grubu, Birebir Sohbet, Dosya Gönderme, Profil Kartı ve Moderasyon

- **Özellik Bayrağı (`CHAT_ENABLED` & `CHAT_GOOGLE_MEMBERS_ENABLED`):** `CHAT_ENABLED` varsayılan olarak **KAPALI (`false`)** durumdadır. Kapalıyken tüm `/sohbet*` ve `/sohbet/moderasyon*` adresleri `404` döner ve menüde sohbet/moderasyon öğeleri görünmez. `CHAT_GOOGLE_MEMBERS_ENABLED` varsayılan olarak `true`'dur; `false` yapıldığında Google site üyelerinin sohbete erişimi kapatılır.
- **Zorunlu "Genel Sohbet" Grubu (`group:genel`) ve Grup Yöneticisi (`CHAT_GROUP_ADMIN_DISCORD_IDS`):**
  - Sohbete erişimi olan tüm Discord ve site üyeleri otomatik olarak **🌐 Genel Sohbet** grubunun üyesidir; liste başında sabit durur, ayrılınamaz (yalnızca kullanıcı bazlı "Bildirimleri sessize al" ayarı vardır) ve ilk girişte açık gelir.
  - Grupta "Görüldü" bilgisi yoktur; okunmamış sayacı, "Yeni mesajlar" ayırıcısı, ek dosyalar, raporlama ve moderasyon aynen çalışır. Aşırı yük koruması olarak kullanıcı başına dakikada en çok **12** grup mesajı ve kısa sürede aynı mesajın tekrarı engellenir.
  - Grup yöneticileri yalnızca `CHAT_GROUP_ADMIN_DISCORD_IDS` (virgülle ayrılmış Discord ID listesi) ortam değişkeninden okunur (kodda sabit ID yoktur) ve **yalnızca Discord oturumu** ile doğrulanır. Grup yöneticisi gruptaki kurallara aykırı mesajları silebilir (yerinde *"Bu mesaj yönetici tarafından kaldırıldı"* izi kalır, ekler silinir ve içeriksiz denetim kaydı yazılır); DM'lere özel erişim **kazanmaz**.
- **Profil Bilgi Kartı (Nebula Glass Card) ve Oyun Gizliliği:**
  - Sohbetteki herhangi bir avatara veya isme tıklandığında tıklanan avatardan yaylanarak (`NexusSpring`) açılan **Nebula Glass Card** bilgi kartı (mobilde alttan açılan sayfa) gösterilir; kartın 3 bulutsu rengi üyenin kendi profil halkasındaki ilk 3 renkten türetilir.
  - Kartta üyenin oyun kullanıcı adları, kopyalama düğmesi, Roblox profil bağlantısı ve `Mesaj Yaz` / `Engelle` / `Raporla` (kendi kartında `Profilimi düzenle`) bulunur. Üyenin **"Oyun kullanıcı adlarımı profilimde göster"** ayarı kapalıysa veriler sunucudan hiç gönderilmez.
- **Kayıpsız `convId` Geçişi (`_` -> `~`) ve Mesaj İsteğinin Kaldırılması:**
  - Discord (`\d+`) ve Google (`g_m_...`) kimliklerinin çakışmaması için birebir sohbet ayracı `~` olarak güncellenmiştir. Açılışta eski `_` ayraçlı dosyalar varsa `backups/` altına yedek alınarak tek seferlik, kayıpsız ve geri alınabilir (`rollbackLegacyConvIdMigration`) biçimde taşınır.
  - Eski "mesaj isteği" özelliği ve `CHAT_FIRST_CONTACT_REQUEST` değişkeni tamamen kaldırılmıştır; engelleme ve *"bana kim yazabilir"* ayarları aynen korunur.
- **Kalıcı Depolama (Railway Volume):** Sohbet verileri `${RAILWAY_VOLUME_MOUNT_PATH}/chat/` altında saklanır (`conversations/*.jsonl`, `conversations/*.state.json`, `users.json`, `files/`, `tmp/`, `moderation/`, `modlog.jsonl`). Volume tanımlı değilse yerel `.chat-data/` klasörü kullanılır ve tek satırlık uyarı verilir. Depolama katmanı (`services/chatStore.js`) değiştirilebilir arayüzle yazılmıştır; ileride SQLite/PostgreSQL'e geçilebilir.
- **Gerçek Zamanlı Akış (SSE) ve Tek Kopya Notu:** `/sohbet/akis` uç noktası harici WebSocket paketi olmadan yerleşik SSE (25 sn heartbeat, `X-Accel-Buffering: no`, `Last-Event-ID`, kullanıcı başına maks. 5 bağlantı) kullanır. Abone listesi süreç içi bellekte tutulur; ileride birden fazla sunucu kopyası (multi-instance / yatay ölçekleme) çalıştırılırsa ortak bir Pub/Sub kanalı (örn. Redis Pub/Sub) eklenmelidir.
- **Tarayıcı Bildirimleri & Gelecek Web Push Notu:** Sekme açıkken/arka plandayken isteğe bağlı `Notification` API bildirimi (önizleme varsayılan kapalı) ve Web Audio sesi desteklenir. Sekme tamamen kapalıyken anlık itme bildirimi (Web Push) bu sürümde yoktur; ileride Service Worker ve VAPID anahtarlarıyla eklenebilir.
- **30 Günlük Otomatik Saklama ve Dosya Güvenliği:**
  - Tüm mesajlar ve ek dosyalar **30 gün** sonra günlük otomatik temizlik göreviyle (TSİ 03:00 + açılış telafisi) kalıcı olarak silinir; sahipsiz disk dosyaları ve 1 saati geçen yarım `tmp/` dosyaları da temizlenir.
  - Yalnızca magic-byte doğrulamasından geçen `PNG, JPG/JPEG, GIF, WEBP` (8 MB), `PDF` (10 MB; `/JavaScript` ve `/Launch` reddedilir), `TXT` (1 MB; geçerli UTF-8, NUL yok) ve `MP4/WEBM` (50 MB; HTTP `Range` destekli) kabul edilir. Bir mesaja en çok 5 dosya, kullanıcı başına dakikada 10 yükleme ve günde 200 MB kota uygulanır; disk doluluğu `%90` eşiğini aşarsa yeni yüklemeler reddedilir.
  - Yüklenen JPEG fotoğraflardaki konum/kamera verileri (EXIF/APP1 ve APP13) sunucuya kaydedilmeden önce bağımlılıksız bayt ayrıştırıcısıyla otomatik silinir.
- **Moderasyon ve Gizlilik İlkesi:**
  - **Sohbetler rutin olarak izlenmez.** Moderatör panelinde sohbet listesi gezme veya kullanıcı adıyla sohbet arama uç noktası kesinlikle yoktur.
  - `Community Official` (`1570767625188016259`) rolü her istekte Bot API'den **taze** doğrulanır; rolü olmayan herkese (Developer dahil, `MOD_PANEL_ALSO_DEVELOPER=true` olmadıkça) `404` döner. Developer yalnızca salt okunur `/sohbet/moderasyon/denetim` kaydını görebilir.
  - Yerel otomatik filtre yalnızca metinleri tarar ve **mesajları asla engellemez**; görsel ve videolar otomatik taranmaz (uygunsuz medya için kullanıcı rapor yolu kullanılır).
  - Raporlanan/işaretlenen vakaların kopyalanmış anlık görüntüleri ve korunan ekleri vaka kapandıktan sonra en geç **7 gün** içinde (açık vakalar en çok **90 gün** sonunda otomatik kapatılarak) silinir. İçeriksiz yaptırım ve denetim kayıtları (`modlog.jsonl`) **1 yıl** saklanır.

---

## ⚖️ Yayınlamadan Önce Doldurulacaklar (Yasal & KVKK Kontrol Listesi)

Yasal sayfalar (`content/legal/tr/` ve `content/legal/en/`) gerçek sistem veri akışına göre hazırlanmıştır ve hiçbir yasal bilgi kodda uydurulmamıştır. Yayına almadan önce şu adımları tamamlayın:

- [ ] **Veri Sorumlusu ve Künye Bilgilerini Railway Variables’a Girin:**
  - `LEGAL_CONTROLLER_NAME` *(Zorunlu)* — Veri sorumlusu / site işletmecisi adı veya unvanı
  - `LEGAL_ADDRESS` *(Zorunlu)* — Açık tebligat / iletişim adresi
  - `LEGAL_EMAIL` *(Zorunlu)* — Resmi KVKK / DMCA / hukuki iletişim e-postası
  - `LEGAL_VERBIS_STATUS` *(Zorunlu)* — VERBİS kayıt durumu veya muafiyet beyanı
  - `LEGAL_PHONE`, `LEGAL_KEP`, `LEGAL_REGISTRY_NO`, `LEGAL_TAX_NO` *(Varsa isteğe bağlı)*
- [ ] **Hazırlık Kontrol Betiğini Çalıştırın:** `node scripts/legal-check.js` (eksik alanları, `LEGAL_REVIEWED` durumunu ve tüm metin sürümlerini listeler; üretim öncesi `node scripts/legal-check.js --strict` ile doğrulayın).
- [ ] **Hukuki İnceleme Yaptırın:** `kvkk-aydinlatma.md` içindeki KVKK m.5 hukuki sebep eşleştirmelerini (*"hukuki doğrulama gerekli"* notlu alanlar), KVKK m.9 yurt dışı aktarım dayanağını ve `acik-riza.md` maddelerini bir hukukçuya inceletin.
- [ ] **Taslak Uyarısını Kaldırın:** Hukuki inceleme tamamlandığında Railway Variables üzerinden `LEGAL_REVIEWED=true` yapın (`false` iken her yasal sayfanın en üstünde taslak uyarısı gösterilir).
- [ ] **Saklama Sürelerini Gözden Geçirin:** `LEGAL_KVKK_RETENTION_DAYS` (varsayılan `1095` gün) ve `LEGAL_REPORT_RETENTION_DAYS` (varsayılan `365` gün) değerlerinin politikanızla uyumlu olduğundan emin olun.
- [ ] **Gelecek Özellikler Notu:** Google ile giriş, `pw_remember` hatırlama çerezi, doğrudan site üyeliği, sohbet profilinde oyun kullanıcı adlarının gösterilmesi ve **Google site üyesi uyarı/yaptırım sistemi** yayına alınmış; `kvkk-aydinlatma.md` (`v1.2`), `gizlilik-politikasi.md` (`v1.1`), `cerez-politikasi.md` (`v1.1`) ve `consents.config.js` buna göre güncellenmiştir.

---

## ⚖️ Site (Google) Üyeleri Uyarı & Yaptırım Sistemi (Discord → Site Eşleştirmesi)

`/yonetim/uyari` sayfasında mevcut Discord uyarı panelinin altında ikinci bir panel (**🌐 Site (Google) Üyelerine Uyarı Ver**) yer alır. Tüm kural maddeleri tek kaynak olan [`config/rules.config.js`](config/rules.config.js) dosyasından okunur; site karşılıkları, eşikler ve saklama süreleri [`config/warnings.config.js`](config/warnings.config.js) üzerinden yönetilir. Google site üyeleri asla yetkili olamayacağı için **`Y1–Y5` yetkili kuralları bu panelde bulunmaz**.

### 1. Puan Kademeleri ve Eşik Eşleştirme Tablosu

| Toplam Puan / Eşik | Discord Karşılığı (`warningManager.js`) | Site (Google Üyesi) Karşılığı (`warnings.config.js`) |
| :--- | :--- | :--- |
| **0–2 Puan** | Kademe 0 (Uyarı rolü yok) | Temiz / Kademe 0 |
| **3–5 Puan** | `Uyarı 1` rolü | `Uyarı 1` kademe etiketi |
| **6–8 Puan** | `Uyarı 2` rolü | `Uyarı 2` kademe etiketi |
| **9–11 Puan** | `Uyarı 3` rolü | `Uyarı 3` kademe etiketi |
| **12–14 Puan** | `Uyarı 4` rolü | `Uyarı 4` kademe etiketi |
| **10 Puan Eşiği (İLK geçiş — idempotent)** | Otomatik **+3 Gün Timeout** | **3 Gün Sohbet Susturma** (DM & Genel Sohbet yazma kapalı, okuma açık; tek `sanctions.json` kaydı) |
| **15+ Puan Eşiği (İLK geçiş — idempotent)** | `Uyarı 5` + **1 Hafta `@Askıda`** | `Uyarı 5` + **7 Gün Hesap Askıya Alma** (yalnızca Askı Ekranı, kendi bildirimleri ve `/kurallar` açık; sohbet ve diğer paneller kapalı) |

### 2. Kural Maddeleri Eşleştirme Tablosu (`M1–M13`, `D1–D3`)

| Madde | Kural Başlığı | Discord Karşılığı | Site (Google Üyesi) Karşılığı |
| :--- | :--- | :--- | :--- |
| **M1** | Küfür / Hakaret | `+2 Ceza Puanı` | `+2 Ceza Puanı` |
| **M2** | Reklam & Ticari Faaliyet | `Kalıcı Yasak (Permanent Ban)` | **Kalıcı Hesap Yasağı** (`status: banned`, `googleSub` özet listesi, yeniden üyelik engelli) |
| **M3** | Aşırı Övünme / Rahatsız Etme | `+1 Ceza Puanı` | `+1 Ceza Puanı` |
| **M4** | Taciz | `2 Gün Timeout` | **2 Gün Sohbet Susturma** |
| **M5** | Kanal Amacı Dışında Kullanım | `+3 Ceza Puanı` | `+3 Ceza Puanı` |
| **M6** | Cinsel İçerik | `+8 Ceza Puanı` | `+8 Ceza Puanı` |
| **M7** | Kavga Ortamı Yaratma | `+4 Ceza Puanı` | `+4 Ceza Puanı` |
| **M8** | Zorbalık & Soğutma | `+5 Ceza Puanı` | `+5 Ceza Puanı` |
| **M9** | Başka Sunucuya Davet | `Doğrudan @Yasaklı Rolü` | **Kalıcı Hesap Yasağı** (`status: banned`, `googleSub` özet listesi, yeniden üyelik engelli) |
| **M10** | +18 & Ayrımcılık Paylaşımı | `1 Gün Timeout` | **1 Gün Sohbet Susturma** |
| **M11** | Irkçılık & Ayrımcılık | `1 Gün Timeout` | **1 Gün Sohbet Susturma** |
| **M12** | Küçümseme & Dalga Geçme | `+2 Ceza Puanı` | `+2 Ceza Puanı` |
| **M13** | 3. Taraf Yazılım / Hile | `1 Gün Timeout` | **1 Gün Sohbet Susturma** |
| **D1** | Önemli Kanallara Boş Mesaj | `+3 Ceza Puanı` | `+3 Ceza Puanı` |
| **D2** | Sohbet & Ses Paneli Spamı | `+3 Ceza Puanı` | `+3 Ceza Puanı` |
| **D3** | Ses Kanalında Bildirim Yağmuru | `+3 Ceza Puanı` | `+3 Ceza Puanı` |
| **Y1–Y5** | Yetkili Disiplin Kuralları | Yetkili uyarısı / yetki alma | **Uygulanmaz** (Google üyeler yetkili olamaz) |

### 3. Otomatik Af, İptal, Saklama Süreleri ve Denetim
- **30 Günlük Otomatik Af (`WARNING_AMNESTY_DAYS=30`):** Son puanlı uyarısından itibaren 30 gün boyunca yeni ceza puanı almayan üyenin puanı ve kademesi günlük bakım işiyle (ve açılış telafisiyle) otomatik sıfırlanır. Süresi dolan 7 günlük hesap askısı ve sohbet susturmaları otomatik kalkar; kalıcı yasak yalnızca yetkili iptaliyle kalkar.
- **İptal ve Yeniden Hesaplama:** Yetkili, seçili üyenin sicil önizlemesinden herhangi bir kaydı zorunlu gerekçe yazarak iptal ettiğinde puanlar yeniden hesaplanır; o kayıttan doğan susturma, askı veya kalıcı yasak başka bir aktif kayıtla desteklenmiyorsa otomatik kaldırılır.
- **Saklama Süreleri ve Hesap Silme:** Uyarı kayıtları ve içeriksiz denetim kaydı (`${VOLUME}/warnings/audit.jsonl`) kayıt süresi dolduktan/af/iptal sonrası **12 ay** (`WARNING_RECORD_RETENTION_DAYS=365`, `WARNING_AUDIT_RETENTION_DAYS=365`), yalnızca yetkililere açık kanıt görselleri (`${VOLUME}/warnings/evidence/`) en fazla **6 ay** (`WARNING_EVIDENCE_RETENTION_DAYS=180`) saklanır ve günlük bakım işiyle silinir. Hesap silindiğinde kişisel bağlantılar ve kanıt dosyaları derhal kaldırılır, geriye yalnızca kimliksiz denetim satırı kalır.
- **Bildirim ve Gizlilik:** Uyarı/yaptırım alan Google üyesi bir sonraki girişinde ve çevrimiçiyken canlı SSE ile kapatılabilir bir bildirim kartı görür (kural kodu/adı, gerekçe, puan, yaptırım ve bitişi); **kanıt dosyası/bağlantısı üyeye asla gösterilmez**. Denetim kaydı gerekçe ve kanıt içeriği tutmaz.

---

## 🔑 Google ile Devam Et — Google Cloud Console Kurulum Adımları

`GOOGLE_CLIENT_ID` veya `GOOGLE_CLIENT_SECRET` boş bırakılırsa sitedeki **"Google ile devam et"** düğmesi otomatik olarak gizlenir ve sunucu açılışında tek satırlık uyarı yazar; mevcut Discord girişi kesintisiz çalışmaya devam eder. Google ile girişi etkinleştirmek için şu adımları izleyin:

1. **Google Cloud Console'a Giriş Yapın:** [https://console.cloud.google.com/](https://console.cloud.google.com/) adresine gidin ve yeni bir proje oluşturun (örn. `Piyade World`).
2. **OAuth Onay Ekranını (OAuth Consent Screen / Branding) Ayarlayın:**
   - Sol menüden **APIs & Services → OAuth consent screen** (veya **Google Auth Platform → Branding / Audience**) bölümüne girin.
   - Kullanıcı türünü **External** seçin.
   - Uygulama adı: `Piyade World`, kullanıcı destek e-postası ve geliştirici iletişim e-postası alanlarını doldurun.
   - Uygulama ana sayfası: `https://<sitenizin-adresi>`, Gizlilik Politikası: `https://<sitenizin-adresi>/yasal/gizlilik-politikasi`, Kullanım/Kurallar: `https://<sitenizin-adresi>/kurallar`.
   - Kapsamlar (Scopes): yalnızca `openid`, `email`, `profile` yeterlidir (ek hassas kapsam gerekmez).
   - Test kullanıcılarıyla doğruladıktan sonra uygulamayı **In production (Publish App)** durumuna alın.
3. **OAuth 2.0 İstemci Kimliği (Client ID) Oluşturun:**
   - **APIs & Services → Credentials → + Create Credentials → OAuth client ID** yolunu izleyin.
   - Uygulama türü olarak **Web application** seçin.
   - **Authorized JavaScript origins** bölümüne sitenizin kök adresini ekleyin:
     - Canlı (Railway): `https://piyade-team-tsb.up.railway.app` (veya `BASE_URL` değeriniz)
     - Yerel test için (isteğe bağlı): `http://localhost:3001`
   - **Authorized redirect URIs** bölümüne tam geri dönüş adresini ekleyin:
     - Canlı: `${BASE_URL}/auth/google/callback` (örn. `https://piyade-team-tsb.up.railway.app/auth/google/callback`)
     - Yerel test için (isteğe bağlı): `http://localhost:3001/auth/google/callback`
4. **Railway Variables'a Ekleyin:**
   - Oluşturulan **Client ID** değerini Railway'de `GOOGLE_CLIENT_ID` olarak ekleyin.
   - Oluşturulan **Client Secret** değerini Railway'de `GOOGLE_CLIENT_SECRET` olarak ekleyin.
   - `BASE_URL` değişkeninin sondaki `/` olmadan canlı adresinizle birebir aynı olduğundan emin olun (`https://piyade-team-tsb.up.railway.app`).
   - İsteğe bağlı olarak yeni Google üyelerinin sohbette dosya/bağlantı bekleme süresini `NEW_MEMBER_RESTRICTION_HOURS=24` ile ayarlayabilirsiniz.
5. **Önemli Deploy Sırası:** Google site üyeliği bot API'sindeki `site-guest`, `site-service` ve `/api/roblox/site-claims` uçlarını kullanır. **Önce `tsb.piyade.bot` (Bot), ardından `piyade.team.site` (Site) deploy edilmelidir.**

---

## 🧹 Volume / Disk Temizlik Notu

> **Not:** Volume'daki eski veriler elle silinebilir (`data/warriors.json`, `data/warriors.json.bak`, `data/roblox-avatars-cache.json` ve varsa eski özel görseller). Bu dosyalara ait kodlar projeden tamamen kaldırılmıştır; uygulama açılışında veya çalışma zamanında bu dosyalar okunmaz ve yazılmaz.
