/**
 * ==============================================================================
 * ✅ PIYADE WORLD — AYRILMIŞ (BİRLEŞİK OLMAYAN) AÇIK RIZA MADDELERİ KATALOĞU
 * ==============================================================================
 * Her açık rıza maddesi bağımsız kimlik (id) ve sürüm (version) taşır.
 * Hiçbir madde birbirine bağlanmaz ("hepsini tek seferde kabul et" yaklaşımı YOK).
 * ==============================================================================
 */

const EXPLICIT_CONSENTS = Object.freeze([
  {
    id: 'chat_moderation_review',
    version: '1.0',
    upcoming: false,
    tr: {
      code: 'Madde A',
      title: 'Sohbet İçeriklerinin Rapor veya Otomatik Filtre Halinde Moderatörlerce İncelenmesi',
      summary:
        'Birebir sohbetler rutin olarak izlenmez; yalnızca taraflardan biri bir mesajı raporladığında veya yerel otomatik metin filtresi yüksek riskli bir örüntü işaretlediğinde, ilgili vaka penceresinin kopyası yetkili Community Official moderatörlerince incelenebilir.',
      impact:
        'Bu rızayı vermemeniz sitenin genel sayfalarını, kuralları veya topluluk kaydını kullanmanızı engellemez; yalnızca isteğe bağlı birebir Sohbet bölümünün kullanımı bu inceleme mekanizmasına tabidir.',
    },
    en: {
      code: 'Item A',
      title: 'Moderator Review of Chat Content Upon User Report or Auto-Flag',
      summary:
        'Private one-to-one chats are never routinely monitored. Only when a participant reports a message or the local text-only auto-filter flags a high-risk pattern may a copied snapshot of the relevant case window be reviewed by authorized Community Official moderators.',
      impact:
        'Declining this consent does not affect your access to public site pages, rules, or community registration; it applies solely to the optional private Chat feature.',
    },
  },
  {
    id: 'chat_profile_game_usernames',
    version: '1.0',
    upcoming: true,
    tr: {
      code: 'Madde B',
      title: 'Oyun Kullanıcı Adlarınızın Sohbet Profilinde Diğer Kayıtlı Üyelere Gösterilmesi (GELECEK ÖZELLİK)',
      summary:
        'Yakında devreye alınacak profil geliştirme aşamasında, kayıt sırasında paylaştığınız oyun kullanıcı adlarının (Roblox, CS2, Zula, Minecraft) sohbet profil kartınızda diğer kayıtlı topluluk üyelerine görünür kılınması.',
      impact:
        'Bu özellik şu an henüz yayında değildir (GELECEK ÖZELLİK). Yayına alındığında tamamen isteğe bağlı olacak ve rızanızı istediğiniz zaman profil/sohbet ayarlarından geri alabileceksiniz.',
    },
    en: {
      code: 'Item B',
      title: 'Displaying Your Game Usernames on Your Chat Profile to Other Registered Members (UPCOMING FEATURE)',
      summary:
        'In an upcoming profile update, making the game usernames you registered (Roblox, CS2, Zula, Minecraft) visible on your chat profile card to other registered community members.',
      impact:
        'This feature is not live yet (UPCOMING FEATURE). Once launched, it will remain strictly optional and revocable at any time from your profile/chat settings.',
    },
  },
  {
    id: 'international_data_transfer',
    version: '1.0',
    upcoming: false,
    tr: {
      code: 'Madde C',
      title: 'Verilerin Yurt Dışındaki Barındırma ve Kimlik Doğrulama Sağlayıcılarına Aktarılması',
      summary:
        'Web sitesi altyapısının ve kimlik doğrulama akışlarının çalışabilmesi için zorunlu teknik verilerin yurt dışında sunucuları bulunabilen bulut barındırma sağlayıcısı (Railway) ile üçüncü taraf platform API’lerine (Discord, Roblox, Google Fonts ve gelecek özellik kapsamında Google OAuth) aktarılması.',
      impact:
        'Yurt dışı aktarım hukuki dayanağının (KVKK m.9 kapsamındaki standart sözleşme / yeterlilik / açık rıza değerlendirmesi) hukuki inceleme ile kesinleştirilmesi gerekmektedir.',
    },
    en: {
      code: 'Item C',
      title: 'Transfer of Data to International Hosting and Identity Providers',
      summary:
        'Transferring strictly necessary technical and account data to cloud hosting infrastructure (Railway) and third-party APIs (Discord, Roblox, Google Fonts, and Google OAuth as an upcoming feature) whose servers may be located abroad.',
      impact:
        'The final legal transfer mechanism under Article 9 of KVKK (adequacy, standard contractual clauses, or explicit consent) is subject to legal counsel verification.',
    },
  },
]);

function getExplicitConsents(lang = 'tr') {
  const isEn = lang === 'en';
  return EXPLICIT_CONSENTS.map((item) => {
    const loc = isEn ? item.en : item.tr;
    return {
      id: item.id,
      version: item.version,
      upcoming: item.upcoming,
      code: loc.code,
      title: loc.title,
      summary: loc.summary,
      impact: loc.impact,
    };
  });
}

function getExplicitConsentById(id) {
  return EXPLICIT_CONSENTS.find((c) => c.id === String(id || '').trim()) || null;
}

module.exports = {
  EXPLICIT_CONSENTS,
  getExplicitConsents,
  getExplicitConsentById,
};
