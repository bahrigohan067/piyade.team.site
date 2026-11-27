const express = require('express');
const router = express.Router();

const serversConfig = require('../config/servers.config');
const { getServerDirectory } = require('../services/serverDirectory');
const { requireFreshDeveloper } = require('../middlewares/auth');
const { serverVerifyLimiter } = require('../middlewares/rateLimiter');
const {
  generateIdempotencyKey,
  beginIdempotentOperation,
  commitIdempotentOperation,
  rollbackIdempotentOperation,
} = require('../middlewares/idempotency');

function applyNoIndex(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store');
  if (req && typeof req.applySeo === 'function') {
    req.applySeo({ noindex: true, isPublic: false });
  }
}

function wantsJsonResponse(req) {
  return Boolean(
    req.xhr ||
      (req.headers.accept && req.headers.accept.includes('application/json')) ||
      (req.headers['content-type'] && req.headers['content-type'].includes('application/json'))
  );
}

function getActorId(req) {
  return (req.session && req.session.user && req.session.user.id) || 'developer';
}

function mapDirectoryError(req, code) {
  const map = {
    MAX_SERVERS_REACHED: 'adminServers.errMaxServers',
    INVALID_CODE_FORMAT: 'adminServers.errInvalidCode',
    DUPLICATE_CODE: 'adminServers.errDuplicateCode',
    DUPLICATE_GUILD: 'adminServers.errDuplicateGuild',
    INVITE_INVALID: 'adminServers.errInviteInvalid',
    DISCORD_RATE_LIMITED: 'adminServers.errDiscordRateLimited',
    DISCORD_FETCH_FAILED: 'adminServers.errDiscordFetchFailed',
    FLAGGED_CONFIRM_REQUIRED: 'adminServers.errFlaggedConfirmRequired',
    NOT_FOUND: 'adminServers.errNotFound',
    INVALID_ORDER: 'adminServers.errInvalidOrder',
  };
  const key = map[code];
  return key && req.t ? req.t(key) : req.t ? req.t('adminServers.errGeneric') : 'İşlem başarısız oldu.';
}

// Tüm /yonetim/sunucular rotaları YALNIZCA taze doğrulanmış Discord Developer rolüne açıktır (diğer herkese 404).
router.use(requireFreshDeveloper);

/**
 * GET /yonetim/sunucular — Developer Sunucu Yönetim Paneli
 */
router.get('/', (req, res) => {
  applyNoIndex(req, res);

  const dir = getServerDirectory();
  const lang = req.lang === 'en' ? 'en' : 'tr';
  const adminData = dir.getAdminList();
  const auditLogs = dir.getAuditLogs(25);
  const flashSuccess = (req.session && req.session.serversAdminSuccess) || null;
  const flashError = (req.session && req.session.serversAdminError) || null;
  if (req.session) {
    delete req.session.serversAdminSuccess;
    delete req.session.serversAdminError;
  }

  return res.render('pages/admin-servers', {
    title: req.t('adminServers.pageTitle'),
    isAdminServersPage: true,
    adminData,
    auditLogs,
    idempotencyKey: generateIdempotencyKey(req),
    flashSuccess,
    flashError,
    formatCreatedMonth: (iso) => serversConfig.formatCreatedMonth(iso, lang),
    lang,
  });
});

/**
 * GET /yonetim/sunucular/api/idempotency-key — Yeni tek kullanımlık gönderim anahtarı
 */
router.get('/api/idempotency-key', (req, res) => {
  applyNoIndex(req, res);
  return res.json({
    ok: true,
    idempotencyKey: generateIdempotencyKey(req),
  });
});

/**
 * POST /yonetim/sunucular/api/dogrula — Canlı Discord doğrulama & önizleme (6/dk hız sınırı, CSRF)
 */
router.post('/api/dogrula', serverVerifyLimiter, async (req, res) => {
  applyNoIndex(req, res);

  const rawInput = req.body && typeof req.body.invite === 'string' ? req.body.invite : '';
  const dir = getServerDirectory();
  const lang = req.lang === 'en' ? 'en' : 'tr';

  try {
    const result = await dir.verifyInviteForAdd(rawInput);
    if (!result.ok) {
      const status =
        result.code === 'MAX_SERVERS_REACHED' ||
        result.code === 'INVALID_CODE_FORMAT' ||
        result.code === 'DUPLICATE_CODE' ||
        result.code === 'DUPLICATE_GUILD'
          ? 400
          : result.code === 'INVITE_INVALID'
            ? 404
            : result.code === 'DISCORD_RATE_LIMITED'
              ? 429
              : 502;

      return res.status(status).json({
        ok: false,
        code: result.code,
        error: mapDirectoryError(req, result.code),
      });
    }

    return res.json({
      ok: true,
      code: result.code,
      flagged: result.flagged,
      flaggedReasons: result.flaggedReasons,
      expiresAt: result.expiresAt,
      createdMonthText: result.preview && result.preview.createdAt
        ? serversConfig.formatCreatedMonth(result.preview.createdAt, lang)
        : '',
      preview: result.preview,
    });
  } catch (err) {
    console.error('[YONETIM-SUNUCULAR] Doğrulama hatası:', err && err.message ? err.message : err);
    return res.status(500).json({
      ok: false,
      code: 'VERIFY_ERROR',
      error: req.t('adminServers.errGeneric'),
    });
  }
});

/**
 * POST /yonetim/sunucular/ekle — Sunucu ekleme (CSRF + tek kullanımlık idempotency + PRG)
 */
router.post('/ekle', async (req, res) => {
  applyNoIndex(req, res);
  const asJson = wantsJsonResponse(req);

  const idem = beginIdempotentOperation(req);
  if (!idem.valid) {
    const msg =
      idem.reason === 'DUPLICATE'
        ? req.t('adminServers.errDuplicateSubmit')
        : req.t('adminServers.errMissingIdempotency');
    if (asJson) {
      return res.status(409).json({
        ok: false,
        code: idem.reason === 'DUPLICATE' ? 'DUPLICATE_SUBMIT' : 'MISSING_IDEMPOTENCY',
        error: msg,
        nextIdempotencyKey: generateIdempotencyKey(req),
      });
    }
    if (req.session) req.session.serversAdminError = msg;
    return res.redirect(303, '/yonetim/sunucular');
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const rawInput = typeof body.invite === 'string' ? body.invite : '';
  const label = typeof body.label === 'string' ? body.label : '';
  const note = typeof body.note === 'string' ? body.note : '';
  const confirmFlagged =
    body.confirmFlagged === true ||
    body.confirmFlagged === 'true' ||
    body.confirmFlagged === '1' ||
    body.confirmFlagged === 'on';

  const dir = getServerDirectory();

  try {
    const result = await dir.addServer({
      rawInput,
      label,
      note,
      confirmFlagged,
      actorId: getActorId(req),
    });

    if (!result.ok) {
      rollbackIdempotentOperation(idem.key);
      const errMsg = mapDirectoryError(req, result.code);
      const status =
        result.code === 'INVITE_INVALID'
          ? 404
          : result.code === 'DISCORD_RATE_LIMITED'
            ? 429
            : result.code === 'DISCORD_FETCH_FAILED'
              ? 502
              : 400;

      if (asJson) {
        return res.status(status).json({
          ok: false,
          code: result.code,
          error: errMsg,
          flaggedReasons: result.flaggedReasons || [],
          nextIdempotencyKey: generateIdempotencyKey(req),
        });
      }
      if (req.session) req.session.serversAdminError = errMsg;
      return res.redirect(303, '/yonetim/sunucular');
    }

    commitIdempotentOperation(req, idem.key);
    const successMsg = req.t('adminServers.msgAdded').replace('{name}', result.server.preview.name);

    if (asJson) {
      return res.status(201).json({
        ok: true,
        message: successMsg,
        server: result.server,
        adminData: dir.getAdminList(),
        nextIdempotencyKey: generateIdempotencyKey(req),
      });
    }

    if (req.session) req.session.serversAdminSuccess = successMsg;
    return res.redirect(303, '/yonetim/sunucular');
  } catch (err) {
    rollbackIdempotentOperation(idem.key);
    console.error('[YONETIM-SUNUCULAR] Ekleme hatası:', err && err.message ? err.message : err);
    const msg = req.t('adminServers.errGeneric');
    if (asJson) {
      return res.status(500).json({
        ok: false,
        code: 'ADD_FAILED',
        error: msg,
        nextIdempotencyKey: generateIdempotencyKey(req),
      });
    }
    if (req.session) req.session.serversAdminError = msg;
    return res.redirect(303, '/yonetim/sunucular');
  }
});

/**
 * POST /yonetim/sunucular/sirala — Yukarı/aşağı veya sürükle-bırak sıralama
 */
router.post('/sirala', (req, res) => {
  applyNoIndex(req, res);
  const asJson = wantsJsonResponse(req);
  const rawOrder = req.body && req.body.order;
  const orderArray = Array.isArray(rawOrder)
    ? rawOrder
    : typeof rawOrder === 'string'
      ? rawOrder.split(',').map((x) => x.trim()).filter(Boolean)
      : [];

  const dir = getServerDirectory();
  const result = dir.reorderServers(orderArray, getActorId(req));

  if (!result.ok) {
    const errMsg = mapDirectoryError(req, result.code);
    if (asJson) return res.status(400).json({ ok: false, code: result.code, error: errMsg });
    if (req.session) req.session.serversAdminError = errMsg;
    return res.redirect(303, '/yonetim/sunucular');
  }

  if (asJson) {
    return res.json({
      ok: true,
      message: req.t('adminServers.msgReordered'),
      adminData: dir.getAdminList(),
    });
  }
  if (req.session) req.session.serversAdminSuccess = req.t('adminServers.msgReordered');
  return res.redirect(303, '/yonetim/sunucular');
});

/**
 * POST /yonetim/sunucular/yenile-hepsi — Tüm sunucuları şimdi yenile (Orbital Loader canlı ilerleme destekli)
 */
router.post('/yenile-hepsi', async (req, res) => {
  applyNoIndex(req, res);
  const streamMode = req.query && req.query.stream === '1';
  const asJson = wantsJsonResponse(req);
  const dir = getServerDirectory();

  try {
    if (streamMode) {
      res.status(200);
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('X-Accel-Buffering', 'no');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();

      const summary = await dir.refreshAll({
        onProgress: (ev) => {
          try {
            res.write(`${JSON.stringify({ type: 'progress', ...ev })}\n`);
          } catch (_) {}
        },
      });
      dir.logAudit(getActorId(req), 'refresh_all', `${summary.total}`);
      res.write(`${JSON.stringify({ type: 'done', ok: true, summary, adminData: dir.getAdminList() })}\n`);
      return res.end();
    }

    const summary = await dir.refreshAll();
    dir.logAudit(getActorId(req), 'refresh_all', `${summary.total}`);
    const msg = req.t('adminServers.msgRefreshedAll');

    if (asJson) {
      return res.json({
        ok: true,
        message: msg,
        summary,
        adminData: dir.getAdminList(),
      });
    }
    if (req.session) req.session.serversAdminSuccess = msg;
    return res.redirect(303, '/yonetim/sunucular');
  } catch (err) {
    console.error('[YONETIM-SUNUCULAR] Toplu yenileme hatası:', err && err.message ? err.message : err);
    if (streamMode) {
      try {
        res.write(`${JSON.stringify({ type: 'error', ok: false, error: req.t('adminServers.errGeneric') })}\n`);
      } catch (_) {}
      return res.end();
    }
    if (asJson) return res.status(500).json({ ok: false, error: req.t('adminServers.errGeneric') });
    if (req.session) req.session.serversAdminError = req.t('adminServers.errGeneric');
    return res.redirect(303, '/yonetim/sunucular');
  }
});

/**
 * POST /yonetim/sunucular/:id/duzenle — Yedek ad (label) ve iç not (note) düzenleme
 */
router.post('/:id/duzenle', (req, res) => {
  applyNoIndex(req, res);
  const asJson = wantsJsonResponse(req);
  const id = String(req.params.id || '').trim();
  const body = req.body && typeof req.body === 'object' ? req.body : {};

  const dir = getServerDirectory();
  const result = dir.updateServer(
    id,
    {
      label: typeof body.label === 'string' ? body.label : undefined,
      note: typeof body.note === 'string' ? body.note : undefined,
    },
    getActorId(req)
  );

  if (!result.ok) {
    const errMsg = mapDirectoryError(req, result.code);
    if (asJson) return res.status(404).json({ ok: false, code: result.code, error: errMsg });
    if (req.session) req.session.serversAdminError = errMsg;
    return res.redirect(303, '/yonetim/sunucular');
  }

  const msg = req.t('adminServers.msgUpdated');
  if (asJson) return res.json({ ok: true, message: msg, server: result.server, adminData: dir.getAdminList() });
  if (req.session) req.session.serversAdminSuccess = msg;
  return res.redirect(303, '/yonetim/sunucular');
});

/**
 * POST /yonetim/sunucular/:id/one-cikar — Yalnızca bu sunucuyu öne çıkan yapar
 */
router.post('/:id/one-cikar', (req, res) => {
  applyNoIndex(req, res);
  const asJson = wantsJsonResponse(req);
  const id = String(req.params.id || '').trim();
  const dir = getServerDirectory();
  const result = dir.setFeatured(id, getActorId(req));

  if (!result.ok) {
    const errMsg = mapDirectoryError(req, result.code);
    if (asJson) return res.status(404).json({ ok: false, code: result.code, error: errMsg });
    if (req.session) req.session.serversAdminError = errMsg;
    return res.redirect(303, '/yonetim/sunucular');
  }

  const msg = req.t('adminServers.msgFeatured');
  if (asJson) return res.json({ ok: true, message: msg, server: result.server, adminData: dir.getAdminList() });
  if (req.session) req.session.serversAdminSuccess = msg;
  return res.redirect(303, '/yonetim/sunucular');
});

/**
 * POST /yonetim/sunucular/:id/gizle — Gizle / Göster geçişi
 */
router.post('/:id/gizle', (req, res) => {
  applyNoIndex(req, res);
  const asJson = wantsJsonResponse(req);
  const id = String(req.params.id || '').trim();
  const dir = getServerDirectory();
  const result = dir.toggleHidden(id, getActorId(req));

  if (!result.ok) {
    const errMsg = mapDirectoryError(req, result.code);
    if (asJson) return res.status(404).json({ ok: false, code: result.code, error: errMsg });
    if (req.session) req.session.serversAdminError = errMsg;
    return res.redirect(303, '/yonetim/sunucular');
  }

  const msg = result.server.hidden ? req.t('adminServers.msgHidden') : req.t('adminServers.msgShown');
  if (asJson) return res.json({ ok: true, message: msg, server: result.server, adminData: dir.getAdminList() });
  if (req.session) req.session.serversAdminSuccess = msg;
  return res.redirect(303, '/yonetim/sunucular');
});

/**
 * POST /yonetim/sunucular/:id/onayla — Otomatik filtreye takılan (flagged) kaydı inceleyip onayla
 */
router.post('/:id/onayla', (req, res) => {
  applyNoIndex(req, res);
  const asJson = wantsJsonResponse(req);
  const id = String(req.params.id || '').trim();
  const dir = getServerDirectory();
  const result = dir.approveFlagged(id, getActorId(req));

  if (!result.ok) {
    const errMsg = mapDirectoryError(req, result.code);
    if (asJson) return res.status(404).json({ ok: false, code: result.code, error: errMsg });
    if (req.session) req.session.serversAdminError = errMsg;
    return res.redirect(303, '/yonetim/sunucular');
  }

  const msg = req.t('adminServers.msgApproved');
  if (asJson) return res.json({ ok: true, message: msg, server: result.server, adminData: dir.getAdminList() });
  if (req.session) req.session.serversAdminSuccess = msg;
  return res.redirect(303, '/yonetim/sunucular');
});

/**
 * POST /yonetim/sunucular/:id/yenile — Tek sunucuyu şimdi yenile
 */
router.post('/:id/yenile', async (req, res) => {
  applyNoIndex(req, res);
  const asJson = wantsJsonResponse(req);
  const id = String(req.params.id || '').trim();
  const dir = getServerDirectory();

  try {
    const updated = await dir.refreshSingle(id);
    if (!updated) {
      const errMsg = mapDirectoryError(req, 'NOT_FOUND');
      if (asJson) return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: errMsg });
      if (req.session) req.session.serversAdminError = errMsg;
      return res.redirect(303, '/yonetim/sunucular');
    }

    dir.logAudit(getActorId(req), 'refresh_single', updated.code);
    const msg = req.t('adminServers.msgRefreshedOne');
    if (asJson) return res.json({ ok: true, message: msg, server: updated, adminData: dir.getAdminList() });
    if (req.session) req.session.serversAdminSuccess = msg;
    return res.redirect(303, '/yonetim/sunucular');
  } catch (err) {
    console.error('[YONETIM-SUNUCULAR] Tekil yenileme hatası:', err && err.message ? err.message : err);
    if (asJson) return res.status(500).json({ ok: false, error: req.t('adminServers.errGeneric') });
    if (req.session) req.session.serversAdminError = req.t('adminServers.errGeneric');
    return res.redirect(303, '/yonetim/sunucular');
  }
});

/**
 * POST /yonetim/sunucular/:id/sil — Sunucu silme
 */
router.post('/:id/sil', (req, res) => {
  applyNoIndex(req, res);
  const asJson = wantsJsonResponse(req);
  const id = String(req.params.id || '').trim();
  const dir = getServerDirectory();
  const result = dir.deleteServer(id, getActorId(req));

  if (!result.ok) {
    const errMsg = mapDirectoryError(req, result.code);
    if (asJson) return res.status(404).json({ ok: false, code: result.code, error: errMsg });
    if (req.session) req.session.serversAdminError = errMsg;
    return res.redirect(303, '/yonetim/sunucular');
  }

  const msg = req.t('adminServers.msgDeleted');
  if (asJson) return res.json({ ok: true, message: msg, adminData: dir.getAdminList() });
  if (req.session) req.session.serversAdminSuccess = msg;
  return res.redirect(303, '/yonetim/sunucular');
});

module.exports = router;
