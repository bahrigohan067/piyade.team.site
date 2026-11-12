const express = require('express');
const multer = require('multer');
const warriorsConfig = require('../config/warriors.config');
const warriorsStore = require('../services/warriorsStore');
const robloxAvatarService = require('../services/robloxAvatarService');
const { requireFreshDeveloper } = require('../middlewares/auth');
const { verifyCsrfToken } = require('../middlewares/csrf');
const { warriorSaveLimiter } = require('../middlewares/rateLimiter');
const { generateIdempotencyKey, beginIdempotentOperation, commitIdempotentOperation, rollbackIdempotentOperation } = require('../middlewares/idempotency');
const { validateImageBuffer } = require('../utils/fileValidator');

const router = express.Router();
const { LIMITS, CUSTOM_IMAGE_FILENAME_REGEX } = warriorsConfig;

const uploadWarriorImages = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: LIMITS.maxCustomImageBytes, // 2 MB
    files: LIMITS.maxWarriors,
  },
});

function handleWarriorImagesUpload(req, res, next) {
  uploadWarriorImages.any()(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        req.warriorUploadError = req.t ? req.t('warriors.errFileTooLarge') : 'Özel savaşçı görseli boyutu en fazla 2 MB olabilir.';
      } else {
        req.warriorUploadError = err.message || (req.t ? req.t('errors.invalidFileType') : 'Geçersiz görsel dosyası.');
      }
    }
    return next();
  });
}

function getContentTypeByExt(fileName) {
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.jpg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

function parseSubmittedRows(reqBody) {
  if (!reqBody || typeof reqBody !== 'object') return [];

  if (typeof reqBody.warriorsJson === 'string' && reqBody.warriorsJson.trim()) {
    try {
      const parsed = JSON.parse(reqBody.warriorsJson);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {
      return [];
    }
  }

  if (Array.isArray(reqBody.warriors)) {
    return reqBody.warriors;
  }

  // Indexed form alanları: rowId[], username[], kills[], imageMode[], customImageFile[]
  const ids = Array.isArray(reqBody.rowId) ? reqBody.rowId : reqBody.rowId !== undefined ? [reqBody.rowId] : [];
  const usernames = Array.isArray(reqBody.robloxUsername)
    ? reqBody.robloxUsername
    : reqBody.robloxUsername !== undefined
      ? [reqBody.robloxUsername]
      : [];
  const killsArr = Array.isArray(reqBody.kills)
    ? reqBody.kills
    : reqBody.kills !== undefined
      ? [reqBody.kills]
      : [];
  const modesArr = Array.isArray(reqBody.imageMode)
    ? reqBody.imageMode
    : reqBody.imageMode !== undefined
      ? [reqBody.imageMode]
      : [];
  const customFilesArr = Array.isArray(reqBody.customImageFile)
    ? reqBody.customImageFile
    : reqBody.customImageFile !== undefined
      ? [reqBody.customImageFile]
      : [];
  const slotIndexes = Array.isArray(reqBody.slotIndex)
    ? reqBody.slotIndex
    : reqBody.slotIndex !== undefined
      ? [reqBody.slotIndex]
      : [];

  const rows = [];
  for (let i = 0; i < usernames.length; i++) {
    rows.push({
      id: ids[i] !== undefined ? String(ids[i]) : '',
      robloxUsername: usernames[i] !== undefined ? String(usernames[i]) : '',
      kills: killsArr[i] !== undefined ? String(killsArr[i]) : '',
      imageMode: modesArr[i] === 'custom' ? 'custom' : 'roblox',
      customImageFile: customFilesArr[i] !== undefined ? String(customFilesArr[i]) : '',
      _fileField: slotIndexes[i] !== undefined ? `warriorImage_${slotIndexes[i]}` : `warriorImage_${i}`,
    });
  }
  return rows;
}

/**
 * GET /savascilar/gorsel/:file
 * Özel yüklenen savaşçı görsellerini sıkı dosya adı denetimi ile herkese açık sunar.
 */
router.get('/savascilar/gorsel/:file', (req, res) => {
  const fileName = String(req.params.file || '').trim();
  if (!CUSTOM_IMAGE_FILENAME_REGEX.test(fileName)) {
    return res.status(404).send('Görsel bulunamadı.');
  }

  const resolvedPath = warriorsStore.resolveCustomImagePath(fileName);
  if (!resolvedPath) {
    return res.status(404).send('Görsel bulunamadı.');
  }

  res.setHeader('Content-Type', getContentTypeByExt(fileName));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.sendFile(resolvedPath);
});

/**
 * GET /yonetim/savascilar
 * Yalnızca Developer rolüne (1561777507223601353) açık "Klanın Zirvesi" yönetim ekranı.
 */
router.get('/yonetim/savascilar', requireFreshDeveloper, async (req, res) => {
  const store = warriorsStore.getStore();
  const enrichedWarriors = await robloxAvatarService.enrichWarriorsForDisplay(store.warriors);

  const flash = (req.session && req.session.warriorsFlash) || null;
  if (req.session && req.session.warriorsFlash) {
    delete req.session.warriorsFlash;
  }

  const recentHistory = (store.history || [])
    .slice(-LIMITS.displayHistoryCount)
    .reverse();

  return res.render('pages/admin-warriors', {
    title: req.t('warriors.adminPageTitle'),
    warriors: enrichedWarriors,
    storeVersion: store.version,
    updatedAt: store.updatedAt,
    recentHistory,
    flash,
    error: null,
    idempotencyKey: generateIdempotencyKey(req),
    isWarriorsAdminPage: true,
  });
});

/**
 * GET /yonetim/savascilar/yedek
 * Developer için kalıcı JSON yedeğini indirilebilir dosya olarak sunar.
 */
router.get('/yonetim/savascilar/yedek', requireFreshDeveloper, (req, res) => {
  const store = warriorsStore.getStore();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="warriors-backup-v${store.version}.json"`);
  res.setHeader('Cache-Control', 'no-store');
  return res.send(JSON.stringify(store, null, 2));
});

/**
 * POST /yonetim/savascilar
 * Developer rolü ile sıralama, kullanıcı adı, kill sayısı ve özel görsel değişikliklerini kaydeder.
 */
router.post(
  '/yonetim/savascilar',
  requireFreshDeveloper,
  warriorSaveLimiter,
  handleWarriorImagesUpload,
  verifyCsrfToken,
  async (req, res) => {
    const isAjax = Boolean(
      req.xhr ||
      req.get('X-Requested-With') === 'XMLHttpRequest' ||
      (req.headers.accept && req.headers.accept.includes('application/json'))
    );

    const respondError = async (status, message) => {
      const nextKey = generateIdempotencyKey(req);
      if (isAjax) {
        return res.status(status).json({
          ok: false,
          error: message,
          nextIdempotencyKey: nextKey,
        });
      }

      const store = warriorsStore.getStore();
      const enrichedWarriors = await robloxAvatarService.enrichWarriorsForDisplay(store.warriors);
      const recentHistory = (store.history || []).slice(-LIMITS.displayHistoryCount).reverse();
      return res.status(status).render('pages/admin-warriors', {
        title: req.t('warriors.adminPageTitle'),
        warriors: enrichedWarriors,
        storeVersion: store.version,
        updatedAt: store.updatedAt,
        recentHistory,
        flash: null,
        error: message,
        idempotencyKey: nextKey,
        isWarriorsAdminPage: true,
      });
    };

    if (req.warriorUploadError) {
      return respondError(400, req.warriorUploadError);
    }

    const idemKeyProvided = Boolean(
      (req.body && req.body._idempotencyKey) ||
      (req.query && req.query._idempotencyKey) ||
      req.headers['x-idempotency-key']
    );
    let activeIdemKey = null;
    if (idemKeyProvided) {
      const idem = beginIdempotentOperation(req);
      if (!idem.valid) {
        return respondError(409, req.t('errors.duplicateSubmission'));
      }
      activeIdemKey = idem.key;
    }

    const cleanupIdemOnError = () => {
      if (activeIdemKey) rollbackIdempotentOperation(activeIdemKey);
    };

    try {
      const submittedRows = parseSubmittedRows(req.body);
      if (submittedRows.length < LIMITS.minWarriors || submittedRows.length > LIMITS.maxWarriors) {
        cleanupIdemOnError();
        return respondError(400, req.t('warriors.errInvalidOrder'));
      }

      // 1. Ön alan ve görsel doğrulamaları (henüz diske dosya yazmadan!)
      const uploadedFiles = Array.isArray(req.files) ? req.files : [];
      const filesByField = new Map();
      uploadedFiles.forEach((f) => {
        if (f && f.fieldname) filesByField.set(f.fieldname, f);
      });

      const stagedUploads = [];
      const preparedRows = [];

      for (let i = 0; i < submittedRows.length; i++) {
        const rawRow = submittedRows[i] || {};
        const nameRes = warriorsStore.validateRobloxUsername(rawRow.robloxUsername);
        if (!nameRes.valid) {
          cleanupIdemOnError();
          return respondError(400, `#${i + 1}: ${nameRes.error}`);
        }

        const killsRes = warriorsStore.parseKillCount(rawRow.kills);
        if (!killsRes.valid) {
          cleanupIdemOnError();
          return respondError(400, `#${i + 1} (${nameRes.value}): ${killsRes.error}`);
        }

        const fileField = rawRow._fileField || `warriorImage_${i}`;
        const uploaded = filesByField.get(fileField) || null;
        let nextMode = rawRow.imageMode === 'custom' ? 'custom' : 'roblox';
        let newCustomFileName = null;

        if (uploaded) {
          const imgCheck = validateImageBuffer(uploaded.buffer, uploaded.mimetype, uploaded.originalname, {
            maxBytes: LIMITS.maxCustomImageBytes,
            prefix: '',
            fileTooLargeErrorKey: 'warriors.errFileTooLarge',
            fileTooLargeError: req.t('warriors.errFileTooLarge'),
          });
          if (!imgCheck.valid) {
            cleanupIdemOnError();
            return respondError(400, `#${i + 1} (${nameRes.value}): ${imgCheck.error}`);
          }
          newCustomFileName = imgCheck.randomFileName;
          nextMode = 'custom';
          stagedUploads.push({ buffer: uploaded.buffer, fileName: newCustomFileName });
        }

        preparedRows.push({
          id: rawRow.id ? String(rawRow.id) : '',
          robloxUsername: nameRes.value,
          kills: killsRes.value,
          imageMode: nextMode,
          customImageFile: rawRow.customImageFile ? String(rawRow.customImageFile) : '',
          newCustomImageFile: newCustomFileName,
        });
      }

      // 2. Eşzamanlı düzenleme / versiyon kontrolü
      const expectedVersionRaw = req.body && req.body.version !== undefined ? req.body.version : null;
      const expectedVersion =
        expectedVersionRaw !== null && expectedVersionRaw !== ''
          ? Number.parseInt(String(expectedVersionRaw), 10)
          : null;

      if (expectedVersion !== null && expectedVersion !== warriorsStore.getStore().version) {
        cleanupIdemOnError();
        return respondError(409, req.t('warriors.errVersionConflict'));
      }

      // 3. Roblox kullanıcı adlarını doğrula (API geçici çökerse engelleme!)
      const verifyRes = await robloxAvatarService.verifyUsernamesForSave(
        preparedRows.map((r) => r.robloxUsername)
      );
      const resolvedIdsByLower = new Map();
      for (const [lower, prof] of verifyRes.profilesByLower.entries()) {
        if (prof && prof.userId) resolvedIdsByLower.set(lower, prof.userId);
      }

      // 4. Doğrulamalar tamamen geçti: yeni yüklenen özel görselleri Volume/data içine kaydet
      for (const staged of stagedUploads) {
        warriorsStore.saveCustomImageFile(staged.buffer, staged.fileName);
      }

      // 5. Kalıcı depoyu atomik olarak güncelle ve geçmişe ekle
      const actorId = req.session.user.id;
      const actorTag = req.session.user.username || req.session.user.displayName || actorId;

      const saveRes = warriorsStore.updateWarriors(preparedRows, {
        expectedVersion,
        actorId,
        actorTag,
        resolvedIdsByLower,
      });

      if (!saveRes.ok) {
        cleanupIdemOnError();
        return respondError(saveRes.statusCode || 400, saveRes.error);
      }

      if (activeIdemKey) commitIdempotentOperation(req, activeIdemKey);

      // Sunucu denetim logu (gizli anahtar yok)
      console.info(
        `[WARRIORS AUDIT] actor=${actorId} fromVersion=${expectedVersion ?? '?'} toVersion=${saveRes.store.version} changes=${JSON.stringify(saveRes.changes)}`
      );

      let warningMessage = null;
      if (!verifyRes.reachable) {
        warningMessage = req.t('warriors.warningRobloxOffline');
      } else if (verifyRes.missingUsernames.length > 0) {
        warningMessage = `${req.t('warriors.warningMissingUsers')} ${verifyRes.missingUsernames.join(', ')}`;
      }

      if (req.session) {
        req.session.warriorsFlash = {
          success: true,
          message: req.t('warriors.savedSuccess'),
          warning: warningMessage,
          version: saveRes.store.version,
        };
      }

      if (isAjax) {
        return res.status(200).json({
          ok: true,
          redirectUrl: '/yonetim/savascilar',
          version: saveRes.store.version,
          warning: warningMessage,
        });
      }

      // PRG (Post-Redirect-Get)
      return res.redirect('/yonetim/savascilar');
    } catch (err) {
      cleanupIdemOnError();
      console.error('[WARRIORS PANEL] Kayıt hatası:', err.message);
      return respondError(500, req.t('warriors.errSaveFailed'));
    }
  }
);

module.exports = router;
