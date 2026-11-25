const express = require('express');
const router = express.Router();

const appConfig = require('../config/app.config');
const brandConfig = require('../config/brand.config');
const chatConfig = require('../config/chat.config');
const { isRegisteredMember } = require('../config/roles.config');
const botApiClient = require('../services/botApiClient');
const { getChatStore, makeConvId, isValidDiscordId, sanitizeChatText } = require('../services/chatStore');
const { chatSseHub } = require('../services/chatSseHub');
const { chatMessageLimiter } = require('../middlewares/rateLimiter');

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

function isUserChatEligible(user) {
  if (!user || !user.id || !isValidDiscordId(String(user.id))) return false;
  if (user.registered === true) return true;
  if (user.registered === false) return false;
  return isRegisteredMember(user.roles, user.level, user.registered);
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
  const userId = String(req.session.user.id);
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

function buildMemberPublicInfo(memberObj, fallbackId, store) {
  const id = String((memberObj && memberObj.id) || fallbackId || '');
  const ring = store.getPublicRingForUser(id);
  const avatarUrl =
    (memberObj && (memberObj.robloxAvatarUrl || memberObj.discordAvatarUrl)) || null;
  return {
    id,
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

function formatLastMessagePreview(msg, req) {
  if (!msg) return null;
  if (msg.deleted) {
    return {
      id: msg.id,
      from: msg.from,
      ts: msg.ts,
      deleted: true,
      modRemoved: Boolean(msg.modRemoved),
      text: msg.modRemoved
        ? req.t('chat.msgModRemoved')
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
  const user = req.session.user;
  const userId = String(user.id);
  const hasConsented = store.hasValidConsent(userId, chatConfig.POLICY_VERSION);
  const profile = store.getProfile(userId);
  const effectiveRing = chatConfig.resolveEffectiveRing(profile);
  const retentionInfo = store.getRetentionInfo();

  // Kendi Roblox avatarını da halka önizlemesinde kullanabilmek için rehber lookup yap (başarısızsa Discord avatarı)
  let selfDirectoryInfo = null;
  try {
    const lookup = await botApiClient.lookupDirectoryMembers(userId, [userId]);
    selfDirectoryInfo = lookup.byId.get(userId) || null;
  } catch (_) {}

  const selfAvatarUrl =
    (selfDirectoryInfo && (selfDirectoryInfo.robloxAvatarUrl || selfDirectoryInfo.discordAvatarUrl)) ||
    user.avatarUrl ||
    null;

  const requestedOtherId =
    typeof req.query.kisi === 'string' && isValidDiscordId(req.query.kisi.trim()) && req.query.kisi.trim() !== userId
      ? req.query.kisi.trim()
      : '';

  return res.render('pages/chat', {
    title: req.t('chat.pageTitle'),
    isChatPage: true,
    needsConsent: !hasConsented,
    policyVersion: chatConfig.POLICY_VERSION,
    chatProfile: {
      ringId: profile.ringId,
      ring: profile.ring,
      effectiveRing,
      readReceipts: profile.readReceipts,
      notify: profile.notify,
      whoCanMessage: profile.whoCanMessage,
      requireMessageRequest: profile.requireMessageRequest,
      blocked: profile.blocked,
      avatarUrl: selfAvatarUrl,
      displayName: user.displayName || user.username,
    },
    ringCategories: chatConfig.RING_CATEGORIES,
    ringPresets: chatConfig.RING_PRESETS,
    retentionInfo,
    requestedOtherId,
    chatLimits: {
      maxMessageLength: chatConfig.LIMITS.MAX_MESSAGE_LENGTH,
      maxAnimatedDirectoryRings: chatConfig.LIMITS.MAX_ANIMATED_DIRECTORY_RINGS,
      retentionDays: chatConfig.RETENTION_DAYS,
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
  const userId = String(req.session.user.id);
  const updated = store.recordConsent(userId, chatConfig.POLICY_VERSION);
  return res.json({
    ok: true,
    consent: updated.consent,
  });
});

router.get('/api/okunmamis', requireChatMember, (req, res) => {
  const store = getChatStore();
  const userId = String(req.session.user.id);
  if (!store.hasValidConsent(userId, chatConfig.POLICY_VERSION)) {
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

router.get('/akis', requireChatMember, requireChatConsent, (req, res) => {
  const store = getChatStore();
  const userId = String(req.session.user.id);
  const initialUnread = store.getTotalUnreadCount(userId);
  chatSseHub.subscribe(userId, req, res, { initialUnread });
});

// ============================================================================
// ÜYE REHBERİ VE SOHBET LİSTESİ
// ============================================================================

router.get('/api/rehber', requireChatMember, requireChatConsent, async (req, res) => {
  const store = getChatStore();
  const userId = String(req.session.user.id);
  const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 64) : '';
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit || 50), 10) || 50));
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor.trim() : '';

  try {
    const dir = await botApiClient.getDirectory(userId, {
      query,
      limit,
      cursor,
      excludeSelf: true,
    });

    const filtered = [];
    for (const item of dir.items) {
      if (!item || item.id === userId) continue;
      const block = store.isBlockedBetween(userId, item.id);
      if (block.any) continue;
      filtered.push(buildMemberPublicInfo(item, item.id, store));
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

router.get('/api/sohbetler', requireChatMember, requireChatConsent, async (req, res) => {
  const store = getChatStore();
  const userId = String(req.session.user.id);
  const myProfile = store.getProfile(userId);
  const rawList = store.listConversations(userId);
  const otherIds = rawList.map((c) => c.otherId);

  let memberMap = new Map();
  if (otherIds.length > 0) {
    try {
      const lookup = await botApiClient.lookupDirectoryMembers(userId, otherIds);
      memberMap = lookup.byId;
    } catch (_) {}
  }

  const conversations = rawList.map((entry) => {
    const otherProfile = store.getProfile(entry.otherId);
    const blockInfo = store.isBlockedBetween(userId, entry.otherId);
    const canSeeOtherRead = Boolean(myProfile.readReceipts && otherProfile.readReceipts);
    const isPendingIncoming =
      entry.state.requestStatus === 'pending' && entry.state.requestFrom === entry.otherId;

    return {
      convId: entry.convId,
      other: buildMemberPublicInfo(memberMap.get(entry.otherId), entry.otherId, store),
      lastMessage: isPendingIncoming
        ? {
            id: entry.lastMessage ? entry.lastMessage.id : null,
            from: entry.otherId,
            ts: entry.lastActivityAt,
            deleted: false,
            text: req.t('chat.messageRequestPreview'),
            attachmentCount: 0,
            masked: true,
          }
        : formatLastMessagePreview(entry.lastMessage, req),
      lastActivityAt: entry.lastActivityAt,
      unreadCount: blockInfo.blockedByA ? 0 : entry.unreadCount,
      otherLastRead: canSeeOtherRead ? entry.state.lastRead[entry.otherId] || 0 : 0,
      otherLastDelivered: entry.state.lastDelivered[entry.otherId] || 0,
      canSeeOtherRead,
      blockedByMe: blockInfo.blockedByA,
      blockedByOther: blockInfo.blockedByB,
      requestStatus: entry.state.requestStatus,
      requestFrom: entry.state.requestFrom,
    };
  });

  return res.json({
    ok: true,
    conversations,
    totalUnread: store.getTotalUnreadCount(userId),
    retentionInfo: store.getRetentionInfo(),
  });
});

// ============================================================================
// SOHBET MESAJLARI: OKUMA, GÖNDERME, SİLME, GÖRÜLDÜ, YAZIYOR
// ============================================================================

router.get('/api/sohbet/:digerId/mesajlar', requireChatMember, requireChatConsent, async (req, res) => {
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
    const lookup = await botApiClient.lookupDirectoryMembers(userId, [otherId]);
    otherMember = lookup.byId.get(otherId) || null;
  } catch (_) {}

  const isPendingIncoming =
    page.state.requestStatus === 'pending' && page.state.requestFrom === otherId;

  const safeMessages = page.messages.map((m) => {
    if (isPendingIncoming && m.from === otherId && !m.deleted) {
      return {
        ...m,
        text: '',
        attachments: [],
        maskedRequest: true,
      };
    }
    return m;
  });

  return res.json({
    ok: true,
    convId,
    other: buildMemberPublicInfo(otherMember, otherId, store),
    messages: safeMessages,
    hasMore: page.hasMore,
    canSeeOtherRead,
    state: {
      myLastRead: page.state.lastRead[userId] || 0,
      otherLastRead: canSeeOtherRead ? page.state.lastRead[otherId] || 0 : 0,
      otherLastDelivered: page.state.lastDelivered[otherId] || 0,
      requestStatus: page.state.requestStatus,
      requestFrom: page.state.requestFrom,
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
  chatMessageLimiter,
  async (req, res) => {
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

      // Hedefin kayıtlı üye olduğunu doğrula
      try {
        const lookup = await botApiClient.lookupDirectoryMembers(userId, [otherId]);
        if (!lookup.byId.has(otherId)) {
          return res.status(404).json({
            ok: false,
            code: 'TARGET_NOT_FOUND',
            error: req.t('chat.errTargetNotFound'),
          });
        }
      } catch (_) {
        // Bot API anlık erişilemezse gönderimi engelle
        return res.status(503).json({
          ok: false,
          code: 'DIRECTORY_UNAVAILABLE',
          error: req.t('chat.errDirectoryUnavailable'),
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
    const clientId =
      req.body && typeof req.body.clientId === 'string' ? req.body.clientId.trim().slice(0, 80) : null;
    const replyTo =
      req.body && typeof req.body.replyTo === 'string' ? req.body.replyTo.trim().slice(0, 64) : null;

    if (!cleanText) {
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
        attachments: [],
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

    if (appended.isNewConversation) {
      store.recordNewConversation(userId);
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
  const userId = String(req.session.user.id);
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
  if (body.notify && typeof body.notify === 'object') {
    patch.notify = body.notify;
  }
  if (body.whoCanMessage === 'everyone' || body.whoCanMessage === 'nobody') {
    patch.whoCanMessage = body.whoCanMessage;
  }
  if (typeof body.requireMessageRequest === 'boolean') {
    patch.requireMessageRequest = body.requireMessageRequest;
  }

  try {
    const updated = store.setProfile(userId, patch);
    const effectiveRing = chatConfig.resolveEffectiveRing(updated);

    if (ringTouched) {
      chatSseHub.broadcastProfileRing(userId, effectiveRing);
    }

    chatSseHub.sendToUser(userId, 'settings', {
      readReceipts: updated.readReceipts,
      notify: updated.notify,
      whoCanMessage: updated.whoCanMessage,
      requireMessageRequest: updated.requireMessageRequest,
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
        notify: updated.notify,
        whoCanMessage: updated.whoCanMessage,
        requireMessageRequest: updated.requireMessageRequest,
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

  if (!isValidDiscordId(targetId) || targetId === userId) {
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

  if (!isValidDiscordId(targetId) || targetId === userId) {
    return res.status(400).json({ ok: false, code: 'INVALID_TARGET', error: req.t('chat.errInvalidTarget') });
  }

  const updated = store.unblockUser(userId, targetId);
  chatSseHub.sendToUser(userId, 'settings', { blocked: updated.blocked });
  chatSseHub.sendToUser(userId, 'unread', { unread: store.getTotalUnreadCount(userId) });
  return res.json({ ok: true, blocked: updated.blocked });
});

module.exports = router;
