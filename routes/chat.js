const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const router = express.Router();

const appConfig = require('../config/app.config');
const authConfig = require('../config/auth.config');
const brandConfig = require('../config/brand.config');
const chatConfig = require('../config/chat.config');
const gamesConfig = require('../config/games.config');
const { isRegisteredMember } = require('../config/roles.config');
const botApiClient = require('../services/botApiClient');
const {
  getChatStore,
  makeConvId,
  parseConvId,
  makeGroupConvId,
  parseGroupConvId,
  isGroupConvId,
  isValidDiscordId,
  isValidChatUserId,
  sanitizeChatText,
} = require('../services/chatStore');
const { getMemberStore, parseUnifiedGoogleId } = require('../services/memberStore');
const { chatSseHub } = require('../services/chatSseHub');
const { chatMessageLimiter, chatGroupMessageLimiter, chatUploadLimiter } = require('../middlewares/rateLimiter');
const chatFileValidator = require('../utils/chatFileValidator');
const chatAutoFilter = require('../services/chatAutoFilter');
const { containsExternalLink } = require('../utils/nicknameValidator');
const { getChatModStore, REPORT_CATEGORIES } = require('../services/chatModStore');

// Profil bilgi kartı (Nebula Glass Card) için 60 saniyelik sunucu bellek önbelleği (yalnızca ham üye kaydı; gizlilik anlık kontrol edilir)
const profileCardRawCache = new Map(); // targetId -> { item, expiresAt }
// Grup sohbeti hızlı tekrar eden / aynı mesaj koruma önbelleği (userId -> { normText, ts })
const groupRecentMsgMap = new Map();
// Google üye Roblox avatarı 6 saatlik yenileme hata geri çekilme haritası (robloxId -> nextAllowedAttemptTs)
const robloxAvatarRefreshBackoff = new Map();

function clearProfileCardCache() {
  profileCardRawCache.clear();
}

function clearGroupDuplicateTracker() {
  groupRecentMsgMap.clear();
}

function clearAvatarRefreshBackoff() {
  robloxAvatarRefreshBackoff.clear();
}

// Parça 4 moderasyon dosya erişim kancası (varsayılan kapalı; Parça 4 tarafından bağlanır)
let modFileAccessAuthorizer = null;
function setModFileAccessAuthorizer(fn) {
  modFileAccessAuthorizer = typeof fn === 'function' ? fn : null;
}

const chatUploadStorage = multer.diskStorage({
  destination(req, file, cb) {
    const store = getChatStore();
    try {
      if (!fs.existsSync(store.tmpDir)) {
        fs.mkdirSync(store.tmpDir, { recursive: true, mode: 0o700 });
      }
      cb(null, store.tmpDir);
    } catch (err) {
      cb(err);
    }
  },
  filename(req, file, cb) {
    cb(null, `up_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.part`);
  },
});

const uploadSingleChatFile = multer({
  storage: chatUploadStorage,
  limits: {
    fileSize: chatConfig.FILES.MAX_VIDEO_BYTES,
    files: 1,
  },
}).single('file');

/**
 * 1) Özellik bayrağı koruması: CHAT_ENABLED kapalıysa tüm /sohbet* yolları 404 döner.
 * Ayrıca tüm sohbet sayfaları noindex ve Feedback Pill gizli (data-feedback="off") olur.
 */
router.use((req, res, next) => {
  if (!appConfig.isChatEnabled()) {
    return next('router');
  }
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.locals.disableFeedbackPill = true;
  if (req && typeof req.applySeo === 'function') {
    req.applySeo({ noindex: true, isPublic: false });
  } else if (res.locals && res.locals.seo) {
    res.locals.seo.noindex = true;
    res.locals.seo.isPublic = false;
  }
  return next();
});

function wantsJsonResponse(req) {
  return Boolean(
    req.path.startsWith('/api/') ||
      req.path === '/akis' ||
      req.xhr ||
      (req.headers.accept && req.headers.accept.includes('application/json'))
  );
}

function isGoogleChatUser(user) {
  return Boolean(user && (user.kind === 'google' || parseUnifiedGoogleId(String(user.id || ''))));
}

function getFreshGoogleMember(user) {
  if (!isGoogleChatUser(user)) return null;
  const memberStore = getMemberStore();
  if (user.memberId) return memberStore.findById(user.memberId);
  return memberStore.findByUnifiedId(String(user.id || ''));
}

function isNewGoogleMemberRestricted(user) {
  if (!isGoogleChatUser(user)) return false;
  const member = getFreshGoogleMember(user);
  if (!member) return false;
  const limitMs = authConfig.getNewMemberRestrictionMs();
  if (limitMs <= 0) return false;
  const createdAt = Number(member.createdAt) || 0;
  return createdAt > 0 && Date.now() - createdAt < limitMs;
}

function isUserChatEligible(user) {
  if (!user || !user.id) return false;
  if (isGoogleChatUser(user)) {
    if (!chatConfig.isChatGoogleMembersEnabled()) return false;
    if (!isValidChatUserId(String(user.id))) return false;
    const member = getFreshGoogleMember(user);
    if (!member || member.status !== 'active') return false;
    return getMemberStore().hasConsent(member, 'international_data_transfer');
  }
  if (!isValidDiscordId(String(user.id))) return false;
  if (user.registered === true) return true;
  if (user.registered === false) return false;
  return isRegisteredMember(user.roles, user.level, user.registered);
}

/**
 * Aktif Google üyelerinin kayıtlı Roblox avatarlarını 6 saatlik periyotla
 * Bot API (POST /api/roblox/avatars, site-service) üzerinden tazeler.
 */
async function maybeRefreshGoogleRobloxAvatars(members = []) {
  const list = Array.isArray(members) ? members.filter(Boolean) : [];
  if (list.length === 0) return;
  const now = Date.now();
  const refreshMs = chatConfig.LIMITS.ROBLOX_AVATAR_REFRESH_MS || 6 * 60 * 60 * 1000;
  const staleRobloxIds = [];

  for (const m of list) {
    if (!m || m.status !== 'active' || !Array.isArray(m.games)) continue;
    const rbGame = m.games.find((g) => g && g.id === 'roblox' && g.robloxId);
    if (!rbGame) continue;
    const rid = String(rbGame.robloxId).trim();
    if (!/^\d{1,20}$/.test(rid)) continue;
    const lastRef = Number(m.robloxAvatarRefreshedAt) || Number(m.createdAt) || 0;
    const needsRefresh = !rbGame.robloxAvatarUrl || now - lastRef >= refreshMs;
    if (!needsRefresh) continue;
    const backoffUntil = robloxAvatarRefreshBackoff.get(rid) || 0;
    if (backoffUntil > now) continue;
    if (!staleRobloxIds.includes(rid)) staleRobloxIds.push(rid);
  }

  if (staleRobloxIds.length === 0) return;

  try {
    const resp = await botApiClient.fetchRobloxAvatarsAsService(staleRobloxIds.slice(0, 50));
    const avatarsObj =
      resp && typeof resp === 'object'
        ? (resp.avatars && typeof resp.avatars === 'object' ? resp.avatars : resp)
        : {};
    const validEntries = {};
    for (const [rid, urlVal] of Object.entries(avatarsObj)) {
      if (typeof urlVal === 'string' && /^https?:\/\//i.test(urlVal.trim())) {
        validEntries[rid] = urlVal.trim();
      }
    }
    if (Object.keys(validEntries).length > 0) {
      getMemberStore().updateRobloxAvatarsByRobloxId(validEntries, now);
    } else {
      for (const rid of staleRobloxIds) {
        robloxAvatarRefreshBackoff.set(rid, now + 5 * 60 * 1000);
      }
    }
  } catch (_) {
    for (const rid of staleRobloxIds) {
      robloxAvatarRefreshBackoff.set(rid, now + 5 * 60 * 1000);
    }
  }
}

/**
 * Hem Discord üyelerini (Bot API üzerinden) hem de Google site üyelerini (memberStore üzerinden)
 * tek bir ortak rehber haritasında çözümler. E-posta ve Google adı ASLA dönmez.
 */
async function lookupUnifiedMembers(requesterUser, ids = [], { includeGames = false, forceService = false } = {}) {
  const byId = new Map();
  const discordIds = [];
  const googleIds = [];
  for (const rawId of Array.isArray(ids) ? ids : []) {
    const clean = String(rawId || '').trim();
    if (!clean) continue;
    if (parseUnifiedGoogleId(clean)) {
      googleIds.push(clean);
    } else if (isValidDiscordId(clean)) {
      discordIds.push(clean);
    }
  }

  const memberStore = getMemberStore();
  const matchedGoogleMembers = [];
  for (const gid of [...new Set(googleIds)]) {
    const member = memberStore.findByUnifiedId(gid);
    if (member && member.status === 'active') {
      matchedGoogleMembers.push(member);
    }
  }
  if (matchedGoogleMembers.length > 0) {
    await maybeRefreshGoogleRobloxAvatars(matchedGoogleMembers);
    for (const gm of matchedGoogleMembers) {
      const freshGm = memberStore.findById(gm.id) || gm;
      const pub = memberStore.toPublicChatDirectoryItem(freshGm);
      if (pub) {
        byId.set(pub.id, pub);
      }
    }
  }

  let botFailed = false;
  if (discordIds.length > 0) {
    const requesterIsGoogle = isGoogleChatUser(requesterUser);
    const useService = Boolean(forceService || requesterIsGoogle || includeGames);
    try {
      const lookup = await botApiClient.lookupDirectoryMembers(
        useService ? 'site' : String(requesterUser.id),
        [...new Set(discordIds)],
        { asService: useService, includeGames: Boolean(includeGames) }
      );
      for (const [k, v] of lookup.byId.entries()) {
        byId.set(k, v);
      }
    } catch (_) {
      botFailed = true;
    }
  }

  return { byId, botFailed };
}

/**
 * 2) Kayıtlı üye erişim kontrolü.
 * HTML GET isteklerinde girişsiz veya kayıtsız kullanıcıya 404 yerine nazik "Önce kayıt ol" (not-registered) ekranı gösterilir.
 */
function requireChatMember(req, res, next) {
  const user = req.session && req.session.user;
  const isJson = wantsJsonResponse(req);

  if (!user || !user.id) {
    if (isJson) {
      return res.status(401).json({
        ok: false,
        code: 'AUTH_REQUIRED',
        error: req.t ? req.t('chat.errAuthRequired') : 'Oturum açmanız gerekiyor.',
      });
    }
    const siteName = brandConfig.getSiteName ? brandConfig.getSiteName() : 'Piyade World';
    return res.status(403).render('pages/not-registered', {
      title: req.t ? req.t('notRegistered.pageTitle') : `Önce Kayıt Ol — ${siteName}`,
      inGuild: false,
    });
  }

  if (!isUserChatEligible(user)) {
    if (isGoogleChatUser(user)) {
      if (!chatConfig.isChatGoogleMembersEnabled()) {
        const msg = req.t
          ? req.t('chat.errGoogleMembersDisabled')
          : 'Google site üyeleri için sohbet erişimi şu anda kapalıdır.';
        if (isJson) {
          return res.status(403).json({
            ok: false,
            code: 'GOOGLE_CHAT_DISABLED',
            error: msg,
          });
        }
        const siteName = brandConfig.getSiteName ? brandConfig.getSiteName() : 'Piyade World';
        return res.status(403).render('errors/403', {
          title: req.t ? req.t('errors.403Title') : `Yetkisiz Erişim — ${siteName}`,
          message: msg,
        });
      }
      if (isJson) {
        return res.status(403).json({
          ok: false,
          code: 'CONSENT_WITHDRAWN',
          error: req.t ? req.t('googleProfile.flashConsentCWithdrawn') : 'Gerekli açık rıza geri çekildi.',
        });
      }
      return res.redirect('/profil#rizalarim');
    }
    if (isJson) {
      return res.status(403).json({
        ok: false,
        code: 'NOT_REGISTERED',
        error: req.t ? req.t('chat.errNotRegistered') : 'Sohbet yalnızca kayıtlı üyelere açıktır.',
      });
    }
    const siteName = brandConfig.getSiteName ? brandConfig.getSiteName() : 'Piyade World';
    return res.status(403).render('pages/not-registered', {
      title: req.t ? req.t('notRegistered.pageTitle') : `Önce Kayıt Ol — ${siteName}`,
      inGuild: Boolean(user.inGuild),
    });
  }

  return next();
}

/**
 * 3) İlk kullanım gizlilik/kural onayı kontrolü (API ve SSE uç noktaları için).
 */
function requireChatConsent(req, res, next) {
  const store = getChatStore();
  const user = req.session.user;
  const userId = String(user.id);
  if (isGoogleChatUser(user)) {
    const member = getFreshGoogleMember(user);
    if (!member || !getMemberStore().hasConsent(member, 'chat_moderation_review')) {
      return res.status(403).json({
        ok: false,
        code: 'CONSENT_REQUIRED',
        policyVersion: chatConfig.POLICY_VERSION,
        error: req.t ? req.t('chat.errConsentRequired') : 'Devam etmek için sohbet kullanım onayını kabul etmelisiniz.',
      });
    }
  }
  if (!store.hasValidConsent(userId, chatConfig.POLICY_VERSION)) {
    return res.status(403).json({
      ok: false,
      code: 'CONSENT_REQUIRED',
      policyVersion: chatConfig.POLICY_VERSION,
      error: req.t ? req.t('chat.errConsentRequired') : 'Devam etmek için sohbet kullanım onayını kabul etmelisiniz.',
    });
  }
  return next();
}

function requireNotBannedFromChat(req, res, next) {
  const store = getChatStore();
  const modStore = getChatModStore(store);
  const userId = String(req.session.user.id);
  const sanction = modStore.getActiveSanction(userId);
  if (sanction && sanction.type === 'ban') {
    return res.status(403).json({
      ok: false,
      code: 'USER_BANNED',
      sanction: {
        type: 'ban',
        reasonCategory: sanction.reasonCategory,
        createdAt: sanction.createdAt,
      },
      error: req.t('chat.errBannedFromChat'),
    });
  }
  req.activeChatSanction = sanction || null;
  return next();
}

function buildMemberPublicInfo(memberObj, fallbackId, store) {
  const id = String((memberObj && memberObj.id) || fallbackId || '');
  const ring = store.getPublicRingForUser(id);
  const kind = (memberObj && memberObj.kind) || (parseUnifiedGoogleId(id) ? 'google' : 'discord');
  const avatarUrl =
    (memberObj && (memberObj.robloxAvatarUrl || memberObj.discordAvatarUrl)) || null;
  return {
    id,
    kind,
    badgeKind: kind === 'google' ? 'site_member' : 'discord_member',
    isGroupAdmin: kind === 'discord' && chatConfig.isDiscordIdGroupAdmin(id),
    displayName: (memberObj && memberObj.displayName) || id,
    avatarUrl,
    discordAvatarUrl: (memberObj && memberObj.discordAvatarUrl) || null,
    robloxAvatarUrl: (memberObj && memberObj.robloxAvatarUrl) || null,
    robloxUsername: (memberObj && memberObj.robloxUsername) || null,
    robloxId: (memberObj && memberObj.robloxId) || null,
    hasRoblox: Boolean(memberObj && memberObj.hasRoblox),
    ring,
  };
}

function formatProfileCardGames(rawGames = [], fallbackRoblox = null) {
  const list = [];
  const seen = new Set();

  for (const g of Array.isArray(rawGames) ? rawGames : []) {
    if (!g || !g.id || !g.username) continue;
    const gid = String(g.id).trim().toLowerCase();
    const uname = String(g.username).trim().slice(0, 80);
    if (!gid || !uname || seen.has(gid)) continue;
    seen.add(gid);
    const catalog = gamesConfig.getFallbackGameById(gid);
    const robloxId =
      gid === 'roblox'
        ? String(g.robloxId || (fallbackRoblox && fallbackRoblox.robloxId) || '').trim() || null
        : null;
    let profileUrl = null;
    if (typeof g.profileUrl === 'string' && /^https?:\/\//i.test(g.profileUrl.trim())) {
      profileUrl = g.profileUrl.trim();
    } else if (gid === 'roblox' && robloxId && /^\d{1,20}$/.test(robloxId)) {
      profileUrl = `https://www.roblox.com/users/${robloxId}/profile`;
    }
    list.push({
      id: gid,
      emoji: (catalog && catalog.emoji) || '🎮',
      name: (catalog && catalog.name) || { tr: gid.toUpperCase(), en: gid.toUpperCase() },
      username: uname,
      ...(robloxId ? { robloxId } : {}),
      ...(profileUrl ? { profileUrl } : {}),
    });
  }

  // Bot includeGames boş döndü ancak robloxUsername varsa Roblox'u otomatik ekle
  if (!seen.has('roblox') && fallbackRoblox && fallbackRoblox.robloxUsername) {
    const catalog = gamesConfig.getFallbackGameById('roblox');
    const robloxId = fallbackRoblox.robloxId ? String(fallbackRoblox.robloxId).trim() : null;
    const profileUrl =
      fallbackRoblox.robloxProfileUrl ||
      (robloxId && /^\d{1,20}$/.test(robloxId) ? `https://www.roblox.com/users/${robloxId}/profile` : null);
    list.unshift({
      id: 'roblox',
      emoji: (catalog && catalog.emoji) || '🧱',
      name: (catalog && catalog.name) || { tr: 'Roblox', en: 'Roblox' },
      username: String(fallbackRoblox.robloxUsername).trim().slice(0, 80),
      ...(robloxId ? { robloxId } : {}),
      ...(profileUrl ? { profileUrl } : {}),
    });
  }

  return list;
}

function formatLastMessagePreview(msg, req) {
  if (!msg) return null;
  if (msg.deleted) {
    return {
      id: msg.id,
      from: msg.from,
      ts: msg.ts,
      deleted: true,
      modRemoved: Boolean(msg.modRemoved),
      adminRemoved: Boolean(msg.adminRemoved),
      text: msg.modRemoved
        ? req.t('chat.msgModRemoved')
        : msg.adminRemoved
          ? req.t('chat.msgAdminRemoved')
          : req.t('chat.msgDeleted'),
      attachmentCount: 0,
    };
  }
  const attCount = Array.isArray(msg.attachments) ? msg.attachments.length : 0;
  return {
    id: msg.id,
    from: msg.from,
    ts: msg.ts,
    deleted: false,
    modRemoved: false,
    adminRemoved: false,
    text: (msg.text || '').slice(0, 120),
    attachmentCount: attCount,
  };
}

// ============================================================================
// SAYFALAR: /sohbet ve /sohbet/gizlilik
// ============================================================================

/**
 * GET /sohbet/gizlilik
 * Sohbet gizlilik ve güvenlik politikası (onay öncesinde de okunabilir).
 */
router.get('/gizlilik', (req, res) => {
  const store = getChatStore();
  const user = req.session && req.session.user;
  const hasConsented = Boolean(
    user && user.id && store.hasValidConsent(String(user.id), chatConfig.POLICY_VERSION)
  );
  return res.render('pages/chat-privacy', {
    title: req.t('chat.privacyPageTitle'),
    policyVersion: chatConfig.POLICY_VERSION,
    retentionInfo: store.getRetentionInfo(),
    hasConsented,
    isChatPrivacyPage: true,
  });
});

/**
 * GET /sohbet
 * Ana birebir sohbet ekranı veya ilk kullanım onay ekranı.
 */
router.get('/', requireChatMember, async (req, res) => {
  const store = getChatStore();
  const modStore = getChatModStore(store);
  const user = req.session.user;
  const userId = String(user.id);
  const activeSanction = modStore.getActiveSanction(userId);
  let hasConsented = store.hasValidConsent(userId, chatConfig.POLICY_VERSION);
  if (hasConsented && isGoogleChatUser(user)) {
    const gm = getFreshGoogleMember(user);
    if (!gm || !getMemberStore().hasConsent(gm, 'chat_moderation_review')) {
      hasConsented = false;
    }
  }
  const profile = store.getProfile(userId);
  const effectiveRing = chatConfig.resolveEffectiveRing(profile);
  const retentionInfo = store.getRetentionInfo();
  const unreadNotices = modStore.getUnreadNotices(userId);
  if (unreadNotices.length > 0) modStore.markNoticesRead(userId);

  // Kendi Roblox avatarını da halka önizlemesinde kullanabilmek için rehber lookup yap (başarısızsa profil/Discord avatarı)
  let selfDirectoryInfo = null;
  try {
    const lookup = await lookupUnifiedMembers(user, [userId]);
    selfDirectoryInfo = lookup.byId.get(userId) || null;
  } catch (_) {}

  const selfAvatarUrl =
    (selfDirectoryInfo && (selfDirectoryInfo.robloxAvatarUrl || selfDirectoryInfo.discordAvatarUrl)) ||
    user.avatarUrl ||
    null;

  const requestedOtherId =
    typeof req.query.kisi === 'string' && isValidChatUserId(req.query.kisi.trim()) && req.query.kisi.trim() !== userId
      ? req.query.kisi.trim()
      : '';

  const lang = req.lang === 'en' ? 'en' : 'tr';
  let effectiveShowGames = profile.showGamesInChat !== false;
  if (isGoogleChatUser(user)) {
    const gm = getFreshGoogleMember(user);
    effectiveShowGames = Boolean(
      gm &&
        gm.privacy &&
        gm.privacy.showGamesInChat !== false &&
        getMemberStore().hasConsent(gm, 'chat_profile_game_usernames')
    );
  }

  const chatGroupsMeta = chatConfig.GROUPS.map((grp) => ({
    id: grp.id,
    convId: makeGroupConvId(grp.id),
    icon: grp.icon,
    name: grp.name[lang] || grp.name.tr,
    description: grp.description[lang] || grp.description.tr,
    avatarUrl: brandConfig.ASSETS.icon192,
    allowAttachments: Boolean(grp.allowAttachments),
    muted: store.isGroupMuted(userId, grp.id),
  }));

  return res.render('pages/chat', {
    title: req.t('chat.pageTitle'),
    isChatPage: true,
    needsConsent: !hasConsented,
    policyVersion: chatConfig.POLICY_VERSION,
    activeSanction: activeSanction
      ? {
          type: activeSanction.type,
          reasonCategory: activeSanction.reasonCategory,
          ruleCode: activeSanction.ruleCode || null,
          reasonText: activeSanction.reasonText || '',
          expiresAt: activeSanction.expiresAt || null,
          createdAt: activeSanction.createdAt,
        }
      : null,
    unreadNotices,
    reportCategories: REPORT_CATEGORIES,
    isGroupAdmin: chatConfig.isChatGroupAdmin(req),
    chatGroups: chatGroupsMeta,
    defaultGroupId: chatConfig.DEFAULT_GROUP_ID,
    brandIconUrl: brandConfig.ASSETS.icon192,
    chatProfile: {
      ringId: profile.ringId,
      ring: profile.ring,
      effectiveRing,
      readReceipts: profile.readReceipts,
      showGamesInChat: effectiveShowGames,
      mutedGroups: profile.mutedGroups || [],
      notify: profile.notify,
      whoCanMessage: profile.whoCanMessage,
      blocked: profile.blocked,
      avatarUrl: selfAvatarUrl,
      displayName: user.displayName || user.username,
      kind: isGoogleChatUser(user) ? 'google' : 'discord',
    },
    ringCategories: chatConfig.RING_CATEGORIES,
    ringPresets: chatConfig.RING_PRESETS,
    retentionInfo,
    requestedOtherId,
    chatLimits: {
      maxMessageLength: chatConfig.LIMITS.MAX_MESSAGE_LENGTH,
      maxGroupMessagesPerMin: chatConfig.LIMITS.MAX_GROUP_MESSAGES_PER_MIN,
      maxAnimatedDirectoryRings: chatConfig.LIMITS.MAX_ANIMATED_DIRECTORY_RINGS,
      retentionDays: chatConfig.RETENTION_DAYS,
      maxFilesPerMessage: chatConfig.FILES.MAX_FILES_PER_MESSAGE,
      maxImageBytes: chatConfig.FILES.MAX_IMAGE_BYTES,
      maxPdfBytes: chatConfig.FILES.MAX_PDF_BYTES,
      maxTxtBytes: chatConfig.FILES.MAX_TXT_BYTES,
      maxVideoBytes: chatConfig.FILES.MAX_VIDEO_BYTES,
    },
  });
});

// ============================================================================
// ONAY VE OKUNMAMIŞ SAYAÇ
// ============================================================================

router.post('/api/onay', requireChatMember, (req, res) => {
  const accepted = req.body && (req.body.accepted === true || req.body.accepted === 'true' || req.body.accepted === '1');
  if (!accepted) {
    return res.status(400).json({
      ok: false,
      code: 'CONSENT_NOT_ACCEPTED',
      error: req.t('chat.errConsentCheckbox'),
    });
  }
  const store = getChatStore();
  const user = req.session.user;
  const userId = String(user.id);
  if (isGoogleChatUser(user)) {
    const gm = getFreshGoogleMember(user);
    if (gm) {
      getMemberStore().grantConsent(gm.id, 'chat_moderation_review', '1.0');
    }
  }
  const updated = store.recordConsent(userId, chatConfig.POLICY_VERSION);
  return res.json({
    ok: true,
    consent: updated.consent,
  });
});

router.get('/api/okunmamis', requireChatMember, (req, res) => {
  const store = getChatStore();
  const user = req.session.user;
  const userId = String(user.id);
  const googleHasModConsent = !isGoogleChatUser(user) || (() => {
    const gm = getFreshGoogleMember(user);
    return Boolean(gm && getMemberStore().hasConsent(gm, 'chat_moderation_review'));
  })();
  if (!googleHasModConsent || !store.hasValidConsent(userId, chatConfig.POLICY_VERSION)) {
    return res.json({ ok: true, unread: 0, needsConsent: true });
  }
  return res.json({
    ok: true,
    unread: store.getTotalUnreadCount(userId),
    needsConsent: false,
  });
});

// ============================================================================
// SSE GERÇEK ZAMANLI AKIŞ
// ============================================================================

router.get('/akis', requireChatMember, requireChatConsent, requireNotBannedFromChat, (req, res) => {
  const store = getChatStore();
  const userId = String(req.session.user.id);
  const initialUnread = store.getTotalUnreadCount(userId);
  chatSseHub.subscribe(userId, req, res, { initialUnread });
});

// ============================================================================
// ÜYE REHBERİ VE SOHBET LİSTESİ
// ============================================================================

router.get('/api/rehber', requireChatMember, requireChatConsent, requireNotBannedFromChat, async (req, res) => {
  const store = getChatStore();
  const user = req.session.user;
  const userId = String(user.id);
  const requesterIsGoogle = isGoogleChatUser(user);
  const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 64) : '';
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit || 50), 10) || 50));
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor.trim() : '';

  try {
    const dir = await botApiClient.getDirectory(requesterIsGoogle ? 'site' : userId, {
      query,
      limit,
      cursor,
      excludeSelf: !requesterIsGoogle,
      asService: requesterIsGoogle,
    });

    const filtered = [];
    const seenIds = new Set();
    for (const item of dir.items) {
      if (!item || item.id === userId || seenIds.has(item.id)) continue;
      const block = store.isBlockedBetween(userId, item.id);
      if (block.any) continue;
      seenIds.add(item.id);
      filtered.push(buildMemberPublicInfo(item, item.id, store));
    }

    // İlk sayfada (cursor yoksa) aktif Google site üyelerini de rehbere ekle (e-posta & Google adı ASLA dahil edilmez)
    if (!cursor && chatConfig.isChatGoogleMembersEnabled()) {
      const qLower = query.toLowerCase();
      const memberStore = getMemberStore();
      const activeGoogleMembers = memberStore.listActiveMembers();
      await maybeRefreshGoogleRobloxAvatars(activeGoogleMembers);
      for (const gmRaw of activeGoogleMembers) {
        const gm = memberStore.findById(gmRaw.id) || gmRaw;
        const pub = memberStore.toPublicChatDirectoryItem(gm);
        if (!pub || pub.id === userId || seenIds.has(pub.id)) continue;
        if (qLower) {
          const hay = `${pub.displayName || ''} ${pub.robloxUsername || ''}`.toLowerCase();
          if (!hay.includes(qLower)) continue;
        }
        const block = store.isBlockedBetween(userId, pub.id);
        if (block.any) continue;
        seenIds.add(pub.id);
        filtered.push(buildMemberPublicInfo(pub, pub.id, store));
      }
    }

    return res.json({
      ok: true,
      items: filtered,
      nextCursor: dir.nextCursor,
      hasMore: dir.hasMore,
      total: filtered.length,
    });
  } catch (err) {
    return res.status(err && err.isOffline ? 503 : 502).json({
      ok: false,
      code: 'DIRECTORY_UNAVAILABLE',
      error: req.t('chat.errDirectoryUnavailable'),
    });
  }
});

/**
 * GET /sohbet/api/uye-karti/:targetId
 * Profil Bilgi Kartı (Nebula Glass Card) verisini döndürür.
 * - Discord üyeleri için Bot POST /api/directory/lookup { includeGames: true } (site-service, 60 sn önbellek)
 * - Google üyeleri için memberStore (6 saatlik Roblox avatar yenilemesiyle)
 * - Gizlilik kontrolü SUNUCUDA yapılır: üye "oyun kullanıcı adlarımı göster" ayarını kapattıysa
 *   oyun verileri istemciye ASLA gönderilmez.
 */
router.get('/api/uye-karti/:targetId', requireChatMember, requireChatConsent, requireNotBannedFromChat, async (req, res) => {
  const store = getChatStore();
  const userId = String(req.session.user.id);
  const targetId = String(req.params.targetId || '').trim();

  if (!isValidChatUserId(targetId)) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_TARGET',
      error: req.t('chat.errInvalidTarget'),
    });
  }

  const isGoogleTarget = Boolean(parseUnifiedGoogleId(targetId));
  const targetChatProfile = store.getProfile(targetId);
  const blockInfo = store.isBlockedBetween(userId, targetId);
  const ring = store.getPublicRingForUser(targetId);
  const nebulaHues = chatConfig.extractNebulaHuesFromRing(ring);
  const now = Date.now();
  const cacheTtl = chatConfig.LIMITS.PROFILE_CARD_CACHE_TTL_MS || 60 * 1000;

  if (isGoogleTarget) {
    const memberStore = getMemberStore();
    const gmInitial = memberStore.findByUnifiedId(targetId);
    if (!gmInitial || gmInitial.status !== 'active') {
      return res.status(404).json({
        ok: false,
        code: 'TARGET_NOT_FOUND',
        error: req.t('chat.errTargetNotFound'),
      });
    }
    await maybeRefreshGoogleRobloxAvatars([gmInitial]);
    const gm = memberStore.findById(gmInitial.id) || gmInitial;
    const rbGame = Array.isArray(gm.games) ? gm.games.find((g) => g && g.id === 'roblox') : null;
    const showGames = Boolean(
      gm.privacy &&
        gm.privacy.showGamesInChat !== false &&
        memberStore.hasConsent(gm, 'chat_profile_game_usernames')
    );

    const formattedGames = showGames
      ? formatProfileCardGames(gm.games, rbGame ? { robloxId: rbGame.robloxId, robloxUsername: rbGame.username, robloxProfileUrl: rbGame.robloxProfileUrl } : null)
      : [];

    return res.json({
      ok: true,
      cached: false,
      card: {
        id: targetId,
        kind: 'google',
        badgeKind: 'site_member',
        isSelf: targetId === userId,
        isGroupAdmin: false,
        displayName: showGames ? (gm.displayName || gm.nickname || targetId) : (gm.nickname || targetId),
        avatarUrl: (rbGame && rbGame.robloxAvatarUrl) || null,
        ring,
        nebulaHues,
        gamesHidden: !showGames,
        games: formattedGames,
        blockedByMe: blockInfo.blockedByA,
        blockedByOther: blockInfo.blockedByB,
        whoCanMessage: targetChatProfile.whoCanMessage,
      },
    });
  }

  // Discord üyesi: 60 sn bellek önbelleği + Bot POST /api/directory/lookup { includeGames: true } (site-service)
  let rawMember = null;
  let fromCache = false;
  const cachedEntry = profileCardRawCache.get(targetId);
  if (cachedEntry && cachedEntry.expiresAt > now) {
    rawMember = cachedEntry.item;
    fromCache = true;
  } else {
    try {
      const lookup = await botApiClient.lookupDirectoryMembers('site', [targetId], {
        asService: true,
        includeGames: true,
      });
      rawMember = lookup.byId.get(targetId) || null;
      if (rawMember) {
        if (profileCardRawCache.size > 500) {
          for (const [k, v] of profileCardRawCache.entries()) {
            if (v.expiresAt <= now) profileCardRawCache.delete(k);
          }
        }
        profileCardRawCache.set(targetId, { item: rawMember, expiresAt: now + cacheTtl });
      }
    } catch (err) {
      return res.status(err && err.isOffline ? 503 : 502).json({
        ok: false,
        code: 'DIRECTORY_UNAVAILABLE',
        error: req.t('chat.errDirectoryUnavailable'),
      });
    }
  }

  if (!rawMember) {
    return res.status(404).json({
      ok: false,
      code: 'TARGET_NOT_FOUND',
      error: req.t('chat.errTargetNotFound'),
    });
  }

  // Gizlilik kontrolü SUNUCUDA her istekte taze yapılır
  const showGames = targetChatProfile.showGamesInChat !== false;
  const formattedGames = showGames
    ? formatProfileCardGames(rawMember.games, {
        robloxId: rawMember.robloxId,
        robloxUsername: rawMember.robloxUsername,
      })
    : [];

  return res.json({
    ok: true,
    cached: fromCache,
    card: {
      id: targetId,
      kind: 'discord',
      badgeKind: 'discord_member',
      isSelf: targetId === userId,
      isGroupAdmin: chatConfig.isDiscordIdGroupAdmin(targetId),
      displayName: rawMember.displayName || targetId,
      avatarUrl: rawMember.robloxAvatarUrl || rawMember.discordAvatarUrl || null,
      ring,
      nebulaHues,
      gamesHidden: !showGames,
      games: formattedGames,
      blockedByMe: blockInfo.blockedByA,
      blockedByOther: blockInfo.blockedByB,
      whoCanMessage: targetChatProfile.whoCanMessage,
    },
  });
});

router.get('/api/sohbetler', requireChatMember, requireChatConsent, requireNotBannedFromChat, async (req, res) => {
  const store = getChatStore();
  const user = req.session.user;
  const userId = String(user.id);
  const lang = req.lang === 'en' ? 'en' : 'tr';
  const myProfile = store.getProfile(userId);
  const rawList = store.listConversations(userId);

  // Zorunlu grupların özetlerini al ve son mesaj gönderenlerini de ortak rehberden çözümle
  const groupSummaries = chatConfig.GROUPS.map((grp) => ({
    grp,
    summary: store.getGroupSummary(grp.id, userId),
  }));

  const lookupIds = new Set(rawList.map((c) => c.otherId));
  for (const { summary } of groupSummaries) {
    if (summary && summary.lastMessage && summary.lastMessage.from && isValidChatUserId(summary.lastMessage.from)) {
      lookupIds.add(summary.lastMessage.from);
    }
  }

  let memberMap = new Map();
  if (lookupIds.size > 0) {
    const lookup = await lookupUnifiedMembers(user, [...lookupIds]);
    memberMap = lookup.byId;
  }

  const groups = groupSummaries.map(({ grp, summary }) => {
    const lastMsg = summary ? formatLastMessagePreview(summary.lastMessage, req) : null;
    if (lastMsg && lastMsg.from && isValidChatUserId(lastMsg.from)) {
      const senderObj = memberMap.get(lastMsg.from);
      lastMsg.senderName = (senderObj && senderObj.displayName) || lastMsg.from;
    }
    return {
      id: grp.id,
      convId: makeGroupConvId(grp.id),
      icon: grp.icon,
      name: grp.name[lang] || grp.name.tr,
      description: grp.description[lang] || grp.description.tr,
      avatarUrl: brandConfig.ASSETS.icon192,
      allowAttachments: Boolean(grp.allowAttachments),
      lastMessage: lastMsg,
      lastActivityAt: summary ? summary.lastActivityAt : 0,
      unreadCount: summary ? summary.unreadCount : 0,
      muted: summary ? Boolean(summary.muted) : false,
    };
  });

  const conversations = rawList.map((entry) => {
    const otherProfile = store.getProfile(entry.otherId);
    const blockInfo = store.isBlockedBetween(userId, entry.otherId);
    const canSeeOtherRead = Boolean(myProfile.readReceipts && otherProfile.readReceipts);

    return {
      convId: entry.convId,
      other: buildMemberPublicInfo(memberMap.get(entry.otherId), entry.otherId, store),
      lastMessage: formatLastMessagePreview(entry.lastMessage, req),
      lastActivityAt: entry.lastActivityAt,
      unreadCount: blockInfo.blockedByA ? 0 : entry.unreadCount,
      otherLastRead: canSeeOtherRead ? entry.state.lastRead[entry.otherId] || 0 : 0,
      otherLastDelivered: entry.state.lastDelivered[entry.otherId] || 0,
      canSeeOtherRead,
      blockedByMe: blockInfo.blockedByA,
      blockedByOther: blockInfo.blockedByB,
    };
  });

  return res.json({
    ok: true,
    groups,
    conversations,
    totalUnread: store.getTotalUnreadCount(userId),
    retentionInfo: store.getRetentionInfo(),
  });
});

// ============================================================================
// ZORUNLU GRUP SOHBETİ ("Genel Sohbet"): OKUMA, GÖNDERME, SİLME, SESSİZE ALMA
// ============================================================================

router.get('/api/grup/:grupId/mesajlar', requireChatMember, requireChatConsent, requireNotBannedFromChat, async (req, res) => {
  const store = getChatStore();
  const userId = String(req.session.user.id);
  const lang = req.lang === 'en' ? 'en' : 'tr';
  const grp = chatConfig.getGroupById(req.params.grupId);

  if (!grp) {
    return res.status(404).json({
      ok: false,
      code: 'GROUP_NOT_FOUND',
      error: req.t('chat.errGroupNotFound'),
    });
  }

  const convId = makeGroupConvId(grp.id);
  const before = typeof req.query.before === 'string' && req.query.before.trim() ? req.query.before.trim() : null;
  const after = typeof req.query.after === 'string' && req.query.after.trim() ? req.query.after.trim() : null;
  const limit = Math.min(
    chatConfig.LIMITS.MAX_PAGE_LIMIT,
    Math.max(1, Number.parseInt(String(req.query.limit || chatConfig.LIMITS.DEFAULT_PAGE_LIMIT), 10) || 40)
  );

  const page = store.getMessages(convId, { before, after, limit });
  const senderIds = [
    ...new Set(
      page.messages
        .map((m) => m.from)
        .filter((fid) => fid && fid !== 'system' && isValidChatUserId(fid))
    ),
  ];

  let memberMap = new Map();
  if (senderIds.length > 0) {
    try {
      const lookup = await lookupUnifiedMembers(req.session.user, senderIds);
      memberMap = lookup.byId;
    } catch (_) {}
  }

  const senders = {};
  for (const sid of senderIds) {
    senders[sid] = buildMemberPublicInfo(memberMap.get(sid), sid, store);
  }

  return res.json({
    ok: true,
    convId,
    group: {
      id: grp.id,
      convId,
      icon: grp.icon,
      name: grp.name[lang] || grp.name.tr,
      description: grp.description[lang] || grp.description.tr,
      avatarUrl: brandConfig.ASSETS.icon192,
      allowAttachments: Boolean(grp.allowAttachments),
    },
    messages: page.messages,
    senders,
    hasMore: page.hasMore,
    isGroupAdmin: chatConfig.isChatGroupAdmin(req),
    muted: store.isGroupMuted(userId, grp.id),
    state: {
      myLastRead: page.state.lastRead[userId] || 0,
    },
  });
});

router.post(
  '/api/grup/:grupId/mesaj',
  requireChatMember,
  requireChatConsent,
  requireNotBannedFromChat,
  chatGroupMessageLimiter,
  async (req, res) => {
    const store = getChatStore();
    const modStore = getChatModStore(store);
    const userId = String(req.session.user.id);
    const grp = chatConfig.getGroupById(req.params.grupId);

    if (!grp) {
      return res.status(404).json({
        ok: false,
        code: 'GROUP_NOT_FOUND',
        error: req.t('chat.errGroupNotFound'),
      });
    }

    // Susturulmuş kullanıcı gruba yazamaz (okuma serbesttir)
    const activeSanction = req.activeChatSanction || modStore.getActiveSanction(userId);
    if (activeSanction && activeSanction.type === 'mute') {
      return res.status(403).json({
        ok: false,
        code: 'USER_MUTED',
        sanction: {
          type: 'mute',
          reasonCategory: activeSanction.reasonCategory,
          ruleCode: activeSanction.ruleCode || null,
          reasonText: activeSanction.reasonText || '',
          expiresAt: activeSanction.expiresAt,
        },
        error: req.t('chat.errMutedInChat'),
      });
    }

    const convId = makeGroupConvId(grp.id);
    const rawText = req.body && typeof req.body.text === 'string' ? req.body.text : '';
    if (rawText.length > chatConfig.LIMITS.MAX_MESSAGE_LENGTH + 500) {
      return res.status(400).json({
        ok: false,
        code: 'TEXT_TOO_LONG',
        error: req.t('chat.errTextTooLong'),
      });
    }
    const cleanText = sanitizeChatText(rawText, chatConfig.LIMITS.MAX_MESSAGE_LENGTH);

    // Yeni Google üyesi 24 saat sınırı grupta da geçerlidir
    if (cleanText && isNewGoogleMemberRestricted(req.session.user) && containsExternalLink(cleanText)) {
      return res.status(403).json({
        ok: false,
        code: 'NEW_MEMBER_NO_LINKS',
        error: req.t('chat.errNewMemberNoLinks'),
      });
    }

    const clientId =
      req.body && typeof req.body.clientId === 'string' ? req.body.clientId.trim().slice(0, 80) : null;
    const replyTo =
      req.body && typeof req.body.replyTo === 'string' ? req.body.replyTo.trim().slice(0, 64) : null;

    // Ek dosya doğrulaması (mevcut dosya kuralları grupta aynen geçerlidir)
    const rawAttachmentIds = req.body && Array.isArray(req.body.attachmentIds) ? req.body.attachmentIds : [];
    const uniqueAttIds = [...new Set(rawAttachmentIds.map((x) => String(x || '').trim()).filter(Boolean))];
    if (uniqueAttIds.length > 0 && !grp.allowAttachments) {
      return res.status(400).json({
        ok: false,
        code: 'ATTACHMENTS_DISABLED',
        error: req.t('chat.errInvalidAttachment'),
      });
    }
    if (uniqueAttIds.length > chatConfig.FILES.MAX_FILES_PER_MESSAGE) {
      return res.status(400).json({
        ok: false,
        code: 'TOO_MANY_ATTACHMENTS',
        error: req.t('chat.errMaxFiles'),
      });
    }

    const resolvedAttachments = [];
    for (const attId of uniqueAttIds) {
      if (!/^[0-9a-f]{32}$/.test(attId)) {
        return res.status(400).json({
          ok: false,
          code: 'INVALID_ATTACHMENT',
          error: req.t('chat.errInvalidAttachment'),
        });
      }
      const meta = store.getFileMeta(attId);
      if (!meta || meta.uploaderId !== userId || (meta.convId && meta.convId !== convId) || meta.msgId) {
        return res.status(400).json({
          ok: false,
          code: 'INVALID_ATTACHMENT',
          error: req.t('chat.errInvalidAttachment'),
        });
      }
      resolvedAttachments.push({
        id: meta.id,
        originalName: meta.originalName,
        ext: meta.ext,
        mimeType: meta.mimeType,
        category: meta.category,
        size: meta.size,
        url: `/sohbet/dosya/${meta.id}`,
        txtPreview: meta.txtPreview || null,
      });
    }

    if (!cleanText && resolvedAttachments.length === 0) {
      return res.status(400).json({
        ok: false,
        code: 'EMPTY_MESSAGE',
        error: req.t('chat.errEmptyMessage'),
      });
    }

    // Aşırı yük / spam koruması: aynı metnin kısa süre içinde tekrar gönderilmesini engelle
    const dupWindowMs = chatConfig.LIMITS.GROUP_DUPLICATE_WINDOW_MS || 15000;
    const normText = cleanText ? cleanText.toLowerCase().replace(/\s+/g, ' ').trim() : '';
    const now = Date.now();
    if (normText && resolvedAttachments.length === 0) {
      const prev = groupRecentMsgMap.get(userId);
      if (prev && prev.normText === normText && prev.clientId !== clientId && now - prev.ts < dupWindowMs) {
        return res.status(429).json({
          ok: false,
          code: 'DUPLICATE_GROUP_MESSAGE',
          error: req.t('chat.errDuplicateGroupMessage'),
        });
      }
    }

    let appended;
    try {
      appended = store.appendMessage(convId, {
        from: userId,
        text: cleanText,
        attachments: resolvedAttachments,
        replyTo,
        clientId,
      });
    } catch (err) {
      return res.status(400).json({
        ok: false,
        code: err.code || 'SEND_FAILED',
        error: err.message || req.t('chat.errSendFailed'),
      });
    }

    if (appended.duplicate) {
      return res.status(200).json({
        ok: true,
        duplicate: true,
        convId,
        groupId: grp.id,
        message: appended.message,
      });
    }

    if (normText) {
      groupRecentMsgMap.set(userId, { normText, ts: now, clientId });
      if (groupRecentMsgMap.size > 1000) {
        for (const [k, v] of groupRecentMsgMap.entries()) {
          if (now - v.ts > dupWindowMs * 2) groupRecentMsgMap.delete(k);
        }
      }
    }

    for (const att of resolvedAttachments) {
      const meta = store.getFileMeta(att.id);
      if (meta) {
        meta.convId = convId;
        meta.msgId = appended.message.id;
        store.registerFileMeta(meta);
      }
    }

    // Yerel otomatik filtre grup mesajlarını da kapsar (mesajı engellemez, işaretlenirse vaka açar)
    if (cleanText) {
      try {
        const scan = chatAutoFilter.scanMessageText(cleanText);
        if (scan.flagged) {
          const radius = chatConfig.MODERATION.AUTOFLAG_CONTEXT_RADIUS || 5;
          const ctxMsgs = store.getContextWindow(convId, appended.message.id, { radius });
          modStore.createOrMergeAutoCase({
            convId,
            offendingUserId: userId,
            targetMsgId: appended.message.id,
            categories: scan.categories,
            priority: scan.priority,
            snapshotMessages: ctxMsgs,
            chatStore: store,
          });
        }
      } catch (_) {}
    }

    const msg = appended.message;
    let senderResolved = null;
    try {
      const lkp = await lookupUnifiedMembers(req.session.user, [userId]);
      senderResolved = lkp.byId.get(userId) || null;
    } catch (_) {}

    const senderInfo = buildMemberPublicInfo(
      senderResolved || {
        id: userId,
        kind: isGoogleChatUser(req.session.user) ? 'google' : 'discord',
        displayName: req.session.user.displayName || req.session.user.username || userId,
        robloxAvatarUrl: isGoogleChatUser(req.session.user) ? req.session.user.avatarUrl || null : null,
        discordAvatarUrl: !isGoogleChatUser(req.session.user) ? req.session.user.avatarUrl || null : null,
      },
      userId,
      store
    );

    // Tüm bağlı üyelere SSE üzerinden grup mesajı yayını
    chatSseHub.broadcastGroupEvent(
      'group_message',
      {
        convId,
        groupId: grp.id,
        sender: senderInfo,
        message: msg,
      },
      {
        buffer: true,
        computePerUserData: (targetUid, base) => {
          const isMuted = store.isGroupMuted(targetUid, grp.id);
          const tProf = store.getProfile(targetUid);
          return {
            ...base,
            selfEcho: targetUid === userId,
            muted: isMuted,
            notifyPreview: Boolean(tProf.notify && tProf.notify.preview),
          };
        },
      }
    );

    // Bağlı diğer üyelere güncel okunmamış sayaç yayını (grubu sessize alanlar hariç)
    for (const targetUid of [...chatSseHub.clientsByUser.keys()]) {
      if (targetUid === userId) continue;
      if (store.isGroupMuted(targetUid, grp.id)) continue;
      chatSseHub.sendToUser(targetUid, 'unread', { unread: store.getTotalUnreadCount(targetUid) });
    }

    return res.status(201).json({
      ok: true,
      duplicate: false,
      convId,
      groupId: grp.id,
      message: msg,
      sender: senderInfo,
    });
  }
);

router.post('/api/grup/:grupId/okundu', requireChatMember, requireChatConsent, (req, res) => {
  const store = getChatStore();
  const userId = String(req.session.user.id);
  const grp = chatConfig.getGroupById(req.params.grupId);
  if (!grp) {
    return res.status(404).json({ ok: false, code: 'GROUP_NOT_FOUND', error: req.t('chat.errGroupNotFound') });
  }
  const convId = makeGroupConvId(grp.id);
  const upTo = Number(req.body && req.body.upTo) || Date.now();
  store.markRead(convId, userId, upTo);
  const myUnread = store.getTotalUnreadCount(userId);
  // Grupta "Görüldü" yayını YOKTUR; yalnızca kullanıcının kendi okunmamış rozeti güncellenir
  chatSseHub.sendToUser(userId, 'unread', { unread: myUnread });
  return res.json({
    ok: true,
    convId,
    groupId: grp.id,
    unread: myUnread,
  });
});

router.post('/api/grup/:grupId/sessize-al', requireChatMember, requireChatConsent, (req, res) => {
  const store = getChatStore();
  const userId = String(req.session.user.id);
  const grp = chatConfig.getGroupById(req.params.grupId);
  if (!grp) {
    return res.status(404).json({ ok: false, code: 'GROUP_NOT_FOUND', error: req.t('chat.errGroupNotFound') });
  }
  const currentlyMuted = store.isGroupMuted(userId, grp.id);
  const nextMuted =
    req.body && typeof req.body.muted === 'boolean' ? req.body.muted : !currentlyMuted;
  const updated = store.setGroupMuted(userId, grp.id, nextMuted);
  const myUnread = store.getTotalUnreadCount(userId);
  chatSseHub.sendToUser(userId, 'settings', { mutedGroups: updated.mutedGroups });
  chatSseHub.sendToUser(userId, 'unread', { unread: myUnread });
  return res.json({
    ok: true,
    groupId: grp.id,
    muted: nextMuted,
    mutedGroups: updated.mutedGroups,
    unread: myUnread,
  });
});

router.delete('/api/grup/:grupId/mesaj/:msgId', requireChatMember, requireChatConsent, requireNotBannedFromChat, (req, res) => {
  const store = getChatStore();
  const modStore = getChatModStore(store);
  const userId = String(req.session.user.id);
  const grp = chatConfig.getGroupById(req.params.grupId);
  const msgId = String(req.params.msgId || '').trim();

  if (!grp || !msgId) {
    return res.status(400).json({ ok: false, code: 'INVALID_REQUEST' });
  }

  const convId = makeGroupConvId(grp.id);
  const existing = store.getMessageById(convId, msgId);
  if (!existing) {
    return res.status(404).json({
      ok: false,
      code: 'NOT_FOUND',
      error: req.t('chat.errMsgNotFound'),
    });
  }

  const isOwn = existing.from === userId;
  // Grup yöneticisi kontrolü YALNIZCA Discord oturumu ve env CHAT_GROUP_ADMIN_DISCORD_IDS ile yapılır
  const isGroupAdmin = chatConfig.isChatGroupAdmin(req);
  if (!isOwn && !isGroupAdmin) {
    return res.status(403).json({
      ok: false,
      code: 'FORBIDDEN',
      error: req.t('chat.errDeleteForbidden'),
    });
  }

  const adminRemoved = !isOwn && isGroupAdmin;
  const result = store.deleteMessage(convId, msgId, {
    by: userId,
    modRemoved: false,
    adminRemoved,
  });

  if (!result.ok) {
    const status = result.code === 'FORBIDDEN' ? 403 : 404;
    return res.status(status).json({
      ok: false,
      code: result.code,
      error: result.code === 'FORBIDDEN' ? req.t('chat.errDeleteForbidden') : req.t('chat.errMsgNotFound'),
    });
  }

  // Korunmayan ek dosyaları diskten sil
  for (const attId of result.deletedAttachmentIds || []) {
    store.deleteFileIfUnpreserved(attId);
  }

  // Yönetici silme işlemini içeriksiz olarak denetim kaydına yaz
  if (adminRemoved) {
    modStore.recordGroupAdminDeleteAudit({
      adminId: userId,
      adminName: req.session.user.displayName || req.session.user.username || userId,
      convId,
      msgId,
      targetUserId: existing.from,
    });
  }

  chatSseHub.broadcastGroupEvent(
    'group_deleted',
    {
      convId,
      groupId: grp.id,
      msgId,
      modRemoved: false,
      adminRemoved,
    },
    { buffer: true }
  );

  return res.json({
    ok: true,
    msgId,
    groupId: grp.id,
    adminRemoved,
  });
});

// ============================================================================
// SOHBET MESAJLARI: OKUMA, GÖNDERME, SİLME, GÖRÜLDÜ, YAZIYOR
// ============================================================================

router.get('/api/sohbet/:digerId/mesajlar', requireChatMember, requireChatConsent, requireNotBannedFromChat, async (req, res) => {
  const store = getChatStore();
  const userId = String(req.session.user.id);
  const otherId = String(req.params.digerId || '').trim();
  const convId = makeConvId(userId, otherId);

  if (!convId) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_TARGET',
      error: req.t('chat.errInvalidTarget'),
    });
  }

  const before = typeof req.query.before === 'string' && req.query.before.trim() ? req.query.before.trim() : null;
  const after = typeof req.query.after === 'string' && req.query.after.trim() ? req.query.after.trim() : null;
  const limit = Math.min(
    chatConfig.LIMITS.MAX_PAGE_LIMIT,
    Math.max(1, Number.parseInt(String(req.query.limit || chatConfig.LIMITS.DEFAULT_PAGE_LIMIT), 10) || 40)
  );

  const page = store.getMessages(convId, { before, after, limit });
  const myProfile = store.getProfile(userId);
  const otherProfile = store.getProfile(otherId);
  const blockInfo = store.isBlockedBetween(userId, otherId);
  const canSeeOtherRead = Boolean(myProfile.readReceipts && otherProfile.readReceipts);

  // Karşı tarafın son mesajını teslim alındı olarak işaretle
  const latestFromOther = [...page.messages].reverse().find((m) => m.from === otherId);
  if (latestFromOther && latestFromOther.ts > (page.state.lastDelivered[userId] || 0)) {
    const updatedState = store.markDelivered(convId, userId, latestFromOther.ts);
    if (updatedState) {
      page.state = updatedState;
      chatSseHub.sendToUser(otherId, 'delivered', {
        convId,
        by: userId,
        upTo: updatedState.lastDelivered[userId],
      });
    }
  }

  let otherMember = null;
  try {
    const lookup = await lookupUnifiedMembers(req.session.user, [otherId]);
    otherMember = lookup.byId.get(otherId) || null;
  } catch (_) {}

  return res.json({
    ok: true,
    convId,
    other: buildMemberPublicInfo(otherMember, otherId, store),
    messages: page.messages,
    hasMore: page.hasMore,
    canSeeOtherRead,
    state: {
      myLastRead: page.state.lastRead[userId] || 0,
      otherLastRead: canSeeOtherRead ? page.state.lastRead[otherId] || 0 : 0,
      otherLastDelivered: page.state.lastDelivered[otherId] || 0,
    },
    blocked: {
      byMe: blockInfo.blockedByA,
      byOther: blockInfo.blockedByB,
      any: blockInfo.any,
    },
    whoCanMessageOther: otherProfile.whoCanMessage,
  });
});

router.post(
  '/api/sohbet/:digerId/mesaj',
  requireChatMember,
  requireChatConsent,
  requireNotBannedFromChat,
  chatMessageLimiter,
  async (req, res) => {
    const store = getChatStore();
    const modStore = getChatModStore(store);
    const userId = String(req.session.user.id);

    // Susturulmuş kullanıcı mesaj gönderemez
    const activeSanction = req.activeChatSanction || modStore.getActiveSanction(userId);
    if (activeSanction && activeSanction.type === 'mute') {
      return res.status(403).json({
        ok: false,
        code: 'USER_MUTED',
        sanction: {
          type: 'mute',
          reasonCategory: activeSanction.reasonCategory,
          ruleCode: activeSanction.ruleCode || null,
          reasonText: activeSanction.reasonText || '',
          expiresAt: activeSanction.expiresAt,
        },
        error: req.t('chat.errMutedInChat'),
      });
    }

    const otherId = String(req.params.digerId || '').trim();
    const convId = makeConvId(userId, otherId);

    if (!convId) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_TARGET',
        error: req.t('chat.errInvalidTarget'),
      });
    }

    const blockInfo = store.isBlockedBetween(userId, otherId);
    if (blockInfo.blockedByA) {
      return res.status(403).json({
        ok: false,
        code: 'BLOCKED_BY_ME',
        error: req.t('chat.errBlockedByMe'),
      });
    }
    if (blockInfo.blockedByB) {
      return res.status(403).json({
        ok: false,
        code: 'BLOCKED_BY_OTHER',
        error: req.t('chat.errCannotMessage'),
      });
    }

    const otherProfile = store.getProfile(otherId);
    if (otherProfile.whoCanMessage === 'nobody') {
      return res.status(403).json({
        ok: false,
        code: 'RECIPIENT_CLOSED_DM',
        error: req.t('chat.errRecipientClosed'),
      });
    }

    const existingConv = store.conversationExists(convId);
    if (!existingConv) {
      // Günde en çok 10 YENİ sohbet başlatma sınırı
      if (!store.canStartNewConversation(userId)) {
        return res.status(429).json({
          ok: false,
          code: 'NEW_CONV_LIMIT',
          error: req.t('chat.errNewConvLimit'),
        });
      }

      // Hedefin kayıtlı üye olduğunu doğrula (hem Discord hem Google site üyeleri)
      const lookup = await lookupUnifiedMembers(req.session.user, [otherId]);
      if (lookup.botFailed && !parseUnifiedGoogleId(otherId)) {
        // Bot API anlık erişilemezse gönderimi engelle
        return res.status(503).json({
          ok: false,
          code: 'DIRECTORY_UNAVAILABLE',
          error: req.t('chat.errDirectoryUnavailable'),
        });
      }
      if (!lookup.byId.has(otherId)) {
        return res.status(404).json({
          ok: false,
          code: 'TARGET_NOT_FOUND',
          error: req.t('chat.errTargetNotFound'),
        });
      }
    }

    const rawText = req.body && typeof req.body.text === 'string' ? req.body.text : '';
    if (rawText.length > chatConfig.LIMITS.MAX_MESSAGE_LENGTH + 500) {
      return res.status(400).json({
        ok: false,
        code: 'TEXT_TOO_LONG',
        error: req.t('chat.errTextTooLong'),
      });
    }
    const cleanText = sanitizeChatText(rawText, chatConfig.LIMITS.MAX_MESSAGE_LENGTH);

    // Yeni Google üyesi sınırı: ilk 24 saat bağlantı içeren mesaj gönderemez
    if (cleanText && isNewGoogleMemberRestricted(req.session.user) && containsExternalLink(cleanText)) {
      return res.status(403).json({
        ok: false,
        code: 'NEW_MEMBER_NO_LINKS',
        error: req.t('chat.errNewMemberNoLinks'),
      });
    }
    const clientId =
      req.body && typeof req.body.clientId === 'string' ? req.body.clientId.trim().slice(0, 80) : null;
    const replyTo =
      req.body && typeof req.body.replyTo === 'string' ? req.body.replyTo.trim().slice(0, 64) : null;

    // Parça 3: Mesaja eklenecek dosya kimliklerini doğrula (en çok 5 dosya)
    const rawAttachmentIds = req.body && Array.isArray(req.body.attachmentIds) ? req.body.attachmentIds : [];
    const uniqueAttIds = [...new Set(rawAttachmentIds.map((x) => String(x || '').trim()).filter(Boolean))];
    if (uniqueAttIds.length > chatConfig.FILES.MAX_FILES_PER_MESSAGE) {
      return res.status(400).json({
        ok: false,
        code: 'TOO_MANY_ATTACHMENTS',
        error: req.t('chat.errMaxFiles'),
      });
    }

    const resolvedAttachments = [];
    for (const attId of uniqueAttIds) {
      if (!/^[0-9a-f]{32}$/.test(attId)) {
        return res.status(400).json({
          ok: false,
          code: 'INVALID_ATTACHMENT',
          error: req.t('chat.errInvalidAttachment'),
        });
      }
      const meta = store.getFileMeta(attId);
      if (!meta || meta.uploaderId !== userId || (meta.convId && meta.convId !== convId) || meta.msgId) {
        return res.status(400).json({
          ok: false,
          code: 'INVALID_ATTACHMENT',
          error: req.t('chat.errInvalidAttachment'),
        });
      }
      resolvedAttachments.push({
        id: meta.id,
        originalName: meta.originalName,
        ext: meta.ext,
        mimeType: meta.mimeType,
        category: meta.category,
        size: meta.size,
        url: `/sohbet/dosya/${meta.id}`,
        txtPreview: meta.txtPreview || null,
      });
    }

    if (!cleanText && resolvedAttachments.length === 0) {
      return res.status(400).json({
        ok: false,
        code: 'EMPTY_MESSAGE',
        error: req.t('chat.errEmptyMessage'),
      });
    }

    let appended;
    try {
      appended = store.appendMessage(convId, {
        from: userId,
        text: cleanText,
        attachments: resolvedAttachments,
        replyTo,
        clientId,
      });
    } catch (err) {
      return res.status(400).json({
        ok: false,
        code: err.code || 'SEND_FAILED',
        error: err.message || req.t('chat.errSendFailed'),
      });
    }

    if (appended.duplicate) {
      return res.status(200).json({
        ok: true,
        duplicate: true,
        convId,
        message: appended.message,
      });
    }

    // Yüklenen dosyaları bu sohbet ve mesaja kalıcı olarak bağla
    for (const att of resolvedAttachments) {
      const meta = store.getFileMeta(att.id);
      if (meta) {
        meta.convId = convId;
        meta.msgId = appended.message.id;
        store.registerFileMeta(meta);
      }
    }

    if (appended.isNewConversation) {
      store.recordNewConversation(userId);
    }

    // Parça 4: Yerel otomatik filtre (mesajı ASLA engellemez; işaretlenirse ±5 mesajla otomatik vaka açar/birleştirir)
    if (cleanText) {
      try {
        const scan = chatAutoFilter.scanMessageText(cleanText);
        if (scan.flagged) {
          const radius = chatConfig.MODERATION.AUTOFLAG_CONTEXT_RADIUS || 5;
          const ctxMsgs = store.getContextWindow(convId, appended.message.id, { radius });
          modStore.createOrMergeAutoCase({
            convId,
            offendingUserId: userId,
            targetMsgId: appended.message.id,
            categories: scan.categories,
            priority: scan.priority,
            snapshotMessages: ctxMsgs,
            chatStore: store,
          });
        }
      } catch (_) {}
    }

    const msg = appended.message;
    const recipientConnected = chatSseHub.isUserConnected(otherId);
    if (recipientConnected) {
      store.markDelivered(convId, otherId, msg.ts);
    }

    const senderInfo = {
      id: userId,
      displayName: req.session.user.displayName || req.session.user.username || userId,
      avatarUrl: req.session.user.avatarUrl || null,
      ring: store.getPublicRingForUser(userId),
    };

    const recipientUnread = store.getTotalUnreadCount(otherId);
    const notifyPreview = Boolean(otherProfile.notify && otherProfile.notify.preview);

    // Alıcıya SSE olayı
    chatSseHub.sendToUser(otherId, 'message', {
      convId,
      otherId: userId,
      sender: senderInfo,
      message: msg,
      notifyPreview,
    });
    chatSseHub.sendToUser(otherId, 'unread', { unread: recipientUnread });

    // Gönderenin diğer açık sekmelerine SSE olayı
    chatSseHub.sendToUser(userId, 'message', {
      convId,
      otherId,
      sender: senderInfo,
      message: msg,
      selfEcho: true,
    });
    if (recipientConnected) {
      chatSseHub.sendToUser(userId, 'delivered', {
        convId,
        by: otherId,
        upTo: msg.ts,
      });
    }

    return res.status(201).json({
      ok: true,
      duplicate: false,
      convId,
      message: msg,
      delivered: recipientConnected,
    });
  }
);

router.post('/api/sohbet/:digerId/okundu', requireChatMember, requireChatConsent, (req, res) => {
  const store = getChatStore();
  const userId = String(req.session.user.id);
  const otherId = String(req.params.digerId || '').trim();
  const convId = makeConvId(userId, otherId);

  if (!convId) {
    return res.status(400).json({ ok: false, code: 'INVALID_TARGET', error: req.t('chat.errInvalidTarget') });
  }

  const upTo = Number(req.body && req.body.upTo) || Date.now();
  const updatedState = store.markRead(convId, userId, upTo);
  const myUnread = store.getTotalUnreadCount(userId);
  chatSseHub.sendToUser(userId, 'unread', { unread: myUnread });

  // Karşılıklı görüldü gizlilik kuralı: yalnızca iki tarafın da readReceipts ayarı açıksa yayınla
  const myProfile = store.getProfile(userId);
  const otherProfile = store.getProfile(otherId);
  const broadcastRead = Boolean(myProfile.readReceipts && otherProfile.readReceipts);
  if (broadcastRead && updatedState) {
    chatSseHub.sendToUser(otherId, 'read', {
      convId,
      by: userId,
      upTo: updatedState.lastRead[userId] || upTo,
    });
  }

  return res.json({
    ok: true,
    convId,
    unread: myUnread,
    broadcastRead,
  });
});

router.post('/api/sohbet/:digerId/yaziyor', requireChatMember, requireChatConsent, (req, res) => {
  const store = getChatStore();
  const userId = String(req.session.user.id);
  const otherId = String(req.params.digerId || '').trim();
  const convId = makeConvId(userId, otherId);

  if (!convId) {
    return res.status(400).json({ ok: false, code: 'INVALID_TARGET' });
  }
  const blockInfo = store.isBlockedBetween(userId, otherId);
  if (blockInfo.any) {
    return res.json({ ok: true, emitted: false });
  }
  const emitted = chatSseHub.emitTyping(userId, otherId, convId);
  return res.json({ ok: true, emitted });
});

router.delete('/api/sohbet/:digerId/mesaj/:msgId', requireChatMember, requireChatConsent, (req, res) => {
  const store = getChatStore();
  const userId = String(req.session.user.id);
  const otherId = String(req.params.digerId || '').trim();
  const msgId = String(req.params.msgId || '').trim();
  const convId = makeConvId(userId, otherId);

  if (!convId || !msgId) {
    return res.status(400).json({ ok: false, code: 'INVALID_REQUEST' });
  }

  const result = store.deleteMessage(convId, msgId, { by: userId, modRemoved: false });
  if (!result.ok) {
    const status = result.code === 'FORBIDDEN' ? 403 : 404;
    return res.status(status).json({
      ok: false,
      code: result.code,
      error: result.code === 'FORBIDDEN' ? req.t('chat.errDeleteForbidden') : req.t('chat.errMsgNotFound'),
    });
  }

  // Parça 3 kancası: korunmayan ek dosyalarını diskten sil
  for (const attId of result.deletedAttachmentIds || []) {
    store.deleteFileIfUnpreserved(attId);
  }

  const payload = { convId, msgId, modRemoved: false };
  chatSseHub.sendToUser(userId, 'deleted', payload);
  chatSseHub.sendToUser(otherId, 'deleted', payload);
  chatSseHub.sendToUser(otherId, 'unread', { unread: store.getTotalUnreadCount(otherId) });
  chatSseHub.sendToUser(userId, 'unread', { unread: store.getTotalUnreadCount(userId) });

  return res.json({ ok: true, msgId });
});

// ============================================================================
// PROFİL, HALKA, GİZLİLİK AYARLARI VE ENGELLEME
// ============================================================================

router.post('/api/profil', requireChatMember, requireChatConsent, (req, res) => {
  const store = getChatStore();
  const user = req.session.user;
  const userId = String(user.id);
  const body = req.body && typeof req.body === 'object' ? req.body : {};

  const patch = {};
  let ringTouched = false;
  if (body.ringId !== undefined || body.ring !== undefined) {
    patch.ringId = body.ringId;
    patch.ring = body.ring;
    ringTouched = true;
  }
  if (typeof body.readReceipts === 'boolean') {
    patch.readReceipts = body.readReceipts;
  }
  if (typeof body.showGamesInChat === 'boolean') {
    patch.showGamesInChat = body.showGamesInChat;
  }
  if (body.notify && typeof body.notify === 'object') {
    patch.notify = body.notify;
  }
  if (body.whoCanMessage === 'everyone' || body.whoCanMessage === 'nobody') {
    patch.whoCanMessage = body.whoCanMessage;
  }

  try {
    const updated = store.setProfile(userId, patch);
    const effectiveRing = chatConfig.resolveEffectiveRing(updated);

    // Google üyesi oyun görünürlüğünü sohbet ayarlarından değiştirdiyse memberStore'u da senkronize et
    let effectiveShowGames = updated.showGamesInChat !== false;
    if (typeof body.showGamesInChat === 'boolean' && isGoogleChatUser(user)) {
      const gm = getFreshGoogleMember(user);
      if (gm) {
        const ms = getMemberStore();
        if (body.showGamesInChat) {
          ms.grantConsent(gm.id, 'chat_profile_game_usernames', '1.0');
          effectiveShowGames = true;
        } else {
          ms.updateMember(gm.id, { privacy: { showGamesInChat: false } });
          effectiveShowGames = false;
        }
      }
    } else if (isGoogleChatUser(user)) {
      const gm = getFreshGoogleMember(user);
      effectiveShowGames = Boolean(
        gm &&
          gm.privacy &&
          gm.privacy.showGamesInChat !== false &&
          getMemberStore().hasConsent(gm, 'chat_profile_game_usernames')
      );
    }

    if (ringTouched) {
      chatSseHub.broadcastProfileRing(userId, effectiveRing);
    }

    chatSseHub.sendToUser(userId, 'settings', {
      readReceipts: updated.readReceipts,
      showGamesInChat: effectiveShowGames,
      mutedGroups: updated.mutedGroups || [],
      notify: updated.notify,
      whoCanMessage: updated.whoCanMessage,
      ringId: updated.ringId,
      ring: updated.ring,
      effectiveRing,
    });

    return res.json({
      ok: true,
      profile: {
        ringId: updated.ringId,
        ring: updated.ring,
        effectiveRing,
        readReceipts: updated.readReceipts,
        showGamesInChat: effectiveShowGames,
        mutedGroups: updated.mutedGroups || [],
        notify: updated.notify,
        whoCanMessage: updated.whoCanMessage,
      },
    });
  } catch (err) {
    return res.status(400).json({
      ok: false,
      code: err.code || 'INVALID_PROFILE',
      error: err.message || req.t('chat.errInvalidProfile'),
    });
  }
});

router.post('/api/engelle', requireChatMember, requireChatConsent, (req, res) => {
  const store = getChatStore();
  const userId = String(req.session.user.id);
  const targetId = String((req.body && req.body.targetId) || '').trim();

  if (!isValidChatUserId(targetId) || targetId === userId) {
    return res.status(400).json({ ok: false, code: 'INVALID_TARGET', error: req.t('chat.errInvalidTarget') });
  }

  const updated = store.blockUser(userId, targetId);
  chatSseHub.sendToUser(userId, 'settings', { blocked: updated.blocked });
  chatSseHub.sendToUser(userId, 'unread', { unread: store.getTotalUnreadCount(userId) });
  return res.json({ ok: true, blocked: updated.blocked });
});

router.post('/api/engeli-kaldir', requireChatMember, requireChatConsent, (req, res) => {
  const store = getChatStore();
  const userId = String(req.session.user.id);
  const targetId = String((req.body && req.body.targetId) || '').trim();

  if (!isValidChatUserId(targetId) || targetId === userId) {
    return res.status(400).json({ ok: false, code: 'INVALID_TARGET', error: req.t('chat.errInvalidTarget') });
  }

  const updated = store.unblockUser(userId, targetId);
  chatSseHub.sendToUser(userId, 'settings', { blocked: updated.blocked });
  chatSseHub.sendToUser(userId, 'unread', { unread: store.getTotalUnreadCount(userId) });
  return res.json({ ok: true, blocked: updated.blocked });
});

// ============================================================================
// PARÇA 3: DOSYA YÜKLEME (POST /sohbet/api/yukle) VE ERİŞİM KONTROLLÜ SUNUM
// ============================================================================

router.post(
  '/api/yukle',
  requireChatMember,
  requireChatConsent,
  requireNotBannedFromChat,
  chatUploadLimiter,
  (req, res) => {
    const store = getChatStore();
    const modStore = getChatModStore(store);
    const userId = String(req.session.user.id);

    // Yeni Google üyesi sınırı: ilk 24 saat sohbette dosya yükleyemez
    if (isNewGoogleMemberRestricted(req.session.user)) {
      return res.status(403).json({
        ok: false,
        code: 'NEW_MEMBER_NO_FILES',
        error: req.t('chat.errNewMemberNoFiles'),
      });
    }

    const activeSanction = req.activeChatSanction || modStore.getActiveSanction(userId);
    if (activeSanction && activeSanction.type === 'mute') {
      return res.status(403).json({
        ok: false,
        code: 'USER_MUTED',
        sanction: { type: 'mute', reasonCategory: activeSanction.reasonCategory, expiresAt: activeSanction.expiresAt },
        error: req.t('chat.errMutedInChat'),
      });
    }

    // Önce disk doluluk eşiğini (%90) kontrol et
    const preDisk = chatFileValidator.checkVolumeDiskSpace(store.baseDir, 0);
    if (!preDisk.ok) {
      return res.status(507).json({
        ok: false,
        code: 'DISK_FULL',
        error: req.t('chat.errDiskFull'),
      });
    }

    uploadSingleChatFile(req, res, (multerErr) => {
      const tmpFilePath = req.file && req.file.path ? req.file.path : null;
      const cleanupTmp = () => {
        if (tmpFilePath) {
          try {
            if (fs.existsSync(tmpFilePath)) fs.unlinkSync(tmpFilePath);
          } catch (_) {}
        }
      };

      if (multerErr) {
        cleanupTmp();
        if (multerErr.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            ok: false,
            code: 'FILE_TOO_LARGE',
            error: 'Dosya boyutu izin verilen azami sınırı (50 MB) aşıyor.',
          });
        }
        return res.status(400).json({
          ok: false,
          code: 'UPLOAD_ERROR',
          error: req.t('chat.errUploadFailed'),
        });
      }

      if (!req.file || !tmpFilePath) {
        return res.status(400).json({
          ok: false,
          code: 'NO_FILE',
          error: req.t('chat.errUploadFailed'),
        });
      }

      try {
        // Dosya boyutuyla disk doluluğunu ve günlük 200 MB kullanıcı kotasını tekrar doğrula
        const fileSize = req.file.size || 0;
        const diskCheck = chatFileValidator.checkVolumeDiskSpace(store.baseDir, fileSize);
        if (!diskCheck.ok) {
          cleanupTmp();
          return res.status(507).json({
            ok: false,
            code: 'DISK_FULL',
            error: req.t('chat.errDiskFull'),
          });
        }

        const usedToday = store.getDailyUploadBytes(userId);
        if (usedToday + fileSize > chatConfig.FILES.DAILY_QUOTA_BYTES) {
          cleanupTmp();
          return res.status(413).json({
            ok: false,
            code: 'QUOTA_EXCEEDED',
            error: req.t('chat.errDailyQuota'),
          });
        }

        const rawBuffer = fs.readFileSync(tmpFilePath);
        const validated = chatFileValidator.validateChatAttachmentBuffer(rawBuffer, req.file.originalname || '');
        if (!validated.ok) {
          cleanupTmp();
          const status = validated.code === 'FILE_TOO_LARGE' ? 413 : 400;
          return res.status(status).json({
            ok: false,
            code: validated.code,
            error: validated.error,
          });
        }

        // Doğrulanmış (ve JPEG ise EXIF'i temizlenmiş) dosyayı rasgele 32-hex isimle files/ altına atomik taşı
        if (!fs.existsSync(store.filesDir)) {
          fs.mkdirSync(store.filesDir, { recursive: true, mode: 0o700 });
        }
        const finalPath = path.join(store.filesDir, validated.storedName);
        const writeTmpPath = `${finalPath}.${process.pid}.tmp`;
        fs.writeFileSync(writeTmpPath, validated.buffer, { mode: 0o600 });
        fs.renameSync(writeTmpPath, finalPath);
        cleanupTmp();

        const metaObj = {
          id: validated.id,
          storedName: validated.storedName,
          ext: validated.ext,
          mimeType: validated.mimeType,
          category: validated.category,
          size: validated.size,
          originalName: validated.originalName,
          uploaderId: userId,
          convId: null,
          msgId: null,
          createdAt: Date.now(),
          preserved: false,
          preservedByCases: [],
          txtPreview: validated.txtPreview || null,
        };
        store.registerFileMeta(metaObj);
        store.addDailyUploadBytes(userId, validated.size);

        return res.status(201).json({
          ok: true,
          file: {
            id: metaObj.id,
            originalName: metaObj.originalName,
            ext: metaObj.ext,
            mimeType: metaObj.mimeType,
            category: metaObj.category,
            size: metaObj.size,
            url: `/sohbet/dosya/${metaObj.id}`,
            txtPreview: metaObj.txtPreview,
          },
        });
      } catch (_) {
        cleanupTmp();
        return res.status(500).json({
          ok: false,
          code: 'UPLOAD_FAILED',
          error: req.t('chat.errUploadFailed'),
        });
      }
    });
  }
);

/**
 * GET /sohbet/dosya/:id
 * Erişim kontrollü dosya sunumu: yalnızca oturumlu katılımcı (veya Parça 4 yetkili vaka moderatörü) erişebilir;
 * aksi halde 404 döner (dosyanın varlığı belli edilmez). Video için HTTP Range destekler.
 */
router.get('/dosya/:id', async (req, res) => {
  const user = req.session && req.session.user;
  if (!user || !user.id || !isUserChatEligible(user)) {
    return res.status(404).end();
  }

  const fileId = String(req.params.id || '').trim();
  if (!/^[0-9a-f]{32}$/.test(fileId)) {
    return res.status(404).end();
  }

  const store = getChatStore();
  const meta = store.getFileMeta(fileId);
  if (!meta || !meta.storedName) {
    return res.status(404).end();
  }

  const userId = String(user.id);
  let authorized = false;

  if (meta.convId) {
    if (isGroupConvId(meta.convId)) {
      const modStore = getChatModStore(store);
      const sanction = modStore.getActiveSanction(userId);
      if (!sanction || sanction.type !== 'ban') {
        authorized = true;
      }
    } else {
      const participants = parseConvId(meta.convId);
      if (participants && participants.includes(userId)) {
        authorized = true;
      }
    }
  } else if (meta.uploaderId === userId) {
    // Gönderilmeden önceki önizleme yalnızca yükleyenin kendisine açıktır
    authorized = true;
  }

  // Parça 4 moderasyon vaka erişimi (yalnızca ?caseId= ve taze Community Official rolü ile)
  let modCaseAccess = false;
  if (!authorized && req.query && req.query.caseId && typeof modFileAccessAuthorizer === 'function') {
    try {
      modCaseAccess = Boolean(await modFileAccessAuthorizer(req, fileId, String(req.query.caseId)));
      if (modCaseAccess) authorized = true;
    } catch (_) {
      authorized = false;
    }
  }

  if (!authorized) {
    return res.status(404).end();
  }

  const diskPath = path.join(store.filesDir, path.basename(meta.storedName));
  if (!fs.existsSync(diskPath)) {
    return res.status(404).end();
  }

  let stat;
  try {
    stat = fs.statSync(diskPath);
    if (!stat.isFile()) return res.status(404).end();
  } catch (_) {
    return res.status(404).end();
  }

  const isInline = meta.category === 'image' || meta.category === 'video';
  const asciiName = String(meta.originalName || meta.storedName)
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\;]/g, '_');
  const encodedName = encodeURIComponent(meta.originalName || meta.storedName);
  const dispositionType = isInline ? 'inline' : 'attachment';

  const csp =
    meta.category === 'image'
      ? "default-src 'none'; img-src 'self'; sandbox"
      : meta.category === 'video'
        ? "default-src 'none'; media-src 'self'; sandbox"
        : "default-src 'none'; sandbox";

  res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Disposition', `${dispositionType}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`);
  res.setHeader('Accept-Ranges', 'bytes');

  const totalSize = stat.size;
  const rangeHeader = req.headers.range;

  if (rangeHeader && typeof rangeHeader === 'string' && rangeHeader.startsWith('bytes=')) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match) {
      res.setHeader('Content-Range', `bytes */${totalSize}`);
      return res.status(416).end();
    }
    let start = match[1] ? Number.parseInt(match[1], 10) : 0;
    let end = match[2] ? Number.parseInt(match[2], 10) : totalSize - 1;
    if (!match[1] && match[2]) {
      // suffix-byte-range-spec: bytes=-500
      const suffix = Number.parseInt(match[2], 10);
      start = Math.max(0, totalSize - suffix);
      end = totalSize - 1;
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || start >= totalSize || end < start) {
      res.setHeader('Content-Range', `bytes */${totalSize}`);
      return res.status(416).end();
    }
    end = Math.min(end, totalSize - 1);
    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    res.setHeader('Content-Length', String(chunkSize));
    const stream = fs.createReadStream(diskPath, { start, end });
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    return stream.pipe(res);
  }

  res.status(200);
  res.setHeader('Content-Length', String(totalSize));
  const stream = fs.createReadStream(diskPath);
  stream.on('error', () => {
    if (!res.headersSent) res.status(500).end();
    else res.end();
  });
  return stream.pipe(res);
});

// ============================================================================
// PARÇA 4: KULLANICI RAPORLAMA (DM VE GRUP)
// ============================================================================

/**
 * POST /sohbet/api/raporla
 * Bir mesajı veya sohbeti (DM veya Genel Sohbet grubu) raporlar; etrafındaki son 30 mesaj (+ ekleri) anlık görüntü olarak vakaya kopyalanır.
 */
router.post('/api/raporla', requireChatMember, requireChatConsent, requireNotBannedFromChat, (req, res) => {
  const store = getChatStore();
  const modStore = getChatModStore(store);
  const userId = String(req.session.user.id);
  const body = req.body && typeof req.body === 'object' ? req.body : {};

  const groupIdRaw = typeof body.groupId === 'string' ? body.groupId.trim() : '';
  const targetMsgId = typeof body.msgId === 'string' && body.msgId.trim() ? body.msgId.trim().slice(0, 64) : null;
  let convId = null;
  let reportedUserId = '';

  if (groupIdRaw) {
    convId = makeGroupConvId(groupIdRaw);
    if (!convId) {
      return res.status(400).json({ ok: false, code: 'INVALID_TARGET', error: req.t('chat.errInvalidTarget') });
    }
    if (targetMsgId) {
      const targetMsg = store.getMessageById(convId, targetMsgId);
      if (targetMsg && targetMsg.from && isValidChatUserId(targetMsg.from)) {
        reportedUserId = targetMsg.from;
      }
    }
    if (!reportedUserId && typeof body.otherId === 'string' && isValidChatUserId(body.otherId.trim())) {
      reportedUserId = body.otherId.trim();
    }
    if (!reportedUserId || reportedUserId === userId) {
      return res.status(400).json({ ok: false, code: 'INVALID_TARGET', error: req.t('chat.errInvalidTarget') });
    }
  } else {
    const otherId = String(body.otherId || '').trim();
    convId = makeConvId(userId, otherId);
    reportedUserId = otherId;
    if (!convId) {
      return res.status(400).json({ ok: false, code: 'INVALID_TARGET', error: req.t('chat.errInvalidTarget') });
    }
  }

  const category = String(body.category || '').trim();
  if (!REPORT_CATEGORIES.includes(category)) {
    return res.status(400).json({ ok: false, code: 'INVALID_CATEGORY', error: req.t('chat.errInvalidCategory') });
  }

  const note = typeof body.note === 'string' ? body.note.trim().slice(0, chatConfig.LIMITS.MAX_REPORT_NOTE_LENGTH) : '';

  if (!store.canSubmitReport(userId)) {
    return res.status(429).json({
      ok: false,
      code: 'REPORT_DAILY_LIMIT',
      error: req.t('chat.errReportLimit'),
    });
  }

  if (modStore.hasDuplicateReport(userId, convId, targetMsgId)) {
    return res.status(409).json({
      ok: false,
      code: 'DUPLICATE_REPORT',
      error: req.t('chat.errDuplicateReport'),
    });
  }

  const contextMsgs = store.getContextWindow(convId, targetMsgId, {
    totalCount: chatConfig.MODERATION.REPORT_CONTEXT_MESSAGES || 30,
  });

  try {
    const createdCase = modStore.createReportCase({
      convId,
      reporterId: userId,
      reportedUserId,
      targetMsgId,
      category,
      note,
      snapshotMessages: contextMsgs,
      chatStore: store,
    });
    store.recordReportSubmission(userId);
    return res.status(201).json({
      ok: true,
      caseId: createdCase.id,
      message: req.t('chat.reportReceivedToast'),
    });
  } catch (err) {
    const status = err.code === 'DUPLICATE_REPORT' ? 409 : 400;
    return res.status(status).json({ ok: false, code: err.code || 'REPORT_FAILED', error: err.message });
  }
});

router.setModFileAccessAuthorizer = setModFileAccessAuthorizer;
router.clearProfileCardCache = clearProfileCardCache;
router.clearGroupDuplicateTracker = clearGroupDuplicateTracker;
router.clearAvatarRefreshBackoff = clearAvatarRefreshBackoff;

module.exports = router;
