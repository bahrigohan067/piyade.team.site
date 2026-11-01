const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { botApiClient, BotApiUnavailableError, BotApiError } = require('../services/botApiClient');
const { requireManagement } = require('../middlewares/auth');
const { formLimiter } = require('../middlewares/rateLimiter');
const { RULES } = require('../config/rules.config');
const appConfig = require('../config/app.config');

// Uploads klasörü hazırlığı
const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer yapılandırması (Görsel yüklemeleri için)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    const unique = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
    cb(null, unique);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (req, file, cb) => {
    const allowedMime = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowedMime.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Sadece JPEG, PNG, WEBP veya GIF formatında görseller yüklenebilir.'));
    }
  },
});

// Tüm yönetim rotaları Yönetmenlik ve Developer kontrolünden geçer
router.use(requireManagement);

/**
 * GET /yonetim/uyari
 * Uyarı Verme Ekranı: Üye seçimi, ceza türü, kural seçimi, sebep ve kanıt yükleme
 */
router.get('/uyari', async (req, res, next) => {
  const actorId = req.session.user.id;
  const targetId = req.query.targetUserId || '';

  try {
    let preselectedMember = null;
    if (targetId && /^\d{1,21}$/.test(targetId)) {
      try {
        preselectedMember = await botApiClient.getAdminMemberDetail(actorId, targetId);
      } catch (e) {
        console.warn('[ÖN SEÇİM HATASI]:', e.message);
      }
    }

    res.render('pages/admin-warn', {
      title: 'Disiplin & Uyarı Ver | Yönetim Paneli',
      rules: RULES,
      preselectedMember,
      targetId,
      result: req.session.warnResult || null,
      error: req.session.warnError || null,
    });

    req.session.warnResult = null;
    req.session.warnError = null;
  } catch (err) {
    next(err);
  }
});

/**
 * POST /yonetim/uyari
 * Ceza Uygulama İşlemi (Bot API /api/admin/warn çağrısı)
 */
router.post('/uyari', upload.single('evidenceFile'), formLimiter, async (req, res, next) => {
  const actorId = req.session.user.id;
  const { targetUserId, type, reason, ruleCode, evidenceUrlInput } = req.body;

  try {
    // 1. Temel Girdi Doğrulamaları
    if (!targetUserId || !/^\d{1,21}$/.test(String(targetUserId).trim())) {
      req.session.warnError = 'Geçerli bir hedef üye Discord ID\'si girilmeli veya listeden seçilmelidir.';
      return res.redirect('/yonetim/uyari');
    }

    const cleanType = String(type || '').trim().toLowerCase();
    if (cleanType !== 'verbal' && cleanType !== 'official') {
      req.session.warnError = 'Ceza türü Sözlü veya Resmi olarak seçilmelidir.';
      return res.redirect('/yonetim/uyari');
    }

    if (cleanType === 'verbal') {
      if (!reason || reason.trim().length < 2) {
        req.session.warnError = 'Sözlü uyarı için geçerli bir gerekçe belirtilmelidir (en az 2 karakter).';
        return res.redirect(`/yonetim/uyari?targetUserId=${targetUserId}`);
      }
    }

    if (cleanType === 'official') {
      if (!ruleCode || !RULES[ruleCode.trim().toUpperCase()]) {
        req.session.warnError = 'Geçerli bir ihlal kuralı (M1-M13, D1-D3, Y1-Y5) seçilmelidir.';
        return res.redirect(`/yonetim/uyari?targetUserId=${targetUserId}`);
      }
    }

    // 2. Bot API'ye Uyarıyı Uygulat
    const warnResponse = await botApiClient.applyWarning(actorId, {
      targetUserId: targetUserId.trim(),
      type: cleanType,
      reason: reason ? reason.trim() : null,
      ruleCode: ruleCode ? ruleCode.trim().toUpperCase() : null,
    });

    // 3. Kanıt Görseli Varsa Ekle
    let evidenceUrl = null;
    if (req.file) {
      // Yüklenen dosya
      evidenceUrl = `${appConfig.BASE_URL}/uploads/${req.file.filename}`;
    } else if (evidenceUrlInput && /^https?:\/\/\S+/i.test(evidenceUrlInput.trim())) {
      // Dış bağlantı URL'i
      evidenceUrl = evidenceUrlInput.trim();
    }

    if (evidenceUrl && warnResponse.warnId) {
      try {
        await botApiClient.attachWarningEvidence(actorId, warnResponse.warnId, evidenceUrl);
        warnResponse.evidenceUrl = evidenceUrl;
      } catch (evidenceErr) {
        console.warn('[KANIT EKLEME UYARISI]:', evidenceErr.message);
      }
    }

    req.session.warnResult = {
      success: true,
      warnId: warnResponse.warnId,
      type: cleanType,
      targetUserId: targetUserId.trim(),
      ruleCode: warnResponse.ruleCode || null,
      ruleDescription: warnResponse.ruleDescription || null,
      actionTaken: warnResponse.actionTaken || 'Sicil kaydı oluşturuldu.',
      newStats: warnResponse.newStats || null,
      evidenceUrl: evidenceUrl || null,
    };

    return res.redirect('/yonetim/uyari');
  } catch (err) {
    console.error('[UYARI UYGULAMA HATASI]:', err.message);

    // Hiyerarşi veya bot kural hatası
    const errorMessage =
      err instanceof BotApiError
        ? err.message
        : err instanceof BotApiUnavailableError
        ? 'Bot API servisine şu anda ulaşılamıyor.'
        : `Ceza uygulanırken hata oluştu: ${err.message}`;

    req.session.warnError = errorMessage;
    return res.redirect(`/yonetim/uyari?targetUserId=${targetUserId || ''}`);
  }
});

/**
 * GET /yonetim/uyeler
 * Üye Arama ve Listeleme
 */
router.get('/uyeler', async (req, res, next) => {
  const actorId = req.session.user.id;
  const query = String(req.query.query || '').trim();

  try {
    const searchData = await botApiClient.searchAdminMembers(actorId, query);

    res.render('pages/admin-members', {
      title: 'Üye Bilgileri & Sicil Arama | Yönetim Paneli',
      query,
      members: searchData.members || [],
      total: searchData.total || 0,
      selectedMember: null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /yonetim/uyeler/:id
 * Tekil Üye Detayı (Tüm Discord, Roller, Roblox, Tryout, VS ve Sicil Kartları)
 */
router.get('/uyeler/:id', async (req, res, next) => {
  const actorId = req.session.user.id;
  const memberId = req.params.id;

  if (!memberId || !/^\d{1,21}$/.test(memberId)) {
    return res.redirect('/yonetim/uyeler');
  }

  try {
    const memberDetail = await botApiClient.getAdminMemberDetail(actorId, memberId);

    res.render('pages/admin-members', {
      title: `${memberDetail.discord?.displayName || memberId} | Üye Sicil Kartı`,
      query: '',
      members: [],
      total: 1,
      selectedMember: memberDetail,
    });
  } catch (err) {
    if (err instanceof BotApiError && err.status === 404) {
      return res.status(404).render('errors/404', {
        title: 'Üye Bulunamadı',
        url: req.originalUrl,
      });
    }
    next(err);
  }
});

/**
 * GET /yonetim/api/search
 * Uyarı formunda anlık üye araması (AJAX)
 */
router.get('/api/search', async (req, res) => {
  const actorId = req.session.user.id;
  const query = String(req.query.q || '').trim();

  try {
    const searchData = await botApiClient.searchAdminMembers(actorId, query);
    return res.json({ members: searchData.members || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
