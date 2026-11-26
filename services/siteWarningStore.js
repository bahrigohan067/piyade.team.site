const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const warningsConfig = require('../config/warnings.config');
const { validateEvidenceImageBuffer } = require('../utils/fileValidator');
const { toUnifiedGoogleId } = require('./memberStore');

const DAY_MS = warningsConfig.DAY_MS;
const EVIDENCE_FILENAME_RE = /^warn_ev_[a-f0-9]{32}\.(png|jpg|webp)$/;

function generateId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function generateWarnCode() {
  return `SW-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function resolveDefaultWarningsDir(envObj = process.env) {
  const vol =
    envObj && typeof envObj.RAILWAY_VOLUME_MOUNT_PATH === 'string'
      ? envObj.RAILWAY_VOLUME_MOUNT_PATH.trim()
      : '';
  if (vol) {
    return path.join(vol, 'warnings');
  }
  return path.join(process.cwd(), '.warnings-data');
}

function atomicWriteJson(filePath, dataObj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}`;
  const bakPath = `${filePath}.bak`;
  fs.writeFileSync(tmpPath, JSON.stringify(dataObj, null, 2), { encoding: 'utf8', mode: 0o600 });
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

function mapRuleToSanctionCategory(ruleCode) {
  switch (String(ruleCode || '').toUpperCase()) {
    case 'M4':
      return 'harassment';
    case 'M6':
    case 'M10':
      return 'sexual';
    case 'M2':
    case 'M9':
      return 'scam_spam';
    case 'M11':
      return 'harassment';
    default:
      return 'other';
  }
}

/**
 * ==============================================================================
 * ⚖️ SİTE (GOOGLE) ÜYELERİ UYARI, YAPTIRIM, BİLDİRİM VE DENETİM DEPOSU
 * ==============================================================================
 * - ${RAILWAY_VOLUME_MOUNT_PATH}/warnings/ (yoksa .warnings-data/) altında saklar.
 * - Kanıt dosyaları ${VOLUME}/warnings/evidence/ altında rastgele adla tutulur;
 *   public/ klasörüne ASLA yazılmaz, yalnızca yetkililere sunulan rotadan servis edilir.
 * - Denetim kaydı (audit.jsonl) yalnızca eklemelidir; gerekçe metni, iptal gerekçesi
 *   ve kanıt içeriği ASLA yazılmaz.
 * ==============================================================================
 */
class SiteWarningStore {
  constructor(options = {}) {
    this.baseDir = options.baseDir || resolveDefaultWarningsDir(options.env || process.env);
    this.evidenceDir = path.join(this.baseDir, 'evidence');
    this.dataFile = path.join(this.baseDir, 'warnings.json');
    this.auditFile = path.join(this.baseDir, 'audit.jsonl');

    this._ensureDirs();
    this._state = null;
    this._maintenanceTimer = null;
  }

  _ensureDirs() {
    for (const dir of [this.baseDir, this.evidenceDir]) {
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        }
      } catch (_) {}
    }
  }

  _loadState() {
    if (this._state) return this._state;
    const raw = safeReadJson(this.dataFile, {
      version: 1,
      records: {},
      notifications: {},
    });
    this._state = {
      version: 1,
      records: raw && typeof raw.records === 'object' && raw.records ? raw.records : {},
      notifications:
        raw && typeof raw.notifications === 'object' && raw.notifications ? raw.notifications : {},
    };
    return this._state;
  }

  _saveState() {
    const st = this._loadState();
    this._ensureDirs();
    atomicWriteJson(this.dataFile, {
      version: 1,
      updatedAt: Date.now(),
      records: st.records,
      notifications: st.notifications,
    });
  }

  /**
   * İçeriksiz denetim kaydı yazar (kim, ne zaman, hangi üye, eylem; gerekçe veya kanıt İÇERMEZ).
   */
  appendAudit({
    actorId = 'system',
    actorName = '',
    targetMemberId = null,
    action,
    warnId = null,
    ruleCode = null,
    sanctionKind = null,
    nowTs = Date.now(),
  }) {
    this._ensureDirs();
    const entry = {
      id: generateId('waud'),
      ts: Number(nowTs) || Date.now(),
      actorId: String(actorId || 'system').slice(0, 64),
      ...(actorName ? { actorName: String(actorName).slice(0, 64) } : {}),
      ...(targetMemberId ? { targetMemberId: String(targetMemberId).slice(0, 64) } : {}),
      action: String(action || 'unknown').slice(0, 48),
      ...(warnId ? { warnId: String(warnId).slice(0, 32) } : {}),
      ...(ruleCode ? { ruleCode: String(ruleCode).toUpperCase().slice(0, 12) } : {}),
      ...(sanctionKind ? { sanctionKind: String(sanctionKind).slice(0, 32) } : {}),
    };
    fs.appendFileSync(this.auditFile, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
    return entry;
  }

  readAuditLogs({ limit = 100 } = {}) {
    if (!fs.existsSync(this.auditFile)) return [];
    try {
      const lines = fs.readFileSync(this.auditFile, 'utf8').split('\n').filter(Boolean);
      const out = [];
      for (let i = lines.length - 1; i >= 0 && out.length < limit; i -= 1) {
        try {
          const parsed = JSON.parse(lines[i]);
          if (parsed && typeof parsed === 'object') out.push(parsed);
        } catch (_) {}
      }
      return out;
    } catch (_) {
      return [];
    }
  }

  // ==========================================================================
  // 1) OTOMATİK AF & SÜRE SONU DEĞERLENDİRME (Sahte saatle test edilebilir)
  // ==========================================================================

  _getMemberRecordsRaw(memberId) {
    const cleanId = String(memberId || '').trim();
    const st = this._loadState();
    return Object.values(st.records)
      .filter((r) => r && r.memberId === cleanId)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  /**
   * Belirli bir üye için 30 günlük otomatik af ve süresi dolan askı kontrolünü uygular.
   */
  evaluateMemberState(memberId, { nowTs = Date.now(), memberStore = null } = {}) {
    const cleanId = String(memberId || '').trim();
    const now = Number(nowTs) || Date.now();
    const amnestyMs = warningsConfig.getAmnestyDays() * DAY_MS;

    const records = this._getMemberRecordsRaw(cleanId);
    const activePointRecords = records.filter(
      (r) => !r.cancelled && !r.pardonedAt && (Number(r.pointsAdded) || 0) > 0
    );

    let pardonedCount = 0;
    if (activePointRecords.length > 0) {
      const lastPointTs = activePointRecords.reduce(
        (maxTs, r) => Math.max(maxTs, Number(r.createdAt) || 0),
        0
      );
      if (lastPointTs > 0 && now - lastPointTs >= amnestyMs) {
        for (const rec of activePointRecords) {
          rec.pardonedAt = now;
          pardonedCount += 1;
        }
        this._saveState();
        this.appendAudit({
          actorId: 'system',
          targetMemberId: cleanId,
          action: 'auto_amnesty_reset',
          nowTs: now,
        });
      }
    }

    let suspensionLifted = false;
    if (memberStore) {
      const member = memberStore.findById(cleanId);
      if (
        member &&
        member.status === 'suspended' &&
        member.statusExpiresAt &&
        Number(member.statusExpiresAt) <= now
      ) {
        memberStore.updateMember(cleanId, {
          status: 'active',
          statusExpiresAt: null,
          statusReason: '',
        });
        suspensionLifted = true;
        this.appendAudit({
          actorId: 'system',
          targetMemberId: cleanId,
          action: 'suspension_expired',
          nowTs: now,
        });
      }
    }

    return { pardonedCount, suspensionLifted };
  }

  /**
   * Üyenin güncel puan, kademe, eşik geçişi, aktif yaptırım ve son 10 kayıt özetini hesaplar.
   */
  getMemberSummary(
    memberId,
    { nowTs = Date.now(), memberStore = null, chatModStore = null, lang = 'tr', limit = 10 } = {}
  ) {
    const cleanId = String(memberId || '').trim();
    const now = Number(nowTs) || Date.now();
    this.evaluateMemberState(cleanId, { nowTs: now, memberStore });

    const records = this._getMemberRecordsRaw(cleanId);
    const activeCyclePointRecords = records.filter(
      (r) => !r.cancelled && !r.pardonedAt && (Number(r.pointsAdded) || 0) > 0
    );

    const totalPoints = activeCyclePointRecords.reduce((sum, r) => sum + (Number(r.pointsAdded) || 0), 0);
    const tier = warningsConfig.calculateTierFromPoints(totalPoints);
    const tierInfo = warningsConfig.getTierInfo(tier, lang);

    const triggered10 = activeCyclePointRecords.some((r) => Boolean(r.triggeredThreshold10));
    const triggered15 = activeCyclePointRecords.some((r) => Boolean(r.triggeredThreshold15));
    const lastPointWarningAt = activeCyclePointRecords.reduce(
      (maxTs, r) => Math.max(maxTs, Number(r.createdAt) || 0),
      0
    );
    const amnestyAt =
      lastPointWarningAt > 0 ? lastPointWarningAt + warningsConfig.getAmnestyDays() * DAY_MS : null;

    const member = memberStore ? memberStore.findById(cleanId) : null;
    const unifiedId = toUnifiedGoogleId(cleanId);
    const activeChatSanction =
      chatModStore && unifiedId ? chatModStore.getActiveSanction(unifiedId, now) : null;

    let activeSanction = null;
    if (member && member.status === 'banned') {
      activeSanction = {
        kind: 'permanent_ban',
        expiresAt: null,
        reason: member.statusReason || '',
      };
    } else if (
      member &&
      member.status === 'suspended' &&
      (!member.statusExpiresAt || member.statusExpiresAt > now)
    ) {
      activeSanction = {
        kind: 'account_suspend',
        expiresAt: member.statusExpiresAt || null,
        reason: member.statusReason || '',
      };
    } else if (activeChatSanction && activeChatSanction.type === 'mute') {
      activeSanction = {
        kind: 'chat_mute',
        expiresAt: activeChatSanction.expiresAt || null,
        reason: activeChatSanction.reasonText || activeChatSanction.note || '',
        ruleCode: activeChatSanction.ruleCode || null,
        source: activeChatSanction.source || 'moderation',
      };
    }

    const recentRecords = [...records]
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, Math.max(1, Number(limit) || warningsConfig.RETENTION.PREVIEW_HISTORY_LIMIT))
      .map((r) => ({ ...r }));

    return {
      memberId: cleanId,
      status: member ? member.status : 'unknown',
      statusExpiresAt: member && member.statusExpiresAt ? member.statusExpiresAt : null,
      totalPoints,
      tier,
      tierLabel: tierInfo.label,
      tierLabelTr: tierInfo.labelTr,
      tierLabelEn: tierInfo.labelEn,
      triggered10,
      triggered15,
      amnestyAt,
      activeSanction,
      activeChatSanction,
      totalRecordsCount: records.length,
      recentRecords,
    };
  }

  // ==========================================================================
  // 2) UYARI VERME (Resmi: M/D kuralları, Sözlü: 0 puan)
  // ==========================================================================

  saveEvidenceFile(buffer, originalMime, originalName, nowTs = Date.now()) {
    const check = validateEvidenceImageBuffer(buffer, originalMime, originalName);
    if (!check.valid) {
      const err = new Error(check.error || 'Geçersiz kanıt dosyası.');
      err.code = 'INVALID_EVIDENCE';
      err.errorKey = check.errorKey || 'errors.invalidFileType';
      err.statusCode = 400;
      throw err;
    }
    const randomName = `warn_ev_${crypto.randomBytes(16).toString('hex')}.${check.ext}`;
    this._ensureDirs();
    const fullPath = path.join(this.evidenceDir, randomName);
    fs.writeFileSync(fullPath, buffer, { mode: 0o600 });
    return {
      fileName: randomName,
      mimeType: check.mimeType,
      ext: check.ext,
      size: buffer.length,
      createdAt: Number(nowTs) || Date.now(),
    };
  }

  getEvidenceFilePath(fileName) {
    const clean = path.basename(String(fileName || '').trim());
    if (!EVIDENCE_FILENAME_RE.test(clean)) return null;
    const fullPath = path.join(this.evidenceDir, clean);
    if (!fs.existsSync(fullPath)) return null;
    const ext = path.extname(clean).toLowerCase();
    const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
    return {
      fileName: clean,
      fullPath,
      mimeType: mimeMap[ext] || 'application/octet-stream',
    };
  }

  issueWarning({
    memberId,
    type = 'official', // 'official' | 'verbal'
    ruleCode = null,
    reason = '',
    evidenceBuffer = null,
    evidenceMime = '',
    evidenceOrigName = '',
    evidenceUrl = null,
    actorId,
    actorName = '',
    nowTs = Date.now(),
    memberStore,
    chatModStore = null,
    sseHub = null,
  }) {
    const now = Number(nowTs) || Date.now();
    const cleanMemberId = String(memberId || '').trim();
    if (!memberStore) {
      throw new Error('memberStore gereklidir.');
    }
    const member = memberStore.findById(cleanMemberId);
    if (!member) {
      const err = new Error('Seçilen site üyesi bulunamadı.');
      err.code = 'MEMBER_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const cleanType = type === 'verbal' ? 'verbal' : 'official';
    const cleanReason = String(reason || '')
      .trim()
      .slice(0, warningsConfig.RETENTION.MAX_REASON_LENGTH);

    if (cleanType === 'verbal' && cleanReason.length < 3) {
      const err = new Error('Sözlü uyarıda gerekçe yazmak zorunludur (en az 3 karakter).');
      err.code = 'VERBAL_REASON_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    let rule = null;
    if (cleanType === 'official') {
      rule = warningsConfig.getSiteRule(ruleCode, 'tr');
      if (!rule) {
        const err = new Error(
          'Geçersiz kural maddesi! Site üyeleri için yalnızca M1–M13 ve D1–D3 maddeleri seçilebilir.'
        );
        err.code = 'INVALID_RULE_CODE';
        err.statusCode = 400;
        throw err;
      }
    }

    // Harici kanıt bağlantısı doğrulaması (SVG yasak)
    let cleanEvidenceUrl = null;
    if (evidenceUrl && String(evidenceUrl).trim()) {
      const candidate = String(evidenceUrl).trim();
      if (!/^https?:\/\/\S+/i.test(candidate)) {
        const err = new Error('Kanıt bağlantısı http:// veya https:// ile başlamalıdır.');
        err.code = 'INVALID_EVIDENCE_URL';
        err.statusCode = 400;
        throw err;
      }
      if (/\.svg(\?.*)?$/i.test(candidate)) {
        const err = new Error('Güvenlik nedeniyle SVG bağlantıları kabul edilmez.');
        err.code = 'SVG_NOT_ALLOWED';
        err.statusCode = 400;
        throw err;
      }
      cleanEvidenceUrl = candidate.slice(0, 500);
    }

    // Kanıt dosyası doğrulama & diske kaydetme (Volume/warnings/evidence/)
    let savedEvidence = null;
    if (evidenceBuffer && Buffer.isBuffer(evidenceBuffer)) {
      savedEvidence = this.saveEvidenceFile(evidenceBuffer, evidenceMime, evidenceOrigName, now);
    }

    // Önce mevcut af ve askı bitişlerini değerlendir
    const before = this.getMemberSummary(cleanMemberId, {
      nowTs: now,
      memberStore,
      chatModStore,
      lang: 'tr',
    });

    const warnId = generateWarnCode();
    const unifiedId = toUnifiedGoogleId(cleanMemberId);
    const previousPoints = before.totalPoints;
    const previousTier = before.tier;

    let pointsAdded = 0;
    let newPoints = previousPoints;
    let newTier = previousTier;
    let triggeredThreshold10 = false;
    let triggeredThreshold15 = false;
    let sanctionKind = 'none'; // 'none' | 'chat_mute' | 'account_suspend' | 'permanent_ban'
    let sanctionDurationDays = null;
    let sanctionExpiresAt = null;
    let suspensionAppliedUntil = null;
    let sanctionLabelTr = 'Yaptırım yok (sicile işlendi)';
    let sanctionLabelEn = 'No sanction (recorded)';
    let linkedSanctionId = null;

    const effectiveReasonText =
      cleanReason || (rule ? `${rule.code} — ${rule.titleTr}` : 'Kural ihlali');

    if (cleanType === 'verbal') {
      sanctionLabelTr = 'Sözlü Uyarı (0 Puan, Sicile İşlendi)';
      sanctionLabelEn = 'Verbal Warning (0 Points, Recorded)';
    } else if (rule.effectKind === 'permanent_ban') {
      sanctionKind = 'permanent_ban';
      sanctionLabelTr = 'Kalıcı Hesap Yasağı';
      sanctionLabelEn = 'Permanent Account Ban';

      memberStore.updateMember(cleanMemberId, {
        status: 'banned',
        statusExpiresAt: null,
        statusReason: `${rule.code} — ${effectiveReasonText}`.slice(0, 300),
      });
      if (member.googleSub) {
        memberStore.banGoogleSub(member.googleSub, `${rule.code} — ${effectiveReasonText}`);
      }
      memberStore.revokeAllRememberTokensForMember(cleanMemberId);
      if (sseHub && unifiedId) {
        try {
          sseHub.disconnectUser(unifiedId, 'account_banned');
        } catch (_) {}
      }
    } else if (rule.effectKind === 'chat_mute') {
      sanctionKind = 'chat_mute';
      sanctionDurationDays = rule.durationDays || 1;
      sanctionExpiresAt = now + sanctionDurationDays * DAY_MS;
      sanctionLabelTr = `${sanctionDurationDays} Gün Sohbet Susturma`;
      sanctionLabelEn = `${sanctionDurationDays}-Day Chat Mute`;

      if (chatModStore && unifiedId) {
        const s = chatModStore.applySanction({
          userId: unifiedId,
          type: 'mute',
          durationKey: `${sanctionDurationDays}d`,
          durationMs: sanctionDurationDays * DAY_MS,
          reasonCategory: mapRuleToSanctionCategory(rule.code),
          note: `${rule.code} (${sanctionDurationDays}g)`,
          reasonText: effectiveReasonText,
          ruleCode: rule.code,
          source: 'site_warning',
          sourceWarningId: warnId,
          modId: actorId,
          modName: actorName,
          skipAudit: true,
          nowTs: now,
        });
        linkedSanctionId = s.id;
      }
    } else if (rule.effectKind === 'points') {
      pointsAdded = rule.points;
      newPoints = previousPoints + pointsAdded;
      newTier = warningsConfig.calculateTierFromPoints(newPoints);

      const t10 = warningsConfig.POINT_THRESHOLDS.CHAT_MUTE_10;
      const t15 = warningsConfig.POINT_THRESHOLDS.ACCOUNT_SUSPEND_15;

      // 10 Puan Eşiği (idempotent: aktif döngüde İLK geçişte bir kez uygulanır)
      if (!before.triggered10 && previousPoints < t10.minPoints && newPoints >= t10.minPoints) {
        triggeredThreshold10 = true;
        const muteMs = t10.durationDays * DAY_MS;
        sanctionKind = 'chat_mute';
        sanctionDurationDays = t10.durationDays;
        sanctionExpiresAt = now + muteMs;
        sanctionLabelTr = t10.labelTr;
        sanctionLabelEn = t10.labelEn;

        if (chatModStore && unifiedId) {
          const s = chatModStore.applySanction({
            userId: unifiedId,
            type: 'mute',
            durationKey: `${t10.durationDays}d`,
            durationMs: muteMs,
            reasonCategory: mapRuleToSanctionCategory(rule.code),
            note: `10+ puan eşiği (${rule.code})`,
            reasonText: effectiveReasonText,
            ruleCode: rule.code,
            source: 'site_warning',
            sourceWarningId: warnId,
            modId: actorId,
            modName: actorName,
            skipAudit: true,
            nowTs: now,
          });
          linkedSanctionId = s.id;
        }
      }

      // 15+ Puan Eşiği (idempotent: aktif döngüde İLK geçişte 7 gün hesap askıya alma)
      if (!before.triggered15 && previousPoints < t15.minPoints && newPoints >= t15.minPoints) {
        triggeredThreshold15 = true;
        const suspMs = t15.durationDays * DAY_MS;
        suspensionAppliedUntil = now + suspMs;
        sanctionKind = 'account_suspend';
        sanctionDurationDays = t15.durationDays;
        sanctionExpiresAt = suspensionAppliedUntil;
        sanctionLabelTr = t15.labelTr;
        sanctionLabelEn = t15.labelEn;

        const latestMember = memberStore.findById(cleanMemberId);
        if (latestMember && latestMember.status !== 'banned') {
          const nextUntil = Math.max(Number(latestMember.statusExpiresAt) || 0, suspensionAppliedUntil);
          memberStore.updateMember(cleanMemberId, {
            status: 'suspended',
            statusExpiresAt: nextUntil,
            statusReason: `${rule.code} — ${effectiveReasonText}`.slice(0, 300),
          });
          memberStore.revokeAllRememberTokensForMember(cleanMemberId);
        }
      }

      if (sanctionKind === 'none') {
        const tierObj = warningsConfig.getTierInfo(newTier, 'tr');
        sanctionLabelTr = `+${pointsAdded} Ceza Puanı (Toplam: ${newPoints} — ${tierObj.labelTr})`;
        sanctionLabelEn = `+${pointsAdded} Penalty Points (Total: ${newPoints} — ${tierObj.labelEn})`;
      }
    }

    const record = {
      id: warnId,
      memberId: cleanMemberId,
      type: cleanType,
      ruleCode: rule ? rule.code : null,
      ruleTitleTr: rule ? rule.titleTr : null,
      ruleTitleEn: rule ? rule.titleEn : null,
      reason: cleanReason,
      pointsAdded,
      previousPoints,
      newPoints,
      previousTier,
      newTier,
      triggeredThreshold10,
      triggeredThreshold15,
      sanctionKind,
      sanctionDurationDays,
      sanctionExpiresAt,
      suspensionAppliedUntil,
      sanctionLabelTr,
      sanctionLabelEn,
      linkedSanctionId,
      evidence: savedEvidence,
      evidenceUrl: cleanEvidenceUrl,
      actorId: String(actorId || ''),
      actorName: String(actorName || actorId || ''),
      createdAt: now,
      pardonedAt: null,
      cancelled: false,
      cancelledAt: null,
      cancelledBy: null,
      cancelledByName: null,
      cancelReason: null,
    };

    const st = this._loadState();
    st.records[warnId] = record;

    // Üye bildirimi (KANIT DOSYASI / URL ASLA EKLENMEZ!)
    const notification = {
      id: generateId('wnt'),
      warningId: warnId,
      type: cleanType,
      ruleCode: record.ruleCode,
      ruleTitleTr: record.ruleTitleTr,
      ruleTitleEn: record.ruleTitleEn,
      reason: record.reason,
      pointsAdded: record.pointsAdded,
      totalPoints: record.newPoints,
      tier: record.newTier,
      sanctionKind: record.sanctionKind,
      sanctionDurationDays: record.sanctionDurationDays,
      sanctionLabelTr: record.sanctionLabelTr,
      sanctionLabelEn: record.sanctionLabelEn,
      sanctionExpiresAt: record.sanctionExpiresAt,
      createdAt: now,
      dismissedAt: null,
    };

    if (!Array.isArray(st.notifications[cleanMemberId])) {
      st.notifications[cleanMemberId] = [];
    }
    st.notifications[cleanMemberId].push(notification);
    st.notifications[cleanMemberId] = st.notifications[cleanMemberId].slice(-30);

    this._saveState();

    // İçeriksiz denetim kaydı (gerekçe ve kanıt içermez!)
    this.appendAudit({
      actorId,
      actorName,
      targetMemberId: cleanMemberId,
      action: cleanType === 'verbal' ? 'issue_verbal_warning' : 'issue_official_warning',
      warnId,
      ruleCode: record.ruleCode,
      sanctionKind: record.sanctionKind,
      nowTs: now,
    });

    // Canlı SSE bildirimi (kalıcı yasak değilse; yasaklananın bağlantısı yukarıda kapatıldı)
    if (sseHub && unifiedId && record.sanctionKind !== 'permanent_ban') {
      try {
        sseHub.sendToUser(unifiedId, 'site_warning', notification, { buffer: true });
        if (record.sanctionKind === 'chat_mute') {
          sseHub.sendToUser(
            unifiedId,
            'sanction_updated',
            {
              type: 'mute',
              ruleCode: record.ruleCode,
              reasonText: effectiveReasonText,
              expiresAt: record.sanctionExpiresAt,
            },
            { buffer: false }
          );
        } else if (record.sanctionKind === 'account_suspend') {
          sseHub.sendToUser(
            unifiedId,
            'account_suspended',
            {
              expiresAt: record.sanctionExpiresAt,
              redirectUrl: '/giris/askida',
            },
            { buffer: false }
          );
        }
      } catch (_) {}
    }

    const summary = this.getMemberSummary(cleanMemberId, {
      nowTs: now,
      memberStore,
      chatModStore,
      lang: 'tr',
    });

    return {
      ok: true,
      record: { ...record },
      notification: { ...notification },
      summary,
    };
  }

  // ==========================================================================
  // 3) UYARI İPTALİ VE YENİDEN HESAPLAMA
  // ==========================================================================

  cancelWarning(
    warnId,
    {
      actorId,
      actorName = '',
      cancelReason = '',
      nowTs = Date.now(),
      memberStore,
      chatModStore = null,
      sseHub = null,
    } = {}
  ) {
    const now = Number(nowTs) || Date.now();
    const cleanWarnId = String(warnId || '').trim();
    const cleanCancelReason = String(cancelReason || '')
      .trim()
      .slice(0, warningsConfig.RETENTION.MAX_CANCEL_REASON_LENGTH);

    if (cleanCancelReason.length < 3) {
      const err = new Error('Uyarı iptalinde gerekçe yazmak zorunludur (en az 3 karakter).');
      err.code = 'CANCEL_REASON_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    const st = this._loadState();
    const rec = st.records[cleanWarnId];
    if (!rec) {
      const err = new Error('Uyarı kaydı bulunamadı.');
      err.code = 'WARNING_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    if (rec.cancelled) {
      const err = new Error('Bu uyarı kaydı zaten iptal edilmiş.');
      err.code = 'ALREADY_CANCELLED';
      err.statusCode = 409;
      throw err;
    }

    rec.cancelled = true;
    rec.cancelledAt = now;
    rec.cancelledBy = String(actorId || '');
    rec.cancelledByName = String(actorName || actorId || '');
    rec.cancelReason = cleanCancelReason;

    const memberId = rec.memberId;
    const unifiedId = toUnifiedGoogleId(memberId);

    // Kalan aktif (iptal edilmemiş) uyarıları ve aktif af döngüsü puanını yeniden hesapla
    const remainingActive = this._getMemberRecordsRaw(memberId).filter((r) => !r.cancelled);
    const remainingCyclePointRecords = remainingActive.filter(
      (r) => !r.pardonedAt && (Number(r.pointsAdded) || 0) > 0
    );
    const remainingCyclePoints = remainingCyclePointRecords.reduce(
      (sum, r) => sum + (Number(r.pointsAdded) || 0),
      0
    );
    const t10Min = warningsConfig.POINT_THRESHOLDS.CHAT_MUTE_10.minPoints;
    const t15Min = warningsConfig.POINT_THRESHOLDS.ACCOUNT_SUSPEND_15.minPoints;

    // 1) Sohbet susturmasını yeniden değerlendir:
    //    - İptal edilen kayıt doğrudan kural susturmasıysa (M4/M10/M11/M13) yalnız kendi yaptırımını kaldır;
    //      başka aktif bir kural/eşik susturması varsa chatModStore'da kalmaya devam eder.
    //    - Puan kaydı iptal edildiyse ve aktif puan 10'un altına düştüyse, aktif döngüdeki 10-puan eşiği
    //      susturmalarını kaldır ve eşik bayrağını temizle (tekrar 10'a çıkarsa yeniden uygulanabilsin).
    if (chatModStore) {
      if (rec.sanctionKind === 'chat_mute' && !rec.triggeredThreshold10) {
        chatModStore.liftSanctionsByWarningId(cleanWarnId, {
          modId: actorId,
          modName: actorName,
          note: `Uyarı iptali (${cleanWarnId})`,
          nowTs: now,
          skipAudit: true,
        });
      }
      if ((Number(rec.pointsAdded) || 0) > 0 && remainingCyclePoints < t10Min) {
        const threshold10WarnIds = new Set();
        if (rec.triggeredThreshold10) threshold10WarnIds.add(cleanWarnId);
        for (const r of remainingCyclePointRecords) {
          if (r.triggeredThreshold10) {
            threshold10WarnIds.add(r.id);
            r.triggeredThreshold10 = false;
          }
        }
        for (const wid of threshold10WarnIds) {
          chatModStore.liftSanctionsByWarningId(wid, {
            modId: actorId,
            modName: actorName,
            note: `Puan 10 eşiğinin altına düştü (${cleanWarnId})`,
            nowTs: now,
            skipAudit: true,
          });
        }
      } else if (
        rec.triggeredThreshold10 &&
        remainingCyclePoints >= t10Min &&
        remainingCyclePointRecords.length > 0 &&
        !remainingCyclePointRecords.some((r) => r.triggeredThreshold10)
      ) {
        // Kalan aktif puan hala 10+ ise eşik geçişi bayrağını en son aktif kayda taşı (çift tetiklemeyi önler)
        remainingCyclePointRecords[remainingCyclePointRecords.length - 1].triggeredThreshold10 = true;
      }
    }

    // 2) Kalan aktif uyarılara göre kalıcı yasak ve 15+ puan hesap askısını yeniden değerlendir
    const hasOtherActiveBan = remainingActive.some((r) => r.sanctionKind === 'permanent_ban');
    const stillMeetsSuspendThreshold = remainingCyclePoints >= t15Min;
    if (!stillMeetsSuspendThreshold) {
      for (const r of remainingCyclePointRecords) {
        if (r.triggeredThreshold15) {
          r.triggeredThreshold15 = false;
        }
      }
    } else if (
      rec.triggeredThreshold15 &&
      remainingCyclePointRecords.length > 0 &&
      !remainingCyclePointRecords.some((r) => r.triggeredThreshold15)
    ) {
      remainingCyclePointRecords[remainingCyclePointRecords.length - 1].triggeredThreshold15 = true;
      if (rec.suspensionAppliedUntil) {
        remainingCyclePointRecords[remainingCyclePointRecords.length - 1].suspensionAppliedUntil =
          rec.suspensionAppliedUntil;
      }
    }
    const remainingSuspUntil = stillMeetsSuspendThreshold
      ? remainingActive.reduce((maxTs, r) => {
          const u = Number(r.suspensionAppliedUntil) || 0;
          return u > now ? Math.max(maxTs, u) : maxTs;
        }, 0)
      : 0;

    if (memberStore) {
      const member = memberStore.findById(memberId);
      if (member) {
        if (!hasOtherActiveBan) {
          if (rec.sanctionKind === 'permanent_ban' && member.googleSub) {
            memberStore.unbanGoogleSub(member.googleSub);
          }

          if (stillMeetsSuspendThreshold) {
            const keepUntil = Math.max(
              remainingSuspUntil,
              member.status === 'suspended' && Number(member.statusExpiresAt) > now
                ? Number(member.statusExpiresAt)
                : 0
            );
            if (keepUntil > now) {
              memberStore.updateMember(memberId, {
                status: 'suspended',
                statusExpiresAt: keepUntil,
              });
            } else if (rec.sanctionKind === 'permanent_ban' && member.status === 'banned') {
              memberStore.updateMember(memberId, {
                status: 'active',
                statusExpiresAt: null,
                statusReason: '',
              });
            }
          } else if (
            (rec.sanctionKind === 'permanent_ban' && member.status === 'banned') ||
            ((Number(rec.pointsAdded) || 0) > 0 && member.status === 'suspended') ||
            (rec.suspensionAppliedUntil && member.status === 'suspended')
          ) {
            memberStore.updateMember(memberId, {
              status: 'active',
              statusExpiresAt: null,
              statusReason: '',
            });
          }
        }
      }
    }

    // İptal edilen uyarının henüz görülmemiş bildirimini de kapat ki kullanıcıya iptal edilmiş ceza görünmesin
    const memberNotifs = st.notifications[memberId];
    if (Array.isArray(memberNotifs)) {
      for (const n of memberNotifs) {
        if (n && n.warningId === cleanWarnId && !n.dismissedAt) {
          n.dismissedAt = now;
        }
      }
    }

    this._saveState();

    // İçeriksiz denetim kaydı (iptal gerekçesi ASLA yazılmaz!)
    this.appendAudit({
      actorId,
      actorName,
      targetMemberId: memberId,
      action: 'cancel_warning',
      warnId: cleanWarnId,
      ruleCode: rec.ruleCode,
      sanctionKind: rec.sanctionKind,
      nowTs: now,
    });

    if (sseHub && unifiedId && chatModStore) {
      try {
        const nextSanction = chatModStore.getActiveSanction(unifiedId, now);
        sseHub.sendToUser(
          unifiedId,
          'sanction_updated',
          nextSanction
            ? {
                type: nextSanction.type,
                ruleCode: nextSanction.ruleCode || null,
                reasonText: nextSanction.reasonText || nextSanction.note || '',
                expiresAt: nextSanction.expiresAt || null,
              }
            : { type: 'none' },
          { buffer: false }
        );
      } catch (_) {}
    }

    const summary = this.getMemberSummary(memberId, {
      nowTs: now,
      memberStore,
      chatModStore,
      lang: 'tr',
    });

    return {
      ok: true,
      cancelledRecord: { ...rec },
      summary,
    };
  }

  // ==========================================================================
  // 4) ÜYE BİLDİRİMLERİ (Girişte ve canlı SSE; kapatılabilir, kanıtsız)
  // ==========================================================================

  getUnreadNotifications(memberId) {
    const cleanId = String(memberId || '').trim();
    if (!cleanId) return [];
    const st = this._loadState();
    const list = st.notifications[cleanId];
    if (!Array.isArray(list)) return [];
    return list
      .filter((n) => n && !n.dismissedAt)
      .map((n) => ({
        id: n.id,
        warningId: n.warningId,
        type: n.type,
        ruleCode: n.ruleCode,
        ruleTitleTr: n.ruleTitleTr,
        ruleTitleEn: n.ruleTitleEn,
        reason: n.reason,
        pointsAdded: n.pointsAdded,
        totalPoints: n.totalPoints,
        tier: n.tier,
        sanctionKind: n.sanctionKind,
        sanctionDurationDays: n.sanctionDurationDays,
        sanctionLabelTr: n.sanctionLabelTr,
        sanctionLabelEn: n.sanctionLabelEn,
        sanctionExpiresAt: n.sanctionExpiresAt,
        createdAt: n.createdAt,
      }));
  }

  dismissNotification(memberId, notificationId, nowTs = Date.now()) {
    const cleanMemberId = String(memberId || '').trim();
    const cleanNotifId = String(notificationId || '').trim();
    if (!cleanMemberId || !cleanNotifId) return false;
    const st = this._loadState();
    const list = st.notifications[cleanMemberId];
    if (!Array.isArray(list)) return false;
    const target = list.find((n) => n && n.id === cleanNotifId);
    if (!target) return false;
    if (!target.dismissedAt) {
      target.dismissedAt = Number(nowTs) || Date.now();
      this._saveState();
    }
    return true;
  }

  // ==========================================================================
  // 5) HESAP SİLME TEMİZLİĞİ (Kişisel bağlantıları kaldır, kimliksiz denetim satırı bırak)
  // ==========================================================================

  purgePersonalLinksForDeletedMember(memberId, nowTs = Date.now()) {
    const cleanId = String(memberId || '').trim();
    if (!cleanId) return { removedRecords: 0, removedEvidence: 0 };
    const st = this._loadState();

    let removedRecords = 0;
    let removedEvidence = 0;
    for (const [id, rec] of Object.entries(st.records)) {
      if (!rec || rec.memberId !== cleanId) continue;
      if (rec.evidence && rec.evidence.fileName) {
        const p = path.join(this.evidenceDir, path.basename(rec.evidence.fileName));
        try {
          if (fs.existsSync(p)) {
            fs.unlinkSync(p);
            removedEvidence += 1;
          }
        } catch (_) {}
      }
      delete st.records[id];
      removedRecords += 1;
    }

    if (st.notifications[cleanId]) {
      delete st.notifications[cleanId];
    }
    this._saveState();

    // Mevcut denetim satırlarından bu üyeye ait kimlik bağlantısını temizle (satırlar kimliksiz olarak korunur)
    if (fs.existsSync(this.auditFile)) {
      try {
        const lines = fs.readFileSync(this.auditFile, 'utf8').split('\n').filter(Boolean);
        let scrubbed = false;
        const nextLines = lines.map((line) => {
          try {
            const obj = JSON.parse(line);
            if (obj && obj.targetMemberId === cleanId) {
              delete obj.targetMemberId;
              obj.targetAnonymized = true;
              scrubbed = true;
              return JSON.stringify(obj);
            }
          } catch (_) {}
          return line;
        });
        if (scrubbed) {
          const tmp = `${this.auditFile}.${process.pid}.tmp`;
          fs.writeFileSync(tmp, nextLines.length ? `${nextLines.join('\n')}\n` : '', {
            encoding: 'utf8',
            mode: 0o600,
          });
          fs.renameSync(tmp, this.auditFile);
        }
      } catch (_) {}
    }

    // Yalnızca kimlik içermeyen denetim satırı ekle
    this.appendAudit({
      actorId: 'system',
      action: 'member_warning_links_purged',
      nowTs,
    });

    return { removedRecords, removedEvidence };
  }

  // ==========================================================================
  // 6) GÜNLÜK SAKLAMA, OTOMATİK AF VE ASKI BİTİŞİ BAKIM İŞİ
  // ==========================================================================

  runMaintenance({ nowTs = Date.now(), memberStore = null, chatModStore = null } = {}) {
    const now = Number(nowTs) || Date.now();
    const recordRetentionMs = warningsConfig.getRecordRetentionDays() * DAY_MS;
    const evidenceRetentionMs = warningsConfig.getEvidenceRetentionDays() * DAY_MS;
    const auditRetentionMs = warningsConfig.getAuditRetentionDays() * DAY_MS;

    const stats = {
      pardonedMembers: 0,
      pardonedRecords: 0,
      liftedSuspensions: 0,
      purgedEvidenceFiles: 0,
      purgedRecords: 0,
      purgedAuditEntries: 0,
    };

    const st = this._loadState();

    // 1) Tüm ilgili üyeler için 30 günlük otomatik af ve süresi dolan askı kontrolü
    const memberIds = new Set();
    for (const r of Object.values(st.records)) {
      if (r && r.memberId) memberIds.add(r.memberId);
    }
    if (memberStore && typeof memberStore.listAllMembers === 'function') {
      for (const m of memberStore.listAllMembers()) {
        if (m && m.id) memberIds.add(m.id);
      }
    }

    for (const mid of memberIds) {
      const res = this.evaluateMemberState(mid, { nowTs: now, memberStore });
      if (res.pardonedCount > 0) {
        stats.pardonedMembers += 1;
        stats.pardonedRecords += res.pardonedCount;
      }
      if (res.suspensionLifted) {
        stats.liftedSuspensions += 1;
      }
    }

    // 2) Kanıt dosyası saklama süresi (varsayılan 6 ay = 180 gün) ve kayıt saklama süresi (12 ay = 365 gün)
    const evidenceCutoff = now - evidenceRetentionMs;
    const recordCutoff = now - recordRetentionMs;
    let stateDirty = false;

    const deleteEvidenceOnDisk = (fileName) => {
      if (!fileName) return false;
      const fullPath = path.join(this.evidenceDir, path.basename(fileName));
      try {
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          return true;
        }
      } catch (_) {}
      return false;
    };

    for (const [id, rec] of [...Object.entries(st.records)]) {
      if (!rec) continue;

      // Kanıt süresi dolduysa fiziksel dosyayı sil
      const evCreated = (rec.evidence && Number(rec.evidence.createdAt)) || Number(rec.createdAt) || 0;
      if ((rec.evidence || rec.evidenceUrl) && evCreated > 0 && evCreated <= evidenceCutoff) {
        if (rec.evidence && rec.evidence.fileName) {
          if (deleteEvidenceOnDisk(rec.evidence.fileName)) {
            stats.purgedEvidenceFiles += 1;
          }
        }
        rec.evidence = null;
        rec.evidenceUrl = null;
        stateDirty = true;
      }

      // Kayıt süresi dolduysa kaydı kalıcı sil
      let lifecycleEndedAt = null;
      if (rec.cancelled && rec.cancelledAt) {
        lifecycleEndedAt = Number(rec.cancelledAt);
      } else if (rec.sanctionKind === 'permanent_ban') {
        lifecycleEndedAt = null; // Aktif kalıcı yasak süresi dolmaz (yalnızca iptalle kalkar)
      } else if (rec.pardonedAt) {
        lifecycleEndedAt = Number(rec.pardonedAt);
      } else if ((Number(rec.pointsAdded) || 0) === 0) {
        lifecycleEndedAt = Number(rec.sanctionExpiresAt) || Number(rec.createdAt) || 0;
      }

      if (lifecycleEndedAt && lifecycleEndedAt <= recordCutoff) {
        if (rec.evidence && rec.evidence.fileName) {
          if (deleteEvidenceOnDisk(rec.evidence.fileName)) {
            stats.purgedEvidenceFiles += 1;
          }
        }
        delete st.records[id];
        stats.purgedRecords += 1;
        stateDirty = true;
      }
    }

    // 3) Kapatılmış eski bildirimleri temizle
    for (const [mid, list] of Object.entries(st.notifications)) {
      if (!Array.isArray(list)) continue;
      const filtered = list.filter((n) => {
        if (!n) return false;
        if (!n.dismissedAt) return true;
        return Number(n.dismissedAt) > recordCutoff;
      });
      if (filtered.length !== list.length) {
        st.notifications[mid] = filtered;
        stateDirty = true;
      }
    }

    if (stateDirty) {
      this._saveState();
    }

    // 4) Denetim kaydı (audit.jsonl) 12 ay temizliği
    const auditCutoff = now - auditRetentionMs;
    if (fs.existsSync(this.auditFile)) {
      try {
        const lines = fs.readFileSync(this.auditFile, 'utf8').split('\n').filter(Boolean);
        const kept = [];
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj && Number(obj.ts) > auditCutoff) kept.push(line);
            else stats.purgedAuditEntries += 1;
          } catch (_) {
            stats.purgedAuditEntries += 1;
          }
        }
        if (stats.purgedAuditEntries > 0) {
          const tmp = `${this.auditFile}.${process.pid}.tmp`;
          fs.writeFileSync(tmp, kept.length ? `${kept.join('\n')}\n` : '', {
            encoding: 'utf8',
            mode: 0o600,
          });
          fs.renameSync(tmp, this.auditFile);
        }
      } catch (_) {}
    }

    // 5) Varsa chatModStore süresi dolan yaptırımlar da normal temizlikte çalışır (burada sadece istatistik döneriz)
    void chatModStore;
    return stats;
  }

  /**
   * Açılışta eksik kontrol + günlük (her 6 saatte bir güvenli aralıkla) otomatik bakım döngüsü başlatır.
   */
  startMaintenanceScheduler({ memberStore, chatModStore = null, intervalMs = 6 * 60 * 60 * 1000 } = {}) {
    if (this._maintenanceTimer) return;
    try {
      this.runMaintenance({ nowTs: Date.now(), memberStore, chatModStore });
    } catch (_) {}

    this._maintenanceTimer = setInterval(() => {
      try {
        this.runMaintenance({ nowTs: Date.now(), memberStore, chatModStore });
      } catch (_) {}
    }, intervalMs);
    if (this._maintenanceTimer.unref) {
      this._maintenanceTimer.unref();
    }
  }

  stopMaintenanceScheduler() {
    if (this._maintenanceTimer) {
      clearInterval(this._maintenanceTimer);
      this._maintenanceTimer = null;
    }
  }

  flush() {
    if (this._state) {
      try {
        this._saveState();
      } catch (_) {}
    }
  }
}

let singletonSiteWarningStore = null;

function getSiteWarningStore(options) {
  if (options && options.baseDir) {
    return new SiteWarningStore(options);
  }
  if (!singletonSiteWarningStore) {
    singletonSiteWarningStore = new SiteWarningStore();
  }
  return singletonSiteWarningStore;
}

function setDefaultSiteWarningStore(instance) {
  singletonSiteWarningStore = instance || null;
}

function resetSiteWarningStoreForTests() {
  if (singletonSiteWarningStore) {
    singletonSiteWarningStore.stopMaintenanceScheduler();
  }
  singletonSiteWarningStore = null;
}

module.exports = {
  SiteWarningStore,
  EVIDENCE_FILENAME_RE,
  resolveDefaultWarningsDir,
  getSiteWarningStore,
  setDefaultSiteWarningStore,
  resetSiteWarningStoreForTests,
};
