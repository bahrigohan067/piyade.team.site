const express = require('express');
const multer = require('multer');
const router = express.Router();
const { getLocalizedRules } = require('../rules');
const { isDeveloper, isManagement } = require('../config/roles.config');
const botApiClient = require('../services/botApiClient');
const { requireManagement, requireFreshManagement } = require('../middlewares/auth');
const { verifyCsrfToken } = require('../middlewares/csrf');
const { formActionLimiter } = require('../middlewares/rateLimiter');
const { generateIdempotencyKey, consumeIdempotencyKey } = require('../middlewares/idempotency');
const { MAX_EVIDENCE_BYTES, validateEvidenceImageBuffer } = require('../utils/fileValidator');

/**
 * Madde 1: Kanıt görselleri diske (public/uploads) KAYDEDİLMEZ.
 * Sadece bellekte (multer.memoryStorage) alınır, maksimum 5 MB sınır uygulanır,
 * magic-byte kontrolü (sadece PNG, JPG, WEBP; SVG reddedilir) yapılır ve Bot API'ye iletilir.
 */
const uploadEvidence = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_EVIDENCE_BYTES, // 5 MB
    files: 1,
  },
});

/**
 * Geçici RAM kanıt görseli sunucusu (Eski bot sürümlerinin URL üzerinden çekmesi gerekirse).
 * Disk kullanılmaz; 5 dakika sonra RAM'den otomatik silinir.
 */
router.get('/kanit-bellek/:fileName', (req, res) => {
  const item = botApiClient.getEphemeralEvidence(req.params.fileName);
  if (!item) {
    return res.status(404).send('Kanıt görseli bulunamadı veya süresi doldu.');
  }
  res.setHeader('Content-Type', item.mimeType || 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=300');
  return res.send(item.buffer);
});

// Tüm yönetim rotaları sunucu tarafında Yönetmenlik veya Developer yetkisi gerektirir
router.use(requireManagement);

/**
 * GET /yonetim/uyeler
 * Üye Arama ve Listeleme Ekranı.
 */
router.get('/uyeler', async (req, res, next) => {
  const query = String(req.query.query || '').trim();
  const actorId = req.session.user.id;

  try {
    const searchData = await botApiClient.searchAdminMembers(actorId, query);

    return res.render('pages/admin-members', {
      title: req.t('adminMembers.pageTitle'),
      query,
      members: searchData.members || [],
      total: searchData.total || 0,
      selectedMember: null,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /yonetim/uyeler/:id
 * Seçilen üyenin tüm detay kartlarını görüntüler.
 * Madde 12: Üye Bilgileri ekranına erişimi denetim loguna yazar (kim, kimin detayına, ne zaman).
 */
router.get('/uyeler/:id', async (req, res, next) => {
  const targetId = req.params.id;
  const actor = req.session.user;
  const actorId = actor.id;

  try {
    const memberDetail = await botApiClient.getAdminMemberDetail(actorId, targetId, { audit: true });

    // Madde 12: Denetim Logu (Kim, Kimin Detayına, Ne Zaman Erişti)
    const timestampIso = new Date().toISOString();
    const targetName = memberDetail?.discord?.displayName || memberDetail?.discord?.username || targetId;
    console.info(
      `[DENETİM LOGU / AUDIT] Yetkili: ${actor.displayName || actor.username} (${actorId}) | İncelenen Üye: ${targetName} (${targetId}) | Zaman: ${timestampIso} | IP: ${req.ip}`
    );

    return res.render('pages/admin-members', {
      title: `${targetName} ${req.t('adminMembers.detailPageTitleSuffix')}`,
      query: '',
      members: [],
      total: 0,
      selectedMember: memberDetail,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /yonetim/api/search
 * Uyarı Ver ekranındaki üye seçici için JSON arama uç noktası.
 */
router.get('/api/search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  try {
    const data = await botApiClient.searchAdminMembers(req.session.user.id, query);
    return res.json({ members: data.members || [] });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/**
 * GET /yonetim/api/idempotency-key
 * Başarısız XHR/kanıt yüklemeleri sonrası formun yeniden kullanılabilmesi için taze tek kullanımlık anahtar üretir.
 */
router.get('/api/idempotency-key', (req, res) => {
  return res.json({
    ok: true,
    idempotencyKey: generateIdempotencyKey(req),
  });
});

/**
 * GET /yonetim/uyari
 * Uyarı Verme Formu ve PRG (Post-Redirect-Get) Sonuç Kartı Ekranı.
 */
router.get('/uyari', async (req, res) => {
  const preselectedId = String(req.query.targetUserId || '').trim();
  let preselectedMember = null;

  if (preselectedId && /^\d{1,21}$/.test(preselectedId)) {
    try {
      preselectedMember = await botApiClient.getAdminMemberDetail(req.session.user.id, preselectedId, {
        audit: false,
      });
    } catch (_) {
      preselectedMember = null;
    }
  }

  // Başarılı POST sonrası tek seferlik sonuç kartını oku ve temizle (F5 yenilemede tekrar gönderimi önler)
  const flashResult = (req.session && req.session.warnFlashResult) || null;
  if (req.session && req.session.warnFlashResult) {
    delete req.session.warnFlashResult;
  }

  return res.render('pages/admin-warn', {
    title: req.t('adminWarn.pageTitle'),
    rules: getLocalizedRules(req.lang || 'tr'),
    preselectedMember,
    targetId: preselectedId,
    result: flashResult,
    error: null,
    idempotencyKey: generateIdempotencyKey(req),
  });
});

/**
 * Multer dosya boyutu / yükleme hatalarını yakalayan yardımcı sarmalayıcı.
 */
function handleEvidenceUpload(req, res, next) {
  uploadEvidence.single('evidenceFile')(req, res, (err) => {
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

/**
 * Madde 7: Sitede Rol Hiyerarşisi Kontrolü
 * Yetkilinin kendine veya eşit/üst role sahip bir üyeye uyarı vermesini sitede de engeller.
 */
async function checkSiteRoleHierarchy(req, actorRolesData, targetUserId) {
  const actorId = String(req.session.user.id);
  const cleanTargetId = String(targetUserId);

  // 1. Kendine uyarı verme engeli
  if (actorId === cleanTargetId) {
    return {
      allowed: false,
      error: req.t('adminWarn.errSelfWarn'),
    };
  }

  const actorRoles = actorRolesData?.roles || req.session.user.roles || [];
  const actorLevel = actorRolesData?.level || req.session.user.level || 'none';
  const actorIsDev = isDeveloper(actorRoles, actorLevel);

  // Developer kendisi dışındaki üyelere işlem yapabilir
  if (actorIsDev) {
    return { allowed: true };
  }

  // 2. Hedef kullanıcının rollerini Bot API'den çek ve hiyerarşiyi karşılaştır
  const targetRolesData = await botApiClient.getMemberRoles(cleanTargetId);
  const targetRoles = targetRolesData.roles || [];
  const targetLevel = targetRolesData.level || 'none';

  // Hedef Developer veya Yönetmenlik ise ve aktör Developer değilse
  if (isDeveloper(targetRoles, targetLevel)) {
    return {
      allowed: false,
      error: req.t('adminWarn.errEqualOrHigherRole'),
    };
  }

  const actorHighestPos = Number(actorRolesData?.highestRolePosition ?? req.session.user.highestRolePosition ?? 0);
  const targetHighestPos = Number(targetRolesData?.highestRolePosition ?? 0);

  if (actorHighestPos > 0 && targetHighestPos >= actorHighestPos) {
    return {
      allowed: false,
      error: req.t('adminWarn.errEqualOrHigherRole'),
    };
  }

  // Pozisyon bilgisi 0 ise rol seviyesi üzerinden ek koruma
  if (actorHighestPos === 0 && isManagement(targetRoles, targetLevel)) {
    return {
      allowed: false,
      error: req.t('adminWarn.errEqualOrHigherRole'),
    };
  }

  return { allowed: true };
}

/**
 * POST /yonetim/uyari
 * Madde 1: Kanıt görselini memoryStorage + magic-byte (PNG/JPG/WEBP, maks 5 MB) ile doğrular, Bot API'ye iletir.
 * Madde 5: requireFreshManagement ile yetkili rolünü Bot API'den önbelleksiz taze doğrular.
 * Madde 6: Tekil idempotency anahtarı ile çift gönderimi engeller.
 * Madde 7: Kendine ve eşit/üst role uyarı verme engelini sitede de kontrol eder.
 */
router.post(
  '/uyari',
  formActionLimiter,
  requireFreshManagement,
  handleEvidenceUpload,
  verifyCsrfToken,
  async (req, res, next) => {
    const actorId = req.session.user.id;
    const { targetUserId, type, ruleCode, reason, evidenceUrlInput } = req.body;
    const cleanTargetId = String(targetUserId || '').trim();
    const localizedRules = getLocalizedRules(req.lang || 'tr');
    const isAjax = Boolean(
      req.xhr ||
      req.get('X-Requested-With') === 'XMLHttpRequest' ||
      (req.headers.accept && req.headers.accept.includes('application/json'))
    );

    const renderWarnFormError = (status, errorMessage) => {
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
        rules: localizedRules,
        preselectedMember: null,
        targetId: cleanTargetId,
        result: null,
        error: errorMessage,
        idempotencyKey: nextKey,
      });
    };

    // Madde 6: Çift Gönderim (Idempotency) Kontrolü
    const idemCheck = consumeIdempotencyKey(req);
    if (!idemCheck.valid) {
      return renderWarnFormError(409, req.t('errors.duplicateSubmission'));
    }

    // Multer boyut hatası varsa
    if (req.fileUploadError) {
      return renderWarnFormError(400, req.fileUploadError);
    }

    // Madde 1: Yüklenen dosya varsa magic-byte kontrolü (PNG, JPG, WEBP; SVG reddedilir)
    let validatedEvidence = null;
    if (req.file) {
      const check = validateEvidenceImageBuffer(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname
      );
      if (!check.valid) {
        return renderWarnFormError(400, check.errorKey ? req.t(check.errorKey) : check.error);
      }
      validatedEvidence = {
        buffer: req.file.buffer,
        fileName: check.randomFileName,
        mimeType: check.mimeType,
      };
    }

    // Harici kanıt URL'si girildiyse doğrula (SVG linklerini reddet)
    let cleanEvidenceUrl = null;
    if (evidenceUrlInput && String(evidenceUrlInput).trim()) {
      const candidateUrl = String(evidenceUrlInput).trim();
      if (!/^https?:\/\/\S+/i.test(candidateUrl)) {
        return renderWarnFormError(400, req.t('adminWarn.errInvalidEvidenceUrl'));
      }
      if (/\.svg(\?.*)?$/i.test(candidateUrl)) {
        return renderWarnFormError(400, req.t('errors.svgNotAllowed'));
      }
      cleanEvidenceUrl = candidateUrl;
    }

    if (!cleanTargetId || !/^\d{1,21}$/.test(cleanTargetId)) {
      return renderWarnFormError(400, req.t('adminWarn.errSelectTarget'));
    }

    if (type === 'verbal' && (!reason || String(reason).trim().length < 2)) {
      return renderWarnFormError(400, req.t('adminWarn.errVerbalReason'));
    }

    if (type === 'official' && !ruleCode) {
      return renderWarnFormError(400, req.t('adminWarn.errSelectRule'));
    }

    try {
      // Madde 7: Sitede Rol Hiyerarşisi Kontrolü (Kendine ve eşit/üst role ceza verme engeli)
      const hierarchyCheck = await checkSiteRoleHierarchy(req, req.freshActorRoles, cleanTargetId);
      if (!hierarchyCheck.allowed) {
        return renderWarnFormError(403, hierarchyCheck.error);
      }

      // 1. Uyarıyı Bot REST API'si üzerinden uygula
      const warnResult = await botApiClient.applyWarning({
        actorId,
        targetUserId: cleanTargetId,
        type,
        reason: reason ? String(reason).trim() : '',
        ruleCode: type === 'official' ? String(ruleCode).trim().toUpperCase() : undefined,
      });

      // 2. Kanıt görseli varsa bellekten doğrudan Bot API'ye ilet
      let finalEvidenceUrl = null;
      if (warnResult.warnId && (validatedEvidence || cleanEvidenceUrl)) {
        try {
          const evRes = await botApiClient.attachWarningEvidence(warnResult.warnId, {
            actorId,
            fileBuffer: validatedEvidence ? validatedEvidence.buffer : null,
            fileName: validatedEvidence ? validatedEvidence.fileName : null,
            mimeType: validatedEvidence ? validatedEvidence.mimeType : null,
            evidenceUrl: cleanEvidenceUrl,
          });
          finalEvidenceUrl = evRes.proofUrl || cleanEvidenceUrl;
        } catch (evErr) {
          console.error('[KANIT İLETİM HATASI]:', evErr.message);
        }
      }

      req.session.warnFlashResult = {
        ...warnResult,
        targetUserId: cleanTargetId,
        evidenceUrl: finalEvidenceUrl,
      };

      return req.session.save(() => {
        if (isAjax) {
          return res.json({
            ok: true,
            redirectUrl: '/yonetim/uyari',
          });
        }
        return res.redirect('/yonetim/uyari');
      });
    } catch (err) {
      if (err && err.isOffline) {
        return next(err);
      }
      return renderWarnFormError(err.statusCode || 400, err.message);
    }
  }
);

module.exports = router;
