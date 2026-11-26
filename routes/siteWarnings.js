const fs = require('fs');
const express = require('express');
const multer = require('multer');
const router = express.Router();

const warningsConfig = require('../config/warnings.config');
const { getLocalizedRules } = require('../rules');
const { getMemberStore, toUnifiedGoogleId } = require('../services/memberStore');
const { getSiteWarningStore } = require('../services/siteWarningStore');
const { getChatStore } = require('../services/chatStore');
const { getChatModStore } = require('../services/chatModStore');
const { chatSseHub } = require('../services/chatSseHub');
const {
  isGoogleSession,
  requireFreshManagement,
} = require('../middlewares/auth');
const { verifyCsrfToken, verifyCsrfRequest } = require('../middlewares/csrf');
const { formActionLimiter } = require('../middlewares/rateLimiter');
const { generateIdempotencyKey, consumeIdempotencyKey } = require('../middlewares/idempotency');
const { MAX_EVIDENCE_BYTES } = require('../utils/fileValidator');

const uploadSiteEvidence = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_EVIDENCE_BYTES, // 5 MB
    files: 1,
  },
});

function wantsJson(req) {
  return Boolean(
    req.xhr ||
      req.get('X-Requested-With') === 'XMLHttpRequest' ||
      (req.headers.accept && req.headers.accept.includes('application/json')) ||
      req.path.includes('/api/')
  );
}

function markPrivate(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
}

/**
 * Site uyarı yönetim uçları için sıkı yetki kapısı:
 * - Girişsiz JSON isteğine 401, sayfa isteğine Discord giriş yönlendirmesi
 * - Google oturumlarına ve Developer/Yönetmenlik dışındaki herkese 403
 * - Her istekte Bot API'den TAZE rol doğrulaması (requireFreshManagement)
 */
function requireFreshSiteWarnAuthority(req, res, next) {
  markPrivate(req, res);
  if (!req.session || !req.session.user || !req.session.user.id) {
    if (wantsJson(req) || req.path.includes('/kanit/')) {
      return res.status(401).json({
        ok: false,
        code: 'AUTH_REQUIRED',
        error: req.t ? req.t('errors.403DefaultMsg') : 'Oturum açmanız gerekiyor.',
      });
    }
  }
  return requireFreshManagement(req, res, next);
}

function handleSiteEvidenceUpload(req, res, next) {
  uploadSiteEvidence.single('evidenceFile')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        req.fileUploadError = req.t('errors.fileTooLarge');
      } else {
        req.fileUploadError = err.message || req.t('errors.invalidFileType');
      }
    }
    return next();
  });
}

function getSafeChatModStore() {
  try {
    return getChatModStore(getChatStore());
  } catch (_) {
    return null;
  }
}

function serializeAdminMemberItem(member, summary) {
  const games = Array.isArray(member.games)
    ? member.games.map((g) => ({
        id: g.id,
        username: g.username,
        ...(g.robloxId ? { robloxId: String(g.robloxId) } : {}),
      }))
    : [];
  const rbGame = games.find((g) => g.id === 'roblox') || null;
  return {
    id: member.id,
    unifiedId: toUnifiedGoogleId(member.id),
    nickname: member.nickname || '',
    displayName: member.displayName || member.nickname || member.id,
    robloxUsername: rbGame ? rbGame.username : null,
    games,
    status: member.status || 'active',
    statusExpiresAt: member.statusExpiresAt || null,
    statusReason: member.statusReason || '',
    createdAt: member.createdAt || null,
    totalPoints: summary ? summary.totalPoints : 0,
    tier: summary ? summary.tier : 0,
    tierLabel: summary ? summary.tierLabel : '',
    activeSanction: summary ? summary.activeSanction : null,
  };
}

// ============================================================================
// 1) ÜYE BİLDİRİM UÇLARI (Yalnızca Google Oturumu — Aktif veya Askıda)
// ============================================================================

router.get('/api/uyari-bildirimleri', (req, res) => {
  markPrivate(req, res);
  if (!isGoogleSession(req)) {
    return res.status(401).json({ ok: false, code: 'GOOGLE_SESSION_REQUIRED', notices: [] });
  }
  const memberId =
    (req.session.identity && req.session.identity.memberId) ||
    (req.session.user && req.session.user.memberId);
  if (!memberId) {
    return res.status(401).json({ ok: false, code: 'GOOGLE_SESSION_REQUIRED', notices: [] });
  }
  const notices = getSiteWarningStore().getUnreadNotifications(memberId);
  return res.json({ ok: true, notices });
});

router.post('/api/uyari-bildirimleri/:noticeId/kapat', verifyCsrfRequest, (req, res) => {
  markPrivate(req, res);
  if (!isGoogleSession(req)) {
    return res.status(401).json({ ok: false, code: 'GOOGLE_SESSION_REQUIRED' });
  }
  const memberId =
    (req.session.identity && req.session.identity.memberId) ||
    (req.session.user && req.session.user.memberId);
  if (!memberId) {
    return res.status(401).json({ ok: false, code: 'GOOGLE_SESSION_REQUIRED' });
  }
  const dismissed = getSiteWarningStore().dismissNotification(memberId, req.params.noticeId);
  if (!dismissed) {
    return res.status(404).json({ ok: false, code: 'NOTICE_NOT_FOUND' });
  }
  return res.json({ ok: true, dismissed: true });
});

router.get('/api/uyari-bildirimleri/akis', (req, res) => {
  markPrivate(req, res);
  if (!isGoogleSession(req)) {
    return res.status(401).json({ ok: false, code: 'GOOGLE_SESSION_REQUIRED' });
  }
  const memberId =
    (req.session.identity && req.session.identity.memberId) ||
    (req.session.user && req.session.user.memberId);
  const unifiedId = toUnifiedGoogleId(memberId);
  if (!unifiedId) {
    return res.status(401).json({ ok: false, code: 'GOOGLE_SESSION_REQUIRED' });
  }
  chatSseHub.subscribe(unifiedId, req, res, { initialUnread: 0 });
  return undefined;
});

// ============================================================================
// 2) YÖNETİM UÇLARI: YALNIZCA TAZE DOĞRULANMIŞ DEVELOPER / YÖNETMENLİK (DİSCORD)
// ============================================================================

/**
 * GET /yonetim/site-uyari/api/uyeler?q=...
 * Yalnızca memberStore içindeki Google (site) üyelerini arar; Discord üyesi ASLA çıkmaz.
 */
router.get('/yonetim/site-uyari/api/uyeler', requireFreshSiteWarnAuthority, (req, res) => {
  const q = String(req.query.q || '')
    .trim()
    .toLocaleLowerCase('tr-TR');
  const lang = req.lang === 'en' ? 'en' : 'tr';
  const memberStore = getMemberStore();
  const warningStore = getSiteWarningStore();
  const chatModStore = getSafeChatModStore();

  const allMembers = memberStore.listAllMembers();
  const filtered = allMembers.filter((m) => {
    if (!q) return true;
    const fields = [
      m.id,
      toUnifiedGoogleId(m.id) || '',
      m.nickname || '',
      m.displayName || '',
      m.googleName || '',
      ...(Array.isArray(m.games) ? m.games.map((g) => (g && g.username) || '') : []),
    ];
    return fields.some((f) => String(f).toLocaleLowerCase('tr-TR').includes(q));
  });

  filtered.sort((a, b) =>
    String(a.displayName || a.nickname || '').localeCompare(
      String(b.displayName || b.nickname || ''),
      'tr'
    )
  );

  const members = filtered.slice(0, 20).map((m) => {
    const summary = warningStore.getMemberSummary(m.id, {
      memberStore,
      chatModStore,
      lang,
      limit: 1,
    });
    return serializeAdminMemberItem(m, summary);
  });

  return res.json({ ok: true, members, total: filtered.length });
});

/**
 * GET /yonetim/site-uyari/api/uye/:memberId/sicil
 * Seçili Google üyesinin toplam puanı, kademesi, aktif yaptırımı ve son 10 kaydını döndürür.
 */
router.get('/yonetim/site-uyari/api/uye/:memberId/sicil', requireFreshSiteWarnAuthority, (req, res) => {
  const memberId = String(req.params.memberId || '').trim();
  const lang = req.lang === 'en' ? 'en' : 'tr';
  const memberStore = getMemberStore();
  const warningStore = getSiteWarningStore();
  const chatModStore = getSafeChatModStore();

  const member = memberStore.findById(memberId);
  if (!member) {
    return res.status(404).json({ ok: false, code: 'MEMBER_NOT_FOUND', error: req.t('siteWarn.errMemberNotFound') });
  }

  const summary = warningStore.getMemberSummary(memberId, {
    memberStore,
    chatModStore,
    lang,
    limit: warningsConfig.RETENTION.PREVIEW_HISTORY_LIMIT,
  });

  const records = summary.recentRecords.map((r) => ({
    id: r.id,
    type: r.type,
    ruleCode: r.ruleCode,
    ruleTitle: lang === 'en' ? r.ruleTitleEn || r.ruleTitleTr || '' : r.ruleTitleTr || '',
    reason: r.reason || '',
    pointsAdded: r.pointsAdded || 0,
    newPoints: r.newPoints || 0,
    newTier: r.newTier || 0,
    sanctionKind: r.sanctionKind || 'none',
    sanctionLabel: lang === 'en' ? r.sanctionLabelEn || r.sanctionLabelTr || '' : r.sanctionLabelTr || '',
    sanctionExpiresAt: r.sanctionExpiresAt || null,
    evidenceFileUrl:
      r.evidence && r.evidence.fileName
        ? `/yonetim/site-uyari/kanit/${encodeURIComponent(r.evidence.fileName)}`
        : null,
    evidenceUrl: r.evidenceUrl || null,
    actorName: r.actorName || r.actorId || '',
    createdAt: r.createdAt,
    pardonedAt: r.pardonedAt || null,
    cancelled: Boolean(r.cancelled),
    cancelledAt: r.cancelledAt || null,
    cancelledByName: r.cancelledByName || r.cancelledBy || null,
    cancelReason: r.cancelReason || null,
  }));

  return res.json({
    ok: true,
    member: serializeAdminMemberItem(member, summary),
    summary: {
      totalPoints: summary.totalPoints,
      tier: summary.tier,
      tierLabel: summary.tierLabel,
      status: summary.status,
      statusExpiresAt: summary.statusExpiresAt,
      amnestyAt: summary.amnestyAt,
      activeSanction: summary.activeSanction,
      totalRecordsCount: summary.totalRecordsCount,
    },
    records,
  });
});

/**
 * POST /yonetim/site-uyari
 * Site (Google) üyesine resmi (M/D) veya sözlü uyarı verir; kanıt dosyasını magic-byte ile doğrular.
 * Çift gönderim kilidi (idempotency), Orbital Loader XHR uyumu ve PRG akışını destekler.
 */
router.post(
  '/yonetim/site-uyari',
  requireFreshSiteWarnAuthority,
  formActionLimiter,
  handleSiteEvidenceUpload,
  verifyCsrfToken,
  (req, res) => {
    const lang = req.lang === 'en' ? 'en' : 'tr';
    const isAjax = wantsJson(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const targetMemberId = String(body.siteTargetMemberId || body.memberId || '').trim();
    const warnType = String(body.siteWarnType || body.type || 'official').trim();
    const ruleCode = String(body.siteRuleCode || body.ruleCode || '').trim();
    const reason = String(body.siteWarnReason || body.reason || '').trim();
    const evidenceUrlInput = String(body.siteEvidenceUrlInput || body.evidenceUrlInput || '').trim();

    const respondError = (status, errorMessage) => {
      const nextKey = generateIdempotencyKey(req);
      if (isAjax) {
        return res.status(status).json({
          ok: false,
          error: errorMessage,
          nextIdempotencyKey: nextKey,
        });
      }
      return res.status(status).render('pages/admin-warn', {
        title: req.t('adminWarn.pageTitle'),
        isAdminWarnPage: true,
        rules: getLocalizedRules(lang),
        preselectedMember: null,
        targetId: '',
        result: null,
        error: null,
        idempotencyKey: generateIdempotencyKey(req),
        siteRules: warningsConfig.getSiteRulesMap(lang),
        siteIdempotencyKey: nextKey,
        siteTargetId: targetMemberId,
        sitePreselectedMember: null,
        siteResult: null,
        siteError: errorMessage,
      });
    };

    // Tek kullanımlık idempotency anahtarı (çift gönderim engeli)
    const idemCheck = consumeIdempotencyKey(req);
    if (!idemCheck.valid) {
      return respondError(409, req.t('errors.duplicateSubmission'));
    }

    if (req.fileUploadError) {
      return respondError(400, req.fileUploadError);
    }

    if (!targetMemberId) {
      return respondError(400, req.t('siteWarn.errSelectMember'));
    }

    // Ek güvenlik: Discord ID formatı gelirse reddet (yalnızca memberStore Google üyesi)
    const memberStore = getMemberStore();
    const targetMember = memberStore.findById(targetMemberId);
    if (!targetMember) {
      return respondError(404, req.t('siteWarn.errMemberNotFound'));
    }

    const actor = req.session.user;
    const warningStore = getSiteWarningStore();
    const chatModStore = getSafeChatModStore();

    try {
      const out = warningStore.issueWarning({
        memberId: targetMember.id,
        type: warnType === 'verbal' ? 'verbal' : 'official',
        ruleCode: warnType === 'verbal' ? null : ruleCode,
        reason,
        evidenceBuffer: req.file ? req.file.buffer : null,
        evidenceMime: req.file ? req.file.mimetype : '',
        evidenceOrigName: req.file ? req.file.originalname : '',
        evidenceUrl: evidenceUrlInput || null,
        actorId: String(actor.id),
        actorName: actor.displayName || actor.username || String(actor.id),
        memberStore,
        chatModStore,
        sseHub: chatSseHub,
      });

      const rec = out.record;
      const flashPayload = {
        success: true,
        action: 'issued',
        warnId: rec.id,
        memberId: targetMember.id,
        memberDisplayName: targetMember.displayName || targetMember.nickname,
        type: rec.type,
        ruleCode: rec.ruleCode,
        ruleTitle: lang === 'en' ? rec.ruleTitleEn || rec.ruleTitleTr || '' : rec.ruleTitleTr || '',
        pointsAdded: rec.pointsAdded,
        totalPoints: out.summary.totalPoints,
        tier: out.summary.tier,
        tierLabel: lang === 'en' ? out.summary.tierLabelEn : out.summary.tierLabelTr,
        sanctionLabel: lang === 'en' ? rec.sanctionLabelEn : rec.sanctionLabelTr,
        evidenceFileUrl:
          rec.evidence && rec.evidence.fileName
            ? `/yonetim/site-uyari/kanit/${encodeURIComponent(rec.evidence.fileName)}`
            : null,
        evidenceUrl: rec.evidenceUrl || null,
      };

      req.session.siteWarnFlashResult = flashPayload;
      const redirectUrl = `/yonetim/uyari?siteTargetId=${encodeURIComponent(targetMember.id)}#site-uyari-paneli`;

      return req.session.save(() => {
        if (isAjax) {
          return res.status(200).json({
            ok: true,
            warnId: rec.id,
            record: flashPayload,
            summary: out.summary,
            redirectUrl,
          });
        }
        return res.redirect(303, redirectUrl);
      });
    } catch (err) {
      const msg = err && err.errorKey ? req.t(err.errorKey) : (err && err.message) || req.t('siteWarn.errGeneric');
      return respondError((err && err.statusCode) || 400, msg);
    }
  }
);

/**
 * POST /yonetim/site-uyari/:warnId/iptal
 * Kaydı iptal eder (gerekçe zorunlu), puanları yeniden hesaplar ve desteklenmeyen yaptırımları kaldırır.
 */
router.post(
  '/yonetim/site-uyari/:warnId/iptal',
  requireFreshSiteWarnAuthority,
  formActionLimiter,
  verifyCsrfRequest,
  (req, res) => {
    const lang = req.lang === 'en' ? 'en' : 'tr';
    const warnId = String(req.params.warnId || '').trim();
    const cancelReason = String((req.body && req.body.cancelReason) || '').trim();
    const actor = req.session.user;
    const memberStore = getMemberStore();
    const warningStore = getSiteWarningStore();
    const chatModStore = getSafeChatModStore();

    try {
      const out = warningStore.cancelWarning(warnId, {
        actorId: String(actor.id),
        actorName: actor.displayName || actor.username || String(actor.id),
        cancelReason,
        memberStore,
        chatModStore,
        sseHub: chatSseHub,
      });

      if (wantsJson(req)) {
        return res.json({
          ok: true,
          warnId,
          summary: {
            ...out.summary,
            tierLabel: lang === 'en' ? out.summary.tierLabelEn : out.summary.tierLabelTr,
          },
        });
      }

      req.session.siteWarnFlashResult = {
        success: true,
        action: 'cancelled',
        warnId,
        memberId: out.cancelledRecord.memberId,
        totalPoints: out.summary.totalPoints,
        tier: out.summary.tier,
        tierLabel: lang === 'en' ? out.summary.tierLabelEn : out.summary.tierLabelTr,
      };
      return req.session.save(() =>
        res.redirect(
          303,
          `/yonetim/uyari?siteTargetId=${encodeURIComponent(out.cancelledRecord.memberId)}#site-uyari-paneli`
        )
      );
    } catch (err) {
      const status = (err && err.statusCode) || 400;
      const msg = (err && err.message) || req.t('siteWarn.errGeneric');
      if (wantsJson(req)) {
        return res.status(status).json({ ok: false, code: err && err.code, error: msg });
      }
      req.session.siteWarnFlashError = msg;
      return req.session.save(() => res.redirect(303, '/yonetim/uyari#site-uyari-paneli'));
    }
  }
);

/**
 * GET /yonetim/site-uyari/kanit/:fileName
 * Kanıt görsellerini YALNIZCA taze doğrulanmış Developer/Yönetmenlik yetkililerine sunar.
 * Herkese açık değildir; üyeler (Google veya normal Discord) ASLA erişemez.
 */
router.get('/yonetim/site-uyari/kanit/:fileName', requireFreshSiteWarnAuthority, (req, res) => {
  const warningStore = getSiteWarningStore();
  const info = warningStore.getEvidenceFilePath(req.params.fileName);
  if (!info) {
    return res.status(404).json({ ok: false, error: 'Kanıt dosyası bulunamadı.' });
  }

  const actor = req.session.user;
  warningStore.appendAudit({
    actorId: String(actor.id),
    actorName: actor.displayName || actor.username || String(actor.id),
    action: 'view_warning_evidence',
  });

  res.setHeader('Content-Type', info.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  return fs.createReadStream(info.fullPath).pipe(res);
});

module.exports = router;
