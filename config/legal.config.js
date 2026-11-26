/**
 * ==============================================================================
 * ⚖️ PIYADE WORLD — MERKEZİ YASAL, KVKK VE İHLAL BİLDİRİM YAPILANDIRMASI
 * ==============================================================================
 * - Hiçbir yasal bilgi (unvan, adres, e-posta, telefon, KEP, sicil, vergi, VERBİS)
 *   kodda uydurulmaz; tamamı ortam değişkenlerinden (LEGAL_*) okunur.
 * - Boş olan her alan sayfada açıkça "[Doldurulacak: ...]" / "[To be filled: ...]"
 *   olarak gösterilir.
 * - LEGAL_REVIEWED varsayılan olarak false'tur; false iken her yasal sayfanın en
 *   üstünde belirgin taslak uyarısı görünür.
 * ==============================================================================
 */

const LEGAL_FIELDS = Object.freeze([
  {
    key: 'LEGAL_CONTROLLER_NAME',
    required: true,
    labelTr: 'Veri Sorumlusu Adı / Unvanı',
    labelEn: 'Data Controller Full Name / Legal Title',
  },
  {
    key: 'LEGAL_ADDRESS',
    required: true,
    labelTr: 'Açık Tebligat / İletişim Adresi',
    labelEn: 'Physical / Legal Notification Address',
  },
  {
    key: 'LEGAL_EMAIL',
    required: true,
    labelTr: 'Yasal & KVKK İletişim E-postası',
    labelEn: 'Legal & Privacy Contact Email',
  },
  {
    key: 'LEGAL_PHONE',
    required: false,
    labelTr: 'İletişim Telefon Numarası',
    labelEn: 'Contact Phone Number',
  },
  {
    key: 'LEGAL_KEP',
    required: false,
    labelTr: 'KEP (Kayıtlı Elektronik Posta) Adresi',
    labelEn: 'Registered Electronic Mail (KEP) Address',
  },
  {
    key: 'LEGAL_REGISTRY_NO',
    required: false,
    labelTr: 'Ticaret Sicil / MERSİS Numarası (varsa)',
    labelEn: 'Trade Registry / MERSIS Number (if applicable)',
  },
  {
    key: 'LEGAL_TAX_NO',
    required: false,
    labelTr: 'Vergi Dairesi ve Vergi Numarası (varsa)',
    labelEn: 'Tax Office & Tax ID (if applicable)',
  },
  {
    key: 'LEGAL_VERBIS_STATUS',
    required: true,
    labelTr: 'VERBİS Kayıt Durumu / Muafiyet Beyanı',
    labelEn: 'VERBIS Registration Status / Exemption Statement',
  },
]);

const LEGAL_DOCS = Object.freeze([
  {
    slug: 'kvkk-aydinlatma',
    titleTr: 'KVKK Aydınlatma Metni',
    titleEn: 'KVKK Privacy Notice',
    descTr: 'Piyade World kişisel verilerin işlenmesi, saklama süreleri, aktarımlar ve KVKK m.11 hakları aydınlatma metni.',
    descEn: 'Piyade World personal data processing notice under Law No. 6698 (KVKK), retention periods, transfers, and data subject rights.',
    sitemapPriority: '0.6',
  },
  {
    slug: 'acik-riza',
    titleTr: 'Açık Rıza Metni',
    titleEn: 'Explicit Consent Notice',
    descTr: 'Piyade World sohbet inceleme, oyun kullanıcı adı görünürlüğü ve yurt dışı aktarım için ayrı ayrı onaylanabilir açık rıza maddeleri.',
    descEn: 'Separately opt-in explicit consent items for Piyade World moderation review, game username display, and cross-border transfers.',
    sitemapPriority: '0.5',
  },
  {
    slug: 'gizlilik-politikasi',
    titleTr: 'Gizlilik Politikası',
    titleEn: 'Privacy Policy',
    descTr: 'Piyade World web sitesi ve Discord botu gizlilik ilkeleri, veri toplama akışı, sohbet gizliliği ve güvenlik tedbirleri.',
    descEn: 'Piyade World website and Discord bot privacy policy covering real data flows, chat privacy, and security measures.',
    sitemapPriority: '0.6',
  },
  {
    slug: 'cerez-politikasi',
    titleTr: 'Çerez Politikası',
    titleEn: 'Cookie Policy',
    descTr: 'Piyade World sitesinde kullanılan zorunlu çerezler ile localStorage / sessionStorage anahtarlarının tam envanteri.',
    descEn: 'Full inventory of strictly necessary cookies and browser localStorage / sessionStorage keys used on Piyade World.',
    sitemapPriority: '0.5',
  },
  {
    slug: 'kvkk-basvuru',
    titleTr: 'KVKK Başvuru Formu',
    titleEn: 'KVKK Request Form',
    descTr: '6698 sayılı KVKK m.11 kapsamındaki haklarınız için çevrimiçi başvuru formu ve 30 günlük yanıt süreci açıklaması.',
    descEn: 'Online data subject request form under Article 11 of KVKK and explanation of the 30-day response process.',
    sitemapPriority: '0.5',
  },
  {
    slug: 'kunye',
    titleTr: 'Künye',
    titleEn: 'Imprint / Legal Notice',
    descTr: '5651 sayılı Kanun kapsamında yer sağlayıcı / topluluk künyesi ve resmi iletişim bilgileri.',
    descEn: 'Hosting / community service provider legal notice (Imprint) under Turkish Law No. 5651 and official contact details.',
    sitemapPriority: '0.5',
  },
  {
    slug: 'telif-dmca',
    titleTr: 'Telif Hakkı / DMCA',
    titleEn: 'Copyright / DMCA',
    descTr: '5846 sayılı FSEK ve DMCA usulü fikri mülkiyet ihlali bildirim, kaldırma ve karşı bildirim prosedürü.',
    descEn: 'Intellectual property notice-and-takedown and counter-notice procedure under Law No. 5846 and DMCA.',
    sitemapPriority: '0.5',
  },
  {
    slug: 'kotuye-kullanim',
    titleTr: 'Kötüye Kullanım ve İhlal Bildirimi',
    titleEn: 'Abuse & Violation Policy',
    descTr: 'Piyade World kötüye kullanım, güvenlik ve içerik ihlali bildirim prosedürü, inceleme süreleri ve itiraz yolları.',
    descEn: 'Piyade World abuse, safety, and violation reporting procedure, review timelines, outcomes, and appeal process.',
    sitemapPriority: '0.5',
  },
]);

const FOOTER_LEGAL_LINKS = Object.freeze([
  { path: '/yasal/kvkk-aydinlatma', labelTr: 'KVKK Aydınlatma Metni', labelEn: 'KVKK Privacy Notice' },
  { path: '/yasal/acik-riza', labelTr: 'Açık Rıza Metni', labelEn: 'Explicit Consent' },
  { path: '/yasal/gizlilik-politikasi', labelTr: 'Gizlilik Politikası', labelEn: 'Privacy Policy' },
  { path: '/yasal/cerez-politikasi', labelTr: 'Çerez Politikası', labelEn: 'Cookie Policy' },
  { path: '/yasal/kvkk-basvuru', labelTr: 'KVKK Başvuru Formu', labelEn: 'KVKK Request Form' },
  { path: '/yasal/kunye', labelTr: 'Künye', labelEn: 'Imprint' },
  { path: '/yasal/telif-dmca', labelTr: 'Telif Hakkı / DMCA', labelEn: 'Copyright / DMCA' },
  { path: '/bildir', labelTr: 'İhlal Bildir', labelEn: 'Report Abuse' },
]);

const REPORT_CATEGORIES = Object.freeze([
  {
    id: 'harassment',
    emoji: '🚨',
    audience: 'community',
    priority: 'normal',
    labelTr: 'Taciz / Zorbalık',
    labelEn: 'Harassment / Bullying',
    descTr: 'Hakaret, ısrarlı rahatsız etme, hedef gösterme veya zorbalık.',
    descEn: 'Insults, persistent harassment, targeting, or bullying.',
  },
  {
    id: 'sexual',
    emoji: '🔞',
    audience: 'community',
    priority: 'high',
    labelTr: 'Cinsel / Uygunsuz İçerik',
    labelEn: 'Sexual / Inappropriate Content',
    descTr: 'Müstehcen, rıza dışı veya topluluğa uygunsuz cinsel içerik.',
    descEn: 'Explicit, non-consensual, or inappropriate sexual content.',
  },
  {
    id: 'child_safety',
    emoji: '🆘',
    audience: 'community',
    priority: 'critical',
    labelTr: 'Çocuk Güvenliği',
    labelEn: 'Child Safety',
    descTr: 'Reşit olmayanlara yönelik istismar, yönlendirme veya tehlike (ÖNCELİKLİ).',
    descEn: 'Exploitation, grooming, or harm involving minors (CRITICAL PRIORITY).',
  },
  {
    id: 'threat',
    emoji: '⚠️',
    audience: 'community',
    priority: 'high',
    labelTr: 'Tehdit / Şiddet',
    labelEn: 'Threat / Violence',
    descTr: 'Fiziksel zarar tehdidi, şantaj, kendine zarar veya şiddet teşviki.',
    descEn: 'Threats of harm, blackmail, self-harm, or incitement to violence.',
  },
  {
    id: 'scam_spam',
    emoji: '🎭',
    audience: 'community',
    priority: 'normal',
    labelTr: 'Dolandırıcılık / Spam',
    labelEn: 'Scam / Spam',
    descTr: 'Hesap çalma bağlantısı, oltalama, sahte çekiliş veya yoğun spam.',
    descEn: 'Phishing links, account theft attempts, fake giveaways, or spam.',
  },
  {
    id: 'impersonation',
    emoji: '🪪',
    audience: 'community',
    priority: 'normal',
    labelTr: 'Hesap / Kimlik Taklidi',
    labelEn: 'Account / Identity Impersonation',
    descTr: 'Yetkili veya başka bir üye gibi davranma, sahte kimlik kullanımı.',
    descEn: 'Pretending to be staff or another member using a fake identity.',
  },
  {
    id: 'illegal',
    emoji: '⚖️',
    audience: 'management',
    priority: 'high',
    labelTr: 'Yasa Dışı İçerik',
    labelEn: 'Illegal Content',
    descTr: 'Yürürlükteki mevzuata aykırı paylaşım, suç teşkil eden içerik.',
    descEn: 'Unlawful content or activity violating applicable laws.',
  },
  {
    id: 'copyright_dmca',
    emoji: '©️',
    audience: 'management',
    priority: 'normal',
    labelTr: 'Telif Hakkı / Fikri Mülkiyet (DMCA)',
    labelEn: 'Copyright / IP (DMCA)',
    descTr: 'İzinsiz kullanılan eser, görsel, metin, marka veya telif hakkı ihlali.',
    descEn: 'Unauthorized use of copyrighted work, imagery, text, or trademarks.',
  },
  {
    id: 'privacy_kvkk',
    emoji: '🔐',
    audience: 'management',
    priority: 'high',
    labelTr: 'Kişisel Veri / Gizlilik İhlali (KVKK)',
    labelEn: 'Personal Data / Privacy Violation',
    descTr: 'İzinsiz kişisel bilgi paylaşımı (doxxing) veya veri gizliliği ihlali.',
    descEn: 'Unauthorized sharing of personal information (doxxing) or privacy breach.',
  },
  {
    id: 'other',
    emoji: '📌',
    audience: 'management',
    priority: 'low',
    labelTr: 'Diğer',
    labelEn: 'Other',
    descTr: 'Yukarıdaki başlıklara girmeyen site, topluluk veya güvenlik bildirimleri.',
    descEn: 'Other site, community, or safety concerns not listed above.',
  },
]);

const REPORT_LOCATIONS = Object.freeze(['site', 'chat', 'discord', 'other']);
const REPORT_STATUSES = Object.freeze(['new', 'in_review', 'action_taken', 'no_basis', 'closed']);
const KVKK_STATUSES = Object.freeze(['received', 'in_review', 'answered', 'rejected']);

const KVKK_REQUEST_TYPES = Object.freeze([
  { id: 'info', labelTr: 'Verilerimin işlenip işlenmediğini öğrenme ve bilgi talep etme', labelEn: 'Learn whether my personal data is processed and request information' },
  { id: 'access', labelTr: 'İşlenen kişisel verilerime erişim ve kopya talep etme', labelEn: 'Access and obtain a copy of my personal data' },
  { id: 'rectification', labelTr: 'Eksik veya yanlış işlenen verilerin düzeltilmesini isteme', labelEn: 'Request rectification of incomplete or inaccurate data' },
  { id: 'erasure', labelTr: 'Kişisel verilerimin silinmesini veya yok edilmesini isteme', labelEn: 'Request erasure or destruction of my personal data' },
  { id: 'objection', labelTr: 'Veri işleme faaliyetine veya açık rızaya itiraz / geri alma', labelEn: 'Object to processing or withdraw explicit consent' },
  { id: 'transfer_info', labelTr: 'Verilerin aktarıldığı yurt içi / yurt dışı üçüncü kişileri öğrenme', labelEn: 'Learn third parties (domestic/abroad) to whom data is transferred' },
  { id: 'automated_objection', labelTr: 'Münhasıran otomatik sistemlerle analiz sonucuna itiraz etme', labelEn: 'Object to adverse outcomes from exclusively automated analysis' },
  { id: 'other', labelTr: 'Diğer KVKK m.11 talebi', labelEn: 'Other KVKK Article 11 request' },
]);

function parsePositiveInt(raw, fallback) {
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getRetentionConfig(envObj = process.env) {
  const kvkkRetentionDays = parsePositiveInt(envObj.LEGAL_KVKK_RETENTION_DAYS, 1095);
  const reportRetentionDays = parsePositiveInt(envObj.LEGAL_REPORT_RETENTION_DAYS, 365);
  return {
    KVKK_REQUEST_DAYS: kvkkRetentionDays,
    KVKK_RESPONSE_DEADLINE_DAYS: 30,
    REPORT_DAYS: reportRetentionDays,
    REPORT_EVIDENCE_MAX_FILES: 3,
    REPORT_EVIDENCE_MAX_BYTES: 5 * 1024 * 1024, // 5 MB
    MIN_FORM_FILL_MS: 3000,
    MAX_KVKK_PER_DAY_PER_IP: 3,
    MAX_REPORTS_PER_HOUR_PER_IP: 5,
    MAX_KVKK_DESCRIPTION: 3000,
    MAX_REPORT_DESCRIPTION: 2000,
  };
}

function getLegalEnvValue(key, envObj = process.env) {
  if (!envObj || typeof envObj !== 'object') return '';
  const raw = envObj[key];
  return typeof raw === 'string' ? raw.trim() : '';
}

function isLegalReviewed(envObj = process.env) {
  const raw = getLegalEnvValue('LEGAL_REVIEWED', envObj).toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function formatLegalField(key, lang = 'tr', envObj = process.env) {
  const val = getLegalEnvValue(key, envObj);
  if (val) return val;
  const spec = LEGAL_FIELDS.find((f) => f.key === key);
  const label = spec ? (lang === 'en' ? spec.labelEn : spec.labelTr) : key;
  return lang === 'en' ? `[To be filled: ${label}]` : `[Doldurulacak: ${label}]`;
}

function getLegalFieldsStatus(envObj = process.env) {
  return LEGAL_FIELDS.map((field) => {
    const value = getLegalEnvValue(field.key, envObj);
    return {
      ...field,
      value,
      filled: value.length > 0,
    };
  });
}

function replaceLegalPlaceholders(markdownText, lang = 'tr', envObj = process.env) {
  let out = String(markdownText || '');
  for (const field of LEGAL_FIELDS) {
    const token = `{{${field.key}}}`;
    const replacement = formatLegalField(field.key, lang, envObj);
    out = out.split(token).join(replacement);
  }
  const retention = getRetentionConfig(envObj);
  const baseUrl = (getLegalEnvValue('BASE_URL', envObj) || 'https://piyade-team-tsb.up.railway.app').replace(/\/+$/, '');
  const kvkkYears = Math.max(1, Math.round((retention.KVKK_REQUEST_DAYS / 365) * 10) / 10);
  const reportDays = retention.REPORT_DAYS;

  out = out
    .split('{{SITE_URL}}').join(baseUrl)
    .split('{{KVKK_RETENTION_DAYS}}').join(String(retention.KVKK_REQUEST_DAYS))
    .split('{{KVKK_RETENTION_YEARS}}').join(String(kvkkYears))
    .split('{{KVKK_RESPONSE_DEADLINE_DAYS}}').join(String(retention.KVKK_RESPONSE_DEADLINE_DAYS))
    .split('{{REPORT_RETENTION_DAYS}}').join(String(reportDays));

  return out;
}

function getLegalDocBySlug(slug) {
  const clean = String(slug || '').trim().toLowerCase();
  return LEGAL_DOCS.find((d) => d.slug === clean) || null;
}

function getReportCategoryById(id) {
  const clean = String(id || '').trim().toLowerCase();
  return REPORT_CATEGORIES.find((c) => c.id === clean) || null;
}

module.exports = {
  LEGAL_FIELDS,
  LEGAL_DOCS,
  FOOTER_LEGAL_LINKS,
  REPORT_CATEGORIES,
  REPORT_LOCATIONS,
  REPORT_STATUSES,
  KVKK_STATUSES,
  KVKK_REQUEST_TYPES,
  getRetentionConfig,
  getLegalEnvValue,
  isLegalReviewed,
  formatLegalField,
  getLegalFieldsStatus,
  replaceLegalPlaceholders,
  getLegalDocBySlug,
  getReportCategoryById,
};
