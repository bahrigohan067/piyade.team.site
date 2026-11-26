const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const legalConfig = require('../config/legal.config');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PRIORITY_RANK = { critical: 0, high: 1, normal: 2, low: 3 };

function atomicWriteJson(filePath, dataObj) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  const bakPath = `${filePath}.bak`;
  fs.writeFileSync(tmpPath, JSON.stringify(dataObj, null, 2), 'utf8');
  if (fs.existsSync(filePath)) {
    try {
      fs.copyFileSync(filePath, bakPath);
    } catch (_) {}
  }
  fs.renameSync(tmpPath, filePath);
}

function safeReadJson(filePath, fallback) {
  for (const candidate of [filePath, `${filePath}.bak`]) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const raw = fs.readFileSync(candidate, 'utf8');
      if (!raw.trim()) continue;
      return JSON.parse(raw);
    } catch (_) {}
  }
  return fallback;
}

function readJsonlLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) return [];
  const list = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      list.push(JSON.parse(t));
    } catch (_) {}
  }
  return list;
}

function appendJsonlLine(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(obj)}\n`, 'utf8');
}

function generateCodeSegment(len = 5) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

function resolveDefaultReportsDir(envObj = process.env) {
  const vol = envObj && typeof envObj.RAILWAY_VOLUME_MOUNT_PATH === 'string'
    ? envObj.RAILWAY_VOLUME_MOUNT_PATH.trim()
    : '';
  if (vol) {
    return path.join(vol, 'reports');
  }
  return path.join(process.cwd(), '.reports-data');
}

class ReportStore {
  constructor(options = {}) {
    this.baseDir = options.baseDir || resolveDefaultReportsDir(options.env || process.env);
    this.filesDir = path.join(this.baseDir, 'files');
    this.reportsFile = path.join(this.baseDir, 'reports.jsonl');
    this.statusFile = path.join(this.baseDir, 'reports-status.json');
    this.auditFile = path.join(this.baseDir, 'reports-audit.jsonl');
    fs.mkdirSync(this.filesDir, { recursive: true });
    this._statusMap = null;
  }

  _loadStatusMap() {
    if (this._statusMap) return this._statusMap;
    const loaded = safeReadJson(this.statusFile, { version: 1, items: {} });
    this._statusMap = loaded && typeof loaded.items === 'object' && loaded.items ? loaded.items : {};
    return this._statusMap;
  }

  _saveStatusMap() {
    const items = this._loadStatusMap();
    atomicWriteJson(this.statusFile, { version: 1, updatedAt: Date.now(), items });
  }

  _generateUniqueTrackingCode(nowMs = Date.now()) {
    const statusMap = this._loadStatusMap();
    const year = new Date(nowMs).getUTCFullYear();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = `RPT-${year}-${generateCodeSegment(5)}`;
      if (!statusMap[code]) return code;
    }
    return `RPT-${year}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  }

  /**
   * İçeriksiz yönetim denetim kaydı (kişisel içerik, açıklama veya kanıt metni ASLA yazılmaz).
   */
  appendManagementAudit({ actorId = 'system', actorName = 'System', action, trackingCode = '', category = '', status = '', hasNote = false }) {
    const entry = {
      ts: Date.now(),
      actorId: String(actorId || 'system'),
      actorName: String(actorName || 'System').slice(0, 80),
      action: String(action || ''),
      trackingCode: String(trackingCode || ''),
      category: String(category || ''),
      status: String(status || ''),
      hasNote: Boolean(hasNote),
    };
    appendJsonlLine(this.auditFile, entry);
    return entry;
  }

  createReport({
    category,
    location = 'site',
    targetRef = '',
    description,
    contactEmail = '',
    reporterUserId = null,
    reporterName = '',
    dmca = null,
    evidenceFiles = [],
    lang = 'tr',
    nowMs = Date.now(),
  }) {
    const catDef = legalConfig.getReportCategoryById(category);
    if (!catDef) {
      const err = new Error('Geçersiz bildirim kategorisi.');
      err.code = 'INVALID_CATEGORY';
      throw err;
    }

    const retention = legalConfig.getRetentionConfig();
    const createdAt = Number(nowMs) || Date.now();
    const trackingCode = this._generateUniqueTrackingCode(createdAt);

    // Kanıt görsellerini erişim kontrollü özel klasöre rastgele adla kaydet (asla public/ içine değil!)
    const savedEvidence = [];
    for (const file of (evidenceFiles || []).slice(0, retention.REPORT_EVIDENCE_MAX_FILES)) {
      const fileId = crypto.randomBytes(16).toString('hex'); // 32 hex
      const safeExt = ['png', 'jpg', 'webp'].includes(file.ext) ? file.ext : 'png';
      const storedName = `${fileId}.${safeExt}`;
      const diskPath = path.join(this.filesDir, storedName);
      fs.mkdirSync(this.filesDir, { recursive: true });
      fs.writeFileSync(diskPath, file.buffer);
      savedEvidence.push({
        id: fileId,
        storedName,
        ext: safeExt,
        mimeType: file.mimeType || `image/${safeExt === 'jpg' ? 'jpeg' : safeExt}`,
        size: file.buffer.length,
        originalName: String(file.originalName || storedName).slice(0, 80),
      });
    }

    const record = {
      id: trackingCode,
      trackingCode,
      createdAt,
      lang: lang === 'en' ? 'en' : 'tr',
      category: catDef.id,
      audience: catDef.audience,
      priority: catDef.priority,
      location: legalConfig.REPORT_LOCATIONS.includes(location) ? location : 'other',
      targetRef: String(targetRef || '').trim().slice(0, 500),
      description: String(description || '').trim().slice(0, retention.MAX_REPORT_DESCRIPTION),
      contactEmail: String(contactEmail || '').trim().toLowerCase().slice(0, 160),
      reporterUserId: reporterUserId ? String(reporterUserId) : null,
      reporterName: reporterName ? String(reporterName).trim().slice(0, 80) : '',
      dmca: catDef.id === 'copyright_dmca' && dmca ? {
        rightsHolder: String(dmca.rightsHolder || '').trim().slice(0, 160),
        workDescription: String(dmca.workDescription || '').trim().slice(0, 1000),
        infringingUrl: String(dmca.infringingUrl || '').trim().slice(0, 500),
        goodFaithConfirmed: Boolean(dmca.goodFaithConfirmed),
      } : null,
      evidence: savedEvidence,
    };

    appendJsonlLine(this.reportsFile, record);

    const statusMap = this._loadStatusMap();
    statusMap[trackingCode] = {
      trackingCode,
      category: record.category,
      audience: record.audience,
      priority: record.priority,
      status: 'new',
      createdAt,
      updatedAt: createdAt,
      notes: [],
    };
    this._saveStatusMap();

    return {
      id: trackingCode,
      trackingCode,
      category: record.category,
      audience: record.audience,
      priority: record.priority,
      status: 'new',
      createdAt,
      evidenceCount: savedEvidence.length,
    };
  }

  /**
   * Durum sorgulama sayfası için SADECE DURUM bilgisi döndürür (kişisel bilgi/açıklama/not YOK).
   */
  lookupReportStatus(trackingCode) {
    const cleanCode = String(trackingCode || '').trim().toUpperCase();
    if (!cleanCode) return { found: false };
    const statusMap = this._loadStatusMap();
    const entry = statusMap[cleanCode];
    if (!entry) return { found: false };
    return {
      found: true,
      trackingCode: entry.trackingCode,
      category: entry.category,
      status: entry.status,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  /**
   * Çıkar çatışması kontrolü: Bildirimi gönderen veya hedef kimlik alanında kendi ID'si geçen yetkili kaydı açamaz.
   */
  isConflictOfInterest(report, actorId) {
    if (!report || !actorId) return false;
    const cleanActor = String(actorId).trim();
    if (!cleanActor) return false;
    if (report.reporterUserId && String(report.reporterUserId) === cleanActor) {
      return true;
    }
    if (report.targetRef && /^\d{15,22}$/.test(cleanActor)) {
      const idRegex = new RegExp(`(^|\\D)${cleanActor}(\\D|$)`);
      if (idRegex.test(String(report.targetRef))) {
        return true;
      }
    }
    return false;
  }

  _readAllMerged() {
    const statusMap = this._loadStatusMap();
    const records = readJsonlLines(this.reportsFile);
    return records.map((rec) => {
      const st = statusMap[rec.trackingCode] || {
        status: 'new',
        createdAt: rec.createdAt,
        updatedAt: rec.createdAt,
        notes: [],
      };
      return {
        ...rec,
        status: st.status,
        updatedAt: st.updatedAt,
        notes: Array.isArray(st.notes) ? st.notes : [],
      };
    });
  }

  listReports({ audience, status = '', category = '', actorId = '', page = 1, limit = 25 } = {}) {
    let items = this._readAllMerged();
    if (audience) {
      items = items.filter((r) => r.audience === audience);
    }
    if (actorId) {
      items = items.filter((r) => !this.isConflictOfInterest(r, actorId));
    }
    if (status && legalConfig.REPORT_STATUSES.includes(status)) {
      items = items.filter((r) => r.status === status);
    }
    if (category) {
      items = items.filter((r) => r.category === category);
    }

    items.sort((a, b) => {
      const aClosed = a.status === 'closed' || a.status === 'no_basis' || a.status === 'action_taken';
      const bClosed = b.status === 'closed' || b.status === 'no_basis' || b.status === 'action_taken';
      if (aClosed !== bClosed) return aClosed ? 1 : -1;
      const pa = PRIORITY_RANK[a.priority] ?? 2;
      const pb = PRIORITY_RANK[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      return b.createdAt - a.createdAt;
    });

    const total = items.length;
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));
    const totalPages = Math.max(1, Math.ceil(total / safeLimit));
    const safePage = Math.min(totalPages, Math.max(1, Number(page) || 1));
    const pageItems = items.slice((safePage - 1) * safeLimit, safePage * safeLimit).map((r) => ({
      id: r.id,
      trackingCode: r.trackingCode,
      category: r.category,
      audience: r.audience,
      priority: r.priority,
      location: r.location,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      evidenceCount: Array.isArray(r.evidence) ? r.evidence.length : 0,
      hasDmca: Boolean(r.dmca),
    }));

    return {
      items: pageItems,
      total,
      page: safePage,
      totalPages,
    };
  }

  getReportDetail(reportIdOrCode, { expectedAudience = '', actorId = '' } = {}) {
    const cleanCode = String(reportIdOrCode || '').trim().toUpperCase();
    const found = this._readAllMerged().find((r) => r.trackingCode === cleanCode);
    if (!found) {
      return { ok: false, status: 404, code: 'REPORT_NOT_FOUND' };
    }
    if (expectedAudience && found.audience !== expectedAudience) {
      return { ok: false, status: 404, code: 'REPORT_NOT_FOUND' };
    }
    if (actorId && this.isConflictOfInterest(found, actorId)) {
      return { ok: false, status: 403, code: 'CONFLICT_OF_INTEREST' };
    }
    return { ok: true, report: found };
  }

  updateReportStatus(reportIdOrCode, { expectedAudience = '', status, note, actorId, actorName }) {
    const cleanStatus = String(status || '').trim();
    const cleanNote = String(note || '').trim().slice(0, 500);
    if (!legalConfig.REPORT_STATUSES.includes(cleanStatus)) {
      return { ok: false, status: 400, code: 'INVALID_STATUS' };
    }
    if (cleanNote.length < 3) {
      return { ok: false, status: 400, code: 'NOTE_REQUIRED' };
    }

    const detail = this.getReportDetail(reportIdOrCode, { expectedAudience, actorId });
    if (!detail.ok) return detail;

    const code = detail.report.trackingCode;
    const statusMap = this._loadStatusMap();
    const entry = statusMap[code];
    if (!entry) {
      return { ok: false, status: 404, code: 'REPORT_NOT_FOUND' };
    }

    entry.status = cleanStatus;
    entry.updatedAt = Date.now();
    if (!Array.isArray(entry.notes)) entry.notes = [];
    entry.notes.push({
      ts: entry.updatedAt,
      byId: String(actorId || ''),
      byName: String(actorName || '').slice(0, 80),
      status: cleanStatus,
      note: cleanNote,
    });
    this._saveStatusMap();

    return { ok: true, report: { ...detail.report, status: cleanStatus, updatedAt: entry.updatedAt, notes: entry.notes } };
  }

  getEvidenceFile(reportIdOrCode, fileId, { expectedAudience = '', actorId = '' } = {}) {
    const cleanFileId = String(fileId || '').trim().toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(cleanFileId)) {
      return { ok: false, status: 404, code: 'FILE_NOT_FOUND' };
    }
    const detail = this.getReportDetail(reportIdOrCode, { expectedAudience, actorId });
    if (!detail.ok) return detail;

    const meta = (detail.report.evidence || []).find((f) => f.id === cleanFileId);
    if (!meta) {
      return { ok: false, status: 404, code: 'FILE_NOT_FOUND' };
    }
    const safeName = path.basename(meta.storedName);
    const fullPath = path.join(this.filesDir, safeName);
    if (!fullPath.startsWith(this.filesDir) || !fs.existsSync(fullPath)) {
      return { ok: false, status: 404, code: 'FILE_NOT_FOUND' };
    }
    return {
      ok: true,
      meta,
      fullPath,
      report: detail.report,
    };
  }

  readManagementAudit({ page = 1, limit = 100 } = {}) {
    const all = readJsonlLines(this.auditFile).reverse();
    const total = all.length;
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 100));
    const totalPages = Math.max(1, Math.ceil(total / safeLimit));
    const safePage = Math.min(totalPages, Math.max(1, Number(page) || 1));
    return {
      items: all.slice((safePage - 1) * safeLimit, safePage * safeLimit),
      total,
      page: safePage,
      totalPages,
    };
  }

  flush() {
    if (this._statusMap) {
      this._saveStatusMap();
    }
  }
}

let singletonReportStore = null;

function getReportStore(options) {
  if (options && options.baseDir) {
    return new ReportStore(options);
  }
  if (!singletonReportStore) {
    singletonReportStore = new ReportStore();
  }
  return singletonReportStore;
}

function resetReportStoreForTests() {
  singletonReportStore = null;
}

function setDefaultReportStore(storeInstance) {
  singletonReportStore = storeInstance || null;
}

module.exports = {
  ReportStore,
  resolveDefaultReportsDir,
  getReportStore,
  setDefaultReportStore,
  resetReportStoreForTests,
};
