/**
 * Piyade Team | TSB Sunucu Kuralları (TR / EN Çok Dilli Tek Kaynak)
 *
 * Bu dosya Genel Kurallar sayfasında ve Yönetim Uyarı Verme modülünde
 * ortak olarak kullanılır. Yeni kural eklemek veya düzenlemek için
 * yalnızca bu nesneyi güncellemek yeterlidir.
 */

const RULES = {
  // ==========================================
  // KATILIMCI KURALLARI (M1 - M13)
  // ==========================================
  M1: {
    code: 'M1',
    category: 'participant',
    categoryLabel: 'Katılımcı Kuralları',
    categoryLabelEn: 'Participant Rules',
    title: 'Küfür / Hakaret',
    titleEn: 'Profanity / Insults',
    description: 'Sunucumuzda küfür/hakarete başvurmak. Bununla ilgili içerik paylaşmak.',
    descriptionEn: 'Using profanity or insults in the server, or sharing related offensive content.',
    type: 'points',
    points: 2,
    penaltyLabel: '+2 Ceza Puanı',
    penaltyLabelEn: '+2 Penalty Points',
    badgeClass: 'badge-warning',
  },
  M2: {
    code: 'M2',
    category: 'participant',
    categoryLabel: 'Katılımcı Kuralları',
    categoryLabelEn: 'Participant Rules',
    title: 'Reklam & Ticari Faaliyet',
    titleEn: 'Advertising & Commercial Activity',
    description: 'Reklam yapmak, hesap/oyun satışı gibi ticari faaliyetlerde bulunmak (Özel mesaj da dahil).',
    descriptionEn: 'Advertising or engaging in commercial activities such as account/game sales (including via DMs).',
    type: 'ban',
    points: 0,
    penaltyLabel: 'Kalıcı Yasak (Permanent Ban)',
    penaltyLabelEn: 'Permanent Ban',
    badgeClass: 'badge-danger',
  },
  M3: {
    code: 'M3',
    category: 'participant',
    categoryLabel: 'Katılımcı Kuralları',
    categoryLabelEn: 'Participant Rules',
    title: 'Aşırı Övünme / Rahatsız Etme',
    titleEn: 'Excessive Bragging / Provocation',
    description:
      'Sunucumuzda düzenlenen etkinliklerde veya yapılacak olan kapışmalarda karşı taraf rahatsız olduğu halde kendini abartı şekilde övmek.',
    descriptionEn:
      'Excessively bragging during server events or matches when the opponent has expressed discomfort.',
    type: 'points',
    points: 1,
    penaltyLabel: '+1 Ceza Puanı',
    penaltyLabelEn: '+1 Penalty Point',
    badgeClass: 'badge-info',
  },
  M4: {
    code: 'M4',
    category: 'participant',
    categoryLabel: 'Katılımcı Kuralları',
    categoryLabelEn: 'Participant Rules',
    title: 'Taciz',
    titleEn: 'Harassment',
    description: 'Cinsiyet fark etmeksizin taciz içeren davranışlarda bulunmak.',
    descriptionEn: 'Engaging in any form of harassment regardless of gender.',
    type: 'timeout',
    durationDays: 2,
    points: 0,
    penaltyLabel: '2 Gün Timeout',
    penaltyLabelEn: '2-Day Timeout',
    badgeClass: 'badge-danger',
  },
  M5: {
    code: 'M5',
    category: 'participant',
    categoryLabel: 'Katılımcı Kuralları',
    categoryLabelEn: 'Participant Rules',
    title: 'Kanal Amacı Dışında Kullanım',
    titleEn: 'Off-Topic Channel Usage',
    description: "Kanalları amacı dışında kullanmak (Örn: #bot-komut'ta sohbet etmek).",
    descriptionEn: 'Using channels outside their intended purpose (e.g., chatting in #bot-commands).',
    type: 'points',
    points: 3,
    penaltyLabel: '+3 Ceza Puanı',
    penaltyLabelEn: '+3 Penalty Points',
    badgeClass: 'badge-warning',
  },
  M6: {
    code: 'M6',
    category: 'participant',
    categoryLabel: 'Katılımcı Kuralları',
    categoryLabelEn: 'Participant Rules',
    title: 'Cinsel İçerik',
    titleEn: 'NSFW / Sexual Content',
    description: 'Cinsel içerikli herhangi bir paylaşım (görsel, yazı, link) yapmak.',
    descriptionEn: 'Sharing any sexually explicit content (images, text, or links).',
    type: 'points',
    points: 8,
    penaltyLabel: '+8 Ceza Puanı',
    penaltyLabelEn: '+8 Penalty Points',
    badgeClass: 'badge-danger',
  },
  M7: {
    code: 'M7',
    category: 'participant',
    categoryLabel: 'Katılımcı Kuralları',
    categoryLabelEn: 'Participant Rules',
    title: 'Kavga Ortamı Yaratma',
    titleEn: 'Instigating Fights / Unwanted Contact',
    description: 'Bir kişiye muhatap olmak istemediği sürece ya da kasten kavga ortamı yaratmak.',
    descriptionEn: 'Forcing interaction with someone who does not wish to engage, or intentionally instigating fights.',
    type: 'points',
    points: 4,
    penaltyLabel: '+4 Ceza Puanı',
    penaltyLabelEn: '+4 Penalty Points',
    badgeClass: 'badge-warning',
  },
  M8: {
    code: 'M8',
    category: 'participant',
    categoryLabel: 'Katılımcı Kuralları',
    categoryLabelEn: 'Participant Rules',
    title: 'Zorbalık & Soğutma',
    titleEn: 'Bullying & Alienating Members',
    description: 'Zorbalık yapmak, başka bir üyeyi sunucudan soğutacak davranışlarda bulunmak.',
    descriptionEn: 'Bullying or acting in ways that alienate and drive other members away from the server.',
    type: 'points',
    points: 5,
    penaltyLabel: '+5 Ceza Puanı',
    penaltyLabelEn: '+5 Penalty Points',
    badgeClass: 'badge-danger',
  },
  M9: {
    code: 'M9',
    category: 'participant',
    categoryLabel: 'Katılımcı Kuralları',
    categoryLabelEn: 'Participant Rules',
    title: 'Başka Sunucuya Davet',
    titleEn: 'Unauthorized Server Invites',
    description: 'Yönetmenlik bilgisi dışında sunucu üyelerini kendi sunucunuza veya grubunuza davet etmek.',
    descriptionEn: 'Inviting server members to external servers or groups without management approval.',
    type: 'yasakli',
    points: 0,
    penaltyLabel: 'Doğrudan Yasaklı (Sunucudan Atılma)',
    penaltyLabelEn: 'Direct Restricted Role / Removal',
    badgeClass: 'badge-danger',
  },
  M10: {
    code: 'M10',
    category: 'participant',
    categoryLabel: 'Katılımcı Kuralları',
    categoryLabelEn: 'Participant Rules',
    title: '+18 & Ayrımcılık Paylaşımı',
    titleEn: '18+ & Discriminatory Content',
    description: '+18, cinsel taciz, ırkçılık, cinsiyet/yaş ayrımcılığı içeren içerik paylaşmak.',
    descriptionEn: 'Sharing 18+ material, sexual harassment, racism, or gender/age discrimination content.',
    type: 'timeout',
    durationDays: 1,
    points: 0,
    penaltyLabel: '1 Gün Timeout',
    penaltyLabelEn: '1-Day Timeout',
    badgeClass: 'badge-danger',
  },
  M11: {
    code: 'M11',
    category: 'participant',
    categoryLabel: 'Katılımcı Kuralları',
    categoryLabelEn: 'Participant Rules',
    title: 'Irkçılık & Ayrımcılık',
    titleEn: 'Racism & Discrimination',
    description: 'Irkçılık ve her türlü ayrımcılık yapmak.',
    descriptionEn: 'Engaging in racism or any form of discrimination.',
    type: 'timeout',
    durationDays: 1,
    points: 0,
    penaltyLabel: '1 Gün Timeout',
    penaltyLabelEn: '1-Day Timeout',
    badgeClass: 'badge-danger',
  },
  M12: {
    code: 'M12',
    category: 'participant',
    categoryLabel: 'Katılımcı Kuralları',
    categoryLabelEn: 'Participant Rules',
    title: 'Küçümseme & Dalga Geçme',
    titleEn: 'Belittling & Mocking',
    description:
      'Sunucuda bulunan kişilerin psikolojisini etkileyecek argo, küçümseme ve dalga geçme gibi faaliyetler yapmak.',
    descriptionEn:
      'Using toxic slang, belittling, or mocking others in ways that negatively affect their well-being.',
    type: 'points',
    points: 2,
    penaltyLabel: '+2 Ceza Puanı',
    penaltyLabelEn: '+2 Penalty Points',
    badgeClass: 'badge-warning',
  },
  M13: {
    code: 'M13',
    category: 'participant',
    categoryLabel: 'Katılımcı Kuralları',
    categoryLabelEn: 'Participant Rules',
    title: '3. Taraf Yazılım / Hile',
    titleEn: 'Third-Party Software / Exploiting',
    description: 'Sunucuda yapılan etkinliklerde ve kapışmalarda 3. Taraf yazılım veya hile kullanmak.',
    descriptionEn: 'Using third-party software, scripts, or cheats during server events and matches.',
    type: 'timeout',
    durationDays: 1,
    points: 0,
    penaltyLabel: '1 Gün Timeout',
    penaltyLabelEn: '1-Day Timeout',
    badgeClass: 'badge-danger',
  },

  // ==========================================
  // DÜZEN VE KANAL KURALLARI (D1 - D3)
  // ==========================================
  D1: {
    code: 'D1',
    category: 'order',
    categoryLabel: 'Düzen & Kanal Kuralları',
    categoryLabelEn: 'Order & Channel Rules',
    title: 'Önemli Kanallara Boş Mesaj',
    titleEn: 'Spamming Important Channels',
    description: 'Önemli kanallara (duyuru vb.) anlamsız, boş mesajlar atmak.',
    descriptionEn: 'Posting meaningless or empty messages in important channels (e.g., announcements).',
    type: 'points',
    points: 3,
    penaltyLabel: '+3 Ceza Puanı',
    penaltyLabelEn: '+3 Penalty Points',
    badgeClass: 'badge-warning',
  },
  D2: {
    code: 'D2',
    category: 'order',
    categoryLabel: 'Düzen & Kanal Kuralları',
    categoryLabelEn: 'Order & Channel Rules',
    title: 'Sohbet & Ses Paneli Spamı',
    titleEn: 'Chat & Soundboard Spam',
    description: 'Ses kanallarında ses panelini veya sohbet kanallarında sohbeti gereksiz yere çağırmak / spamlamak.',
    descriptionEn: 'Unnecessarily spamming the soundboard in voice channels or flooding text channels.',
    type: 'points',
    points: 3,
    penaltyLabel: '+3 Ceza Puanı',
    penaltyLabelEn: '+3 Penalty Points',
    badgeClass: 'badge-warning',
  },
  D3: {
    code: 'D3',
    category: 'order',
    categoryLabel: 'Düzen & Kanal Kuralları',
    categoryLabelEn: 'Order & Channel Rules',
    title: 'Ses Kanalında Bildirim Yağmuru',
    titleEn: 'Voice Channel Hopping / Notification Spam',
    description: 'Önemli ses kanallarında sürekli yolculuk yaparak gereksiz bildirim yağmuruna sebep olmak.',
    descriptionEn: 'Repeatedly joining and leaving important voice channels to cause notification spam.',
    type: 'points',
    points: 3,
    penaltyLabel: '+3 Ceza Puanı',
    penaltyLabelEn: '+3 Penalty Points',
    badgeClass: 'badge-warning',
  },

  // ==========================================
  // YETKİLİ KURALLARI (Y1 - Y5)
  // ==========================================
  Y1: {
    code: 'Y1',
    category: 'staff',
    categoryLabel: 'Yetkili Disiplin Kuralları',
    categoryLabelEn: 'Staff Disciplinary Rules',
    title: 'Yetkiyi Kendi Lehine Kullanmak',
    titleEn: 'Abuse of Authority for Personal Gain',
    description: 'Yetkisini kendi çıkarı veya lehine kullanmak.',
    descriptionEn: 'Using staff permissions or authority for personal advantage or gain.',
    type: 'staff_strip',
    points: 0,
    penaltyLabel: 'Direkt Tüm Yetkiler Alınır',
    penaltyLabelEn: 'Immediate Removal of All Staff Roles',
    badgeClass: 'badge-danger',
  },
  Y2: {
    code: 'Y2',
    category: 'staff',
    categoryLabel: 'Yetkili Disiplin Kuralları',
    categoryLabelEn: 'Staff Disciplinary Rules',
    title: 'Katılımcıyı Yanlış Yönlendirmek',
    titleEn: 'Misleading Members',
    description: 'Sunucudaki katılımcıyı yanlış yönlendirmek veya yanıltıcı bilgi vermek.',
    descriptionEn: 'Misleading server participants or providing false/inaccurate guidance.',
    type: 'staff_warn',
    points: 0,
    penaltyLabel: '+1 Yetkili Uyarısı',
    penaltyLabelEn: '+1 Staff Warning',
    badgeClass: 'badge-warning',
  },
  Y3: {
    code: 'Y3',
    category: 'staff',
    categoryLabel: 'Yetkili Disiplin Kuralları',
    categoryLabelEn: 'Staff Disciplinary Rules',
    title: 'Yanlış İşlem Yapmak',
    titleEn: 'Improper Moderation Action',
    description: 'Yetkili sorumluluğunda yanlış işlem yapmak (Örn: Hatalı ceza/uyarı vermek).',
    descriptionEn: 'Performing an incorrect administrative action (e.g., issuing an invalid warning or penalty).',
    type: 'staff_warn',
    points: 0,
    penaltyLabel: '+1 Yetkili Uyarısı',
    penaltyLabelEn: '+1 Staff Warning',
    badgeClass: 'badge-warning',
  },
  Y4: {
    code: 'Y4',
    category: 'staff',
    categoryLabel: 'Yetkili Disiplin Kuralları',
    categoryLabelEn: 'Staff Disciplinary Rules',
    title: 'Kendini Üstün Görmek',
    titleEn: 'Arrogance / Acting Superior',
    description: 'Sunucuda diğer üyelere veya yetkililere karşı kibir göstermek, kendini üstün görmek.',
    descriptionEn: 'Displaying arrogance or acting superior toward other members or fellow staff.',
    type: 'staff_warn',
    points: 0,
    penaltyLabel: '+1 Yetkili Uyarısı',
    penaltyLabelEn: '+1 Staff Warning',
    badgeClass: 'badge-warning',
  },
  Y5: {
    code: 'Y5',
    category: 'staff',
    categoryLabel: 'Yetkili Disiplin Kuralları',
    categoryLabelEn: 'Staff Disciplinary Rules',
    title: 'Üst Kademe Yönlendirmesini Dinlememek',
    titleEn: 'Disobeying Senior Management Directives',
    description: 'Kendinden üst kademeli yetkililerin talimat veya yönlendirmelerini dinlememek / dikkate almamak.',
    descriptionEn: 'Ignoring or disobeying instructions and directives from higher-ranking management.',
    type: 'staff_warn',
    points: 0,
    penaltyLabel: '+1 Yetkili Uyarısı',
    penaltyLabelEn: '+1 Staff Warning',
    badgeClass: 'badge-warning',
  },
};

/**
 * Tek bir kural nesnesini seçili dile (tr/en) göre yerelleştirilmiş kopya olarak döndürür.
 */
function localizeRule(rule, lang = 'tr') {
  const isEn = lang === 'en';
  return {
    ...rule,
    categoryLabel: isEn ? rule.categoryLabelEn || rule.categoryLabel : rule.categoryLabel,
    title: isEn ? rule.titleEn || rule.title : rule.title,
    description: isEn ? rule.descriptionEn || rule.description : rule.description,
    penaltyLabel: isEn ? rule.penaltyLabelEn || rule.penaltyLabel : rule.penaltyLabel,
  };
}

/**
 * Tüm kuralları seçili dile göre sözlük (Map) olarak döndürür.
 */
function getLocalizedRules(lang = 'tr') {
  const result = {};
  for (const [code, rule] of Object.entries(RULES)) {
    result[code] = localizeRule(rule, lang);
  }
  return result;
}

/**
 * Kuralları kategorilerine göre gruplanmış ve seçili dile uyarlanmış olarak döndürür.
 */
function getGroupedRules(lang = 'tr') {
  const isEn = lang === 'en';
  const groups = {
    participant: {
      title: isEn
        ? '🛡️ Participant Rules (M1 – M13)'
        : '🛡️ Katılımcı Kuralları (M1 – M13)',
      subtitle: isEn
        ? 'Core conduct and interaction standards applicable to all server members'
        : 'Sunucudaki tüm üyeler için geçerli temel davranış ve etkileşim maddeleri',
      rules: [],
    },
    order: {
      title: isEn
        ? '📢 Order & Channel Rules (D1 – D3)'
        : '📢 Düzen ve Kanal Kuralları (D1 – D3)',
      subtitle: isEn
        ? 'Guidelines designed to maintain order across text and voice channels'
        : 'Sohbet ve ses kanallarının düzenini korumaya yönelik maddeler',
      rules: [],
    },
    staff: {
      title: isEn
        ? '⚖️ Staff Disciplinary Rules (Y1 – Y5)'
        : '⚖️ Yetkili Disiplin Kuralları (Y1 – Y5)',
      subtitle: isEn
        ? 'Code of conduct ensuring fair, disciplined, and exemplary staff administration'
        : 'Yetkili kadrosunun adil, disiplinli ve örnek yönetimini sağlayan kurallar',
      rules: [],
    },
  };

  for (const [, rule] of Object.entries(RULES)) {
    if (groups[rule.category]) {
      groups[rule.category].rules.push(localizeRule(rule, lang));
    }
  }

  return groups;
}

module.exports = {
  RULES,
  localizeRule,
  getLocalizedRules,
  getGroupedRules,
};
