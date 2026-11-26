const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const appConfig = require('../config/app.config');
const legalConfig = require('../config/legal.config');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function atomicWriteJson(filePath, dataObj) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const payload = JSON.stringify(dataObj, null, 2);
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  const bakPath = `${filePath}.bak`;

  fs.writeFileSync(tmpPath, payload, 'utf8');
  if (fs.existsSync(filePath)) {
    try {
      fs.copyFileSync(filePath, bakPath);
    } catch (_) {}
  }
  fs.renameSync(tmpPath, filePath);
}

function safeReadJson(filePath, fallback) {
  const candidates = [filePath, `${filePath}.bak`];
  for (const candidate of candidates) {
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
  const items = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      items.push(JSON.parse(t));
    } catch (_) {}
  }
  return items;
}

function appendJsonlLine(filePath, obj) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(obj)}\n`, 'utf8');
}

function getSigningSecret() {
  return process.env.SESSION_SECRET || appConfig.SESSION_SECRET || 'piyade-legal-form-timing-fallback-secret';
}

/**
 * Form açılış zamanını HMAC ile imzalar (en az 3 sn doldurma süresi koruması için).
 */
function createFormStartToken(nowMs = Date.now()) {
  const ts = String(Math.floor(Number(nowMs) || Date.now()));
  const sig = crypto.createHmac('sha256', getSigningSecret()).update(ts).digest('hex').slice(0, 24);
  return `${ts}.${sig}`;
}

/**
 * İmzalı form açılış belirtecini ve en az doldurma süresini (varsayılan 3000 ms) doğrular.
 */
function verifyFormStartToken(token, { minMs = 3000, maxAgeMs = 12 * 60 * 60 * 1000, nowMs = Date.now() } = {}) {
  if (typeof token !== 'string' || !token.includes('.')) {
    return { ok: false, reason: 'MISSING_TOKEN' };
  }
  const [tsStr, providedSig] = token.trim().split('.');
  if (!/^\d{10,16}$/.test(tsStr) || !/^[a-f0-9]{24}$/i.test(providedSig || '')) {
    return { ok: false, reason: 'INVALID_TOKEN' };
  }
  const expectedSig = crypto.createHmac('sha256', getSigningSecret()).update(tsStr).digest('hex').slice(0, 24);
  const a = Buffer.from(expectedSig, 'utf8');
  const b = Buffer.from(providedSig.toLowerCase(), 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'BAD_SIGNATURE' };
  }
  const startedAt = Number(tsStr);
  const elapsed = nowMs - startedAt;
  if (elapsed < minMs) {
    return { ok: false, reason: 'TOO_FAST', elapsedMs: elapsed };
  }
  if (elapsed > maxAgeMs) {
    return { ok: false, reason: 'EXPIRED', elapsedMs: elapsed };
  }
  return { ok: true, elapsedMs: elapsed };
}

function generateCodeSegment(len = 5) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

function hashNormalizedEmail(email) {
  const norm = String(email || '').trim().toLowerCase();
  return crypto.createHash('sha256').update(norm).digest('hex');
}

function resolveDefaultLegalDir(envObj = process.env) {
  const vol = envObj && typeof envObj.RAILWAY_VOLUME_MOUNT_PATH === 'string'
    ? envObj.RAILWAY_VOLUME_MOUNT_PATH.trim()
    : '';
  if (vol) {
    return path.join(vol, 'legal');
  }
  return path.join(process.cwd(), '.legal-data');
}

class LegalStore {
  constructor(options = {}) {
    this.baseDir = options.baseDir || resolveDefaultLegalDir(options.env || process.env);
    this.requestsFile = path.join(this.baseDir, 'kvkk-requests.jsonl');
    this.statusFile = path.join(this.baseDir, 'kvkk-status.json');
    this.auditFile = path.join(this.baseDir, 'kvkk-audit.jsonl');
    fs.mkdirSync(this.baseDir, { recursive: true });
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
      const code = `KVKK-${year}-${generateCodeSegment(5)}`;
      if (!statusMap[code]) return code;
    }
    return `KVKK-${year}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  }

  appendAudit({ actorId = 'system', actorName = 'System', action, trackingCode = '', status = '', hasNote = false }) {
    // GÜVENLİK: Denetim kaydına başvuranın adı, e-postası veya talep içeriği ASLA yazılmaz.
    const entry = {
      ts: Date.now(),
      actorId: String(actorId || 'system'),
      actorName: String(actorName || 'System').slice(0, 80),
      action: String(action || ''),
      trackingCode: String(trackingCode || ''),
      status: String(status || ''),
      hasNote: Boolean(hasNote),
    };
    appendJsonlLine(this.auditFile, entry);
    return entry;
  }

  createKvkkRequest({
    fullName,
    email,
    relation,
    accountIdentifier = '',
    requestTypes = [],
    description,
    userId = null,
    lang = 'tr',
    nowMs = Date.now(),
  }) {
    const retention = legalConfig.getRetentionConfig();
    const trackingCode = this._generateUniqueTrackingCode(nowMs);
    const createdAt = Number(nowMs) || Date.now();
    const deadlineAt = createdAt + retention.KVKK_RESPONSE_DEADLINE_DAYS * 24 * 60 * 60 * 1000;
    const normalizedEmail = String(email || '').trim().toLowerCase();

    const record = {
      trackingCode,
      createdAt,
      deadlineAt,
      lang: lang === 'en' ? 'en' : 'tr',
      fullName: String(fullName || '').trim().slice(0, 120),
      email: normalizedEmail.slice(0, 160),
      emailHash: hashNormalizedEmail(normalizedEmail),
      relation: relation === 'member' ? 'member' : 'visitor',
      accountIdentifier: String(accountIdentifier || '').trim().slice(0, 120),
      userId: userId ? String(userId) : null,
      requestTypes: Array.isArray(requestTypes) ? requestTypes.map(String) : [],
      description: String(description || '').trim().slice(0, retention.MAX_KVKK_DESCRIPTION),
    };

    appendJsonlLine(this.requestsFile, record);

    const statusMap = this._loadStatusMap();
    statusMap[trackingCode] = {
      trackingCode,
      emailHash: record.emailHash,
      status: 'received',
      createdAt,
      updatedAt: createdAt,
      deadlineAt,
      internalNotes: [],
    };
    this._saveStatusMap();

    this.appendAudit({
      actorId: userId || 'public',
      actorName: userId ? 'Member' : 'Visitor',
      action: 'kvkk_submitted',
      trackingCode,
      status: 'received',
    });

    return {
      trackingCode,
      status: 'received',
      createdAt,
      deadlineAt,
    };
  }

  /**
   * Takip kodu + e-posta ile SADECE DURUM döndürür; hiçbir kişisel bilgi/içerik/not sızdırmaz.
   */
  lookupKvkkStatus(trackingCode, email) {
    const cleanCode = String(trackingCode || '').trim().toUpperCase();
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanCode || !cleanEmail) {
      return { found: false };
    }
    const statusMap = this._loadStatusMap();
    const entry = statusMap[cleanCode];
    if (!entry || !entry.emailHash) {
      return { found: false };
    }
    const providedHash = hashNormalizedEmail(cleanEmail);
    const a = Buffer.from(entry.emailHash, 'utf8');
    const b = Buffer.from(providedHash, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { found: false };
    }
    return {
      found: true,
      trackingCode: entry.trackingCode,
      status: entry.status,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      deadlineAt: entry.deadlineAt,
    };
  }

  _readAllMerged(nowMs = Date.now()) {
    const statusMap = this._loadStatusMap();
    const rawRecords = readJsonlLines(this.requestsFile);
    const merged = [];

    for (const rec of rawRecords) {
      const st = statusMap[rec.trackingCode] || {
        status: 'received',
        createdAt: rec.createdAt,
        updatedAt: rec.createdAt,
        deadlineAt: rec.deadlineAt,
        internalNotes: [],
      };
      const isClosed = st.status === 'answered' || st.status === 'rejected';
      const msLeft = st.deadlineAt - nowMs;
      const daysRemaining = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
      const isOverdue = !isClosed && nowMs > st.deadlineAt;
      const isNearDeadline = !isClosed && !isOverdue && daysRemaining <= 5;

      merged.push({
        trackingCode: rec.trackingCode,
        fullName: rec.fullName,
        email: rec.email,
        relation: rec.relation,
        accountIdentifier: rec.accountIdentifier || '',
        userId: rec.userId || null,
        requestTypes: rec.requestTypes || [],
        description: rec.description || '',
        lang: rec.lang || 'tr',
        status: st.status,
        createdAt: st.createdAt,
        updatedAt: st.updatedAt,
        deadlineAt: st.deadlineAt,
        daysRemaining,
        isOverdue,
        isNearDeadline,
        internalNotes: Array.isArray(st.internalNotes) ? st.internalNotes : [],
      });
    }

    // Önce gecikenler, sonra son tarihi en yakın açık başvurular, sonra en yeniler
    merged.sort((a, b) => {
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
      const aClosed = a.status === 'answered' || a.status === 'rejected';
      const bClosed = b.status === 'answered' || b.status === 'rejected';
      if (aClosed !== bClosed) return aClosed ? 1 : -1;
      return b.createdAt - a.createdAt;
    });

    return merged;
  }

  listKvkkRequests({ status = '', overdueOnly = false, page = 1, limit = 25, nowMs = Date.now() } = {}) {
    let items = this._readAllMerged(nowMs);
    if (status && legalConfig.KVKK_STATUSES.includes(status)) {
      items = items.filter((it) => it.status === status);
    }
    if (overdueOnly) {
      items = items.filter((it) => it.isOverdue);
    }
    const total = items.length;
    const overdueCount = items.filter((it) => it.isOverdue).length;
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));
    const totalPages = Math.max(1, Math.ceil(total / safeLimit));
    const safePage = Math.min(totalPages, Math.max(1, Number(page) || 1));
    const slice = items.slice((safePage - 1) * safeLimit, safePage * safeLimit);

    return {
      items: slice,
      total,
      overdueCount,
      page: safePage,
      totalPages,
    };
  }

  getKvkkRequestDetail(trackingCode, { actorId, actorName, nowMs = Date.now() } = {}) {
    const cleanCode = String(trackingCode || '').trim().toUpperCase();
    const all = this._readAllMerged(nowMs);
    const found = all.find((it) => it.trackingCode === cleanCode) || null;
    if (!found) return null;
    if (actorId) {
      this.appendAudit({
        actorId,
        actorName,
        action: 'kvkk_view',
        trackingCode: found.trackingCode,
        status: found.status,
      });
    }
    return found;
  }

  updateKvkkRequest(trackingCode, { status, note, actorId, actorName, nowMs = Date.now() }) {
    const cleanCode = String(trackingCode || '').trim().toUpperCase();
    const cleanStatus = String(status || '').trim();
    const cleanNote = String(note || '').trim().slice(0, 1000);

    if (!legalConfig.KVKK_STATUSES.includes(cleanStatus)) {
      return { ok: false, status: 400, code: 'INVALID_STATUS' };
    }
    if (cleanNote.length < 3) {
      return { ok: false, status: 400, code: 'NOTE_REQUIRED' };
    }

    const statusMap = this._loadStatusMap();
    const entry = statusMap[cleanCode];
    if (!entry) {
      return { ok: false, status: 404, code: 'NOT_FOUND' };
    }

    entry.status = cleanStatus;
    entry.updatedAt = Number(nowMs) || Date.now();
    if (!Array.isArray(entry.internalNotes)) entry.internalNotes = [];
    entry.internalNotes.push({
      ts: entry.updatedAt,
      byId: String(actorId || ''),
      byName: String(actorName || '').slice(0, 80),
      status: cleanStatus,
      note: cleanNote,
    });
    this._saveStatusMap();

    this.appendAudit({
      actorId,
      actorName,
      action: 'kvkk_status_update',
      trackingCode: cleanCode,
      status: cleanStatus,
      hasNote: true,
    });

    return { ok: true, entry };
  }

  readAuditLog({ page = 1, limit = 100 } = {}) {
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

let singletonLegalStore = null;

function getLegalStore(options) {
  if (options && options.baseDir) {
    return new LegalStore(options);
  }
  if (!singletonLegalStore) {
    singletonLegalStore = new LegalStore();
  }
  return singletonLegalStore;
}

function resetLegalStoreForTests() {
  singletonLegalStore = null;
}

function setDefaultLegalStore(storeInstance) {
  singletonLegalStore = storeInstance || null;
}

module.exports = {
  LegalStore,
  resolveDefaultLegalDir,
  getLegalStore,
  setDefaultLegalStore,
  resetLegalStoreForTests,
  createFormStartToken,
  verifyFormStartToken,
};
