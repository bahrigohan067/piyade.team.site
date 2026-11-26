const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();

const legalConfig = require('../config/legal.config');
const consentsConfig = require('../config/consents.config');
const { renderMarkdown } = require('../utils/markdownRenderer');
const { getLegalStore, createFormStartToken, verifyFormStartToken } = require('../services/legalStore');
const { kvkkSubmitLimiter, statusLookupLimiter } = require('../middlewares/rateLimiter');

const LEGAL_CONTENT_ROOT = path.join(__dirname, '..', 'content', 'legal');
const EMAIL_REGEX = /^[^\s@<>]{1,64}@[^\s@<>]{1,120}\.[^\s@<>]{2,24}$/;
const ALLOWED_REQUEST_TYPE_IDS = new Set(legalConfig.KVKK_REQUEST_TYPES.map((t) => t.id));

function loadLegalDocument(slug, lang = 'tr') {
  const safeLang = lang === 'en' ? 'en' : 'tr';
  const primaryPath = path.join(LEGAL_CONTENT_ROOT, safeLang, `${slug}.md`);
  const fallbackPath = path.join(LEGAL_CONTENT_ROOT, 'tr', `${slug}.md`);
  const targetPath = fs.existsSync(primaryPath) ? primaryPath : fallbackPath;
  if (!fs.existsSync(targetPath)) return null;

  const raw = fs.readFileSync(targetPath, 'utf8');
  const substituted = legalConfig.replaceLegalPlaceholders(raw, safeLang);
  return renderMarkdown(substituted);
}

function buildPrefilledKvkkForm(req) {
  const user = req.session && req.session.user;
  if (!user || !user.id) {
    return {
      fullName: '',
      email: '',
      relation: 'visitor',
      accountIdentifier: '',
      requestTypes: [],
      description: '',
    };
  }
  return {
    fullName: user.displayName || user.username || '',
    email: user.email || '',
    relation: 'member',
    accountIdentifier: `Discord: ${user.username || user.displayName || ''} (ID: ${user.id})`,
    requestTypes: [],
    description: '',
  };
}

function resolveLegalPath(req, suffix) {
  return req.langPrefix ? `/${req.langPrefix}${suffix}` : suffix;
}

// ============================================================================
// 1) KVKK BAŞVURU FORMU (/yasal/kvkk-basvuru)
// ============================================================================
router.get('/kvkk-basvuru', (req, res, next) => {
  const lang = req.lang === 'en' ? 'en' : 'tr';
  const doc = loadLegalDocument('kvkk-basvuru', lang);
  if (!doc) return next();

  const submittedResult = (req.session && req.session.kvkkSubmittedResult) || null;
  if (req.session && req.session.kvkkSubmittedResult) {
    delete req.session.kvkkSubmittedResult;
  }

  return res.render('pages/kvkk-form', {
    title: res.locals.seo ? res.locals.seo.title : req.t('kvkkForm.pageTitle'),
    doc,
    legalReviewed: legalConfig.isLegalReviewed(),
    formData: buildPrefilledKvkkForm(req),
    formError: null,
    submittedResult,
    requestTypesList: legalConfig.KVKK_REQUEST_TYPES,
    formStartToken: createFormStartToken(),
  });
});

router.post('/kvkk-basvuru', kvkkSubmitLimiter, (req, res) => {
  const lang = req.lang === 'en' ? 'en' : 'tr';
  const doc = loadLegalDocument('kvkk-basvuru', lang) || { meta: {}, html: '', toc: [] };
  const retention = legalConfig.getRetentionConfig();
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const wantsJson = Boolean(
    req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))
  );

  const rawTypes = body.requestTypes !== undefined ? body.requestTypes : body['requestTypes[]'];
  const requestTypes = (Array.isArray(rawTypes) ? rawTypes : rawTypes ? [rawTypes] : [])
    .map((v) => String(v || '').trim())
    .filter((v) => ALLOWED_REQUEST_TYPE_IDS.has(v));

  const formData = {
    fullName: String(body.fullName || '').trim(),
    email: String(body.email || '').trim().toLowerCase(),
    relation: body.relation === 'member' ? 'member' : 'visitor',
    accountIdentifier: String(body.accountIdentifier || '').trim(),
    requestTypes: [...new Set(requestTypes)],
    description: String(body.description || '').trim(),
  };

  const fail = (statusCode, errorMsg, code = 'VALIDATION_ERROR') => {
    if (wantsJson) {
      return res.status(statusCode).json({ ok: false, code, error: errorMsg });
    }
    return res.status(statusCode).render('pages/kvkk-form', {
      title: res.locals.seo ? res.locals.seo.title : req.t('kvkkForm.pageTitle'),
      doc,
      legalReviewed: legalConfig.isLegalReviewed(),
      formData,
      formError: errorMsg,
      submittedResult: null,
      requestTypesList: legalConfig.KVKK_REQUEST_TYPES,
      formStartToken: createFormStartToken(),
    });
  };

  // 1) Honeypot kontrolü
  if (typeof body.website_url === 'string' && body.website_url.trim() !== '') {
    return fail(400, req.t('kvkkForm.errSpamDetected'), 'HONEYPOT_TRIGGERED');
  }

  // 2) En az 3 sn doldurma süresi kontrolü
  const timing = verifyFormStartToken(body._formStartedAt, { minMs: retention.MIN_FORM_FILL_MS });
  if (!timing.ok) {
    return fail(400, req.t('kvkkForm.errTooFast'), timing.reason || 'TOO_FAST');
  }

  // 3) Sunucu tarafı girdi doğrulama
  if (formData.fullName.length < 2 || formData.fullName.length > 120) {
    return fail(400, req.t('kvkkForm.errFullName'));
  }
  if (!EMAIL_REGEX.test(formData.email) || formData.email.length > 160) {
    return fail(400, req.t('kvkkForm.errEmail'));
  }
  if (formData.requestTypes.length === 0) {
    return fail(400, req.t('kvkkForm.errRequestTypes'));
  }
  if (formData.description.length < 10 || formData.description.length > retention.MAX_KVKK_DESCRIPTION) {
    return fail(400, req.t('kvkkForm.errDescription'));
  }

  const user = req.session && req.session.user;
  const created = getLegalStore().createKvkkRequest({
    ...formData,
    userId: user && user.id ? String(user.id) : null,
    lang,
  });

  if (wantsJson) {
    return res.status(201).json({
      ok: true,
      trackingCode: created.trackingCode,
      status: created.status,
      deadlineAt: created.deadlineAt,
      lookupUrl: resolveLegalPath(req, '/yasal/kvkk-basvuru/sorgula'),
    });
  }

  req.session.kvkkSubmittedResult = created;
  return req.session.save(() => {
    return res.redirect(303, resolveLegalPath(req, '/yasal/kvkk-basvuru'));
  });
});

// ============================================================================
// 2) KVKK BAŞVURU DURUM SORGULAMA (/yasal/kvkk-basvuru/sorgula — noindex, SADECE DURUM)
// ============================================================================
function markLookupNoIndex(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req && typeof req.applySeo === 'function') {
    req.applySeo({ noindex: true, isPublic: false });
  }
}

router.get('/kvkk-basvuru/sorgula', (req, res) => {
  markLookupNoIndex(req, res);
  const queryCode = typeof req.query.kod === 'string' ? req.query.kod.trim().toUpperCase().slice(0, 32) : '';
  return res.render('pages/kvkk-status', {
    title: req.t('kvkkForm.lookupPageTitle'),
    queryCode,
    queryEmail: '',
    lookupResult: null,
    lookupError: null,
  });
});

router.post('/kvkk-basvuru/sorgula', statusLookupLimiter, (req, res) => {
  markLookupNoIndex(req, res);
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const queryCode = String(body.trackingCode || '').trim().toUpperCase().slice(0, 32);
  const queryEmail = String(body.email || '').trim().toLowerCase().slice(0, 160);
  const wantsJson = Boolean(
    req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))
  );

  if (!queryCode || !EMAIL_REGEX.test(queryEmail)) {
    const errMsg = req.t('kvkkForm.errLookupInput');
    if (wantsJson) return res.status(400).json({ ok: false, error: errMsg });
    return res.status(400).render('pages/kvkk-status', {
      title: req.t('kvkkForm.lookupPageTitle'),
      queryCode,
      queryEmail,
      lookupResult: null,
      lookupError: errMsg,
    });
  }

  const found = getLegalStore().lookupKvkkStatus(queryCode, queryEmail);
  if (!found.found) {
    const errMsg = req.t('kvkkForm.errLookupNotFound');
    if (wantsJson) return res.status(404).json({ ok: false, error: errMsg });
    return res.status(404).render('pages/kvkk-status', {
      title: req.t('kvkkForm.lookupPageTitle'),
      queryCode,
      queryEmail,
      lookupResult: null,
      lookupError: errMsg,
    });
  }

  // GÜVENLİK: Sorgulama yanıtında SADECE DURUM döner; kişisel içerik/not/ad-soyad YOK!
  const safeStatusPayload = {
    trackingCode: found.trackingCode,
    status: found.status,
    createdAt: found.createdAt,
    updatedAt: found.updatedAt,
    deadlineAt: found.deadlineAt,
  };

  if (wantsJson) {
    return res.json({ ok: true, result: safeStatusPayload });
  }

  return res.render('pages/kvkk-status', {
    title: req.t('kvkkForm.lookupPageTitle'),
    queryCode,
    queryEmail,
    lookupResult: safeStatusPayload,
    lookupError: null,
  });
});

// ============================================================================
// 3) GENEL YASAL BELGE SAYFALARI (/yasal/:slug — indekslenebilir)
// ============================================================================
router.get('/:slug', (req, res, next) => {
  const slug = String(req.params.slug || '').trim().toLowerCase();
  const docDef = legalConfig.getLegalDocBySlug(slug);
  if (!docDef) return next();

  const lang = req.lang === 'en' ? 'en' : 'tr';
  const doc = loadLegalDocument(slug, lang);
  if (!doc) return next();

  const pageTitle = lang === 'en' ? docDef.titleEn : docDef.titleTr;

  return res.render('pages/legal-doc', {
    title: res.locals.seo ? res.locals.seo.title : `${pageTitle} — Piyade World`,
    pageTitle,
    slug,
    doc,
    legalReviewed: legalConfig.isLegalReviewed(),
    explicitConsents: slug === 'acik-riza' ? consentsConfig.getExplicitConsents(lang) : [],
    allLegalDocs: legalConfig.LEGAL_DOCS,
  });
});

module.exports = router;
