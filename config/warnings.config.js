/**
 * ==============================================================================
 * ⚖️ PIYADE WORLD — SİTE (GOOGLE) ÜYELERİ UYARI & YAPTIRIM KURAL MOTORU AYARLARI
 * ==============================================================================
 * - Tüm kural maddeleri (M1–M13, D1–D3) ve puanları TEK KAYNAK olan
 *   config/rules.config.js dosyasından okunur; kurallar burada tekrar yazılmaz.
 * - Yetkili kuralları (Y1–Y5) bu modülde KESİNLİKLE yer almaz (Google üyeler
 *   asla yetkili olamaz).
 * - Discord kademeleri (0–5), puan eşikleri (10 ve 15), özel yaptırımlar
 *   (M2, M9, M4, M10, M11, M13), 30 günlük otomatik af ve saklama süreleri
 *   buradan merkezi olarak yönetilir ve istenirse ortam değişkenleriyle ayarlanır.
 * ==============================================================================
 */

const { RULES, localizeRule } = require('./rules.config');

const DAY_MS = 24 * 60 * 60 * 1000;

function readPositiveIntEnv(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const parsed = Number.parseInt(String(raw).trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Site (Google) üyelerine uygulanabilen kategoriler:
 * Yalnızca katılımcı (M1–M13) ve düzen/kanal (D1–D3) kuralları.
 * Yetkili kuralları ('staff': Y1–Y5) hariç tutulur.
 */
const ALLOWED_CATEGORIES = Object.freeze(['participant', 'order']);

/**
 * Discord uyarı kademeleriyle birebir uyumlu puan kademeleri:
 *  - 0–2 puan  -> Kademe 0 (Henüz uyarı etiketi yok)
 *  - 3–5 puan  -> Kademe 1 (Uyarı 1)
 *  - 6–8 puan  -> Kademe 2 (Uyarı 2)
 *  - 9–11 puan -> Kademe 3 (Uyarı 3)
 *  - 12–14 puan-> Kademe 4 (Uyarı 4)
 *  - 15+ puan  -> Kademe 5 (Uyarı 5)
 */
const TIERS = Object.freeze([
  { tier: 0, minPoints: 0, maxPoints: 2, labelTr: 'Temiz / Kademe 0', labelEn: 'Clean / Tier 0' },
  { tier: 1, minPoints: 3, maxPoints: 5, labelTr: 'Uyarı 1', labelEn: 'Warning 1' },
  { tier: 2, minPoints: 6, maxPoints: 8, labelTr: 'Uyarı 2', labelEn: 'Warning 2' },
  { tier: 3, minPoints: 9, maxPoints: 11, labelTr: 'Uyarı 3', labelEn: 'Warning 3' },
  { tier: 4, minPoints: 12, maxPoints: 14, labelTr: 'Uyarı 4', labelEn: 'Warning 4' },
  { tier: 5, minPoints: 15, maxPoints: Infinity, labelTr: 'Uyarı 5', labelEn: 'Warning 5' },
]);

/**
 * Puan eşiği yaptırımları (her aktif af döngüsünde İLK geçişte bir kez uygulanır — idempotent):
 *  - 10 puana İLK ulaşıldığında: 3 gün Sohbet Susturma (Discord: +3 Gün Timeout)
 *  - 15+ puana İLK ulaşıldığında: 7 gün Hesap Askıya Alma (Discord: 1 Hafta @Askıda)
 */
const POINT_THRESHOLDS = Object.freeze({
  CHAT_MUTE_10: Object.freeze({
    key: 'pts_10_mute',
    minPoints: 10,
    sanctionKind: 'chat_mute',
    durationDays: 3,
    labelTr: '10 Puan Eşiği: 3 Gün Sohbet Susturma',
    labelEn: '10-Point Threshold: 3-Day Chat Mute',
  }),
  ACCOUNT_SUSPEND_15: Object.freeze({
    key: 'pts_15_suspend',
    minPoints: 15,
    sanctionKind: 'account_suspend',
    durationDays: 7,
    labelTr: '15+ Puan Eşiği: 7 Gün Hesap Askıya Alma',
    labelEn: '15+ Point Threshold: 7-Day Account Suspension',
  }),
});

/**
 * Otomatik af ve saklama süreleri (gün cinsinden; ortam değişkeniyle ezilebilir).
 */
const RETENTION = Object.freeze({
  AMNESTY_DAYS: 30, // Son puandan itibaren 30 gün yeni puan yoksa puan ve kademe sıfırlanır
  RECORD_AFTER_EXPIRY_DAYS: 365, // Kayıt süresi dolduktan / af / iptal sonrası 12 ay
  EVIDENCE_MAX_DAYS: 180, // Kanıt görseli dosyası en fazla 6 ay
  AUDIT_MAX_DAYS: 365, // İçeriksiz denetim kaydı 12 ay
  MAX_REASON_LENGTH: 600,
  MAX_CANCEL_REASON_LENGTH: 400,
  PREVIEW_HISTORY_LIMIT: 10,
});

function getAmnestyDays() {
  return readPositiveIntEnv('WARNING_AMNESTY_DAYS', RETENTION.AMNESTY_DAYS);
}

function getRecordRetentionDays() {
  return readPositiveIntEnv('WARNING_RECORD_RETENTION_DAYS', RETENTION.RECORD_AFTER_EXPIRY_DAYS);
}

function getEvidenceRetentionDays() {
  return readPositiveIntEnv('WARNING_EVIDENCE_RETENTION_DAYS', RETENTION.EVIDENCE_MAX_DAYS);
}

function getAuditRetentionDays() {
  return readPositiveIntEnv('WARNING_AUDIT_RETENTION_DAYS', RETENTION.AUDIT_MAX_DAYS);
}

/**
 * config/rules.config.js içindeki bir kuralın Site (Google) üyesi karşılığını üretir.
 * - type: 'ban' (M2) ve 'yasakli' (M9) -> Kalıcı Yasak ('permanent_ban')
 * - type: 'timeout' (M4: 2g, M10/M11/M13: 1g) -> Sohbet Susturma ('chat_mute')
 * - type: 'points' (M1, M3, M5, M6, M7, M8, M12, D1–D3) -> Ceza Puanı ('points')
 */
function resolveSiteEffectForRule(rule) {
  if (!rule || !ALLOWED_CATEGORIES.includes(rule.category)) return null;

  if (rule.type === 'ban' || rule.type === 'yasakli') {
    return {
      effectKind: 'permanent_ban',
      points: 0,
      durationDays: null,
      sitePenaltyLabelTr: 'Kalıcı Hesap Yasağı',
      sitePenaltyLabelEn: 'Permanent Account Ban',
    };
  }

  if (rule.type === 'timeout') {
    const days = Number(rule.durationDays) > 0 ? Number(rule.durationDays) : 1;
    return {
      effectKind: 'chat_mute',
      points: 0,
      durationDays: days,
      sitePenaltyLabelTr: `${days} Gün Sohbet Susturma`,
      sitePenaltyLabelEn: `${days}-Day Chat Mute`,
    };
  }

  if (rule.type === 'points') {
    const pts = Number(rule.points) > 0 ? Number(rule.points) : 0;
    return {
      effectKind: 'points',
      points: pts,
      durationDays: null,
      sitePenaltyLabelTr: `+${pts} Ceza Puanı`,
      sitePenaltyLabelEn: `+${pts} Penalty Point${pts === 1 ? '' : 's'}`,
    };
  }

  return null;
}

/**
 * Site (Google) uyarı panelinde seçilebilecek kuralları (yalnızca M ve D maddeleri)
 * seçili dile göre döndürür. Y1–Y5 maddeleri asla döndürülmez.
 */
function getSiteRulesMap(lang = 'tr') {
  const isEn = lang === 'en';
  const out = {};
  for (const [code, rawRule] of Object.entries(RULES)) {
    if (!ALLOWED_CATEGORIES.includes(rawRule.category)) continue;
    const effect = resolveSiteEffectForRule(rawRule);
    if (!effect) continue;
    const loc = localizeRule(rawRule, lang);
    out[code] = {
      ...loc,
      titleTr: rawRule.title,
      titleEn: rawRule.titleEn || rawRule.title,
      effectKind: effect.effectKind,
      points: effect.points,
      durationDays: effect.durationDays,
      sitePenaltyLabelTr: effect.sitePenaltyLabelTr,
      sitePenaltyLabelEn: effect.sitePenaltyLabelEn,
      sitePenaltyLabel: isEn ? effect.sitePenaltyLabelEn : effect.sitePenaltyLabelTr,
      discordPenaltyLabelTr: rawRule.penaltyLabel,
      discordPenaltyLabelEn: rawRule.penaltyLabelEn || rawRule.penaltyLabel,
    };
  }
  return out;
}

function getSiteRule(rawCode, lang = 'tr') {
  const clean = String(rawCode || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!clean) return null;
  const map = getSiteRulesMap(lang);
  return map[clean] || null;
}

function calculateTierFromPoints(points) {
  const pts = Math.max(0, Number(points) || 0);
  if (pts >= 15) return 5;
  if (pts >= 12) return 4;
  if (pts >= 9) return 3;
  if (pts >= 6) return 2;
  if (pts >= 3) return 1;
  return 0;
}

function getTierInfo(tier, lang = 'tr') {
  const tNum = Math.max(0, Math.min(5, Number(tier) || 0));
  const found = TIERS.find((x) => x.tier === tNum) || TIERS[0];
  return {
    ...found,
    label: lang === 'en' ? found.labelEn : found.labelTr,
  };
}

module.exports = {
  DAY_MS,
  ALLOWED_CATEGORIES,
  TIERS,
  POINT_THRESHOLDS,
  RETENTION,
  getAmnestyDays,
  getRecordRetentionDays,
  getEvidenceRetentionDays,
  getAuditRetentionDays,
  resolveSiteEffectForRule,
  getSiteRulesMap,
  getSiteRule,
  calculateTierFromPoints,
  getTierInfo,
};
