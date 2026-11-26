---
title: KVKK Aydınlatma Metni
version: 1.2
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

Web sitesi Discord üyeleri için bağlı Discord botunun dahili REST API’sini kullanır; Discord hesabı olmadan "Google ile devam et" seçeneğiyle doğrudan üye olan kullanıcıların kayıtları ise kalıcı sunucu hacminde (`members/`) atomik olarak saklanır. Gerçek sistem akışımıza göre işlenen veri kategorileri şunlardır:

- **Discord Kimlik ve Oturum Verileri:** Discord OAuth2 (`identify` kapsamı — e-posta talep edilmez) ile alınan Discord kullanıcı kimliği (ID), kullanıcı adı, görünen ad, profil görseli bağlantısı ve sunucu rol/yetki bilgileri. OAuth erişim anahtarı (`access_token`) oturumda saklanmaz ve tarayıcıya gönderilmez.
- **Google ile Giriş ve Doğrudan Site Üyeliği Verileri:** Google OpenID Connect (`openid email profile`, PKCE S256 ve JWKS imza doğrulaması) ile alınan benzersiz Google kimliği (`sub`), doğrulanmış e-posta adresi ve Google hesap adı; üyelik sihirbazında beyan ettiğiniz yaş grubu, takma ad, seçtiğiniz oyunlar ve oyun kullanıcı adları (varsa doğrulanmış Roblox kimliği/avatarı), ayrı rıza onay kayıtları ve gizlilik tercihleri. **E-posta adresiniz ve Google adınız hiçbir yerde diğer üyelere gösterilmez; Google profil fotoğrafınız (`picture`) hiçbir zaman alınmaz ve saklanmaz.** İsteğe bağlı olarak Google hesabınızı mevcut Discord hesabınıza kalıcı biçimde bağlayabilirsiniz.
- **Topluluk Kayıt ve Oyun Profili Verileri (Bot API):** Discord kayıt başvurusunda beyan ettiğiniz isim/takma ad, cinsiyet seçimi, seçtiğiniz oyunlar ve oyun kullanıcı adları (Roblox, CS2, Zula, Minecraft), Roblox kimlik/kullanıcı adı/avatar bilgisi ve sunucu disiplin/uyarı puanı kayıtları. Oyun kullanıcı adlarınız, yalnızca açık rızanız ve gizlilik ayarınız açık olduğu sürece sohbet profilinizde diğer kayıtlı üyelere gösterilir.
- **Oyun Etkinliği Verileri (Bot API):** Yalnızca oyun takibini açık bırakan kayıtlı Discord üyeleri için, bulunulan takvim ayına ait toplam oyun süreleri (her ayın 1’inde sıfırlanır; tarihsel zaman çizelgesi tutulmaz). Takibini kapatan (`tracking: false`) üyelerin verisi toplanmaz ve gösterilmez.
- **Genel Sohbet, Birebir Sohbet ve Moderasyon Verileri (`CHAT_ENABLED` açıkken):** Kayıtlı üyeler arasındaki özel sohbet ve zorunlu Genel Sohbet mesajları, yüklenen ek dosyalar (JPEG fotoğraflardaki EXIF/konum üstverileri sunucuya yazılmadan önce otomatik temizlenir), sohbet tercihleri (profil halkası, engellenen üyeler, oyun adı görünürlüğü), rapor veya yerel otomatik metin filtresi sonucu açılan vaka anlık görüntüleri, yaptırım ve içeriksiz denetim kayıtları.
- **Site (Google) Üyeleri Uyarı ve Yaptırım Kayıtları:** Doğrudan Google ile kayıtlı site üyelerine yetkili tarafından verilen resmi veya sözlü uyarı kayıtları (kural kodu, puan/kademe, gerekçe, uygulanan sohbet susturma / 7 günlük hesap askısı / kalıcı yasak yaptırımları, kalıcı yasakta tek yönlü `googleSub` özeti), yalnızca yetkililerin görebildiği kanıt görselleri (`warnings/evidence/` — üyelere gösterilmez) ve gerekçe/kanıt içermeyen denetim kayıtları.
- **Oturum, Çerez ve Tarayıcı Depolama Verileri:** Zorunlu oturum çerezi (`piyade.sid`), Google site üyeleri için 90 günlük döndürülen "beni hatırla" çerezi (`pw_remember` — sunucuda yalnızca belirteç özeti ve cihaz etiketi tutulur, en fazla 5 cihaz), dil tercihi çerezi (`lang`) ile arayüz tercihleriniz (`localStorage` / `sessionStorage`). Ayrıntılı tablo [Çerez Politikası](/yasal/cerez-politikasi) sayfasındadır.
- **İşlem Güvenliği ve Hata Kayıtları:** Hız sınırlayıcı (rate limiter) için yalnızca geçici bellek (RAM) üzerinde tutulan IP sayaçları (diske yazılmaz) ve teknik arıza takibi için gizli anahtarları maskelenmiş hata kodları.
- **KVKK Başvuruları ve İhlal Bildirimleri:** [KVKK Başvuru Formu](/yasal/kvkk-basvuru) veya [İhlal Bildirim Sistemi](/bildir) üzerinden gönderdiğiniz ad/iletişim bilgileri, açıklamalar, kanıt görselleri ve takip kodları.

## 3. Kişisel Verilerin İşlenme Amaçları

- Topluluk üyeliği (Discord veya Google site üyeliği) ve oyun bazlı kayıt süreçlerinin yürütülmesi, Roblox hesap benzersizliğinin korunması ve Discord sunucu rollerinin senkronize edilmesi,
- Birebir özel sohbet hizmetinin, dosya paylaşımının ve güvenlik önlemlerinin (yeni üye 24 saatlik dosya/bağlantı sınırı dahil) yürütülmesi,
- Topluluk kurallarının uygulanması, kötüye kullanım, telif hakkı ve yasa dışı içerik bildirimlerinin incelenmesi,
- Oturum güvenliğinin, CSRF korumasının, çalınma tespitli hatırlama çerezinin ve kötü niyetli trafik/spam engellemesinin sağlanması,
- KVKK kapsamındaki bilgi, erişim, düzeltme ve silme başvurularının yasal süresi içinde yanıtlanması,
- Yetkili kamu kurum ve kuruluşlarından gelebilecek yasal yükümlülüklerin yerine getirilmesi.

## 4. Kişisel Verilerin İşlenmesinin Hukuki Sebepleri (KVKK m.5)

> **Not:** Aşağıdaki KVKK m.5 hukuki sebep eşleştirmeleri taslak çalışma çerçevesindedir; her bir veri işleme faaliyeti için **hukuki doğrulama gerekli** olup yayına çıkmadan önce hukuk danışmanı tarafından onaylanmalıdır.

| Veri İşleme Faaliyeti | Öngörülen KVKK m.5 Hukuki Sebebi | Durum |
| --- | --- | --- |
| Discord/Google OAuth girişi, oturum ve `pw_remember` yönetimi, zorunlu çerezler | KVKK m.5/2-(c) Sözleşmenin kurulması veya ifası / m.5/2-(f) Meşru menfaat | *Hukuki doğrulama gerekli* |
| Oyun bazlı kayıt ve topluluk profili yönetimi | KVKK m.5/2-(c) Hizmetin ifası | *Hukuki doğrulama gerekli* |
| Hız sınırlama (RAM IP), CSRF ve güvenlik günlükleri | KVKK m.5/2-(ç) Hukuki yükümlülük ve m.5/2-(f) Meşru menfaat | *Hukuki doğrulama gerekli* |
| KVKK başvuruları ve yasal ihlal/telif bildirimlerinin işlenmesi | KVKK m.5/2-(ç) Hukuki yükümlülük ve m.5/2-(e) Hakkın tesisi/korunması | *Hukuki doğrulama gerekli* |
| Sohbet vaka incelemesi (Madde A), sohbet oyun adı görünürlüğü (Madde B) ve yurt dışı aktarım (Madde C) | KVKK m.5/1 Açık rıza (veya yurt dışı aktarım için KVKK m.9 mekanizması) | *Hukuki doğrulama gerekli* |

## 5. Kişisel Verilerin Aktarılması ve Yurt Dışına Aktarım

Kişisel verileriniz üçüncü kişilere satılmaz veya reklam amacıyla paylaşılmaz. Hizmetin teknik olarak çalışabilmesi için sınırlı ve amaca bağlı aktarımlar şu taraflara yapılabilir:

- **Bulut Barındırma Sağlayıcısı (Railway):** Web sitesi, kalıcı disk hacmi (Volume) ve hata günlükleri yurt dışındaki sunucularda barındırılabilir.
- **Discord (Discord Inc.):** OAuth2 kimlik doğrulaması, rol kontrolü ve profil avatarı gösterimi (`cdn.discordapp.com`) için teknik çağrılar yapılır.
- **Google (Google LLC):** "Google ile devam et" OpenID Connect kimlik doğrulaması (`oauth2.googleapis.com` / JWKS) ve yazı tipi yüklemesi (`fonts.googleapis.com` / `fonts.gstatic.com`) için teknik veri alışverişi gerçekleşir.
- **Roblox (Roblox Corporation):** Kayıt sırasında Roblox kullanıcı doğrulaması ve avatar gösterimi (`rbxcdn.com`) için sınırlı sorgu yapılır.
- **Yetkili Kamu Kurumları:** Yalnızca kanunen zorunlu ve usulüne uygun resmi talep halinde.

Yurt dışına aktarımların KVKK m.9 kapsamındaki güncel hukuki dayanağı (standart sözleşme, yeterlilik veya açık rıza) ayrıca [Açık Rıza Metni](/yasal/acik-riza) sayfasında ayrı madde olarak sunulmaktadır *(hukuki doğrulama gerekli)*.

## 6. Saklama Süreleri ve İmha İlkeleri

| Veri Türü | Saklama Süresi | İmha / Silme Yöntemi |
| --- | --- | --- |
| Oturum dosyası (`piyade.sid` / `sessions.json`) | 24 saat | Süre dolumunda veya çıkışta otomatik silinir |
| Hatırlama belirteci (`pw_remember` / `remember-tokens.json`) | 90 gün (kullanımda yenilenir) | Çıkışta, Profil → Oturumlarım iptalinde, çalınma tespitinde veya hesap silmede derhal silinir |
| Google doğrudan site üyesi kaydı (`members/members.json`) | Üyelik süresince | Profil → **Hesabımı Sil** ile üye kaydı, sohbet profili, kendi mesajları/korunmayan dosyaları ve Roblox eşleşmesi derhal silinir; geriye yalnızca kimlik içermeyen `account_deleted` denetim satırı kalır |
| Sohbet mesajları ve ek dosyalar | En fazla **30 gün** | Her gün TSİ 03:00’te otomatik kalıcı silme |
| Kapanan moderasyon vaka anlık görüntüsü ve kanıtı | Kapanıştan sonra en geç **7 gün** | Otomatik kalıcı silme (hesap silme halinde dahi vaka süresi dolana kadar korunur) |
| Kapanmamış moderasyon vakası | En çok **90 gün** | Otomatik kapatma ve anlık görüntü silme |
| Sohbet yaptırım kayıtları ve içeriksiz denetim kaydı | **1 yıl** | Süre dolumunda otomatik temizleme |
| Site (Google) üyesi uyarı kayıtları ve içeriksiz denetim kaydı (`warnings/`) | Kayıt süresi dolduktan / 30 günlük af veya iptal sonrası **12 ay** (365 gün) | Günlük otomatik bakım göreviyle kalıcı silme; hesap silinince kişisel bağlantılar derhal kaldırılır, yalnızca kimlik içermeyen denetim satırı kalır |
| Site (Google) üyesi uyarı kanıt görselleri (`warnings/evidence/`) | En fazla **6 ay** (180 gün) | Günlük otomatik bakım göreviyle diskten kalıcı silme (hesap silinince derhal silinir; üyelere gösterilmez) |
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
