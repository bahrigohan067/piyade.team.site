const express = require('express');
const router = express.Router();

const legalConfig = require('../config/legal.config');
const { getLegalStore } = require('../services/legalStore');
const { getReportStore } = require('../services/reportStore');
const { requireFreshDeveloper, requireFreshManagementOr404 } = require('../middlewares/auth');
const { chatModLimiter } = require('../middlewares/rateLimiter');

// ============================================================================
// A) KVKK BAŞVURU YÖNETİM PANELİ (/yonetim/kvkk — YALNIZCA DEVELOPER, TAZE ROL, DİĞERLERİNE 404)
// ============================================================================
const kvkkRouter = express.Router();
kvkkRouter.use(chatModLimiter);
kvkkRouter.use(requireFreshDeveloper);
kvkkRouter.use((req, res, next) => {
  res.locals.disableFeedbackPill = true;
  return next();
});

kvkkRouter.get('/', (req, res) => {
  const retention = legalConfig.getRetentionConfig();
  return res.render('pages/admin-kvkk', {
    title: req.t('adminKvkk.pageTitle'),
    isAdminLegalPage: true,
    legalPanelMode: 'kvkk',
    retentionDays: retention.KVKK_REQUEST_DAYS,
    deadlineDays: retention.KVKK_RESPONSE_DEADLINE_DAYS,
    kvkkStatuses: legalConfig.KVKK_STATUSES,
  });
});

kvkkRouter.get('/api/basvurular', (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  const overdueOnly = req.query.overdue === '1';
  const page = Number.parseInt(String(req.query.page || '1'), 10) || 1;
  const limit = Number.parseInt(String(req.query.limit || '25'), 10) || 25;

  const listed = getLegalStore().listKvkkRequests({ status, overdueOnly, page, limit });
  return res.json({
    ok: true,
    ...listed,
  });
});

kvkkRouter.get('/api/basvuru/:code', (req, res) => {
  const actorId = String(req.session.user.id);
  const actorName = req.session.user.displayName || req.session.user.username || actorId;
  const detail = getLegalStore().getKvkkRequestDetail(req.params.code, { actorId, actorName });
  if (!detail) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: req.t('adminKvkk.errNotFound') });
  }
  return res.json({ ok: true, item: detail });
});

kvkkRouter.post('/api/basvuru/:code/durum', (req, res) => {
  const actorId = String(req.session.user.id);
  const actorName = req.session.user.displayName || req.session.user.username || actorId;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const result = getLegalStore().updateKvkkRequest(req.params.code, {
    status: body.status,
    note: body.note,
    actorId,
    actorName,
  });
  if (!result.ok) {
    const errMsg =
      result.code === 'NOTE_REQUIRED'
        ? req.t('adminKvkk.errNoteRequired')
        : result.code === 'INVALID_STATUS'
          ? req.t('adminKvkk.errInvalidStatus')
          : req.t('adminKvkk.errNotFound');
    return res.status(result.status || 400).json({ ok: false, code: result.code, error: errMsg });
  }
  return res.json({ ok: true, entry: result.entry });
});

kvkkRouter.get('/api/denetim', (req, res) => {
  const page = Number.parseInt(String(req.query.page || '1'), 10) || 1;
  const limit = Number.parseInt(String(req.query.limit || '100'), 10) || 100;
  const data = getLegalStore().readAuditLog({ page, limit });
  return res.json({ ok: true, ...data });
});

// ============================================================================
// B) YÖNETİM İHLAL BİLDİRİMLERİ (/yonetim/bildirimler — DEVELOPER + YÖNETMENLİK, DİĞERLERİNE 404)
//    Yasa dışı içerik, Telif/DMCA, KVKK gizlilik ihlali ve Diğer kategorileri.
// ============================================================================
const mgmtReportsRouter = express.Router();
mgmtReportsRouter.use(chatModLimiter);
mgmtReportsRouter.use(requireFreshManagementOr404);
mgmtReportsRouter.use((req, res, next) => {
  res.locals.disableFeedbackPill = true;
  return next();
});

mgmtReportsRouter.get('/', (req, res) => {
  const mgmtCategories = legalConfig.REPORT_CATEGORIES.filter((c) => c.audience === 'management');
  return res.render('pages/admin-reports', {
    title: req.t('adminReports.pageTitle'),
    isAdminLegalPage: true,
    legalPanelMode: 'management_reports',
    categories: mgmtCategories,
    statuses: legalConfig.REPORT_STATUSES,
  });
});

mgmtReportsRouter.get('/api/liste', (req, res) => {
  const actorId = String(req.session.user.id);
  const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
  const page = Number.parseInt(String(req.query.page || '1'), 10) || 1;
  const limit = Number.parseInt(String(req.query.limit || '25'), 10) || 25;

  const listed = getReportStore().listReports({
    audience: 'management',
    status,
    category,
    actorId,
    page,
    limit,
  });
  return res.json({ ok: true, ...listed });
});

mgmtReportsRouter.get('/api/detay/:code', (req, res) => {
  const actorId = String(req.session.user.id);
  const actorName = req.session.user.displayName || req.session.user.username || actorId;
  const store = getReportStore();
  const detail = store.getReportDetail(req.params.code, { expectedAudience: 'management', actorId });
  if (!detail.ok) {
    const errMsg =
      detail.code === 'CONFLICT_OF_INTEREST'
        ? req.t('adminReports.errConflict')
        : req.t('adminReports.errNotFound');
    return res.status(detail.status || 404).json({ ok: false, code: detail.code, error: errMsg });
  }

  store.appendManagementAudit({
    actorId,
    actorName,
    action: 'report_view',
    trackingCode: detail.report.trackingCode,
    category: detail.report.category,
    status: detail.report.status,
  });

  const safeReport = {
    ...detail.report,
    evidence: (detail.report.evidence || []).map((f) => ({
      id: f.id,
      originalName: f.originalName,
      ext: f.ext,
      mimeType: f.mimeType,
      size: f.size,
      previewUrl: `/yonetim/bildirimler/dosya/${f.id}?reportId=${encodeURIComponent(detail.report.trackingCode)}`,
    })),
  };

  return res.json({ ok: true, report: safeReport });
});

mgmtReportsRouter.post('/api/detay/:code/durum', (req, res) => {
  const actorId = String(req.session.user.id);
  const actorName = req.session.user.displayName || req.session.user.username || actorId;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const store = getReportStore();

  const updated = store.updateReportStatus(req.params.code, {
    expectedAudience: 'management',
    status: body.status,
    note: body.note,
    actorId,
    actorName,
  });

  if (!updated.ok) {
    const errMsg =
      updated.code === 'CONFLICT_OF_INTEREST'
        ? req.t('adminReports.errConflict')
        : updated.code === 'NOTE_REQUIRED'
          ? req.t('adminReports.errNoteRequired')
          : updated.code === 'INVALID_STATUS'
            ? req.t('adminReports.errInvalidStatus')
            : req.t('adminReports.errNotFound');
    return res.status(updated.status || 400).json({ ok: false, code: updated.code, error: errMsg });
  }

  store.appendManagementAudit({
    actorId,
    actorName,
    action: 'report_status_update',
    trackingCode: updated.report.trackingCode,
    category: updated.report.category,
    status: updated.report.status,
    hasNote: true,
  });

  return res.json({ ok: true, report: updated.report });
});

mgmtReportsRouter.get('/dosya/:fileId', (req, res) => {
  const actorId = String(req.session.user.id);
  const actorName = req.session.user.displayName || req.session.user.username || actorId;
  const reportId = typeof req.query.reportId === 'string' ? req.query.reportId.trim() : '';
  const store = getReportStore();

  const fileRes = store.getEvidenceFile(reportId, req.params.fileId, {
    expectedAudience: 'management',
    actorId,
  });
  if (!fileRes.ok) {
    return res.status(fileRes.status === 403 ? 403 : 404).end();
  }

  store.appendManagementAudit({
    actorId,
    actorName,
    action: 'report_evidence_view',
    trackingCode: fileRes.report.trackingCode,
    category: fileRes.report.category,
    status: fileRes.report.status,
  });

  res.setHeader('Content-Type', fileRes.meta.mimeType || 'image/png');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', 'inline');
  return res.sendFile(fileRes.fullPath);
});

mgmtReportsRouter.get('/api/denetim', (req, res) => {
  const page = Number.parseInt(String(req.query.page || '1'), 10) || 1;
  const limit = Number.parseInt(String(req.query.limit || '100'), 10) || 100;
  return res.json({ ok: true, ...getReportStore().readManagementAudit({ page, limit }) });
});

router.use('/kvkk', kvkkRouter);
router.use('/bildirimler', mgmtReportsRouter);

module.exports = router;
