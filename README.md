# ⚔️ Piyade Team | TSB Web Sitesi

**Piyade Team (The Strongest Battlegrounds)** Discord topluluğu için geliştirilmiş, yüksek performanslı, güvenli ve **ince (thin client)** web portalı.

Bu web sitesi doğrudan veri tabanı veya ceza mantığı barındırmaz; tüm verilerini, yetkilendirmelerini ve iş mantığını klanın Discord botunun REST API'sinden (`BOT_API_URL` + `API_SECRET`) çeker.

---

## 📑 İçindekiler
1. [Mimari ve Temel Özellikler](#1-mimari-ve-temel-özellikler)
2. [Teknoloji Yığını ve Güvenlik](#2-teknoloji-yığını-ve-güvenlik)
3. [Klasör ve Dosya Yapısı](#3-klasör-ve-dosya-yapısı)
4. [Çevre Değişkenleri (.env Listesi)](#4-çevre-değişkenleri-env-listesi)
5. [Discord Developer Portal (OAuth2) Ayarları](#5-discord-developer-portal-oauth2-ayarları)
6. [Railway Üzerinde Adım Adım Dağıtım (Deployment)](#6-railway-üzerinde-adım-adım-dağıtım-deployment)
7. [Tema ve Renk Özelleştirme Rehberi](#7-tema-ve-renk-özelleştirme-rehberi)
8. [Modüler Menü ve Kural Yönetimi](#8-modüler-menü-ve-kural-yönetimi)
9. [Bot API Çevrimdışı Durumu ve Hata Yönetimi](#9-bot-api-çevrimdışı-durumu-ve-hata-yönetimi)

---

## 1. Mimari ve Temel Özellikler

```mermaid
flowchart LR
    User["Kullanıcı / Yetkili"] --> Web["Piyade Web Sitesi (Express + EJS)"]
    Web -->|OAuth2 (identify)| Discord["Discord API"]
    Web -->|Bearer API_SECRET + X-Actor-Id| BotAPI["Bot REST API (Express)"]
    BotAPI --> DB[("database.json (Railway Volume)")]
```

- **İnce Ön Yüz (Thin Client):** Web sunucusu kural hesaplamaz veya ceza mantığı kurmaz. Tüm işlemler (kayıt, ceza verme, kanıt iliştirme, tryout, yardım çağrısı) botun REST API'sine delege edilir.
- **60 Saniyelik Rol Senkronizasyonu:** Kullanıcı rolleri OAuth2 token'ı ile değil, giriş anında ve her 60 saniyede bir doğrudan bot API'sinin `/api/member/:id/roles` uç noktasından taze olarak çekilir.
- **Sunucu Taraflı Yetki Kontrolü:** Menü linkleri sadece arayüzde gizlenmekle kalmaz; her bir route middleware katmanında (`requireRegisteredMember`, `requireManagement`) sunucu tarafında sıkı bir şekilde denetlenir.
- **Kayıtsız Kullanıcı Koruması:** Sunucuda olmayan veya sadece Kayıtsız rolüne sahip olan kullanıcılara doğrudan **"Önce Kayıt Ol"** ekranı sunulur.

---

## 2. Teknoloji Yığını ve Güvenlik

- **Platform:** Node.js (CommonJS, `node v20+` / `v24+`)
- **Sunucu & Şablon:** Express.js 4, EJS Template Engine
- **Oturum Yönetimi:** `express-session` (`httpOnly: true`, `secure: production`, `sameSite: 'lax'`)
- **Güvenlik Katmanları:**
  - `helmet`: Gelişmiş HTTP güvenlik başlıkları ve Discord CDN içerik güvenlik politikası (CSP).
  - **CSRF Koruması:** Durum değiştiren tüm POST formlarında ve AJAX çağrılarında oturum tabanlı eşleşme.
  - **Rate Limiting:** Genel site, giriş ve form gönderimleri için ayrı pencerelerde istek sınırlaması.
  - **Secrets İzolasyonu:** Discord Client Secret, API Secret ve Session Secret kesinlikle istemciye (tarayıcıya) iletilmez.

---

## 3. Klasör ve Dosya Yapısı

```
piyade.team.site/
├── .env.example              # Örnek çevre değişkenleri şablonu
├── .gitignore                # Git dışı tutulacak dosyalar (node_modules, .env, vb.)
├── package.json              # Bağımlılıklar ve npm betikleri
├── server.js                 # Express ana giriş noktası ve sunucu motoru
├── rules.js                  # Tek noktadan kural yönetimi köprüsü
├── menu.config.js            # Tek noktadan menü yönetimi köprüsü
│
├── config/
│   ├── app.config.js         # Çevre değişkenleri ve zamanlayıcı ayarları
│   ├── roles.config.js       # Sunucu rol ID'leri ve yetki kontrol fonksiyonları
│   ├── rules.config.js       # Genel Kurallar (M1-M13, D1-D3, Y1-Y5)
│   └── menu.config.js        # Modüler dinamik menü yapılandırması
│
├── services/
│   ├── botApiClient.js       # Bot REST API istemcisi (Bearer Auth + X-Actor-Id)
│   └── discordAuthService.js # Discord OAuth2 token takası ve profil çekimi
│
├── middlewares/
│   ├── auth.js               # 60sn rol senkronizasyonu ve yetki denetimleri
│   ├── csrf.js               # CSRF koruma middleware'i
│   ├── rateLimiter.js        # İstek sınırlayıcılar
│   └── errorHandler.js       # Bot API çevrimdışı ve 404/403/500 yakalayıcıları
│
├── routes/
│   ├── public.js             # Anasayfa, kurallar, kayıt ol (GET+POST), durum ekranı
│   ├── auth.js               # Discord OAuth2 giriş, callback ve çıkış rotaları
│   ├── member.js             # /profil, /tryout, /takviye (Kayıtlı Üye ve üstü)
│   └── admin.js              # /yonetim/uyari, /yonetim/uyeler (Yönetmenlik ve Developer)
│
├── public/
│   ├── css/
│   │   ├── theme.css         # TEK CSS DEĞİŞKENLERİ DOSYASI (Tema ve Renkler)
│   │   └── style.css         # Duyarlı (responsive) UI ve bileşen stilleri
│   ├── js/
│   │   └── app.js            # İstemci tarafı scriptleri (canlı sayaç, üye arama vb.)
│   └── uploads/              # Ceza kanıt görselleri için yükleme dizini
│
└── views/
    ├── layouts/
    │   ├── header.ejs        # Navbar ve menü bileşeni
    │   └── footer.ejs        # Footer bileşeni
    ├── pages/
    │   ├── home.ejs          # Anasayfa (tanıtım ve canlı aktif üye sayısı)
    │   ├── rules.ejs         # Genel Kurallar sayfası
    │   ├── register.ejs      # Kayıt Başvuru sayfası (durum kartlı)
    │   ├── not-registered.ejs# Kayıtsız üye bilgilendirme ekranı
    │   ├── profile.ejs       # Üye Profilim
    │   ├── tryout.ejs        # 37 aşamalı Tryout Sıralama Tablosu
    │   ├── help.ejs          # Acil Takviye Paneli (cooldown & canlı sayaç)
    │   ├── admin-warn.ejs    # Yönetim: Uyarı Ver (üyeler, kurallar, kanıt)
    │   └── admin-members.ejs # Yönetim: Üye Arama ve Detaylı Sicil Kartları
    └── errors/
        ├── 404.ejs           # Sayfa Bulunamadı
        ├── 403.ejs           # Yetkisiz Erişim
        ├── 500.ejs           # Sunucu İçi Hata
        └── bot-offline.ejs   # Bot API Çevrimdışı Anlaşılır Hata Ekranı
```

---

## 4. Çevre Değişkenleri (.env Listesi)

Sitenin çalışabilmesi için `.env` dosyasında (veya Railway Dashboard Variables sekmesinde) aşağıdaki değişkenlerin tanımlanması zorunludur:

| Değişken Adı | Açıklama | Örnek Değer |
| :--- | :--- | :--- |
| `PORT` | Web uygulamasının dinleyeceği port | `3001` (Railway otomatik atar) |
| `NODE_ENV` | Çalışma modu (`development` veya `production`) | `production` |
| `BASE_URL` | Sitenin tarayıcıdan erişilen genel adresi | `https://piyade-site.up.railway.app` |
| `BOT_API_URL` | Discord botunun çalıştığı REST API adresi | `https://piyade-bot.up.railway.app` |
| `API_SECRET` | Bot REST API'si ile eşleşen gizli güvenlik anahtarı | `super_secret_piyade_bot_api_key_2026` |
| `DISCORD_CLIENT_ID` | Discord Developer Portal Uygulama ID'si | `1559...` |
| `DISCORD_CLIENT_SECRET` | Discord Developer Portal OAuth2 Secret'ı | `abc123xyz...` |
| `SESSION_SECRET` | Çerezleri şifrelemek için rastgele karmaşık anahtar | `piyade_session_secret_change_me_in_production` |

---

## 5. Discord Developer Portal (OAuth2) Ayarları

Kullanıcıların Discord hesaplarıyla siteye tek tıkla giriş yapabilmesi için aşağıdaki adımları tamamlayınız:

1. [Discord Developer Portal](https://discord.com/developers/applications) adresine gidin.
2. Botunuzun bağlı olduğu uygulamayı seçin (veya yeni bir uygulama açın).
3. Sol menüden **OAuth2** sekmesine tıklayın.
4. **Redirects (Yönlendirme Adresleri)** bölümüne sitenizin callback URL'lerini ekleyin:
   - Yerel test için: `http://localhost:3001/auth/discord/callback`
   - Canlı (Railway) için: `https://<sitenizin-railway-adresi>.up.railway.app/auth/discord/callback`
5. **Save Changes** butonuna basın.
6. **Client ID** ve **Client Secret** değerlerini kopyalayarak `.env` dosyanıza ekleyin.
7. *Not:* Bot için ek bir izin gerekmez; OAuth2 için yalnızca standart `identify` kapsamı (scope) kullanılır.

---

## 6. Railway Üzerinde Adım Adım Dağıtım (Deployment)

Bu site, Discord botunuzdan ayrı bir servis olarak **tamamen ücretsiz Railway alan adı** (`.up.railway.app`) ile çalışacak şekilde tasarlanmıştır.

### Adım 1: GitHub Reposunu Oluşturma
Projeyi GitHub hesabınızda `piyade.team.site` isimli yeni bir depoya (repository) gönderin:
```bash
git init
git add .
git commit -m "feat: Piyade Team web sitesi ilk sürüm"
git branch -M main
git remote add origin https://github.com/<kullanici-adiniz>/piyade.team.site.git
git push -u origin main
```

### Adım 2: Railway Üzerinde Yeni Servis Açma
1. [Railway.app](https://railway.app) hesabınıza giriş yapın.
2. Botunuzun bulunduğu mevcut projeye gidin (veya **New Project** deyin).
3. **+ New** butonuna basarak **GitHub Repo** seçeneğini seçin.
4. `piyade.team.site` deponuzu seçin.

### Adım 3: Ücretsiz Alan Adı (Public Networking) Tanımlama
1. Yeni oluşan `piyade.team.site` servisine tıklayın.
2. Üst menüden **Settings** sekmesine gelin.
3. **Networking** başlığı altındaki **Generate Domain** butonuna basın.
4. Railway size `piyade-team-site-production.up.railway.app` benzeri ücretsiz bir HTTPS adresi tahsis edecektir. Bu adresi kopyalayın.

### Adım 4: Ortam Değişkenlerini (Variables) Tanımlama
Servisin **Variables** sekmesine gidin ve aşağıdaki anahtarları girin:
- `NODE_ENV`: `production`
- `BASE_URL`: `https://<3-adimda-aldiginiz-railway-adresi>.up.railway.app`
- `BOT_API_URL`: Botunuzun çalıştığı Railway adresi (Örn: `https://tsb-piyade-bot-production.up.railway.app`)
- `API_SECRET`: Botunuzun `API_SECRET` değişkeni ile **birebir aynı** olan gizli anahtar.
- `DISCORD_CLIENT_ID`: Discord uygulama ID'niz.
- `DISCORD_CLIENT_SECRET`: Discord uygulama gizli anahtarınız.
- `SESSION_SECRET`: Rastgele 32+ karakterlik şifreleme metni.

> [!NOTE]
> `PORT` değişkenini Railway kendisi otomatik olarak tanımlar. Elle girmenize gerek yoktur.

### Adım 5: Discord Developer Portal'a Canlı URL'yi Ekleme
[5. Bölüm](#5-discord-developer-portal-oauth2-ayarları)'de belirtildiği gibi, Railway'in verdiği canlı adresi (`https://<railway-adresi>/auth/discord/callback`) Discord Developer Portal'daki **Redirects** listesine ekleyin.

---

## 7. Tema ve Renk Özelleştirme Rehberi

Sitenin tüm tasarım, renk, yazı tipi ve kenarlık stilleri **tek bir dosyadan** kontrol edilir:
📂 [`public/css/theme.css`](file:///public/css/theme.css)

Renkleri ve temayı değiştirmek için yalnızca bu dosyadaki CSS değişkenlerini düzenlemeniz yeterlidir:

```css
:root {
  /* Ana Marka Rengi (Mavi) */
  --color-primary: #0099ff;
  --color-primary-hover: #0080d9;

  /* İkincil Vurgu Rengi (Altın / Turuncu) */
  --color-accent: #ff8c00;

  /* Arka Plan Tonları (Koyu Gece Teması) */
  --bg-body: #0b0f19;
  --bg-surface: #111827;
  --bg-card: #151e32;
  --bg-card-hover: #1c2742;

  /* Durum Renkleri */
  --color-success: #10b981;  /* Onaylandı & Aktif */
  --color-warning: #f59e0b;  /* Beklemede & Sözlü Uyarı */
  --color-danger: #ef4444;   /* Ceza, Ban & Kırmızı */
}
```

Değişiklik kaydedildiği anda tüm sitedeki butonlar, rozetler, kart kenarlıkları ve başlıklar yeni renklere anında uyum sağlar.

---

## 8. Modüler Menü ve Kural Yönetimi

### Yeni Sayfa ve Menü Ekleme
Proje kökündeki [`menu.config.js`](file:///menu.config.js) dosyası menüleri yönetir. Yeni bir sayfa eklemek için listeye yeni bir nesne eklemeniz yeterlidir:

```javascript
{
  id: 'yeni_sayfa',
  title: 'Turnuva Fikstürü',
  path: '/turnuva',
  category: 'member',           // 'public' | 'member' | 'management'
  minLevel: 'registered',       // 'public' | 'registered' | 'management' | 'developer'
  badge: 'Yeni',
  visible: (user) => Boolean(user && isRegisteredMember(user.roles, user.level)),
}
```

### Kural Maddelerini Düzenleme
Proje kökündeki [`rules.js`](file:///rules.js) dosyası Genel Kurallar sayfasını ve Uyarı Verme formunu ortak besler. Bir maddenin puanını veya metnini değiştirmek için yalnızca bu dosyayı güncellemeniz yeterlidir.

---

## 9. Bot API Çevrimdışı Durumu ve Hata Yönetimi

Site, Discord botunun kapalı veya yeniden başlatılıyor olma ihtimaline karşı toleranslıdır:
- Bot API'ye ulaşılamadığında (`ECONNREFUSED`, `ETIMEDOUT` veya 503), kullanıcıya beyaz sayfa veya anlamsız kod hataları yerine **özel tasarlanmış Türkçe 503 sayfası** (`views/errors/bot-offline.ejs`) gösterilir.
- Sayfa üzerinde sorunun neden kaynaklanabileceğine dair kontrol listesi ve **"Bağlantıyı Yeniden Dene"** butonu bulunur.
- Anasayfa gibi genel sayfalarda bot kapalı olsa bile sayfa çökmez; son güvenli varsayılanlarla açılmaya devam eder.
