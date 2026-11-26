const express = require('express');
const multer = require('multer');
const router = express.Router();

const legalConfig = require('../config/legal.config');
const { getReportStore } = require('../services/reportStore');
const { createFormStartToken, verifyFormStartToken } = require('../services/legalStore');
const { validateEvidenceImageBuffer } = require('../utils/fileValidator');
const { stripJpegMetadata } = require('../utils/chatFileValidator');
const { abuseReportLimiter, statusLookupLimiter } = require('../middlewares/rateLimiter');

const EMAIL_REGEX = /^[^\s@<>]{1,64}@[^\s@<>]{1,120}\.[^\s@<>]{2,24}$/;
const HTML_TAG_REGEX = /<\s*\/?\s*[a-z][^>]*>/i;

const retentionDefaults = legalConfig.getRetentionConfig();

const uploadReportEvidence = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: retentionDefaults.REPORT_EVIDENCE_MAX_BYTES,
    files: retentionDefaults.REPORT_EVIDENCE_MAX_FILES,
  },
});

function handleReportUploads(req, res, next) {
  uploadReportEvidence.array('evidenceFiles', retentionDefaults.REPORT_EVIDENCE_MAX_FILES)(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        req.reportUploadError = req.t ? req.t('reportPage.errFileTooLarge') : 'Her görsel en fazla 5 MB olabilir.';
      } else if (err instanceof multer.MulterError && (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE')) {
        req.reportUploadError = req.t ? req.t('reportPage.errMaxFiles') : 'En fazla 3 görsel yükleyebilirsiniz.';
      } else {
        req.reportUploadError = req.t ? req.t('reportPage.errInvalidFile') : 'Geçersiz dosya yüklemesi.';
      }
    }
    return next();
  });
}

function resolveReportPath(req, suffix) {
  return req.langPrefix ? `/${req.langPrefix}${suffix}` : suffix;
}

function markLookupNoIndex(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req && typeof req.applySeo === 'function') {
    req.applySeo({ noindex: true, isPublic: false });
  }
}

// ============================================================================
// 1) İHLAL BİLDİRİM SAYFASI (GET /bildir — Giriş zorunlu DEĞİL, indekslenebilir)
// ============================================================================
router.get('/', (req, res) => {
  const user = req.session && req.session.user;
  const submittedResult = (req.session && req.session.reportSubmittedResult) || null;
  if (req.session && req.session.reportSubmittedResult) {
    delete req.session.reportSubmittedResult;
  }

  const rawCat = typeof req.query.kategori === 'string' ? req.query.kategori.trim().toLowerCase() : '';
  const preselectedCategory = legalConfig.getReportCategoryById(rawCat) ? rawCat : '';

  return res.render('pages/report-form', {
    title: res.locals.seo ? res.locals.seo.title : req.t('reportPage.pageTitle'),
    isReportPage: true,
    categories: legalConfig.REPORT_CATEGORIES,
    locations: legalConfig.REPORT_LOCATIONS,
    preselectedCategory,
    formData: {
      category: preselectedCategory,
      location: 'site',
      targetRef: '',
      description: '',
      contactEmail: (user && user.email) || '',
      dmcaRightsHolder: '',
      dmcaWorkDescription: '',
      dmcaInfringingUrl: '',
      dmcaGoodFaith: false,
    },
    formError: null,
    submittedResult,
    formStartToken: createFormStartToken(),
  });
});

// ============================================================================
// 2) İHLAL BİLDİRİM GÖNDERİMİ (POST /bildir — 5/saat/IP, honeypot, min 3sn, magic-byte)
// ============================================================================
router.post('/', abuseReportLimiter, handleReportUploads, (req, res) => {
  const lang = req.lang === 'en' ? 'en' : 'tr';
  const retention = legalConfig.getRetentionConfig();
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const wantsJson = Boolean(
    req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))
  );

  const formData = {
    category: String(body.category || '').trim().toLowerCase(),
    location: String(body.location || 'site').trim().toLowerCase(),
    targetRef: String(body.targetRef || '').trim(),
    description: String(body.description || '').trim(),
    contactEmail: String(body.contactEmail || '').trim().toLowerCase(),
    dmcaRightsHolder: String(body.dmcaRightsHolder || '').trim(),
    dmcaWorkDescription: String(body.dmcaWorkDescription || '').trim(),
    dmcaInfringingUrl: String(body.dmcaInfringingUrl || '').trim(),
    dmcaGoodFaith: body.dmcaGoodFaith === 'on' || body.dmcaGoodFaith === 'true' || body.dmcaGoodFaith === '1' || body.dmcaGoodFaith === true,
  };

  const fail = (statusCode, errorMsg, code = 'VALIDATION_ERROR') => {
    if (wantsJson) {
      return res.status(statusCode).json({ ok: false, code, error: errorMsg });
    }
    return res.status(statusCode).render('pages/report-form', {
      title: res.locals.seo ? res.locals.seo.title : req.t('reportPage.pageTitle'),
      isReportPage: true,
      categories: legalConfig.REPORT_CATEGORIES,
      locations: legalConfig.REPORT_LOCATIONS,
      preselectedCategory: legalConfig.getReportCategoryById(formData.category) ? formData.category : '',
      formData,
      formError: errorMsg,
      submittedResult: null,
      formStartToken: createFormStartToken(),
    });
  };

  // 1) Honeypot
  if (typeof body.website_url === 'string' && body.website_url.trim() !== '') {
    return fail(400, req.t('reportPage.errSpamDetected'), 'HONEYPOT_TRIGGERED');
  }

  // 2) En az 3 saniye doldurma süresi
  const timing = verifyFormStartToken(body._formStartedAt, { minMs: retention.MIN_FORM_FILL_MS });
  if (!timing.ok) {
    return fail(400, req.t('reportPage.errTooFast'), timing.reason || 'TOO_FAST');
  }

  // 3) Multer dosya sınırı hatası
  if (req.reportUploadError) {
    return fail(400, req.reportUploadError, 'UPLOAD_ERROR');
  }

  // 4) Kategori ve olay yeri doğrulama
  const catDef = legalConfig.getReportCategoryById(formData.category);
  if (!catDef) {
    return fail(400, req.t('reportPage.errCategory'));
  }
  if (!legalConfig.REPORT_LOCATIONS.includes(formData.location)) {
    return fail(400, req.t('reportPage.errLocation'));
  }

  // 5) HTML etiketi engeli + uzunluk kontrolleri
  const textFieldsToCheck = [
    formData.targetRef,
    formData.description,
    formData.dmcaRightsHolder,
    formData.dmcaWorkDescription,
    formData.dmcaInfringingUrl,
  ];
  if (textFieldsToCheck.some((v) => HTML_TAG_REGEX.test(v))) {
    return fail(400, req.t('reportPage.errNoHtml'), 'HTML_NOT_ALLOWED');
  }

  if (formData.targetRef.length > 500) {
    return fail(400, req.t('reportPage.errTargetTooLong'));
  }
  if (formData.description.length < 10 || formData.description.length > retention.MAX_REPORT_DESCRIPTION) {
    return fail(400, req.t('reportPage.errDescription'));
  }
  if (formData.contactEmail && (!EMAIL_REGEX.test(formData.contactEmail) || formData.contactEmail.length > 160)) {
    return fail(400, req.t('reportPage.errEmail'));
  }

  // 6) Telif / DMCA ek zorunlu alanları
  let dmcaPayload = null;
  if (catDef.id === 'copyright_dmca') {
    if (!formData.contactEmail) {
      return fail(400, req.t('reportPage.errDmcaEmailRequired'));
    }
    if (formData.dmcaRightsHolder.length < 2 || formData.dmcaRightsHolder.length > 160) {
      return fail(400, req.t('reportPage.errDmcaRightsHolder'));
    }
    if (formData.dmcaWorkDescription.length < 10 || formData.dmcaWorkDescription.length > 1000) {
      return fail(400, req.t('reportPage.errDmcaWorkDesc'));
    }
    if (formData.dmcaInfringingUrl.length < 5 || formData.dmcaInfringingUrl.length > 500) {
      return fail(400, req.t('reportPage.errDmcaInfringingUrl'));
    }
    if (!formData.dmcaGoodFaith) {
      return fail(400, req.t('reportPage.errDmcaGoodFaith'));
    }
    dmcaPayload = {
      rightsHolder: formData.dmcaRightsHolder,
      workDescription: formData.dmcaWorkDescription,
      infringingUrl: formData.dmcaInfringingUrl,
      goodFaithConfirmed: true,
    };
  }

  // 7) Kanıt görsellerini magic-byte (PNG/JPG/WEBP <= 5 MB) + JPEG EXIF temizliğiyle doğrula
  const rawFiles = Array.isArray(req.files) ? req.files : [];
  if (rawFiles.length > retention.REPORT_EVIDENCE_MAX_FILES) {
    return fail(400, req.t('reportPage.errMaxFiles'), 'TOO_MANY_FILES');
  }

  const validatedFiles = [];
  for (const f of rawFiles) {
    const check = validateEvidenceImageBuffer(f.buffer, f.mimetype, f.originalname);
    if (!check.valid) {
      return fail(400, check.errorKey ? req.t(check.errorKey) : check.error, 'INVALID_FILE');
    }
    let cleanBuffer = f.buffer;
    if (check.ext === 'jpg') {
      const stripped = stripJpegMetadata(f.buffer);
      if (!stripped.ok) {
        return fail(400, req.t('reportPage.errInvalidFile'), 'CORRUPT_JPEG');
      }
      cleanBuffer = stripped.buffer;
    }
    validatedFiles.push({
      buffer: cleanBuffer,
      ext: check.ext,
      mimeType: check.mimeType,
      originalName: f.originalname || check.randomFileName,
    });
  }

  const user = req.session && req.session.user;
  const created = getReportStore().createReport({
    category: catDef.id,
    location: formData.location,
    targetRef: formData.targetRef,
    description: formData.description,
    contactEmail: formData.contactEmail,
    reporterUserId: user && user.id ? String(user.id) : null,
    reporterName: user && (user.displayName || user.username) ? String(user.displayName || user.username) : '',
    dmca: dmcaPayload,
    evidenceFiles: validatedFiles,
    lang,
  });

  if (wantsJson) {
    return res.status(201).json({
      ok: true,
      trackingCode: created.trackingCode,
      status: created.status,
      category: created.category,
      audience: created.audience,
      evidenceCount: created.evidenceCount,
      lookupUrl: `${resolveReportPath(req, '/bildir/sorgula')}?kod=${encodeURIComponent(created.trackingCode)}`,
    });
  }

  req.session.reportSubmittedResult = created;
  return req.session.save(() => {
    return res.redirect(303, resolveReportPath(req, '/bildir'));
  });
});

// ============================================================================
// 3) İHLAL BİLDİRİMİ DURUM SORGULAMA (/bildir/sorgula — noindex, SADECE DURUM)
// ============================================================================
router.get('/sorgula', (req, res) => {
  markLookupNoIndex(req, res);
  const queryCode = typeof req.query.kod === 'string' ? req.query.kod.trim().toUpperCase().slice(0, 32) : '';
  return res.render('pages/report-status', {
    title: req.t('reportPage.lookupPageTitle'),
    queryCode,
    lookupResult: null,
    lookupError: null,
    categories: legalConfig.REPORT_CATEGORIES,
  });
});

router.post('/sorgula', statusLookupLimiter, (req, res) => {
  markLookupNoIndex(req, res);
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const queryCode = String(body.trackingCode || '').trim().toUpperCase().slice(0, 32);
  const wantsJson = Boolean(
    req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))
  );

  if (!queryCode) {
    const errMsg = req.t('reportPage.errLookupCode');
    if (wantsJson) return res.status(400).json({ ok: false, error: errMsg });
    return res.status(400).render('pages/report-status', {
      title: req.t('reportPage.lookupPageTitle'),
      queryCode,
      lookupResult: null,
      lookupError: errMsg,
      categories: legalConfig.REPORT_CATEGORIES,
    });
  }

  const found = getReportStore().lookupReportStatus(queryCode);
  if (!found.found) {
    const errMsg = req.t('reportPage.errLookupNotFound');
    if (wantsJson) return res.status(404).json({ ok: false, error: errMsg });
    return res.status(404).render('pages/report-status', {
      title: req.t('reportPage.lookupPageTitle'),
      queryCode,
      lookupResult: null,
      lookupError: errMsg,
      categories: legalConfig.REPORT_CATEGORIES,
    });
  }

  // GÜVENLİK: Sorgulama yanıtında SADECE DURUM bilgisi yer alır (açıklama/e-posta/not YOK!)
  const safePayload = {
    trackingCode: found.trackingCode,
    category: found.category,
    status: found.status,
    createdAt: found.createdAt,
    updatedAt: found.updatedAt,
  };

  if (wantsJson) {
    return res.json({ ok: true, result: safePayload });
  }

  return res.render('pages/report-status', {
    title: req.t('reportPage.lookupPageTitle'),
    queryCode,
    lookupResult: safePayload,
    lookupError: null,
    categories: legalConfig.REPORT_CATEGORIES,
  });
});

module.exports = router;
