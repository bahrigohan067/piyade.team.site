const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const chatConfig = require('../config/chat.config');
const { parseConvId, isGroupConvId, writeJsonAtomic, readJsonWithBackupRecovery } = require('./chatStore');

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const REPORT_CATEGORIES = Object.freeze([
  'harassment',
  'sexual',
  'child_safety',
  'threat',
  'scam_spam',
  'other',
]);

const MUTE_DURATIONS_MS = Object.freeze({
  '1h': 1 * HOUR_MS,
  '24h': 24 * HOUR_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
});

const PRIORITY_RANK = Object.freeze({
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
});

function generateId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
}

function resolveReportPriority(category) {
  if (category === 'child_safety') return 'critical';
  if (category === 'threat') return 'high';
  return 'normal';
}

/**
 * ==============================================================================
 * 🛡️ SOHBET MODERASYON, YAPTIRIM VE DENETİM KAYDI DEPOSU
 * ==============================================================================
 * - Rutin sohbet izleme veya arama fonksiyonu YOKTUR.
 * - Yalnızca rapor/otomatik işaret vakalarının kopyalanmış anlık görüntülerini tutar.
 * - Denetim kaydı (modlog.jsonl) yalnızca eklemelidir ve ASLA mesaj içeriği yazmaz.
 * - Vaka kapanışından 7 gün sonra (açık vakalarda 90 gün) anlık görüntü ve ekler silinir.
 * ==============================================================================
 */
class ChatModStore {
  constructor({ baseDir }) {
    this.baseDir = baseDir;
    this.modDir = path.join(baseDir, 'moderation');
    this.casesDir = path.join(this.modDir, 'cases');
    this.casesIndexFile = path.join(this.modDir, 'cases.json');
    this.sanctionsFile = path.join(this.modDir, 'sanctions.json');
    this.noticesFile = path.join(this.modDir, 'notices.json');
    this.modlogFile = path.join(this.baseDir, 'modlog.jsonl');

    this.cases = new Map(); // caseId -> case metadata
    this.sanctions = new Map(); // sanctionId -> sanction record
    this.noticesByUser = new Map(); // userId -> Array<notice>
    this.recentViewsByMod = new Map(); // modId -> Array<ts>
    this.processedActionKeys = new Set();

    this._ensureDirs();
    this._loadAll();
  }

  _ensureDirs() {
    for (const d of [this.baseDir, this.modDir, this.casesDir]) {
      try {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
      } catch (_) {}
    }
  }

  _loadAll() {
    const cRes = readJsonWithBackupRecovery(this.casesIndexFile, {});
    this.cases.clear();
    if (cRes.data && typeof cRes.data === 'object') {
      for (const [id, entry] of Object.entries(cRes.data)) {
        if (entry && typeof entry === 'object' && entry.id) {
          this.cases.set(id, entry);
        }
      }
    }

    const sRes = readJsonWithBackupRecovery(this.sanctionsFile, {});
    this.sanctions.clear();
    if (sRes.data && typeof sRes.data === 'object') {
      for (const [id, entry] of Object.entries(sRes.data)) {
        if (entry && typeof entry === 'object' && entry.id) {
          this.sanctions.set(id, entry);
        }
      }
    }

    const nRes = readJsonWithBackupRecovery(this.noticesFile, {});
    this.noticesByUser.clear();
    if (nRes.data && typeof nRes.data === 'object') {
      for (const [uid, list] of Object.entries(nRes.data)) {
        if (Array.isArray(list)) this.noticesByUser.set(uid, list.slice(-30));
      }
    }
  }

  _saveCasesIndexSync() {
    const out = {};
    for (const [id, c] of this.cases.entries()) out[id] = c;
    writeJsonAtomic(this.casesIndexFile, out, { keepBackup: true });
  }

  _saveSanctionsSync() {
    const out = {};
    for (const [id, s] of this.sanctions.entries()) out[id] = s;
    writeJsonAtomic(this.sanctionsFile, out, { keepBackup: true });
  }

  _saveNoticesSync() {
    const out = {};
    for (const [uid, list] of this.noticesByUser.entries()) out[uid] = list;
    writeJsonAtomic(this.noticesFile, out, { keepBackup: true });
  }

  _getSnapshotPath(caseId) {
    return path.join(this.casesDir, `${path.basename(caseId)}.json`);
  }

  _saveCaseSnapshotSync(caseId, snapshot) {
    writeJsonAtomic(this._getSnapshotPath(caseId), snapshot, { keepBackup: false });
  }

  _readCaseSnapshot(caseId) {
    const p = this._getSnapshotPath(caseId);
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (_) {
      return null;
    }
  }

  _extractAttachmentIds(messages) {
    const ids = [];
    for (const m of Array.isArray(messages) ? messages : []) {
      if (Array.isArray(m.attachments)) {
        for (const att of m.attachments) {
          const aid = typeof att === 'string' ? att : att && att.id;
          if (aid && !ids.includes(aid)) ids.push(aid);
        }
      }
    }
    return ids;
  }

  // ==========================================================================
  // 1) VAKA OLUŞTURMA (KULLANICI RAPORU & OTOMATİK FİLTRE BİRLEŞTİRME)
  // ==========================================================================

  hasDuplicateReport(reporterId, convId, targetMsgId) {
    for (const c of this.cases.values()) {
      if (
        c.source === 'report' &&
        c.reporterId === reporterId &&
        c.convId === convId &&
        (targetMsgId ? c.targetMsgId === targetMsgId : !c.targetMsgId && c.status !== 'closed')
      ) {
        return true;
      }
    }
    return false;
  }

  createReportCase({
    convId,
    reporterId,
    reportedUserId,
    targetMsgId = null,
    category,
    note = '',
    snapshotMessages = [],
    chatStore = null,
    nowTs = Date.now(),
  }) {
    const dmParticipants = parseConvId(convId);
    const isGroup = isGroupConvId(convId);
    if (!dmParticipants && !isGroup) throw new Error('Geçersiz sohbet kimliği.');
    const participants = dmParticipants
      ? dmParticipants
      : [...new Set([String(reporterId || ''), String(reportedUserId || '')].filter(Boolean))];
    if (!REPORT_CATEGORIES.includes(category)) {
      const err = new Error('Geçersiz rapor kategorisi.');
      err.code = 'INVALID_CATEGORY';
      throw err;
    }
    if (this.hasDuplicateReport(reporterId, convId, targetMsgId)) {
      const err = new Error('Bu mesaj için zaten rapor oluşturdunuz.');
      err.code = 'DUPLICATE_REPORT';
      throw err;
    }

    const caseId = generateId('case');
    const cleanNote = typeof note === 'string' ? note.trim().slice(0, chatConfig.LIMITS.MAX_REPORT_NOTE_LENGTH) : '';
    const attachmentIds = this._extractAttachmentIds(snapshotMessages);

    if (chatStore) {
      for (const attId of attachmentIds) {
        chatStore.markFilePreserved(attId, caseId);
      }
    }

    const caseMeta = {
      id: caseId,
      source: 'report',
      status: 'open', // 'open' | 'in_review' | 'closed'
      priority: resolveReportPriority(category),
      category,
      autoCategories: [],
      convId,
      isGroupCase: Boolean(isGroup),
      participants,
      reporterId: String(reporterId),
      reportedUserId: String(reportedUserId),
      targetMsgId: targetMsgId ? String(targetMsgId) : null,
      reporterNote: cleanNote,
      attachmentIds,
      messageCount: snapshotMessages.length,
      createdAt: nowTs,
      updatedAt: nowTs,
      closedAt: null,
      closedBy: null,
      resolution: null,
      lockedBy: null,
      lockedByName: null,
      lockedUntil: 0,
      snapshotPurged: false,
      actionsTaken: [],
    };

    const snapshot = {
      caseId,
      capturedAt: nowTs,
      convId,
      isGroupCase: Boolean(isGroup),
      participants,
      targetMsgId: caseMeta.targetMsgId,
      messages: snapshotMessages.map((m) => ({
        id: m.id,
        from: m.from,
        ts: m.ts,
        text: m.text || '',
        attachments: Array.isArray(m.attachments) ? m.attachments.map((a) => ({ ...a })) : [],
        deleted: Boolean(m.deleted),
        modRemoved: Boolean(m.modRemoved),
      })),
    };

    this._saveCaseSnapshotSync(caseId, snapshot);
    this.cases.set(caseId, caseMeta);
    this._saveCasesIndexSync();

    return { ...caseMeta };
  }

  /**
   * Otomatik filtre işaretleri için vaka açar veya aynı kullanıcıdan son 30 dk içindeki
   * açık/incelemede otomatik vakayla birleştirir (spam yığılmasını önler).
   */
  createOrMergeAutoCase({
    convId,
    offendingUserId,
    targetMsgId,
    categories = [],
    priority = 'normal',
    snapshotMessages = [],
    chatStore = null,
    nowTs = Date.now(),
  }) {
    const dmParticipants = parseConvId(convId);
    const isGroup = isGroupConvId(convId);
    if (!dmParticipants && !isGroup) return null;
    const participants = dmParticipants ? dmParticipants : [String(offendingUserId || '')].filter(Boolean);
    const mergeWindowMs = 30 * 60 * 1000;

    // Birleştirilecek mevcut açık otomatik vaka ara
    let existing = null;
    for (const c of this.cases.values()) {
      if (
        c.source === 'auto' &&
        c.status !== 'closed' &&
        !c.snapshotPurged &&
        c.convId === convId &&
        c.reportedUserId === String(offendingUserId) &&
        nowTs - c.updatedAt <= mergeWindowMs
      ) {
        existing = c;
        break;
      }
    }

    if (existing) {
      const snap = this._readCaseSnapshot(existing.id) || {
        caseId: existing.id,
        capturedAt: existing.createdAt,
        convId,
        participants,
        targetMsgId: existing.targetMsgId,
        messages: [],
      };
      const knownIds = new Set(snap.messages.map((m) => m.id));
      for (const m of snapshotMessages) {
        if (!knownIds.has(m.id)) {
          snap.messages.push({
            id: m.id,
            from: m.from,
            ts: m.ts,
            text: m.text || '',
            attachments: Array.isArray(m.attachments) ? m.attachments.map((a) => ({ ...a })) : [],
            deleted: Boolean(m.deleted),
            modRemoved: Boolean(m.modRemoved),
          });
          knownIds.add(m.id);
        }
      }
      snap.messages.sort((a, b) => a.ts - b.ts);
      const newAtts = this._extractAttachmentIds(snap.messages);
      if (chatStore) {
        for (const aid of newAtts) chatStore.markFilePreserved(aid, existing.id);
      }
      existing.attachmentIds = newAtts;
      existing.messageCount = snap.messages.length;
      existing.autoCategories = [...new Set([...(existing.autoCategories || []), ...categories])];
      if ((PRIORITY_RANK[priority] || 2) > (PRIORITY_RANK[existing.priority] || 2)) {
        existing.priority = priority;
      }
      existing.flagCount = (existing.flagCount || 1) + 1;
      existing.updatedAt = nowTs;
      this._saveCaseSnapshotSync(existing.id, snap);
      this._saveCasesIndexSync();
      return { merged: true, caseMeta: { ...existing } };
    }

    const caseId = generateId('auto');
    const attachmentIds = this._extractAttachmentIds(snapshotMessages);
    if (chatStore) {
      for (const aid of attachmentIds) chatStore.markFilePreserved(aid, caseId);
    }

    const caseMeta = {
      id: caseId,
      source: 'auto',
      status: 'open',
      priority: PRIORITY_RANK[priority] ? priority : 'normal',
      category: categories[0] || 'profanity',
      autoCategories: [...new Set(categories)],
      flagCount: 1,
      convId,
      isGroupCase: Boolean(isGroup),
      participants,
      reporterId: null,
      reportedUserId: String(offendingUserId),
      targetMsgId: targetMsgId ? String(targetMsgId) : null,
      reporterNote: '',
      attachmentIds,
      messageCount: snapshotMessages.length,
      createdAt: nowTs,
      updatedAt: nowTs,
      closedAt: null,
      closedBy: null,
      resolution: null,
      lockedBy: null,
      lockedByName: null,
      lockedUntil: 0,
      snapshotPurged: false,
      actionsTaken: [],
    };

    const snapshot = {
      caseId,
      capturedAt: nowTs,
      convId,
      isGroupCase: Boolean(isGroup),
      participants,
      targetMsgId: caseMeta.targetMsgId,
      messages: snapshotMessages.map((m) => ({
        id: m.id,
        from: m.from,
        ts: m.ts,
        text: m.text || '',
        attachments: Array.isArray(m.attachments) ? m.attachments.map((a) => ({ ...a })) : [],
        deleted: Boolean(m.deleted),
        modRemoved: Boolean(m.modRemoved),
      })),
    };

    this._saveCaseSnapshotSync(caseId, snapshot);
    this.cases.set(caseId, caseMeta);
    this._saveCasesIndexSync();
    return { merged: false, caseMeta: { ...caseMeta } };
  }

  // ==========================================================================
  // 2) ÇIKAR ÇATIŞMASI, VAKA LİSTESİ, İNCELEME KİLİDİ VE DETAY
  // ==========================================================================

  isConflictOfInterest(caseMeta, modUserId) {
    if (!caseMeta || !modUserId) return false;
    const mid = String(modUserId);
    if (caseMeta.reporterId && String(caseMeta.reporterId) === mid) return true;
    if (Array.isArray(caseMeta.participants) && caseMeta.participants.includes(mid)) return true;
    return false;
  }

  listCases({ modUserId, status = '', priority = '', source = '', page = 1, limit = 20, nowTs = Date.now() } = {}) {
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
    const safePage = Math.max(1, Number(page) || 1);

    const items = [];
    for (const c of this.cases.values()) {
      // Çıkar çatışması olan vakalar moderatöre açılabilir olarak sunulmaz
      if (modUserId && this.isConflictOfInterest(c, modUserId)) continue;
      if (status && c.status !== status) continue;
      if (priority && c.priority !== priority) continue;
      if (source && c.source !== source) continue;

      const lockActive = Boolean(c.lockedBy && c.lockedUntil > nowTs);
      items.push({
        id: c.id,
        source: c.source,
        status: c.status,
        priority: c.priority,
        category: c.category,
        autoCategories: c.autoCategories || [],
        flagCount: c.flagCount || 1,
        reportedUserId: c.reportedUserId,
        reporterId: c.reporterId,
        messageCount: c.messageCount || 0,
        attachmentCount: Array.isArray(c.attachmentIds) ? c.attachmentIds.length : 0,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        closedAt: c.closedAt,
        resolution: c.resolution,
        lockedBy: lockActive ? c.lockedBy : null,
        lockedByName: lockActive ? c.lockedByName : null,
        lockedUntil: lockActive ? c.lockedUntil : 0,
        snapshotPurged: Boolean(c.snapshotPurged),
      });
    }

    // Öncelik sırası: açık/incelemede önce, sonra öncelik (critical > high > normal > low), sonra en yeni
    items.sort((a, b) => {
      const aOpen = a.status === 'closed' ? 0 : 1;
      const bOpen = b.status === 'closed' ? 0 : 1;
      if (aOpen !== bOpen) return bOpen - aOpen;
      const prDiff = (PRIORITY_RANK[b.priority] || 2) - (PRIORITY_RANK[a.priority] || 2);
      if (prDiff !== 0) return prDiff;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

    const total = items.length;
    const start = (safePage - 1) * safeLimit;
    return {
      items: items.slice(start, start + safeLimit),
      total,
      page: safePage,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    };
  }

  getCaseMeta(caseId) {
    const c = this.cases.get(String(caseId || ''));
    return c ? { ...c } : null;
  }

  openCaseForReview(caseId, { modId, modName = '', nowTs = Date.now() }) {
    const c = this.cases.get(String(caseId || ''));
    if (!c) return { ok: false, code: 'CASE_NOT_FOUND', status: 404 };
    if (this.isConflictOfInterest(c, modId)) {
      return { ok: false, code: 'CONFLICT_OF_INTEREST', status: 403 };
    }

    // 10 dakikalık inceleme kilidi (iki moderatör aynı anda işlem yapamaz)
    if (c.status !== 'closed' && c.lockedBy && c.lockedBy !== String(modId) && c.lockedUntil > nowTs) {
      return {
        ok: false,
        code: 'CASE_LOCKED',
        status: 409,
        lockedBy: c.lockedBy,
        lockedByName: c.lockedByName,
        lockedUntil: c.lockedUntil,
      };
    }

    if (c.status !== 'closed') {
      c.status = 'in_review';
      c.lockedBy = String(modId);
      c.lockedByName = String(modName || modId);
      c.lockedUntil = nowTs + (chatConfig.MODERATION.CASE_REVIEW_LOCK_MS || 10 * 60 * 1000);
      c.updatedAt = nowTs;
      this._saveCasesIndexSync();
    }

    const snapshot = c.snapshotPurged ? null : this._readCaseSnapshot(c.id);
    const highVol = this.appendAuditLog({
      modId,
      modName,
      caseId: c.id,
      action: 'view_case',
      category: c.category,
      targetId: c.reportedUserId,
      note: '',
      nowTs,
      countAsView: true,
    });

    return {
      ok: true,
      caseMeta: { ...c },
      snapshot,
      highVolumeAccess: highVol.highVolumeAccess,
    };
  }

  isFileInCaseForMod(caseId, fileId, modUserId) {
    const c = this.cases.get(String(caseId || ''));
    if (!c || c.snapshotPurged) return false;
    if (this.isConflictOfInterest(c, modUserId)) return false;
    return Array.isArray(c.attachmentIds) && c.attachmentIds.includes(String(fileId));
  }

  checkAndConsumeActionKey(actionKey) {
    if (!actionKey) return true;
    if (this.processedActionKeys.has(actionKey)) return false;
    this.processedActionKeys.add(actionKey);
    if (this.processedActionKeys.size > 5000) {
      const first = this.processedActionKeys.values().next().value;
      this.processedActionKeys.delete(first);
    }
    return true;
  }

  recordCaseAction(caseId, actionEntry, { nowTs = Date.now() } = {}) {
    const c = this.cases.get(String(caseId || ''));
    if (!c) return null;
    if (!Array.isArray(c.actionsTaken)) c.actionsTaken = [];
    c.actionsTaken.push({ ...actionEntry, ts: nowTs });
    c.updatedAt = nowTs;
    this._saveCasesIndexSync();
    return { ...c };
  }

  closeCase(caseId, { modId, modName = '', resolution = 'action_taken', note = '', nowTs = Date.now() }) {
    const c = this.cases.get(String(caseId || ''));
    if (!c) return { ok: false, code: 'CASE_NOT_FOUND', status: 404 };
    if (this.isConflictOfInterest(c, modId)) {
      return { ok: false, code: 'CONFLICT_OF_INTEREST', status: 403 };
    }
    if (c.status === 'closed') {
      return { ok: true, alreadyClosed: true, caseMeta: { ...c } };
    }
    if (c.lockedBy && c.lockedBy !== String(modId) && c.lockedUntil > nowTs) {
      return { ok: false, code: 'CASE_LOCKED', status: 409 };
    }

    c.status = 'closed';
    c.resolution = resolution;
    c.closedAt = nowTs;
    c.closedBy = String(modId);
    c.lockedBy = null;
    c.lockedByName = null;
    c.lockedUntil = 0;
    c.updatedAt = nowTs;
    this._saveCasesIndexSync();

    this.appendAuditLog({
      modId,
      modName,
      caseId: c.id,
      action: 'close_case',
      category: resolution,
      targetId: c.reportedUserId,
      note,
      nowTs,
    });

    // Raporlayana ayrıntı vermeden sade sonuç bildirimi ekle
    if (c.source === 'report' && c.reporterId) {
      this.addUserNotice(c.reporterId, {
        type: 'report_resolved',
        caseId: c.id,
        outcome: resolution === 'action_taken' ? 'action_taken' : 'no_action',
        ts: nowTs,
      });
    }

    return { ok: true, alreadyClosed: false, caseMeta: { ...c } };
  }

  // ==========================================================================
  // 3) YAPTIRIMLAR (SUSTURMA VE YASAKLAMA)
  // ==========================================================================

  getActiveSanction(userId, nowTs = Date.now()) {
    const uid = String(userId || '').trim();
    if (!uid) return null;
    let activeBan = null;
    let activeMute = null;
    for (const s of this.sanctions.values()) {
      if (s.userId !== uid || s.liftedAt) continue;
      if (s.type === 'ban') {
        activeBan = s;
        break;
      }
      if (s.type === 'mute' && s.expiresAt && s.expiresAt > nowTs) {
        if (!activeMute || s.expiresAt > activeMute.expiresAt) {
          activeMute = s;
        }
      }
    }
    return activeBan ? { ...activeBan } : activeMute ? { ...activeMute } : null;
  }

  applySanction({
    userId,
    type, // 'mute' | 'ban'
    durationKey = null,
    reasonCategory = 'other',
    note = '',
    modId,
    modName = '',
    caseId = null,
    nowTs = Date.now(),
  }) {
    const uid = String(userId || '').trim();
    let expiresAt = null;
    if (type === 'mute') {
      const durMs = MUTE_DURATIONS_MS[durationKey];
      if (!durMs) {
        const err = new Error('Geçersiz susturma süresi.');
        err.code = 'INVALID_DURATION';
        throw err;
      }
      expiresAt = nowTs + durMs;
    } else if (type !== 'ban') {
      throw new Error('Geçersiz yaptırım türü.');
    }

    const sanction = {
      id: generateId('sanc'),
      userId: uid,
      type,
      durationKey: type === 'mute' ? durationKey : null,
      reasonCategory: String(reasonCategory || 'other'),
      note: String(note || '').trim().slice(0, 300),
      caseId: caseId ? String(caseId) : null,
      createdBy: String(modId),
      createdByName: String(modName || modId),
      createdAt: nowTs,
      expiresAt,
      liftedAt: null,
      liftedBy: null,
      liftedNote: null,
    };

    this.sanctions.set(sanction.id, sanction);
    this._saveSanctionsSync();

    this.appendAuditLog({
      modId,
      modName,
      caseId: sanction.caseId,
      action: type === 'ban' ? 'ban_user' : `mute_user_${durationKey}`,
      category: sanction.reasonCategory,
      targetId: uid,
      note: sanction.note,
      nowTs,
    });

    return { ...sanction };
  }

  liftSanction(sanctionId, { modId, modName = '', note = '', nowTs = Date.now() }) {
    const s = this.sanctions.get(String(sanctionId || ''));
    if (!s) return { ok: false, code: 'NOT_FOUND', status: 404 };
    if (s.liftedAt) return { ok: true, alreadyLifted: true, sanction: { ...s } };

    s.liftedAt = nowTs;
    s.liftedBy = String(modId);
    s.liftedNote = String(note || '').trim().slice(0, 300);
    this._saveSanctionsSync();

    this.appendAuditLog({
      modId,
      modName,
      caseId: s.caseId,
      action: 'lift_sanction',
      category: s.type,
      targetId: s.userId,
      note: s.liftedNote,
      nowTs,
    });

    return { ok: true, alreadyLifted: false, sanction: { ...s } };
  }

  listSanctions({ activeOnly = false, nowTs = Date.now() } = {}) {
    const list = [];
    for (const s of this.sanctions.values()) {
      const isActive = !s.liftedAt && (s.type === 'ban' || (s.expiresAt && s.expiresAt > nowTs));
      if (activeOnly && !isActive) continue;
      list.push({ ...s, isActive });
    }
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return list;
  }

  // ==========================================================================
  // 4) DENETİM KAYDI (chat/modlog.jsonl — APPEND-ONLY, İÇERİKSİZ)
  // ==========================================================================

  appendAuditLog({
    modId,
    modName = '',
    caseId = null,
    action,
    category = '',
    targetId = null,
    note = '',
    nowTs = Date.now(),
    countAsView = false,
  }) {
    const mid = String(modId || '');
    let highVolumeAccess = false;

    if (countAsView) {
      const cutoff = nowTs - HOUR_MS;
      const views = (this.recentViewsByMod.get(mid) || []).filter((t) => t > cutoff);
      views.push(nowTs);
      this.recentViewsByMod.set(mid, views);
      if (views.length > (chatConfig.MODERATION.HIGH_VOLUME_VIEWS_PER_HOUR || 30)) {
        highVolumeAccess = true;
      }
    }

    // Mesaj içeriği ASLA yazılmaz — yalnızca eylem meta verisi ve moderatör notu
    const entry = {
      id: generateId('log'),
      ts: nowTs,
      modId: mid,
      modName: String(modName || mid).slice(0, 64),
      caseId: caseId ? String(caseId) : null,
      action: String(action || 'unknown').slice(0, 48),
      category: String(category || '').slice(0, 48),
      targetId: targetId ? String(targetId) : null,
      note: String(note || '').trim().slice(0, 300),
      highVolumeAccess,
    };

    this._ensureDirs();
    fs.appendFileSync(this.modlogFile, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
    return entry;
  }

  /**
   * Grup yöneticisi mesaj silme eylemini MESAJ İÇERİĞİ OLMADAN denetim kaydına (modlog.jsonl) yazar.
   */
  recordGroupAdminDeleteAudit({ adminId, adminName = '', convId, msgId, targetUserId = null, nowTs = Date.now() }) {
    return this.appendAuditLog({
      modId: adminId,
      modName: adminName,
      caseId: null,
      action: 'group_admin_delete',
      category: String(convId || 'group:genel'),
      targetId: targetUserId ? String(targetUserId) : null,
      note: `msg:${String(msgId || '').slice(0, 64)}`,
      nowTs,
      countAsView: false,
    });
  }

  readAuditLogs({ limit = 100, page = 1 } = {}) {
    if (!fs.existsSync(this.modlogFile)) {
      return { items: [], total: 0, page: 1, totalPages: 1 };
    }
    let lines = [];
    try {
      lines = fs.readFileSync(this.modlogFile, 'utf8').split('\n').filter(Boolean);
    } catch (_) {
      return { items: [], total: 0, page: 1, totalPages: 1 };
    }
    const parsed = [];
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj && typeof obj === 'object') parsed.push(obj);
      } catch (_) {}
    }
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 100));
    const safePage = Math.max(1, Number(page) || 1);
    const start = (safePage - 1) * safeLimit;
    return {
      items: parsed.slice(start, start + safeLimit),
      total: parsed.length,
      page: safePage,
      totalPages: Math.max(1, Math.ceil(parsed.length / safeLimit)),
    };
  }

  // ==========================================================================
  // 5) KULLANICI BİLDİRİMLERİ (RAPOR SONUCU)
  // ==========================================================================

  addUserNotice(userId, notice) {
    const uid = String(userId || '');
    if (!uid) return;
    const list = this.noticesByUser.get(uid) || [];
    list.push({ id: generateId('ntc'), read: false, ...notice });
    this.noticesByUser.set(uid, list.slice(-30));
    this._saveNoticesSync();
  }

  getUnreadNotices(userId) {
    const list = this.noticesByUser.get(String(userId || '')) || [];
    return list.filter((n) => !n.read);
  }

  markNoticesRead(userId) {
    const uid = String(userId || '');
    const list = this.noticesByUser.get(uid);
    if (!list) return;
    let changed = false;
    for (const n of list) {
      if (!n.read) {
        n.read = true;
        changed = true;
      }
    }
    if (changed) this._saveNoticesSync();
  }

  // ==========================================================================
  // 6) SAKLAMA SÜRELERİ TEMİZLİĞİ (KAPANIŞ+7 GÜN, AÇIK 90 GÜN, YAPTIRIM/LOG 1 YIL)
  // ==========================================================================

  runModRetentionCleanup({ nowTs = Date.now(), chatStore = null } = {}) {
    const closedCutoff = nowTs - (chatConfig.MODERATION.CLOSED_CASE_RETENTION_DAYS || 7) * DAY_MS;
    const openCutoff = nowTs - (chatConfig.MODERATION.OPEN_CASE_MAX_DAYS || 90) * DAY_MS;
    const yearCutoff = nowTs - (chatConfig.MODERATION.SANCTION_RETENTION_DAYS || 365) * DAY_MS;

    const stats = {
      purgedSnapshots: 0,
      autoClosedOldCases: 0,
      purgedSanctions: 0,
      purgedAuditEntries: 0,
    };

    const purgeSnapshot = (c) => {
      if (c.snapshotPurged) return;
      const snapPath = this._getSnapshotPath(c.id);
      try {
        if (fs.existsSync(snapPath)) fs.unlinkSync(snapPath);
      } catch (_) {}
      if (chatStore && Array.isArray(c.attachmentIds)) {
        for (const aid of c.attachmentIds) {
          chatStore.unpreserveFileForCase(aid, c.id);
          // İlgili mesaj zaten silinmiş veya süresi dolmuşsa dosyayı diskten temizle
          const meta = chatStore.getFileMeta(aid);
          if (meta && !meta.preserved) {
            const msgStillActive =
              meta.convId && meta.msgId
                ? (() => {
                    const m = chatStore.getMessageById(meta.convId, meta.msgId);
                    return Boolean(m && !m.deleted);
                  })()
                : false;
            if (!msgStillActive) {
              chatStore.deleteFileIfUnpreserved(aid);
            }
          }
        }
      }
      c.snapshotPurged = true;
      c.attachmentIds = [];
      stats.purgedSnapshots += 1;
    };

    let casesChanged = false;
    for (const c of this.cases.values()) {
      // 90 günü aşan açık vakaları otomatik kapat ve sil
      if (c.status !== 'closed' && c.createdAt <= openCutoff) {
        c.status = 'closed';
        c.resolution = 'auto_expired_90d';
        c.closedAt = nowTs;
        c.lockedBy = null;
        c.lockedUntil = 0;
        purgeSnapshot(c);
        stats.autoClosedOldCases += 1;
        casesChanged = true;
      } else if (c.status === 'closed' && !c.snapshotPurged && c.closedAt && c.closedAt <= closedCutoff) {
        purgeSnapshot(c);
        casesChanged = true;
      }
    }
    if (casesChanged) this._saveCasesIndexSync();

    // 1 yıldan eski sona ermiş yaptırımları temizle
    let sancChanged = false;
    for (const [id, s] of [...this.sanctions.entries()]) {
      const endTs = s.liftedAt || s.expiresAt;
      if (endTs && endTs <= yearCutoff) {
        this.sanctions.delete(id);
        stats.purgedSanctions += 1;
        sancChanged = true;
      }
    }
    if (sancChanged) this._saveSanctionsSync();

    // 1 yıldan eski denetim kayıtlarını temizle (atomik)
    if (fs.existsSync(this.modlogFile)) {
      try {
        const lines = fs.readFileSync(this.modlogFile, 'utf8').split('\n').filter(Boolean);
        const kept = [];
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj && Number(obj.ts) > yearCutoff) kept.push(line);
            else stats.purgedAuditEntries += 1;
          } catch (_) {
            stats.purgedAuditEntries += 1;
          }
        }
        if (stats.purgedAuditEntries > 0) {
          const tmp = `${this.modlogFile}.${process.pid}.tmp`;
          fs.writeFileSync(tmp, kept.length > 0 ? `${kept.join('\n')}\n` : '', { encoding: 'utf8', mode: 0o600 });
          fs.renameSync(tmp, this.modlogFile);
        }
      } catch (_) {}
    }

    return stats;
  }

  flush() {
    try {
      this._saveCasesIndexSync();
    } catch (_) {}
    try {
      this._saveSanctionsSync();
    } catch (_) {}
    try {
      this._saveNoticesSync();
    } catch (_) {}
  }
}

let defaultModStore = null;

function getChatModStore(chatStore = null) {
  const baseDir = chatStore ? chatStore.baseDir : require('./chatStore').getChatStore().baseDir;
  if (!defaultModStore || defaultModStore.baseDir !== baseDir) {
    defaultModStore = new ChatModStore({ baseDir });
  }
  return defaultModStore;
}

function setDefaultChatModStore(instance) {
  defaultModStore = instance;
}

module.exports = {
  ChatModStore,
  getChatModStore,
  setDefaultChatModStore,
  REPORT_CATEGORIES,
  MUTE_DURATIONS_MS,
  PRIORITY_RANK,
};
