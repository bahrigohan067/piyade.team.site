const express = require('express');
const router = express.Router();

const appConfig = require('../config/app.config');
const chatConfig = require('../config/chat.config');
const { isCommunityOfficial, isDeveloper } = require('../config/roles.config');
const botApiClient = require('../services/botApiClient');
const { getChatStore } = require('../services/chatStore');
const { getChatModStore, MUTE_DURATIONS_MS } = require('../services/chatModStore');
const { chatSseHub } = require('../services/chatSseHub');
const { requireFreshCommunityOfficial, requireFreshModAuditViewer } = require('../middlewares/auth');
const { chatModLimiter } = require('../middlewares/rateLimiter');
const chatRoutes = require('./chat');

/**
 * TASARIM İLKESİ (DEĞİŞTİRİLEMEZ):
 * - Bu yönlendiricide sohbet listesi gezme, kullanıcı adıyla sohbet arama veya
 *   "tüm sohbetleri izle" uç noktası KESİNLİKLE YOKTUR.
 * - Community Official rolü yalnızca rapor veya otomatik filtre nedeniyle açılan
 *   vakalardaki kopyalanmış anlık görüntülere erişebilir.
 */

// 1) CHAT_ENABLED kapalıysa 404; her istekte noindex ve Feedback Pill kapalı
router.use((req, res, next) => {
  if (!appConfig.isChatEnabled()) {
    return next('router');
  }
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.locals.disableFeedbackPill = true;
  if (req && typeof req.applySeo === 'function') {
    req.applySeo({ noindex: true, isPublic: false });
  }
  return next();
});

router.use(chatModLimiter);

// Parça 3 dosya sunumuna taze rollü vaka bazlı yetki kancası
chatRoutes.setModFileAccessAuthorizer(async (req, fileId, caseId) => {
  const actorId = req.session && req.session.user && String(req.session.user.id);
  if (!actorId || !caseId) return false;
  try {
    const fresh = await botApiClient.getMemberRoles(actorId);
    const allowed =
      isCommunityOfficial(fresh.roles) ||
      (chatConfig.isModPanelAlsoDeveloper() && isDeveloper(fresh.roles, fresh.level));
    if (!allowed) return false;
    const modStore = getChatModStore(getChatStore());
    return modStore.isFileInCaseForMod(caseId, fileId, actorId);
  } catch (_) {
    return false;
  }
});

// ============================================================================
// SAYFALAR: /sohbet/moderasyon (Community Official) & /sohbet/moderasyon/denetim (Developer + CO)
// ============================================================================

router.get('/', requireFreshCommunityOfficial, (req, res) => {
  return res.render('pages/chat-mod', {
    title: req.t('chatMod.pageTitle'),
    isChatModPage: true,
    auditOnly: false,
    modPolicyDays: {
      closedRetention: chatConfig.MODERATION.CLOSED_CASE_RETENTION_DAYS,
      openMaxDays: chatConfig.MODERATION.OPEN_CASE_MAX_DAYS,
      sanctionDays: chatConfig.MODERATION.SANCTION_RETENTION_DAYS,
    },
  });
});

router.get('/denetim', requireFreshModAuditViewer, (req, res) => {
  return res.render('pages/chat-mod', {
    title: req.t('chatMod.auditPageTitle'),
    isChatModPage: true,
    auditOnly: Boolean(req.modAuditReadOnly),
    modPolicyDays: {
      closedRetention: chatConfig.MODERATION.CLOSED_CASE_RETENTION_DAYS,
      openMaxDays: chatConfig.MODERATION.OPEN_CASE_MAX_DAYS,
      sanctionDays: chatConfig.MODERATION.SANCTION_RETENTION_DAYS,
    },
  });
});

// ============================================================================
// VAKA LİSTESİ VE VAKA DETAYI (Yalnızca Community Official — Taze Rol)
// ============================================================================

router.get('/api/vakalar', requireFreshCommunityOfficial, async (req, res) => {
  const chatStore = getChatStore();
  const modStore = getChatModStore(chatStore);
  const modId = String(req.session.user.id);

  const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  const priority = typeof req.query.priority === 'string' ? req.query.priority.trim() : '';
  const source = typeof req.query.source === 'string' ? req.query.source.trim() : '';
  const page = Number.parseInt(String(req.query.page || '1'), 10) || 1;
  const limit = Number.parseInt(String(req.query.limit || '20'), 10) || 20;

  const listed = modStore.listCases({ modUserId: modId, status, priority, source, page, limit });

  // İsim çözümleme (sadece vaka tarafları için Discord adı)
  const ids = [];
  for (const c of listed.items) {
    if (c.reportedUserId) ids.push(c.reportedUserId);
    if (c.reporterId) ids.push(c.reporterId);
  }
  let nameMap = new Map();
  if (ids.length > 0) {
    try {
      const lookup = await botApiClient.lookupDirectoryMembers(modId, ids);
      nameMap = lookup.byId;
    } catch (_) {}
  }

  const enriched = listed.items.map((c) => ({
    ...c,
    reportedUserName: (nameMap.get(c.reportedUserId) && nameMap.get(c.reportedUserId).displayName) || c.reportedUserId,
    reporterName: c.reporterId
      ? (nameMap.get(c.reporterId) && nameMap.get(c.reporterId).displayName) || c.reporterId
      : null,
  }));

  return res.json({
    ok: true,
    items: enriched,
    total: listed.total,
    page: listed.page,
    totalPages: listed.totalPages,
  });
});

router.get('/api/vaka/:caseId', requireFreshCommunityOfficial, async (req, res) => {
  const chatStore = getChatStore();
  const modStore = getChatModStore(chatStore);
  const modId = String(req.session.user.id);
  const modName = req.session.user.displayName || req.session.user.username || modId;
  const caseId = String(req.params.caseId || '').trim();

  const opened = modStore.openCaseForReview(caseId, { modId, modName });
  if (!opened.ok) {
    const errMsg =
      opened.code === 'CONFLICT_OF_INTEREST'
        ? req.t('chatMod.errConflict')
        : opened.code === 'CASE_LOCKED'
          ? req.t('chatMod.errCaseLocked')
          : req.t('chatMod.errCaseNotFound');
    return res.status(opened.status || 404).json({
      ok: false,
      code: opened.code,
      lockedByName: opened.lockedByName || null,
      lockedUntil: opened.lockedUntil || null,
      error: errMsg,
    });
  }

  const c = opened.caseMeta;
  const participantIds = [...new Set([...(c.participants || []), c.reporterId, c.reportedUserId].filter(Boolean))];
  let nameMap = new Map();
  if (participantIds.length > 0) {
    try {
      const lookup = await botApiClient.lookupDirectoryMembers(modId, participantIds);
      nameMap = lookup.byId;
    } catch (_) {}
  }

  const names = {};
  for (const pid of participantIds) {
    names[pid] = (nameMap.get(pid) && nameMap.get(pid).displayName) || pid;
  }

  const snapshotMessages =
    opened.snapshot && Array.isArray(opened.snapshot.messages)
      ? opened.snapshot.messages.map((m) => ({
          id: m.id,
          from: m.from,
          fromName: names[m.from] || m.from,
          ts: m.ts,
          text: m.text || '',
          deleted: Boolean(m.deleted),
          modRemoved: Boolean(m.modRemoved),
          isTarget: Boolean(c.targetMsgId && m.id === c.targetMsgId),
          attachments: (Array.isArray(m.attachments) ? m.attachments : []).map((att) => ({
            id: att.id,
            originalName: att.originalName,
            ext: att.ext,
            mimeType: att.mimeType,
            category: att.category,
            size: att.size,
            previewUrl: `/sohbet/dosya/${att.id}?caseId=${encodeURIComponent(c.id)}`,
          })),
        }))
      : [];

  return res.json({
    ok: true,
    case: {
      ...c,
      participantNames: names,
      reportedUserName: names[c.reportedUserId] || c.reportedUserId,
      reporterName: c.reporterId ? names[c.reporterId] || c.reporterId : null,
    },
    messages: snapshotMessages,
    highVolumeAccess: Boolean(opened.highVolumeAccess),
  });
});

// ============================================================================
// VAKA EYLEMLERİ (Kaldır / Sustur / Yasakla / Uyarı Notu / Kapat)
// ============================================================================

async function isTargetProtectedOfficial(targetUserId) {
  try {
    const rolesData = await botApiClient.getMemberRoles(targetUserId);
    return isCommunityOfficial(rolesData.roles || []);
  } catch (_) {
    return false;
  }
}

router.post('/api/vaka/:caseId/eylem', requireFreshCommunityOfficial, async (req, res) => {
  const chatStore = getChatStore();
  const modStore = getChatModStore(chatStore);
  const modId = String(req.session.user.id);
  const modName = req.session.user.displayName || req.session.user.username || modId;
  const caseId = String(req.params.caseId || '').trim();
  const body = req.body && typeof req.body === 'object' ? req.body : {};

  const action = String(body.action || '').trim();
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : '';
  const actionKey = typeof body.actionKey === 'string' ? body.actionKey.trim().slice(0, 80) : '';

  if (note.length < 3) {
    return res.status(400).json({
      ok: false,
      code: 'NOTE_REQUIRED',
      error: req.t('chatMod.errNoteRequired'),
    });
  }

  const caseMeta = modStore.getCaseMeta(caseId);
  if (!caseMeta) {
    return res.status(404).json({ ok: false, code: 'CASE_NOT_FOUND', error: req.t('chatMod.errCaseNotFound') });
  }
  if (modStore.isConflictOfInterest(caseMeta, modId)) {
    return res.status(403).json({ ok: false, code: 'CONFLICT_OF_INTEREST', error: req.t('chatMod.errConflict') });
  }
  if (caseMeta.status === 'closed') {
    return res.status(409).json({ ok: false, code: 'CASE_ALREADY_CLOSED', error: req.t('chatMod.errCaseClosed') });
  }
  if (caseMeta.lockedBy && caseMeta.lockedBy !== modId && caseMeta.lockedUntil > Date.now()) {
    return res.status(409).json({ ok: false, code: 'CASE_LOCKED', error: req.t('chatMod.errCaseLocked') });
  }

  if (actionKey && !modStore.checkAndConsumeActionKey(`${caseId}:${actionKey}`)) {
    return res.status(200).json({ ok: true, duplicate: true, case: caseMeta });
  }

  const targetUserId = String(body.targetUserId || caseMeta.reportedUserId || '').trim();

  // Yaptırım içeren eylemlerde kendine veya başka Community Official'a işlem yapılamaz
  if (action === 'mute' || action === 'ban' || action === 'warn_note') {
    if (targetUserId === modId || (await isTargetProtectedOfficial(targetUserId))) {
      return res.status(403).json({
        ok: false,
        code: 'CANNOT_SANCTION_OFFICIAL',
        error: req.t('chatMod.errCannotSanctionOfficial'),
      });
    }
  }

  try {
    if (action === 'remove_message') {
      const msgId = String(body.msgId || caseMeta.targetMsgId || '').trim();
      if (!msgId) {
        return res.status(400).json({ ok: false, code: 'MSG_ID_REQUIRED', error: 'Kaldırılacak mesaj seçilmedi.' });
      }
      const del = chatStore.deleteMessage(caseMeta.convId, msgId, { by: modId, modRemoved: true });
      if (del.ok) {
        const payload = { convId: caseMeta.convId, msgId, modRemoved: true };
        for (const pid of caseMeta.participants || []) {
          chatSseHub.sendToUser(pid, 'deleted', payload);
          chatSseHub.sendToUser(pid, 'unread', { unread: chatStore.getTotalUnreadCount(pid) });
        }
      }
      modStore.appendAuditLog({
        modId,
        modName,
        caseId,
        action: 'remove_message',
        category: caseMeta.category,
        targetId: targetUserId,
        note,
      });
      modStore.recordCaseAction(caseId, { action: 'remove_message', msgId, modId, note });
      return res.json({ ok: true, action: 'remove_message', msgId });
    }

    if (action === 'mute') {
      const durationKey = String(body.duration || '24h').trim();
      if (!MUTE_DURATIONS_MS[durationKey]) {
        return res.status(400).json({ ok: false, code: 'INVALID_DURATION', error: 'Geçersiz susturma süresi.' });
      }
      const sanction = modStore.applySanction({
        userId: targetUserId,
        type: 'mute',
        durationKey,
        reasonCategory: caseMeta.category,
        note,
        modId,
        modName,
        caseId,
      });
      modStore.recordCaseAction(caseId, { action: 'mute', durationKey, targetUserId, sanctionId: sanction.id, modId, note });
      chatSseHub.sendToUser(targetUserId, 'sanction', { sanction });
      return res.json({ ok: true, action: 'mute', sanction });
    }

    if (action === 'ban') {
      const sanction = modStore.applySanction({
        userId: targetUserId,
        type: 'ban',
        reasonCategory: caseMeta.category,
        note,
        modId,
        modName,
        caseId,
      });
      modStore.recordCaseAction(caseId, { action: 'ban', targetUserId, sanctionId: sanction.id, modId, note });
      chatSseHub.sendToUser(targetUserId, 'sanction', { sanction });
      return res.json({ ok: true, action: 'ban', sanction });
    }

    if (action === 'warn_note') {
      const warnText = typeof body.warningText === 'string' && body.warningText.trim()
        ? body.warningText.trim().slice(0, 400)
        : req.t('chatMod.defaultWarningText');
      const sysMsg = chatStore.appendMessage(caseMeta.convId, {
        from: 'system',
        text: `🛡️ ${warnText}`,
        system: true,
        systemType: 'mod_warning',
      });
      modStore.addUserNotice(targetUserId, {
        type: 'mod_warning',
        category: caseMeta.category,
        text: warnText,
        ts: Date.now(),
      });
      modStore.appendAuditLog({
        modId,
        modName,
        caseId,
        action: 'warn_note',
        category: caseMeta.category,
        targetId: targetUserId,
        note,
      });
      modStore.recordCaseAction(caseId, { action: 'warn_note', targetUserId, modId, note });
      for (const pid of caseMeta.participants || []) {
        chatSseHub.sendToUser(pid, 'message', {
          convId: caseMeta.convId,
          otherId: caseMeta.participants.find((x) => x !== pid),
          message: sysMsg.message,
        });
      }
      return res.json({ ok: true, action: 'warn_note' });
    }

    if (action === 'close') {
      const allowedRes = ['action_taken', 'no_violation', 'false_report'];
      const resolution = allowedRes.includes(body.resolution) ? body.resolution : 'action_taken';
      const closed = modStore.closeCase(caseId, { modId, modName, resolution, note });
      if (!closed.ok) {
        return res.status(closed.status || 400).json({ ok: false, code: closed.code });
      }
      if (caseMeta.source === 'report' && caseMeta.reporterId) {
        chatSseHub.sendToUser(caseMeta.reporterId, 'report_update', {
          outcome: resolution === 'action_taken' ? 'action_taken' : 'no_action',
        });
      }
      return res.json({ ok: true, action: 'close', case: closed.caseMeta });
    }

    return res.status(400).json({ ok: false, code: 'INVALID_ACTION', error: 'Geçersiz moderasyon eylemi.' });
  } catch (err) {
    return res.status(400).json({ ok: false, code: err.code || 'ACTION_FAILED', error: err.message });
  }
});

// ============================================================================
// YAPTIRIMLAR LİSTESİ VE YAPTIRIM KALDIRMA
// ============================================================================

router.get('/api/yaptirimlar', requireFreshCommunityOfficial, async (req, res) => {
  const modStore = getChatModStore(getChatStore());
  const modId = String(req.session.user.id);
  const activeOnly = req.query.active === '1';
  const list = modStore.listSanctions({ activeOnly });
  const ids = [...new Set(list.map((s) => s.userId).filter(Boolean))];
  let nameMap = new Map();
  if (ids.length > 0) {
    try {
      const lookup = await botApiClient.lookupDirectoryMembers(modId, ids);
      nameMap = lookup.byId;
    } catch (_) {}
  }
  return res.json({
    ok: true,
    items: list.map((s) => ({
      ...s,
      userName: (nameMap.get(s.userId) && nameMap.get(s.userId).displayName) || s.userId,
    })),
  });
});

router.post('/api/yaptirim/:sanctionId/kaldir', requireFreshCommunityOfficial, (req, res) => {
  const modStore = getChatModStore(getChatStore());
  const modId = String(req.session.user.id);
  const modName = req.session.user.displayName || req.session.user.username || modId;
  const sanctionId = String(req.params.sanctionId || '').trim();
  const note = typeof (req.body && req.body.note) === 'string' ? req.body.note.trim().slice(0, 300) : '';
  if (note.length < 3) {
    return res.status(400).json({ ok: false, code: 'NOTE_REQUIRED', error: req.t('chatMod.errNoteRequired') });
  }
  const lifted = modStore.liftSanction(sanctionId, { modId, modName, note });
  if (!lifted.ok) {
    return res.status(lifted.status || 404).json({ ok: false, code: lifted.code });
  }
  chatSseHub.sendToUser(lifted.sanction.userId, 'sanction', { sanction: null });
  return res.json({ ok: true, sanction: lifted.sanction });
});

// ============================================================================
// DENETİM KAYDI (Community Official + Salt Okunur Developer)
// ============================================================================

router.get('/api/denetim', requireFreshModAuditViewer, (req, res) => {
  const modStore = getChatModStore(getChatStore());
  const page = Number.parseInt(String(req.query.page || '1'), 10) || 1;
  const limit = Number.parseInt(String(req.query.limit || '100'), 10) || 100;
  const result = modStore.readAuditLogs({ page, limit });
  return res.json({
    ok: true,
    readOnly: Boolean(req.modAuditReadOnly),
    ...result,
  });
});

module.exports = router;
