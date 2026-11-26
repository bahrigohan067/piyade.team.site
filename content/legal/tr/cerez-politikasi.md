---
title: Çerez Politikası
version: 1.1
lastUpdated: 2026-11-26
---

# Çerez ve Tarayıcı Depolama Politikası

**Piyade World (Piyade Dünyası)** web sitesinde reklam, davranışsal profilleme veya üçüncü taraf izleme (tracking) çerezleri **kullanılmaz**. Sitenin güvenli ve doğru çalışması için yalnızca aşağıda tam listesi verilen zorunlu çerezler ve yerel tarayıcı depolama anahtarları kullanılır.

## 1. Kullanılan Çerezler (Cookies) Envanteri

| Ad | Amaç | Süre | Tür |
| --- | --- | --- | --- |
| `piyade.sid` | Giriş oturumunuzu korumak, CSRF güvenlik belirtecini, OAuth2 `state`/`nonce`/PKCE doğrulamasını ve form tekillik anahtarlarını (idempotency) saklamak (`HttpOnly`, üretimde `Secure`, `SameSite=Lax`). | 24 saat | Zorunlu (Oturum / Güvenlik) |
| `lang` | Seçtiğiniz site dilini (`tr` veya `en`) sonraki ziyaretlerinizde hatırlamak (`SameSite=Lax`, üretimde `Secure`). | 1 yıl | Zorunlu / İşlevsel |
| `pw_remember` | Google ile giriş yapan doğrudan site üyelerinin oturumunu güvenli biçimde yenileyen "beni hatırla" belirteci (`HttpOnly`, üretimde `Secure`, `SameSite=Lax`). `selector.validator` yapısındadır; sunucuda yalnızca `validator` özet değeri (SHA-256) saklanır, her kullanımda yenilenir (döndürülür), kullanıcı başına en çok 5 cihaz tutulur, uyumsuz belirteçte çalınma önlemi olarak tüm cihazlar iptal edilir ve çıkışta veya Profil → Oturumlarım ekranından silinir. Discord oturumlarını etkilemez. | 90 gün (kullanımda yenilenir) | İşlevsel / Oturum Sürekliliği |

## 2. Tarayıcı Yerel Depolama (`localStorage` ve `sessionStorage`) Envanteri

Bu anahtarlar sunucuya reklam amaçlı gönderilmez; yalnızca cihazınızdaki tarayıcı arayüz deneyimini hatırlamak için kullanılır:

| Anahtar Adı | Depo | Amaç | Süre | Tür |
| --- | --- | --- | --- | --- |
| `piyade_sidebar_state` | `localStorage` | Sol gezinme menüsünün açık (`open`) veya daraltılmış (`collapsed`) durumunu hatırlamak. | Siz temizleyene kadar | İşlevsel (Arayüz) |
| `piyade_activity_panel_state` | `localStorage` | Sol menüdeki "Etkinliğim" panelinin açık/kapalı tercihini saklamak. | Siz temizleyene kadar | İşlevsel (Arayüz) |
| `piyade_chat_recent_emojis` | `localStorage` | Sohbet ekranında son kullandığınız en fazla 24 emojiyi kendi cihazınızda listelemek. | Siz temizleyene kadar | İşlevsel (Arayüz) |
| `ui-sounds` | `localStorage` | Arayüz ses efektlerinin kapalı (`off`) olup olmadığını hatırlamak. | Siz temizleyene kadar | İşlevsel (Arayüz) |
| `piyade_cookie_notice_ack` | `localStorage` | Alt kısımdaki zorunlu çerez bilgi çubuğunda "Anladım" düğmesine bastığınızı hatırlamak. | Siz temizleyene kadar | İşlevsel (Arayüz) |
| `piyade_chat_draft_<userId>` | `sessionStorage` | Sohbette henüz göndermediğiniz taslak metni sekme yenilenirken kaybetmemek. | Sekme kapanınca silinir | İşlevsel (Geçici) |
| `piyade_dock_last_y` | `sessionStorage` | Sol menüdeki aktif gösterge animasyonunun son dikey konumunu tutmak. | Sekme kapanınca silinir | İşlevsel (Geçici) |

## 3. Üçüncü Taraf Bağlantıları

Site yalnızca yazı tipi yüklemek için **Google Fonts** (`fonts.googleapis.com`, `fonts.gstatic.com`) ve profil/avatar görselleri için **Discord CDN** (`cdn.discordapp.com`) ile **Roblox CDN** (`rbxcdn.com`) kaynaklarına standart içerik isteği gönderir. Reklam ağı veya analiz pikseli bulunmaz.

## 4. Çerezleri Nasıl Yönetebilir veya Silebilirsiniz?

Tarayıcınızın ayarlar menüsünden (Gizlilik ve Güvenlik → Çerezler ve Site Verileri) mevcut çerezleri ve `localStorage` kayıtlarını dilediğiniz zaman temizleyebilirsiniz. `piyade.sid` zorunlu oturum çerezini engellemeniz halinde giriş yapma, form gönderme (CSRF koruması) ve üye panelleri çalışmayacaktır.

Sorularınız için [KVKK Aydınlatma Metni](/yasal/kvkk-aydinlatma) sayfasını inceleyebilir veya `{{LEGAL_EMAIL}}` adresine ulaşabilirsiniz.
