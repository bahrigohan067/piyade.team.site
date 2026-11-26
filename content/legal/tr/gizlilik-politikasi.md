---
title: Gizlilik Politikası
version: 1.1
lastUpdated: 2026-11-26
---

# Gizlilik Politikası (Web Sitesi ve Discord Botu)

Bu Gizlilik Politikası, **Piyade World (Piyade Dünyası)** web sitesi ({{SITE_URL}}) ile bu siteye bağlı çalışan Discord topluluk botunun kişisel verileri nasıl topladığını, kullandığını, koruduğunu ve sildiğini açıklar.

## 1. Kapsam ve Veri Sorumlusu

Bu politika hem web sitemizi hem de bağlı Discord botumuzu kapsar. Veri sorumlusu bilgileri: **{{LEGAL_CONTROLLER_NAME}}** | İletişim: `{{LEGAL_EMAIL}}` | Adres: `{{LEGAL_ADDRESS}}`.

## 2. Web Sitesi ve Discord Botu Arasındaki Veri Akışı

Web sitesi **"ince ön yüz" (thin client)** mimarisiyle çalışır:

1. **Discord ile Giriş (OAuth2):** Giriş sırasında yalnızca `identify` izni istenir (Discord e-postanız istenmez). Oturumda Discord ID, kullanıcı adı, görünen ad, avatar URL’si ve sunucu rol seviyeleriniz tutulur; her 60 saniyede bir Bot API üzerinden taze rol kontrolü yapılır.
2. **Discord Bot REST API:** Topluluk kayıt başvurunuz (isim/takma ad, cinsiyet, oyun kullanıcı adları, Roblox doğrulaması), disiplin/uyarı kayıtlarınız, aylık oyun etkinliğiniz ve üye rehberi botun korumalı API’sinden sunucu-içi gizli anahtarla çekilir.
3. **Aylık Oyun Etkinliği ve Gizlilik Tercihi:** Oyun süreleri yalnızca bulunulan takvim ayı için toplanır ve her ayın 1’inde sıfırlanır. Discord’da oyun takibini kapatan (`tracking: false`) üyelerin süresi tutulmaz ve ne kişisel panelde ne de anonim sıralamada görünür.
4. **Google ile Giriş, Doğrudan Site Üyeliği ve Uyarı Sicili:** Discord hesabı olmayanlar için Google OpenID Connect (`sub`, e-posta, ad — Google profil fotoğrafı alınmaz), isteğe bağlı "beni hatırla" çerezi (`pw_remember`, en fazla 5 cihaz), oyun kullanıcı adlarının (isteğe bağlı olarak) sohbet profil kartında gösterilmesi ve site (Google) üyelerine yönelik uyarı/yaptırım sicili aktiftir. Uyarı kayıtları ve içeriksiz denetim satırları kayıt süresi dolduktan/af/iptal sonrası **12 ay** (365 gün), yalnızca yetkililerin erişebildiği kanıt dosyaları ise en fazla **6 ay** (180 gün) saklanır ve günlük bakım göreviyle otomatik silinir. Hesabınızı sildiğinizde uyarılara ait kişisel bağlantılar ve kanıt dosyaları derhal kaldırılır, geriye yalnızca kimlik içermeyen bir denetim satırı kalır.

## 3. Sohbet Gizliliği (`CHAT_ENABLED`: Genel Sohbet Grubu ve Birebir Sohbet)

- **Genel Sohbet Grubu (Herkese Açık):** Sohbete erişimi olan tüm Discord ve site üyeleri zorunlu **Genel Sohbet** grubunun otomatik üyesidir. Bu grupta paylaşılan mesajlar sohbete erişimi olan herkese görünür; yalnızca ortam değişkeninde tanımlı grup yöneticisi kurallara aykırı mesajları kaldırabilir ve bu eylem mesaj içeriği olmadan denetim kaydına yazılır. Grup yöneticisi birebir özel mesajlara (DM) erişemez.
- **Birebir Sohbetlerde Rutin İzleme Yoktur:** Moderatörlerin tüm özel sohbetleri listelemesi veya kullanıcı adıyla sohbet araması teknik olarak imkânsızdır.
- **Profil Bilgi Kartı ve Oyun Kullanıcı Adları:** Sohbette bir üyenin profiline tıklandığında açılan kartta oyun kullanıcı adları üyenin gizlilik ayarına göre gösterilir; ayar kapatıldığında veriler sunucudan hiç gönderilmez.
- **30 Günlük Otomatik Silme:** Hem Genel Sohbet hem de birebir sohbet mesajları ve ek dosyalar en fazla 30 gün saklanır; günlük otomatik temizlik göreviyle (TSİ 03:00) kalıcı olarak silinir.
- **EXIF Temizliği:** Yüklenen JPEG fotoğraflardaki konum/kamera üstverileri (APP1 / APP13) diske kaydedilmeden önce otomatik olarak silinir.
- **Yerel Otomatik Metin Filtresi:** Yalnızca metinlerde yüksek riskli örüntü tarar; hiçbir mesajı engellemez, görsel veya videoları otomatik taramaz.
- **Rapor Anlık Görüntüsü:** Yalnızca rapor veya otomatik bayrak durumunda ilgili mesaj penceresi kopyalanır ve vaka kapandıktan sonra en geç 7 gün (açık vakalar en çok 90 gün) içinde silinir. Yaptırım ve içeriksiz denetim kayıtları 1 yıl saklanır.

## 4. Sunucu Diskinde (Volume) ve Bellekte Tutulanlar

- **Kalıcı Disk Hacmi (`RAILWAY_VOLUME_MOUNT_PATH`):** Oturum dosyaları (`sessions/`), Google üye kayıtları (`members/`), site üyesi uyarı kayıtları ve kanıtları (`warnings/`), sohbet ve moderasyon kayıtları (`chat/`), KVKK başvuru kayıtları (`legal/`) ve ihlal bildirim kayıtları/kanıt görselleri (`reports/`). Kanıt ve sohbet dosyaları herkese açık statik klasörde ASLA tutulmaz; erişim sunucu tarafı yetki kontrolüne tabidir.
- **Geçici Bellek (RAM):** Hız sınırlayıcı (rate limiter) IP/kullanıcı sayaçları ve kısa süreli (en çok 60 sn – 5 dk) API önbellekleri yalnızca bellekte tutulur, diske yazılmaz.
- **Hata Günlükleri:** Teknik arıza incelemesi için yalnızca HTTP yöntemi, yol, 8 karakterlik hata kodu ve maskelenmiş yığın izi kaydedilir; gizli anahtarlar, oturum çerezleri ve sohbet mesaj içerikleri loglara yazılmaz.

## 5. Çerezler ve Tarayıcı Depolama

Sitede reklam veya izleme çerezi kullanılmaz. Yalnızca zorunlu oturum/dil çerezleri ve arayüz tercihleriniz için tarayıcı depolama anahtarları kullanılır. Tam liste [Çerez Politikası](/yasal/cerez-politikasi) sayfasındadır.

## 6. Güvenlik Tedbirleri

- HTTPS zorunluluğu ve Helmet güvenlik başlıkları (sıkı Content-Security-Policy),
- `HttpOnly`, `Secure` (üretimde) ve `SameSite=Lax` oturum çerezleri,
- Tüm form gönderimlerinde oturum tabanlı CSRF koruması, tek kullanımlık gönderim anahtarları (idempotency), honeypot ve hız sınırlama,
- Dosya yüklemelerinde uzantıya güvenmeyen gerçek bayt imzası (magic-byte) doğrulaması ve rastgele dosya adları,
- Yönetim ve moderasyon ekranlarında her işlemde Bot API’den önbelleksiz taze rol doğrulaması ve çıkar çatışması engeli.

## 7. Yaş Sınırı, Haklarınız ve İletişim

13 yaşından küçükler hizmeti kullanamaz; 13–17 yaş kullanıcılar veli/vasi izniyle katılabilir. KVKK m.11 kapsamındaki tüm talepleriniz için [KVKK Başvuru Formu](/yasal/kvkk-basvuru) veya `{{LEGAL_EMAIL}}` kanalını, kural/güvenlik ihlalleri için [İhlal Bildir](/bildir) sayfasını kullanabilirsiniz.
