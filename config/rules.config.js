/**
 * Piyade Team | TSB Sunucu Kuralları
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
    title: 'Küfür / Hakaret',
    description: 'Sunucumuzda küfür/hakarete başvurmak. Bununla ilgili içerik paylaşmak.',
    type: 'points',
    points: 2,
    penaltyLabel: '+2 Ceza Puanı',
    badgeClass: 'badge-warning',
  },
  M2: {
    code: 'M2',
    category: 'participant',
    categoryLabel: 'Katılımcı Kuralları',
    title: 'Reklam & Ticari Faaliyet',
    description: 'Reklam yapmak, hesap/oyun satışı gibi ticari faaliyetlerde bulunmak (Özel mesaj da dahil).',
    type: 'ban',
    points: 0,
    penaltyLabel: 'Kalıcı Yasak (Permanent Ban)',
    badgeClass: 'badge-danger',
  },
  M3: {
    code: 'M3',
    category: 'participant',
    categoryLabel: 'Katılımcı Kuralları',
    title: 'Aşırı Övünme / Rahatsız Etme',
    description: 'Sunucumuzda düzenlenen etkinliklerde veya yapılacak olan kapışmalarda karşı taraf rahatsız olduğu halde kendini abartı şekilde övmek.',
    type: 'points',
    points: 1,
    penaltyLabel: '+1 Ceza Puanı',
    badgeClass: 'badge-info',
  },
  M4: {
    code: 'M4',
    category: 'participant',
    categoryLabel: 'Katılımcı Kuralları',
    title: 'Taciz',
    description: 'Cinsiyet fark etmeksizin taciz içeren davranışlarda bulunmak.',
    type: 'timeout',
    durationDays: 2,
    points: 0,
    penaltyLabel: '2 Gün Timeout',
    badgeClass: 'badge-danger',
  },
  M5: {
    code: 'M5',
    category: 'participant',
    categoryLabel: 'Katılımcı Kuralları',
    title: 'Kanal Amacı Dışında Kullanım',
    description: "Kanalları amacı dışında kullanmak (Örn: #bot-komut'ta sohbet etmek).",
    type: 'points',
    points: 3,
    penaltyLabel: '+3 Ceza Puanı',
    badgeClass: 'badge-warning',
  },
  M6: {
    code: 'M6',
    category: 'participant',
    categoryLabel: 'Katılımcı Kuralları',
    title: 'Cinsel İçerik',
    description: 'Cinsel içerikli herhangi bir paylaşım (görsel, yazı, link) yapmak.',
    type: 'points',
    points: 8,
    penaltyLabel: '+8 Ceza Puanı',
    badgeClass: 'badge-danger',
  },
  M7: {
    code: 'M7',
    category: 'participant',
    categoryLabel: 'Katılımcı Kuralları',
    title: 'Kavga Ortamı Yaratma',
    description: 'Bir kişiye muhatap olmak istemediği sürece ya da kasten kavga ortamı yaratmak.',
    type: 'points',
    points: 4,
    penaltyLabel: '+4 Ceza Puanı',
    badgeClass: 'badge-warning',
  },
  M8: {
    code: 'M8',
    category: 'participant',
    categoryLabel: 'Katılımcı Kuralları',
    title: 'Zorbalık & Soğutma',
    description: 'Zorbalık yapmak, başka bir üyeyi sunucudan soğutacak davranışlarda bulunmak.',
    type: 'points',
    points: 5,
    penaltyLabel: '+5 Ceza Puanı',
    badgeClass: 'badge-danger',
  },
  M9: {
    code: 'M9',
    category: 'participant',
    categoryLabel: 'Katılımcı Kuralları',
    title: 'Başka Sunucuya Davet',
    description: 'Yönetmenlik bilgisi dışında sunucu üyelerini kendi sunucunuza veya grubunuza davet etmek.',
    type: 'yasakli',
    points: 0,
    penaltyLabel: 'Doğrudan Yasaklı (Sunucudan Atılma)',
    badgeClass: 'badge-danger',
  },
  M10: {
    code: 'M10',
    category: 'participant',
    categoryLabel: 'Katılımcı Kuralları',
    title: '+18 & Ayrımcılık Paylaşımı',
    description: '+18, cinsel taciz, ırkçılık, cinsiyet/yaş ayrımcılığı içeren içerik paylaşmak.',
    type: 'timeout',
    durationDays: 1,
    points: 0,
    penaltyLabel: '1 Gün Timeout',
    badgeClass: 'badge-danger',
  },
  M11: {
    code: 'M11',
    category: 'participant',
    categoryLabel: 'Katılımcı Kuralları',
    title: 'Irkçılık & Ayrımcılık',
    description: 'Irkçılık ve her türlü ayrımcılık yapmak.',
    type: 'timeout',
    durationDays: 1,
    points: 0,
    penaltyLabel: '1 Gün Timeout',
    badgeClass: 'badge-danger',
  },
  M12: {
    code: 'M12',
    category: 'participant',
    categoryLabel: 'Katılımcı Kuralları',
    title: 'Küçümseme & Dalga Geçme',
    description: 'Sunucuda bulunan kişilerin psikolojisini etkileyecek argo, küçümseme ve dalga geçme gibi faaliyetler yapmak.',
    type: 'points',
    points: 2,
    penaltyLabel: '+2 Ceza Puanı',
    badgeClass: 'badge-warning',
  },
  M13: {
    code: 'M13',
    category: 'participant',
    categoryLabel: 'Katılımcı Kuralları',
    title: '3. Taraf Yazılım / Hile',
    description: 'Sunucuda yapılan etkinliklerde ve kapışmalarda 3. Taraf yazılım veya hile kullanmak.',
    type: 'timeout',
    durationDays: 1,
    points: 0,
    penaltyLabel: '1 Gün Timeout',
    badgeClass: 'badge-danger',
  },

  // ==========================================
  // DÜZEN VE KANAL KURALLARI (D1 - D3)
  // ==========================================
  D1: {
    code: 'D1',
    category: 'order',
    categoryLabel: 'Düzen & Kanal Kuralları',
    title: 'Önemli Kanallara Boş Mesaj',
    description: 'Önemli kanallara (duyuru vb.) anlamsız, boş mesajlar atmak.',
    type: 'points',
    points: 3,
    penaltyLabel: '+3 Ceza Puanı',
    badgeClass: 'badge-warning',
  },
  D2: {
    code: 'D2',
    category: 'order',
    categoryLabel: 'Düzen & Kanal Kuralları',
    title: 'Sohbet & Ses Paneli Spamı',
    description: 'Ses kanallarında ses panelini veya sohbet kanallarında sohbeti gereksiz yere çağırmak / spamlamak.',
    type: 'points',
    points: 3,
    penaltyLabel: '+3 Ceza Puanı',
    badgeClass: 'badge-warning',
  },
  D3: {
    code: 'D3',
    category: 'order',
    categoryLabel: 'Düzen & Kanal Kuralları',
    title: 'Ses Kanalında Bildirim Yağmuru',
    description: 'Önemli ses kanallarında sürekli yolculuk yaparak gereksiz bildirim yağmuruna sebep olmak.',
    type: 'points',
    points: 3,
    penaltyLabel: '+3 Ceza Puanı',
    badgeClass: 'badge-warning',
  },

  // ==========================================
  // YETKİLİ KURALLARI (Y1 - Y5)
  // ==========================================
  Y1: {
    code: 'Y1',
    category: 'staff',
    categoryLabel: 'Yetkili Disiplin Kuralları',
    title: 'Yetkiyi Kendi Lehine Kullanmak',
    description: 'Yetkisini kendi çıkarı veya lehine kullanmak.',
    type: 'staff_strip',
    points: 0,
    penaltyLabel: 'Direkt Tüm Yetkiler Alınır',
    badgeClass: 'badge-danger',
  },
  Y2: {
    code: 'Y2',
    category: 'staff',
    categoryLabel: 'Yetkili Disiplin Kuralları',
    title: 'Katılımcıyı Yanlış Yönlendirmek',
    description: 'Sunucudaki katılımcıyı yanlış yönlendirmek veya yanıltıcı bilgi vermek.',
    type: 'staff_warn',
    points: 0,
    penaltyLabel: '+1 Yetkili Uyarısı',
    badgeClass: 'badge-warning',
  },
  Y3: {
    code: 'Y3',
    category: 'staff',
    categoryLabel: 'Yetkili Disiplin Kuralları',
    title: 'Yanlış İşlem Yapmak',
    description: 'Yetkili sorumluluğunda yanlış işlem yapmak (Örn: Hatalı ceza/uyarı vermek).',
    type: 'staff_warn',
    points: 0,
    penaltyLabel: '+1 Yetkili Uyarısı',
    badgeClass: 'badge-warning',
  },
  Y4: {
    code: 'Y4',
    category: 'staff',
    categoryLabel: 'Yetkili Disiplin Kuralları',
    title: 'Kendini Üstün Görmek',
    description: 'Sunucuda diğer üyelere veya yetkililere karşı kibir göstermek, kendini üstün görmek.',
    type: 'staff_warn',
    points: 0,
    penaltyLabel: '+1 Yetkili Uyarısı',
    badgeClass: 'badge-warning',
  },
  Y5: {
    code: 'Y5',
    category: 'staff',
    categoryLabel: 'Yetkili Disiplin Kuralları',
    title: 'Üst Kademe Yönlendirmesini Dinlememek',
    description: 'Kendinden üst kademeli yetkililerin talimat veya yönlendirmelerini dinlememek / dikkate almamak.',
    type: 'staff_warn',
    points: 0,
    penaltyLabel: '+1 Yetkili Uyarısı',
    badgeClass: 'badge-warning',
  },
};

// Kuralları kategorilerine göre gruplanmış olarak döndürür
function getGroupedRules() {
  const groups = {
    participant: {
      title: '🛡️ Katılımcı Kuralları (M1 – M13)',
      subtitle: 'Sunucudaki tüm üyeler için geçerli temel davranış ve etkileşim maddeleri',
      rules: [],
    },
    order: {
      title: '📢 Düzen ve Kanal Kuralları (D1 – D3)',
      subtitle: 'Sohbet ve ses kanallarının düzenini korumaya yönelik maddeler',
      rules: [],
    },
    staff: {
      title: '⚖️ Yetkili Disiplin Kuralları (Y1 – Y5)',
      subtitle: 'Yetkili kadrosunun adil, disiplinli ve örnek yönetimini sağlayan kurallar',
      rules: [],
    },
  };

  for (const [code, rule] of Object.entries(RULES)) {
    if (groups[rule.category]) {
      groups[rule.category].rules.push(rule);
    }
  }

  return groups;
}

module.exports = {
  RULES,
  getGroupedRules,
};
