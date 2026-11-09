# ⚔️ Piyade Team | TSB — Resmi Web Portalı (Thin Client)

Bu proje, **"Piyade Team | TSB"** Discord topluluğu ve Roblox *The Strongest Battlegrounds* klanı için geliştirilmiş **ince ön yüz (thin client)** web uygulamasıdır.

> **Mimari Prensip:**  
> Bu web sitesi kendi başına veritabanı tutmaz, ceza puanı hesaplamaz veya kural mantığı yürütmez. Tüm veri, kayıt doğrulaması, rol hiyerarşisi ve uyarı/ceza işlemleri **Discord Botunun REST API'si (`BOT_API_URL` + `API_SECRET`)** üzerinden güvenli bir şekilde gerçekleştirilir.

---

## 🚀 Özellikler

### 1. Herkese Açık Sayfalar
- **Anasayfa (`/`)**: Klan tanıtımı, canlı aktif kayıtlı üye sayısı, Ghost Fibers arka plan, *Scroll Reveal Text* manifestosu ve interaktif *Meteors* (dilek gökyüzü) bileşeni.
- **Genel Kurallar (`/kurallar`)**: Tek bir `rules.js` (`config/rules.config.js`) dosyasından beslenen Katılımcı (`M1–M13`), Düzen (`D1–D3`) ve Yetkili (`Y1–Y5`) kuralları (Türkçe & İngilizce destekli).
- **Atış Poligonu & Dilek Gökyüzü (`/etkilesim`)**: Nexus UI *Dart Rating* (basılı tutup nişan alarak veya `0-9` tuşlarıyla dart fırlatma), *Meteors* ve *Scroll Reveal Text*.
- **Kayıt Ol (`/kayit`)**: Önce Discord OAuth2 (`scope: identify`) ile giriş ister, ardından `Gerçek Ad`, `Cinsiyet` ve `Roblox Nick / ID / Profil Linki` bilgilerini `POST /api/register` ile bota iletir. Kullanıcının mevcut başvuru durumunu (`Beklemede`, `Onaylandı`, `Reddedildi`) canlı olarak gösterir.
- **Çok Dilli Destek (`TR` / `EN`)**: Navbar üzerindeki dil seçici ile Türkçe ve İngilizce arasında anında geçiş yapılabilir. Dil tercihi 1 yıl boyunca çerezde (`lang`) saklanır; çerez yoksa tarayıcının `Accept-Language` başlığından otomatik algılanır.

### 2. Kayıtlı Üye Sayfaları (`1559604702143062016` ve Üstü)
- **Profilim (`/profil`)**: Discord ve Roblox hesap eşleşmesi, Tryout seviyesi, VS istatistikleri ve aktif ceza puanı / sicil durumu.
- **Tryout Tablosu (`/tryout`)**: 37 kademeli (`Low weak 4` → `High strong 0`) resmi klan sıralaması.
- **Acil Takviye (`/takviye`)**: Sunucudaki anlık aktif üye sayısını ve 5 dakikalık bekleme süresini (canlı geri sayım sayacı ile) gösterir; tek tıkla Discord acil yardım kanalına çağrı gönderir.

### 3. Yönetim Sayfaları (`Yönetmenlik 1559614111128490044` + `Developer 1561777507223601353`)
- **Uyarı Ver (`/yonetim/uyari`)**: Üye arama/seçme, Sözlü veya Resmi (`M/D/Y` kural kodlu) uyarı uygulama ve **bellek içi (in-memory) kanıt görseli yükleme**. Yüklenen kanıt görselleri sunucu diskine kaydedilmez (`multer.memoryStorage`), **magic-byte** kontrolünden (sadece gerçek `PNG`, `JPG`, `WEBP`; `SVG` reddedilir, maks `5 MB`) geçirilerek doğrudan Bot API'sine iletilir. Hem sitede hem botta rol hiyerarşisi denetlenir.
- **Üye Bilgileri (`/yonetim/uyeler`)**: Tüm üyelerde arama yapma ve seçilen üyenin Discord rolleri, Roblox kaydı, Tryout geçmişi, VS istatistikleri ve tüm disiplin sicil geçmişini düzenli kartlar halinde inceleme. Her üye detayı görüntüleme işlemi denetim loguna (kim, kimin detayına, ne zaman) kaydedilir.

---

## 🛠️ Teknoloji Yığını & Güvenlik

- **Backend**: Node.js (`>=20.0.0`, CommonJS), Express.js
- **Şablon Motoru**: EJS (Tüm kullanıcı verileri `<%= %>` ile XSS'e karşı escape edilir)
- **Çok Dilli Yapı (i18n)**: `locales/tr.json`, `locales/en.json` ve `config/rules.config.js`
- **Güvenlik Katmanları**:
  - `app.set('trust proxy', 1)` ile Railway reverse proxy uyumluluğu
  - `express-session` + `PersistentSessionStore` (`httpOnly`, `sameSite: 'lax'`, production'da `secure: true`; `MemoryStore` kullanılmaz)
  - Discord OAuth2 `state` parametresi üretimi ve callback'te zorunlu doğrulaması (eşleşmezse `HTTP 403`)
  - Yönetim `POST` işlemlerinde (`requireFreshManagement`) önbellek kullanmadan Bot API'den taze rol doğrulaması (sunucudan çıkan veya yetkisi alınan kullanıcının oturumu anında sonlandırılır)
  - Kayıt ve Uyarı formlarında tek kullanımlık `_idempotencyKey` ve istemci tarafı buton kilitleme ile çift gönderim (double-submit) engelleme
  - `helmet` CSP (`img-src` yalnızca `'self'`, `data:`, `https://cdn.discordapp.com`, `https://tr.rbxcdn.com`, `https://t0.rbxcdn.com`–`https://t9.rbxcdn.com`)
  - Açılışta zorunlu ortam değişkeni (`ENV`) doğrulaması (eksik veya hatalı değişken varsa secret değerlerini loglamadan anlaşılır hata ile durur)

---

## ⚙️ Ortam Değişkenleri (`.env`)

Proje kök dizininde `.env.example` dosyasını `.env` olarak kopyalayıp aşağıdaki değişkenleri doldurun:

| Değişken | Açıklama | Örnek Değer |
| :--- | :--- | :--- |
| `PORT` | Web sitesinin çalışacağı port (Railway otomatik atar) | `3001` |
| `NODE_ENV` | Çalışma ortamı (`development` veya `production`) | `production` |
| `BASE_URL` | Sitenin yayınlandığı tam adres (sonunda `/` olmadan) | `https://piyade-site.up.railway.app` |
| `DISCORD_CLIENT_ID` | Discord Developer Portal Application Client ID | `1234567890123456789` |
| `DISCORD_CLIENT_SECRET` | Discord Developer Portal OAuth2 Client Secret | `sizin_client_secret_degeriniz` |
| `SESSION_SECRET` | Oturum çerezlerini imzalamak için en az 16 karakterli gizli anahtar | `cok_guclu_rastgele_session_anahtari_123` |
| `BOT_API_URL` | Discord botunun REST API adresi (Railway Private Network veya genel URL) | `http://piyade-bot.railway.internal:3000` |
| `API_SECRET` | Botun `.env` dosyasındaki `API_SECRET` ile **birebir aynı** şifre | `bot_ile_ayni_gizli_api_anahtari` |

---

## 🌐 Railway Özel Ağ (`railway.internal`) ile `BOT_API_URL` Kullanımı

Bot servisiniz ve Web Sitesi servisiniz aynı Railway projesi içerisindeyse, iki servis arasındaki iletişimi genel internet yerine **Railway Özel Ağı (Private Networking)** üzerinden sıfır gecikme ve maksimum güvenlikle yapabilirsiniz:

1. Railway panelinizde **Bot** servisinizin **Settings > Networking > Private Networking** bölümündeki özel alan adını kontrol edin (Örn: `piyade-bot.railway.internal`).
2. Bot servisinizin çalıştığı portu kontrol edin (Örn: `PORT=3000` veya `8080`).
3. **Site** servisinizin **Variables** sekmesinde `BOT_API_URL` değişkenini şu şekilde tanımlayın:
   ```env
   BOT_API_URL=http://piyade-bot.railway.internal:3000
   ```
   *(Not: Özel ağ içi iletişimde `https://` yerine `http://` ve port numarası kullanılır. Dış ağ üzerinden bağlanacaksanız `https://bot-adresiniz.up.railway.app` şeklinde tanımlayabilirsiniz).*
4. Bot API istemcisi (`services/botApiClient.js`) **8 saniye zaman aşımı (timeout)**, geçici ağ hatalarında **1 kez otomatik yeniden deneme (retry)** ve net hata sınıflaması (`TIMEOUT`, `NETWORK_UNREACHABLE`, `AUTH_SECRET_MISMATCH`, `FORBIDDEN_HIERARCHY`, `NOT_FOUND`, `VALIDATION_ERROR`) ile donatılmıştır.

---

## 🔐 Discord Developer Portal Redirect URI Ayarı

Discord ile girişin çalışması için:

1. [Discord Developer Portal](https://discord.com/developers/applications) adresine gidin ve uygulamanızı seçin.
2. Sol menüden **OAuth2** sekmesine tıklayın.
3. **Redirects** bölümüne **Add Redirect** diyerek aşağıdaki adresleri ekleyin:
   - **Yerel geliştirme için:** `http://localhost:3001/auth/discord/callback`
   - **Railway yayını için:** `https://<sitenizin-railway-adresi>.up.railway.app/auth/discord/callback`
4. **Save Changes** butonuna basın.

---

## 🎨 Tema ve Menü Özelleştirme

- **Tema & Renkler**: Tüm renk paleti, arka plan gradyanları ve cam (glassmorphism + blur) efektleri tek bir dosyada toplanmıştır: **`public/css/theme.css`**.
- **Modüler Menü**: Yeni bir sayfa veya menü öğesi eklemek için **`menu.config.js`** (`config/menu.config.js`) içerisindeki `MENU_ITEMS` dizisine yeni bir nesne eklemeniz yeterlidir.
- **Kurallar**: Kuralları düzenlemek veya yeni madde eklemek için **`rules.js`** (`config/rules.config.js`) dosyasını düzenlemeniz yeterlidir.
