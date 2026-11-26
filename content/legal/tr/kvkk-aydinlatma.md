---
title: KVKK Aydınlatma Metni
version: 1.0
lastUpdated: 2026-11-26
---

# Kişisel Verilerin Korunması Kanunu (KVKK) Aydınlatma Metni

6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") uyarınca, **Piyade World (Piyade Dünyası)** web portalı ({{SITE_URL}}) ve bağlı Discord topluluk botu üzerinden işlenen kişisel verileriniz hakkında sizi sade ve şeffaf biçimde bilgilendirmek amacıyla bu aydınlatma metni hazırlanmıştır.

## 1. Veri Sorumlusunun Kimliği ve İletişim Bilgileri

| Bilgi | Değer |
| --- | --- |
| Veri Sorumlusu Adı / Unvanı | {{LEGAL_CONTROLLER_NAME}} |
| Açık Adres | {{LEGAL_ADDRESS}} |
| E-posta | {{LEGAL_EMAIL}} |
| Telefon | {{LEGAL_PHONE}} |
| KEP Adresi | {{LEGAL_KEP}} |
| Ticaret Sicil / MERSİS No | {{LEGAL_REGISTRY_NO}} |
| Vergi Dairesi / Vergi No | {{LEGAL_TAX_NO}} |
| VERBİS Kayıt Durumu | {{LEGAL_VERBIS_STATUS}} |

## 2. İşlenen Kişisel Veri Kategorileri (Gerçek Sistem Akışı)

Web sitesi kendi başına ayrı bir üye veritabanı tutmaz; üyelik ve oyun verileri bağlı Discord botunun dahili REST API’si üzerinden anlık çekilir. Gerçek sistem akışımıza göre işlenen veri kategorileri şunlardır:

- **Discord Kimlik ve Oturum Verileri:** Discord OAuth2 (`identify` kapsamı — e-posta talep edilmez) ile alınan Discord kullanıcı kimliği (ID), kullanıcı adı, görünen ad, profil görseli bağlantısı ve sunucu rol/yetki bilgileri. OAuth erişim anahtarı (`access_token`) oturumda saklanmaz ve tarayıcıya gönderilmez.
- **Topluluk Kayıt ve Oyun Profili Verileri (Bot API):** Kayıt başvurusunda beyan ettiğiniz isim/takma ad, cinsiyet seçimi, seçtiğiniz oyunlar ve oyun kullanıcı adları (Roblox, CS2, Zula, Minecraft), Roblox kimlik/kullanıcı adı/avatar bilgisi ve sunucu disiplin/uyarı puanı kayıtları.
- **Oyun Etkinliği Verileri (Bot API):** Yalnızca oyun takibini açık bırakan kayıtlı üyeler için, bulunulan takvim ayına ait toplam oyun süreleri (her ayın 1’inde sıfırlanır; tarihsel zaman çizelgesi tutulmaz). Takibini kapatan (`tracking: false`) üyelerin verisi toplanmaz ve gösterilmez.
- **Birebir Sohbet ve Moderasyon Verileri (`CHAT_ENABLED` açıkken):** Kayıtlı üyeler arasındaki özel sohbet mesajları, yüklenen ek dosyalar (JPEG fotoğraflardaki EXIF/konum üstverileri sunucuya yazılmadan önce otomatik temizlenir), sohbet tercihleri (profil halkası, engellenen üyeler, ilk mesaj isteği ayarı), rapor veya yerel otomatik metin filtresi sonucu açılan vaka anlık görüntüleri, yaptırım ve içeriksiz denetim kayıtları.
- **Oturum, Çerez ve Tarayıcı Depolama Verileri:** Zorunlu oturum çerezi (`piyade.sid`, içinde CSRF güvenlik belirteci ve OAuth durum kodu), dil tercihi çerezi (`lang`) ile arayüz tercihleriniz (`localStorage` / `sessionStorage`). Ayrıntılı tablo [Çerez Politikası](/yasal/cerez-politikasi) sayfasındadır.
- **İşlem Güvenliği ve Hata Kayıtları:** Hız sınırlayıcı (rate limiter) için yalnızca geçici bellek (RAM) üzerinde tutulan IP sayaçları (diske yazılmaz) ve teknik arıza takibi için gizli anahtarları maskelenmiş hata kodları.
- **KVKK Başvuruları ve İhlal Bildirimleri:** [KVKK Başvuru Formu](/yasal/kvkk-basvuru) veya [İhlal Bildirim Sistemi](/bildir) üzerinden gönderdiğiniz ad/iletişim bilgileri, açıklamalar, kanıt görselleri ve takip kodları.
- **GELECEK ÖZELLİK (Yakında Eklenecek Veri Akışları):** Önümüzdeki güncellemelerde devreye alınacak **Google ile giriş** (`sub` kimliği, e-posta adresi, ad), isteğe bağlı **"beni hatırla" çerezi**, **doğrudan site üyesi kaydı**, **Google üye uyarı sicili** ve **oyun kullanıcı adlarının sohbet profilinde diğer üyelere gösterilmesi** özellikleri yayına alındığında bu veri kategorileri de ilgili ekranlarda ayrıca bilgilendirilerek işlenecektir.

## 3. Kişisel Verilerin İşlenme Amaçları

- Topluluk üyeliği ve oyun bazlı kayıt başvurularının alınması, doğrulanması ve Discord sunucu rollerinin senkronize edilmesi,
- Birebir özel sohbet hizmetinin, dosya paylaşımının ve güvenlik önlemlerinin yürütülmesi,
- Topluluk kurallarının uygulanması, kötüye kullanım, telif hakkı ve yasa dışı içerik bildirimlerinin incelenmesi,
- Oturum güvenliğinin, CSRF korumasının ve kötü niyetli trafik/spam engellemesinin sağlanması,
- KVKK kapsamındaki bilgi, erişim, düzeltme ve silme başvurularının yasal süresi içinde yanıtlanması,
- Yetkili kamu kurum ve kuruluşlarından gelebilecek yasal yükümlülüklerin yerine getirilmesi.

## 4. Kişisel Verilerin İşlenmesinin Hukuki Sebepleri (KVKK m.5)

> **Not:** Aşağıdaki KVKK m.5 hukuki sebep eşleştirmeleri taslak çalışma çerçevesindedir; her bir veri işleme faaliyeti için **hukuki doğrulama gerekli** olup yayına çıkmadan önce hukuk danışmanı tarafından onaylanmalıdır.

| Veri İşleme Faaliyeti | Öngörülen KVKK m.5 Hukuki Sebebi | Durum |
| --- | --- | --- |
| Discord OAuth girişi, oturum yönetimi, zorunlu çerezler | KVKK m.5/2-(c) Sözleşmenin kurulması veya ifası / m.5/2-(f) Meşru menfaat | *Hukuki doğrulama gerekli* |
| Oyun bazlı kayıt ve topluluk profili yönetimi | KVKK m.5/2-(c) Hizmetin ifası | *Hukuki doğrulama gerekli* |
| Hız sınırlama (RAM IP), CSRF ve güvenlik günlükleri | KVKK m.5/2-(ç) Hukuki yükümlülük ve m.5/2-(f) Meşru menfaat | *Hukuki doğrulama gerekli* |
| KVKK başvuruları ve yasal ihlal/telif bildirimlerinin işlenmesi | KVKK m.5/2-(ç) Hukuki yükümlülük ve m.5/2-(e) Hakkın tesisi/korunması | *Hukuki doğrulama gerekli* |
| Sohbet vaka incelemesi, yurt dışı aktarım ve oyun adı görünürlüğü *(gelecek)* | KVKK m.5/1 Açık rıza (veya yurt dışı aktarım için KVKK m.9 mekanizması) | *Hukuki doğrulama gerekli* |

## 5. Kişisel Verilerin Aktarılması ve Yurt Dışına Aktarım

Kişisel verileriniz üçüncü kişilere satılmaz veya reklam amacıyla paylaşılmaz. Hizmetin teknik olarak çalışabilmesi için sınırlı ve amaca bağlı aktarımlar şu taraflara yapılabilir:

- **Bulut Barındırma Sağlayıcısı (Railway):** Web sitesi, kalıcı disk hacmi (Volume) ve hata günlükleri yurt dışındaki sunucularda barındırılabilir.
- **Discord (Discord Inc.):** OAuth2 kimlik doğrulaması, rol kontrolü ve profil avatarı gösterimi (`cdn.discordapp.com`) için teknik çağrılar yapılır.
- **Roblox (Roblox Corporation):** Kayıt sırasında Roblox kullanıcı doğrulaması ve avatar gösterimi (`rbxcdn.com`) için sınırlı sorgu yapılır.
- **Google (Google LLC):** Yazı tipi yüklemesi (`fonts.googleapis.com` / `fonts.gstatic.com`) ve **GELECEK ÖZELLİK** kapsamında devreye girecek Google OAuth ile giriş akışında teknik veri alışverişi gerçekleşir.
- **Yetkili Kamu Kurumları:** Yalnızca kanunen zorunlu ve usulüne uygun resmi talep halinde.

Yurt dışına aktarımların KVKK m.9 kapsamındaki güncel hukuki dayanağı (standart sözleşme, yeterlilik veya açık rıza) ayrıca [Açık Rıza Metni](/yasal/acik-riza) sayfasında ayrı madde olarak sunulmaktadır *(hukuki doğrulama gerekli)*.

## 6. Saklama Süreleri ve İmha İlkeleri

| Veri Türü | Saklama Süresi | İmha / Silme Yöntemi |
| --- | --- | --- |
| Oturum dosyası (`piyade.sid` / `sessions.json`) | 24 saat | Süre dolumunda veya çıkışta otomatik silinir |
| Sohbet mesajları ve ek dosyalar | En fazla **30 gün** | Her gün TSİ 03:00’te otomatik kalıcı silme |
| Kapanan moderasyon vaka anlık görüntüsü ve kanıtı | Kapanıştan sonra en geç **7 gün** | Otomatik kalıcı silme |
| Kapanmamış moderasyon vakası | En çok **90 gün** | Otomatik kapatma ve anlık görüntü silme |
| Sohbet yaptırım kayıtları ve içeriksiz denetim kaydı | **1 yıl** | Süre dolumunda otomatik temizleme |
| Aylık oyun etkinliği süresi (Bot API) | Yalnızca bulunulan ay | Her ayın 1’inde (TSİ) otomatik sıfırlama |
| KVKK başvuru kayıtları ve denetim kaydı | **{{KVKK_RETENTION_DAYS}} gün** (~{{KVKK_RETENTION_YEARS}} yıl) | Yapılandırma süresinin dolumunda güvenli silme |
| İhlal/DMCA bildirim kayıtları ve kanıt görselleri | **{{REPORT_RETENTION_DAYS}} gün** | Yapılandırma süresinin dolumunda güvenli silme |

## 7. Çocukların ve Reşit Olmayanların Gizliliği

- **13 yaşından küçük bireyler** bu web sitesini ve bağlı topluluk hizmetlerini **kullanamaz**; 13 yaş altı kullanıcılara ait veri tespit edildiğinde kayıt derhal silinir.
- **13–17 yaş aralığındaki** kullanıcılar, siteye kayıt olurken ve hizmetleri kullanırken **veli veya yasal vasisinin açık iznine sahip olduklarını** beyan etmiş sayılırlar.
- Veli veya vasiler, reşit olmayan kullanıcıya ait verilerin incelenmesi veya silinmesi için [KVKK Başvuru Formu](/yasal/kvkk-basvuru) veya `{{LEGAL_EMAIL}}` adresi üzerinden her zaman başvuruda bulunabilirler.

## 8. KVKK Madde 11 Kapsamındaki Haklarınız ve Başvuru Yöntemi

KVKK’nın 11. maddesi uyarınca veri sorumlusuna başvurarak şu haklarınızı kullanabilirsiniz:

1. Kişisel verilerinizin işlenip işlenmediğini öğrenme ve işlenmişse buna ilişkin bilgi talep etme,
2. İşlenme amacını ve bunların amacına uygun kullanılıp kullanılmadığını öğrenme,
3. Yurt içinde veya yurt dışında kişisel verilerin aktarıldığı üçüncü kişileri bilme,
4. Kişisel verilerin eksik veya yanlış işlenmiş olması halinde bunların düzeltilmesini isteme,
5. KVKK m.7 şartları çerçevesinde kişisel verilerin silinmesini veya yok edilmesini isteme,
6. Düzeltme, silme veya yok etme işlemlerinin aktarılan üçüncü kişilere bildirilmesini isteme,
7. İşlenen verilerin münhasıran otomatik sistemler vasıtasıyla analiz edilmesi suretiyle aleyhinize bir sonucun ortaya çıkmasına itiraz etme,
8. Kişisel verilerin kanuna aykırı olarak işlenmesi sebebiyle zarara uğramanız halinde zararın giderilmesini talep etme.

**Başvuru Kanalları:**
- Çevrimiçi form: [KVKK Başvuru Formu](/yasal/kvkk-basvuru) (takip kodu üretilir ve durum [sorgulama ekranından](/yasal/kvkk-basvuru/sorgula) izlenebilir),
- E-posta / KEP: `{{LEGAL_EMAIL}}` (varsa KEP: `{{LEGAL_KEP}}`),
- Yazılı başvuru adresi: `{{LEGAL_ADDRESS}}`.

Başvurularınız, talebin niteliğine göre en kısa sürede ve **en geç {{KVKK_RESPONSE_DEADLINE_DAYS}} gün içinde** ücretsiz olarak yanıtlanır. Kimliğinizi doğrulamak amacıyla ek bilgi talep edilebilir.
