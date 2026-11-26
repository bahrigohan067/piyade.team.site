#!/usr/bin/env node
/**
 * ==============================================================================
 * ⚖️ PIYADE WORLD — YASAL HAZIRLIK VE METİN KONTROL RAPORU (scripts/legal-check.js)
 * ==============================================================================
 * Kullanım:
 *   node scripts/legal-check.js           -> Sade durum raporu basar (çıkış kodu 0)
 *   node scripts/legal-check.js --strict  -> Eksik zorunlu alan veya LEGAL_REVIEWED=false ise kod 1 ile çıkar
 * ==============================================================================
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const legalConfig = require('../config/legal.config');
const consentsConfig = require('../config/consents.config');
const { parseFrontmatter } = require('../utils/markdownRenderer');

const ROOT_DIR = path.resolve(__dirname, '..');
const LEGAL_CONTENT_DIR = path.join(ROOT_DIR, 'content', 'legal');

function runLegalCheck(envObj = process.env) {
  const reviewed = legalConfig.isLegalReviewed(envObj);
  const fields = legalConfig.getLegalFieldsStatus(envObj);
  const missingRequired = fields.filter((f) => f.required && !f.filled);
  const missingOptional = fields.filter((f) => !f.required && !f.filled);
  const retention = legalConfig.getRetentionConfig(envObj);

  const docs = [];
  const missingFiles = [];

  for (const doc of legalConfig.LEGAL_DOCS) {
    for (const lang of ['tr', 'en']) {
      const filePath = path.join(LEGAL_CONTENT_DIR, lang, `${doc.slug}.md`);
      if (!fs.existsSync(filePath)) {
        missingFiles.push(`content/legal/${lang}/${doc.slug}.md`);
        continue;
      }
      const raw = fs.readFileSync(filePath, 'utf8');
      const { meta } = parseFrontmatter(raw);
      docs.push({
        slug: doc.slug,
        lang,
        title: meta.title || '(Başlık eksik)',
        version: meta.version || '(Sürüm eksik)',
        lastUpdated: meta.lastUpdated || '(Tarih eksik)',
      });
    }
  }

  return {
    reviewed,
    fields,
    missingRequired,
    missingOptional,
    retention,
    docs,
    missingFiles,
    consents: consentsConfig.EXPLICIT_CONSENTS.map((c) => ({
      id: c.id,
      version: c.version,
      upcoming: c.upcoming,
    })),
  };
}

function formatLegalCheckReport(report) {
  const lines = [];
  lines.push('================================================================');
  lines.push('⚖️  PIYADE WORLD — YASAL METİN VE ORTAM DEĞİŞKENİ KONTROL RAPORU');
  lines.push('================================================================');
  lines.push('');
  lines.push(`1) Hukuki İnceleme Durumu (LEGAL_REVIEWED): ${report.reviewed ? '✅ ONAYLANDI (true — taslak uyarısı gizli)' : '⚠️ TASLAK (false — sayfa üstlerinde taslak uyarısı görünür)'}`);
  lines.push(`   Saklama Süreleri: KVKK Başvuruları = ${report.retention.KVKK_REQUEST_DAYS} gün | İhlal Bildirimleri = ${report.retention.REPORT_DAYS} gün | KVKK Yanıt Süresi = ${report.retention.KVKK_RESPONSE_DEADLINE_DAYS} gün`);
  lines.push('');
  lines.push('2) Ortam Değişkenleri (LEGAL_*):');
  for (const f of report.fields) {
    const tag = f.required ? '[ZORUNLU]' : '[İSTEĞE BAĞLI]';
    const state = f.filled ? '✅ Dolu' : '❌ BOŞ ([Doldurulacak] görünür)';
    lines.push(`   • ${f.key.padEnd(24)} ${tag.padEnd(15)} ${state} — ${f.labelTr}`);
  }
  lines.push('');
  lines.push(`   Eksik zorunlu alan sayısı : ${report.missingRequired.length}`);
  lines.push(`   Eksik isteğe bağlı alan   : ${report.missingOptional.length}`);
  lines.push('');
  lines.push('3) Yasal Markdown Belgeleri (content/legal/tr & en):');
  for (const d of report.docs) {
    lines.push(`   • [${d.lang.toUpperCase()}] ${d.slug.padEnd(22)} v${String(d.version).padEnd(6)} | Son Güncelleme: ${d.lastUpdated} | ${d.title}`);
  }
  if (report.missingFiles.length > 0) {
    lines.push('');
    lines.push('   ❌ Eksik Markdown Dosyaları:');
    for (const mf of report.missingFiles) {
      lines.push(`      - ${mf}`);
    }
  }
  lines.push('');
  lines.push('4) Ayrı Açık Rıza Maddeleri (config/consents.config.js):');
  for (const c of report.consents) {
    lines.push(`   • ${c.id.padEnd(30)} v${c.version}${c.upcoming ? ' (GELECEK ÖZELLİK)' : ''}`);
  }
  lines.push('================================================================');
  return lines.join('\n');
}

if (require.main === module) {
  const strict = process.argv.includes('--strict');
  const report = runLegalCheck(process.env);
  console.log(formatLegalCheckReport(report));
  if (strict && (!report.reviewed || report.missingRequired.length > 0 || report.missingFiles.length > 0)) {
    console.error('\n❌ [--strict] Yayına çıkmadan önce eksik zorunlu alanlar veya LEGAL_REVIEWED=false giderilmelidir.');
    process.exit(1);
  }
}

module.exports = {
  runLegalCheck,
  formatLegalCheckReport,
};
