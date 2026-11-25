/**
 * ==============================================================================
 * 💬 PIYADE WORLD — BİREBİR ÖZEL SOHBET İSTEMCİ MOTORU (Saf Vanilla JS)
 * ==============================================================================
 * - Sıfır harici kütüphane (React / Tailwind / framer-motion / CDN YOK)
 * - Tüm kullanıcı metinleri textContent ile işlenir (XSS korumalı)
 * - NexusSpring (POP & MORPH) yay animasyonları yalnızca canlı yeni mesajlarda çalışır
 * - 44+ profil halkası + özel 2-4 hex renk üretici + IntersectionObserver optimizasyonu
 * - 855 yerel emoji + desteklenmeyen glif tespiti + son kullanılanlar (localStorage)
 * - SSE gerçek zamanlı akış + üstel geri çekilme + kopma sonrası yakalama (catch-up)
 * ==============================================================================
 */
(function () {
  'use strict';

  const bootEl = document.getElementById('chatBootstrapData');
  if (!bootEl) return;

  let boot;
  try {
    boot = JSON.parse(bootEl.textContent || '{}');
  } catch (_) {
    return;
  }

  const i18n = boot.i18n || {};
  const lang = boot.lang === 'en' ? 'en' : 'tr';
  const localeTag = lang === 'en' ? 'en-US' : 'tr-TR';
  const csrfToken = boot.csrfToken || '';
  const selfId = String(boot.selfId || '');
  const HEX_RE = /^#[0-9a-fA-F]{6}$/;
  const URL_RE = /(https?:\/\/[^\s<>"'`]+)/gi;

  const prefersReducedMotion = () =>
    Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const supportsAtProperty =
    typeof window.CSS !== 'undefined' && typeof window.CSS.registerProperty === 'function';

  // ==========================================================================
  // 1) İLK KULLANIM ONAY EKRANI
  // ==========================================================================
  if (boot.needsConsent) {
    const form = document.getElementById('chatConsentForm');
    const cb = document.getElementById('chatConsentCheckbox');
    const errBox = document.getElementById('chatConsentError');
    const submitBtn = document.getElementById('chatConsentSubmitBtn');

    if (form && cb) {
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (errBox) {
          errBox.hidden = true;
          errBox.textContent = '';
        }
        if (!cb.checked) {
          if (errBox) {
            errBox.textContent = i18n.errConsentCheckbox || 'Onay kutusunu işaretlemelisiniz.';
            errBox.hidden = false;
          }
          cb.focus();
          return;
        }
        if (submitBtn) submitBtn.disabled = true;
        try {
          const resp = await fetch('/sohbet/api/onay', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              'X-CSRF-Token': csrfToken,
            },
            body: JSON.stringify({ accepted: true }),
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok || !data.ok) {
            throw new Error(data.error || 'Onay kaydedilemedi.');
          }
          window.location.reload();
        } catch (err) {
          if (errBox) {
            errBox.textContent = err.message || 'Bir hata oluştu.';
            errBox.hidden = false;
          }
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }
    return;
  }

  // ==========================================================================
  // 2) ANA SOHBET DURUMU VE DOM REFERANSLARI
  // ==========================================================================
  const appEl = document.getElementById('chatApp');
  if (!appEl) return;

  const els = {
    reconnectBanner: document.getElementById('chatReconnectBanner'),
    searchInput: document.getElementById('chatDirectorySearch'),
    searchClearBtn: document.getElementById('chatSearchClearBtn'),
    directorySection: document.getElementById('chatDirectorySection'),
    directoryList: document.getElementById('chatDirectoryList'),
    conversationsList: document.getElementById('chatConversationsList'),
    threadEmpty: document.getElementById('chatThreadEmpty'),
    threadActive: document.getElementById('chatThreadActive'),
    mobileBackBtn: document.getElementById('chatMobileBackBtn'),
    headerAvatarSlot: document.getElementById('chatHeaderAvatarSlot'),
    headerName: document.getElementById('chatHeaderName'),
    headerSub: document.getElementById('chatHeaderSub'),
    retentionInfoBtn: document.getElementById('chatRetentionInfoBtn'),
    retentionPopover: document.getElementById('chatRetentionPopover'),
    retentionPopoverBody: document.getElementById('chatRetentionPopoverBody'),
    headerMenuBtn: document.getElementById('chatHeaderMenuBtn'),
    headerMenu: document.getElementById('chatHeaderMenu'),
    menuBlockBtn: document.getElementById('chatMenuBlockBtn'),
    menuBlockLabel: document.getElementById('chatMenuBlockLabel'),
    messagesScroll: document.getElementById('chatMessagesScroll'),
    loadOlderWrap: document.getElementById('chatLoadOlderWrap'),
    loadOlderBtn: document.getElementById('chatLoadOlderBtn'),
    messagesList: document.getElementById('chatMessagesList'),
    typingRow: document.getElementById('chatTypingRow'),
    blockedBar: document.getElementById('chatBlockedBar'),
    blockedBarText: document.getElementById('chatBlockedBarText'),
    quickUnblockBtn: document.getElementById('chatQuickUnblockBtn'),
    composerShell: document.getElementById('chatComposerShell'),
    composerForm: document.getElementById('chatComposerForm'),
    messageInput: document.getElementById('chatMessageInput'),
    charCounter: document.getElementById('chatCharCounter'),
    sendBtn: document.getElementById('chatSendBtn'),
    emojiToggleBtn: document.getElementById('chatEmojiToggleBtn'),
    emojiPopover: document.getElementById('chatEmojiPopover'),
    emojiSearch: document.getElementById('chatEmojiSearch'),
    emojiCloseBtn: document.getElementById('chatEmojiCloseBtn'),
    emojiTabs: document.getElementById('chatEmojiTabs'),
    emojiGrid: document.getElementById('chatEmojiGrid'),
    openSettingsBtn: document.getElementById('chatOpenSettingsBtn'),
    settingsModal: document.getElementById('chatSettingsModal'),
    settingsCloseBtn: document.getElementById('chatSettingsCloseBtn'),
    settingsCancelBtn: document.getElementById('chatSettingsCancelBtn'),
    settingsSaveBtn: document.getElementById('chatSettingsSaveBtn'),
    ringLivePreviewSlot: document.getElementById('chatRingLivePreviewSlot'),
    ringPreviewName: document.getElementById('chatRingPreviewName'),
    ringCategoryTabs: document.getElementById('chatRingCategoryTabs'),
    ringPresetGrid: document.getElementById('chatRingPresetGrid'),
    customColorsRow: document.getElementById('chatCustomColorsRow'),
    customAddColorBtn: document.getElementById('chatCustomAddColorBtn'),
    customSpinCheck: document.getElementById('chatCustomSpinCheck'),
    customApplyBtn: document.getElementById('chatCustomApplyBtn'),
    setReadReceipts: document.getElementById('chatSetReadReceipts'),
    setWhoCanMessage: document.getElementById('chatSetWhoCanMessage'),
    enableBrowserNotifyBtn: document.getElementById('chatEnableBrowserNotifyBtn'),
    browserNotifyStatus: document.getElementById('chatBrowserNotifyStatus'),
    setNotifyPreview: document.getElementById('chatSetNotifyPreview'),
    setNotifySound: document.getElementById('chatSetNotifySound'),
    blockedListContainer: document.getElementById('chatBlockedListContainer'),
    confirmModal: document.getElementById('chatConfirmModal'),
    confirmTitle: document.getElementById('chatConfirmTitle'),
    confirmText: document.getElementById('chatConfirmText'),
    confirmCancelBtn: document.getElementById('chatConfirmCancelBtn'),
    confirmOkBtn: document.getElementById('chatConfirmOkBtn'),
    toastStack: document.getElementById('chatToastStack'),
  };

  const DEFAULT_PRESET =
    (Array.isArray(boot.ringPresets) && boot.ringPresets[0]) || { id: 'classic-google', type: 'static', colors: [] };
  const DEFAULT_CUSTOM_COLORS =
    Array.isArray(DEFAULT_PRESET.colors) && DEFAULT_PRESET.colors.length >= 2
      ? DEFAULT_PRESET.colors.slice(0, 3)
      : [];

  const state = {
    profile: Object.assign(
      {
        ringId: DEFAULT_PRESET.id,
        ring: null,
        effectiveRing: { id: DEFAULT_PRESET.id, type: DEFAULT_PRESET.type, colors: DEFAULT_PRESET.colors },
        readReceipts: true,
        notify: { browser: false, sound: false, preview: false },
        whoCanMessage: 'everyone',
        blocked: [],
      },
      boot.profile || {}
    ),
    conversations: [],
    directoryItems: [],
    activeOtherId: null,
    activeConvId: null,
    activeOther: null,
    messages: [],
    hasMoreOlder: false,
    loadingOlder: false,
    canSeeOtherRead: true,
    otherLastRead: 0,
    otherLastDelivered: 0,
    myInitialLastRead: 0,
    blockedState: { byMe: false, byOther: false, any: false },
    whoCanMessageOther: 'everyone',
    drafts: new Map(),
    typingTimer: null,
    lastTypingSentAt: 0,
    sse: null,
    sseRetryMs: 1000,
    sseLastEventId: 0,
    totalUnread: 0,
    // Ayarlar geçici durumu
    settingsDraft: {
      ringId: DEFAULT_PRESET.id,
      customColors: DEFAULT_CUSTOM_COLORS.slice(),
      customSpin: false,
      activeRingCat: 'classic',
    },
    // Emoji durumu
    emojiData: null,
    emojiLoading: false,
    emojiActiveCat: 'recent',
    emojiSearchQuery: '',
    emojiSupportCache: new Map(),
    // Mesaj okuma takipçisi
    readDebounceTimer: null,
    pendingReadTs: 0,
  };

  // Ses istemcisi (kullanıcı etkileşiminden sonra çalar)
  const soundClient =
    window.NexusSound && typeof window.NexusSound.createClient === 'function'
      ? window.NexusSound.createClient({ soundEnabled: true })
      : null;

  function playChatSound(kind) {
    if (!soundClient || !state.profile.notify || !state.profile.notify.sound) return;
    if (kind === 'send' && typeof soundClient.playWhoosh === 'function') {
      soundClient.playWhoosh();
    } else if (kind === 'receive' && typeof soundClient.playPing === 'function') {
      soundClient.playPing();
    } else if (kind === 'pop' && typeof soundClient.playPop === 'function') {
      soundClient.playPop();
    }
  }

  // ==========================================================================
  // 3) YARDIMCI FONKSİYONLAR (TARİH, METİN, BİLDİRİM, HTTP)
  // ==========================================================================
  async function apiJson(url, { method = 'GET', body = null } = {}) {
    const headers = { Accept: 'application/json' };
    if (method !== 'GET' && method !== 'HEAD') {
      headers['X-CSRF-Token'] = csrfToken;
    }
    const opts = { method, credentials: 'same-origin', headers };
    if (body !== null) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const resp = await fetch(url, opts);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = new Error(data.error || `HTTP ${resp.status}`);
      err.status = resp.status;
      err.code = data.code || 'API_ERROR';
      throw err;
    }
    return data;
  }

  function formatTimeHHMM(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleTimeString(localeTag, { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return '';
    }
  }

  function formatListTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) return formatTimeHHMM(ts);
    const yesterday = new Date(now.getTime() - 86400000);
    const isYesterday =
      d.getFullYear() === yesterday.getFullYear() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getDate() === yesterday.getDate();
    if (isYesterday) return i18n.dateYesterday || 'Dün';
    try {
      return d.toLocaleDateString(localeTag, { day: '2-digit', month: '2-digit' });
    } catch (_) {
      return '';
    }
  }

  function getDateDividerLabel(ts) {
    const d = new Date(ts);
    const now = new Date();
    const keyOf = (dt) => `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
    if (keyOf(d) === keyOf(now)) return i18n.dateToday || 'Bugün';
    const yest = new Date(now.getTime() - 86400000);
    if (keyOf(d) === keyOf(yest)) return i18n.dateYesterday || 'Dün';
    try {
      return d.toLocaleDateString(localeTag, { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (_) {
      return d.toISOString().slice(0, 10);
    }
  }

  function formatDaysUntilExpiry(msgTs) {
    const retentionDays = (boot.limits && boot.limits.retentionDays) || 30;
    const expireAt = msgTs + retentionDays * 86400000;
    const diffDays = Math.ceil((expireAt - Date.now()) / 86400000);
    if (diffDays <= 0) return i18n.expiresToday || 'Bugün otomatik silinecek';
    return (i18n.expiresInDays || '{days} gün sonra silinecek').replace('{days}', String(diffDays));
  }

  function showToast(title, body, { onClick = null, variant = 'info' } = {}) {
    if (!els.toastStack) return;
    const toast = document.createElement('div');
    toast.className = `chat-toast chat-toast--${variant}`;
    if (typeof onClick === 'function') {
      toast.classList.add('is-clickable');
      toast.addEventListener('click', () => {
        onClick();
        toast.remove();
      });
    }
    const tEl = document.createElement('strong');
    tEl.className = 'chat-toast-title';
    tEl.textContent = title;
    toast.appendChild(tEl);
    if (body) {
      const bEl = document.createElement('div');
      bEl.className = 'chat-toast-body';
      bEl.textContent = body;
      toast.appendChild(bEl);
    }
    els.toastStack.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('is-leaving');
      setTimeout(() => toast.remove(), 220);
    }, 4200);
  }

  function showConfirmModal(title, message) {
    return new Promise((resolve) => {
      if (!els.confirmModal) return resolve(false);
      els.confirmTitle.textContent = title;
      els.confirmText.textContent = message;
      els.confirmModal.hidden = false;
      els.confirmModal.setAttribute('aria-hidden', 'false');

      const cleanup = (val) => {
        els.confirmModal.hidden = true;
        els.confirmModal.setAttribute('aria-hidden', 'true');
        els.confirmOkBtn.removeEventListener('click', onOk);
        els.confirmCancelBtn.removeEventListener('click', onCancel);
        els.confirmModal.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKey);
        resolve(val);
      };
      const onOk = () => cleanup(true);
      const onCancel = () => cleanup(false);
      const onBackdrop = (e) => {
        if (e.target === els.confirmModal) cleanup(false);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') cleanup(false);
      };

      els.confirmOkBtn.addEventListener('click', onOk);
      els.confirmCancelBtn.addEventListener('click', onCancel);
      els.confirmModal.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKey);
      els.confirmOkBtn.focus();
    });
  }

  function emitUnreadGlobal(count) {
    state.totalUnread = Math.max(0, Number(count) || 0);
    window.dispatchEvent(new CustomEvent('piyade:chat-unread', { detail: { unread: state.totalUnread } }));
  }

  function isJumboEmojiOnly(text) {
    if (!text) return false;
    const stripped = text.replace(/\s+/g, '');
    if (!stripped || stripped.length > 24) return false;
    // Harf veya rakam içeriyorsa jumbo değil
    if (/[a-zA-Z0-9ğüşöçıİĞÜŞÖÇ]/.test(stripped)) return false;
    // En fazla 3 emoji kümesi
    try {
      const seg = typeof Intl !== 'undefined' && Intl.Segmenter
        ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(stripped)].map((s) => s.segment)
        : [...stripped];
      if (seg.length === 0 || seg.length > 3) return false;
      return seg.every((g) => /\p{Extended_Pictographic}/u.test(g));
    } catch (_) {
      return false;
    }
  }

  /**
   * Metni textContent ile güvenli biçimde ekler; yalnızca http:// ve https:// URL'leri linkleştirir.
   */
  function appendSafeLinkedText(container, text) {
    const raw = String(text || '');
    URL_RE.lastIndex = 0;
    let lastIdx = 0;
    let match;
    while ((match = URL_RE.exec(raw)) !== null) {
      const start = match.index;
      if (start > lastIdx) {
        container.appendChild(document.createTextNode(raw.slice(lastIdx, start)));
      }
      let urlStr = match[0];
      let trailing = '';
      while (urlStr.length > 0 && /[.,!?;:)\]]$/.test(urlStr)) {
        trailing = urlStr.slice(-1) + trailing;
        urlStr = urlStr.slice(0, -1);
      }
      let validHref = null;
      try {
        const u = new URL(urlStr);
        if (u.protocol === 'http:' || u.protocol === 'https:') {
          validHref = u.href;
        }
      } catch (_) {}

      if (validHref) {
        const a = document.createElement('a');
        a.href = validHref;
        a.target = '_blank';
        a.rel = 'noopener noreferrer nofollow ugc';
        a.className = 'chat-msg-link';
        a.textContent = urlStr;
        container.appendChild(a);
      } else {
        container.appendChild(document.createTextNode(urlStr));
      }
      if (trailing) {
        container.appendChild(document.createTextNode(trailing));
      }
      lastIdx = URL_RE.lastIndex;
    }
    if (lastIdx < raw.length) {
      container.appendChild(document.createTextNode(raw.slice(lastIdx)));
    }
  }

  // ==========================================================================
  // 4) PROFİL HALKALARI (CONIC GRADIENT + INTERSECTION OBSERVER OPTİMİZASYONU)
  // ==========================================================================
  const ringObserver =
    typeof window.IntersectionObserver === 'function'
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              entry.target.classList.toggle('is-offscreen', !entry.isIntersecting);
            }
          },
          { rootMargin: '60px' }
        )
      : null;

  function buildConicGradient(colors) {
    const clean = (Array.isArray(colors) ? colors : []).filter((c) => typeof c === 'string' && HEX_RE.test(c.trim()));
    const list = clean.length >= 2 ? clean : DEFAULT_PRESET.colors;
    const closed = list.concat([list[0]]);
    return `conic-gradient(from var(--ring-angle, 0deg), ${closed.join(', ')})`;
  }

  function applyRingStylesToEl(ringEl, ring, { allowAnimated = true } = {}) {
    if (!ringEl || !ring) return;
    ringEl.style.setProperty('--ring-gradient', buildConicGradient(ring.colors));
    ringEl.classList.remove('chat-ring--spin', 'chat-ring--pulse', 'chat-ring--fallback-rotate');
    if (allowAnimated && !prefersReducedMotion()) {
      if (ring.type === 'spin') {
        ringEl.classList.add('chat-ring--spin');
        if (!supportsAtProperty) ringEl.classList.add('chat-ring--fallback-rotate');
        if (ringObserver) ringObserver.observe(ringEl);
      } else if (ring.type === 'pulse') {
        ringEl.classList.add('chat-ring--pulse');
        if (ringObserver) ringObserver.observe(ringEl);
      }
    }
  }

  function createRingAvatarEl({
    userId = '',
    avatarUrl = null,
    displayName = '?',
    ring = null,
    sizePx = 42,
    thicknessPx = 2,
    allowAnimated = true,
  }) {
    const wrap = document.createElement('span');
    wrap.className = 'chat-ring';
    wrap.style.setProperty('--ring-size', `${sizePx}px`);
    wrap.style.setProperty('--ring-thickness', `${thicknessPx}px`);
    if (userId) {
      wrap.dataset.ringUserId = String(userId);
      wrap.dataset.ringAllowAnim = allowAnimated ? '1' : '0';
    }

    const effectiveRing = ring || {
      id: DEFAULT_PRESET.id,
      type: DEFAULT_PRESET.type,
      colors: DEFAULT_PRESET.colors,
    };
    applyRingStylesToEl(wrap, effectiveRing, { allowAnimated });

    const inner = document.createElement('span');
    inner.className = 'chat-ring-inner';

    const initialLetter = String(displayName || '?').trim().charAt(0).toUpperCase() || '?';
    const makeFallback = () => {
      const fb = document.createElement('span');
      fb.className = 'chat-avatar-fallback';
      fb.textContent = initialLetter;
      return fb;
    };

    if (avatarUrl) {
      const img = document.createElement('img');
      img.className = 'chat-avatar-img';
      img.src = avatarUrl;
      img.alt = displayName;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('error', () => {
        inner.replaceChildren(makeFallback());
      });
      inner.appendChild(img);
    } else {
      inner.appendChild(makeFallback());
    }

    wrap.appendChild(inner);
    return wrap;
  }

  function updateAllVisibleRingsForUser(userId, ring) {
    const uid = String(userId || '');
    if (!uid || !ring) return;
    document.querySelectorAll(`.chat-ring[data-ring-user-id="${CSS.escape(uid)}"]`).forEach((el) => {
      const allowAnim = el.dataset.ringAllowAnim !== '0';
      applyRingStylesToEl(el, ring, { allowAnimated: allowAnim });
    });
    for (const c of state.conversations) {
      if (c.other && c.other.id === uid) c.other.ring = ring;
    }
    if (state.activeOther && state.activeOther.id === uid) {
      state.activeOther.ring = ring;
    }
  }

  // ==========================================================================
  // 5) NEXUS UI YAY ANİMASYONLARI (POP & MORPH — Yalnızca Canlı Mesajlar)
  // ==========================================================================
  const SPRING_POP = { stiffness: 520, damping: 24, mass: 0.8 };
  const SPRING_MORPH = { stiffness: 380, damping: 30, mass: 1 };

  function animateBubblePop(bubbleEl, isSelf, { fromTyping = false } = {}) {
    if (!bubbleEl || prefersReducedMotion()) return;
    const Spring = window.NexusSpring;
    const origin = isSelf ? 'bottom right' : 'bottom left';
    bubbleEl.style.transformOrigin = origin;

    if (!Spring || typeof Spring.animate !== 'function') {
      bubbleEl.animate(
        [
          { opacity: 0, transform: 'translate3d(0, 12px, 0) scale(0.88)' },
          { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
        ],
        { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
      );
      return;
    }

    const cfg = fromTyping ? SPRING_MORPH : SPRING_POP;
    const startScale = fromTyping ? 0.72 : 0.56;
    const startY = fromTyping ? 6 : 14;
    bubbleEl.style.opacity = '0';
    bubbleEl.style.transform = `translate3d(0, ${startY}px, 0) scale(${startScale})`;

    Spring.animate({
      from: 0,
      to: 1,
      stiffness: cfg.stiffness,
      damping: cfg.damping,
      mass: cfg.mass,
      onUpdate: (v) => {
        const clampedOpacity = Math.max(0, Math.min(1, v * 1.25));
        const sc = startScale + (1 - startScale) * v;
        const ty = startY * (1 - v);
        bubbleEl.style.opacity = String(clampedOpacity);
        bubbleEl.style.transform = `translate3d(0, ${ty.toFixed(2)}px, 0) scale(${sc.toFixed(4)})`;
      },
      onComplete: () => {
        bubbleEl.style.opacity = '';
        bubbleEl.style.transform = '';
      },
    });
  }

  // ==========================================================================
  // 6) SOHBET LİSTESİ VE REHBER ARAMASI
  // ==========================================================================
  async function loadConversations() {
    try {
      const data = await apiJson('/sohbet/api/sohbetler');
      state.conversations = Array.isArray(data.conversations) ? data.conversations : [];
      if (data.retentionInfo) boot.retentionInfo = data.retentionInfo;
      emitUnreadGlobal(data.totalUnread || 0);
      renderConversationsList();
    } catch (_) {
      renderConversationsList(true);
    }
  }

  function renderConversationsList(hasError = false) {
    const container = els.conversationsList;
    if (!container) return;
    container.replaceChildren();

    if (hasError) {
      const errWrap = document.createElement('div');
      errWrap.className = 'chat-empty-card';
      const p = document.createElement('p');
      p.textContent = i18n.directoryError || 'Sohbet listesi yüklenemedi.';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary btn-xs';
      btn.textContent = i18n.retryBtn || 'Tekrar Dene';
      btn.addEventListener('click', loadConversations);
      errWrap.append(p, btn);
      container.appendChild(errWrap);
      return;
    }

    if (state.conversations.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'chat-empty-card';
      const title = document.createElement('strong');
      title.className = 'chat-empty-card-title';
      title.textContent = i18n.noConversationsTitle || 'Bir arkadaşını bul 👋';
      const desc = document.createElement('p');
      desc.className = 'chat-empty-card-desc';
      desc.textContent = i18n.noConversationsDesc || '';
      empty.append(title, desc);
      container.appendChild(empty);
      return;
    }

    let animCount = 0;
    const maxAnim = (boot.limits && boot.limits.maxAnimatedDirectoryRings) || 12;

    for (const conv of state.conversations) {
      const other = conv.other || { id: conv.otherId, displayName: conv.otherId };
      const isActive = state.activeOtherId === other.id;
      const hasUnread = Number(conv.unreadCount) > 0;
      const isAnimRing = other.ring && (other.ring.type === 'spin' || other.ring.type === 'pulse');
      const allowAnim = !isAnimRing || animCount < maxAnim;
      if (isAnimRing && allowAnim) animCount += 1;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `chat-conv-item${isActive ? ' is-active' : ''}${hasUnread ? ' has-unread' : ''}`;
      btn.dataset.otherId = other.id;

      const avatarEl = createRingAvatarEl({
        userId: other.id,
        avatarUrl: other.avatarUrl,
        displayName: other.displayName,
        ring: other.ring,
        sizePx: 44,
        thicknessPx: 2,
        allowAnimated: allowAnim,
      });

      const body = document.createElement('div');
      body.className = 'chat-conv-body';

      const topRow = document.createElement('div');
      topRow.className = 'chat-conv-top';
      const nameEl = document.createElement('span');
      nameEl.className = 'chat-conv-name';
      nameEl.textContent = other.displayName;
      const timeEl = document.createElement('span');
      timeEl.className = 'chat-conv-time';
      timeEl.textContent = formatListTime(conv.lastActivityAt);
      topRow.append(nameEl, timeEl);

      const botRow = document.createElement('div');
      botRow.className = 'chat-conv-bottom';
      const previewEl = document.createElement('span');
      previewEl.className = 'chat-conv-preview';
      if (conv.lastMessage) {
        if (conv.lastMessage.deleted) {
          previewEl.classList.add('is-italic');
          previewEl.textContent = conv.lastMessage.text || i18n.msgDeleted;
        } else {
          const prefix = conv.lastMessage.from === selfId ? '✓ ' : '';
          const attNote =
            conv.lastMessage.attachmentCount > 0 && !conv.lastMessage.text
              ? `📎 (${conv.lastMessage.attachmentCount})`
              : '';
          previewEl.textContent = `${prefix}${conv.lastMessage.text || attNote}`;
        }
      }
      botRow.appendChild(previewEl);

      if (hasUnread) {
        const badge = document.createElement('span');
        badge.className = 'chat-unread-badge';
        badge.textContent = conv.unreadCount > 99 ? '99+' : String(conv.unreadCount);
        botRow.appendChild(badge);
      }

      body.append(topRow, botRow);
      btn.append(avatarEl, body);
      btn.addEventListener('click', () => openConversation(other.id, other));
      container.appendChild(btn);
    }
  }

  let dirSearchTimer = null;
  async function searchDirectory(query) {
    const q = String(query || '').trim();
    if (!q) {
      if (els.directorySection) els.directorySection.hidden = true;
      if (els.searchClearBtn) els.searchClearBtn.hidden = true;
      return;
    }
    if (els.searchClearBtn) els.searchClearBtn.hidden = false;
    if (els.directorySection) els.directorySection.hidden = false;
    els.directoryList.replaceChildren();

    const loading = document.createElement('div');
    loading.className = 'chat-dir-status';
    loading.textContent = '…';
    els.directoryList.appendChild(loading);

    try {
      const data = await apiJson(`/sohbet/api/rehber?q=${encodeURIComponent(q)}&limit=40`);
      state.directoryItems = Array.isArray(data.items) ? data.items : [];
      renderDirectoryItems();
    } catch (_) {
      els.directoryList.replaceChildren();
      const errEl = document.createElement('div');
      errEl.className = 'chat-dir-status is-error';
      errEl.textContent = i18n.directoryError || 'Rehber yüklenemedi.';
      els.directoryList.appendChild(errEl);
    }
  }

  function renderDirectoryItems() {
    els.directoryList.replaceChildren();
    if (state.directoryItems.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'chat-dir-status';
      empty.textContent = i18n.noDirectoryResults || 'Kişi bulunamadı.';
      els.directoryList.appendChild(empty);
      return;
    }

    let animatedCount = 0;
    const maxAnim = (boot.limits && boot.limits.maxAnimatedDirectoryRings) || 12;

    for (const member of state.directoryItems) {
      const isAnim = member.ring && (member.ring.type === 'spin' || member.ring.type === 'pulse');
      const allowAnim = !isAnim || animatedCount < maxAnim;
      if (isAnim && allowAnim) animatedCount += 1;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-conv-item chat-dir-item';

      const avatarEl = createRingAvatarEl({
        userId: member.id,
        avatarUrl: member.avatarUrl,
        displayName: member.displayName,
        ring: member.ring,
        sizePx: 40,
        thicknessPx: 2,
        allowAnimated: allowAnim,
      });

      const body = document.createElement('div');
      body.className = 'chat-conv-body';
      const nameEl = document.createElement('div');
      nameEl.className = 'chat-conv-name';
      nameEl.textContent = member.displayName;
      body.appendChild(nameEl);

      if (member.robloxUsername) {
        const subEl = document.createElement('div');
        subEl.className = 'chat-conv-preview';
        subEl.textContent = `${i18n.robloxLabel || 'Roblox'}: ${member.robloxUsername}`;
        body.appendChild(subEl);
      }

      btn.append(avatarEl, body);
      btn.addEventListener('click', () => {
        els.searchInput.value = '';
        els.directorySection.hidden = true;
        els.searchClearBtn.hidden = true;
        openConversation(member.id, member);
      });
      els.directoryList.appendChild(btn);
    }
  }

  // ==========================================================================
  // 7) KONUŞMA AÇMA, MESAJ AKIŞI, GÖRÜLDÜ VE SAYFALAMA
  // ==========================================================================
  function saveCurrentDraft() {
    if (!state.activeOtherId || !els.messageInput) return;
    const val = els.messageInput.value;
    state.drafts.set(state.activeOtherId, val);
    try {
      sessionStorage.setItem(`piyade_chat_draft_${state.activeOtherId}`, val);
    } catch (_) {}
  }

  function restoreDraft(otherId) {
    let draft = state.drafts.get(otherId);
    if (draft === undefined) {
      try {
        draft = sessionStorage.getItem(`piyade_chat_draft_${otherId}`) || '';
      } catch (_) {
        draft = '';
      }
    }
    els.messageInput.value = draft;
    autoResizeTextarea();
    updateComposerControls();
  }

  function renderThreadHeader() {
    const other = state.activeOther;
    if (!other) return;
    els.headerAvatarSlot.replaceChildren(
      createRingAvatarEl({
        userId: other.id,
        avatarUrl: other.avatarUrl,
        displayName: other.displayName,
        ring: other.ring,
        sizePx: 40,
        thicknessPx: 3,
        allowAnimated: true,
      })
    );
    els.headerName.textContent = other.displayName || other.id;
    els.headerSub.textContent = other.robloxUsername
      ? `${i18n.robloxLabel || 'Roblox'}: ${other.robloxUsername}`
      : '';
    els.headerSub.hidden = !other.robloxUsername;

    if (els.menuBlockLabel) {
      els.menuBlockLabel.textContent = state.blockedState.byMe
        ? i18n.unblockUser || 'Engeli Kaldır'
        : i18n.blockUser || 'Üyeyi Engelle';
    }

    // Engel veya kapalı DM durumu
    if (state.blockedState.byMe) {
      els.blockedBarText.textContent = i18n.blockedBannerMe || '';
      els.quickUnblockBtn.hidden = false;
      els.blockedBar.hidden = false;
      els.composerShell.hidden = true;
    } else if (state.blockedState.byOther) {
      els.blockedBarText.textContent = i18n.blockedBannerOther || '';
      els.quickUnblockBtn.hidden = true;
      els.blockedBar.hidden = false;
      els.composerShell.hidden = true;
    } else if (state.whoCanMessageOther === 'nobody') {
      els.blockedBarText.textContent = i18n.closedDmBanner || '';
      els.quickUnblockBtn.hidden = true;
      els.blockedBar.hidden = false;
      els.composerShell.hidden = true;
    } else {
      els.blockedBar.hidden = true;
      els.composerShell.hidden = false;
    }
  }

  async function openConversation(otherId, hintMember = null) {
    if (!otherId || otherId === selfId) return;
    saveCurrentDraft();

    state.activeOtherId = otherId;
    state.activeOther = hintMember || { id: otherId, displayName: otherId };
    state.messages = [];
    state.hasMoreOlder = false;
    hideTypingIndicator();

    appEl.classList.add('is-thread-open');
    els.threadEmpty.hidden = true;
    els.threadActive.hidden = false;
    els.retentionPopover.hidden = true;
    closeHeaderMenu();
    closeEmojiPicker();
    renderThreadHeader();
    renderConversationsList();
    restoreDraft(otherId);

    try {
      const data = await apiJson(`/sohbet/api/sohbet/${encodeURIComponent(otherId)}/mesajlar?limit=40`);
      if (state.activeOtherId !== otherId) return;
      state.activeConvId = data.convId;
      state.activeOther = data.other || state.activeOther;
      state.messages = Array.isArray(data.messages) ? data.messages : [];
      state.hasMoreOlder = Boolean(data.hasMore);
      state.canSeeOtherRead = Boolean(data.canSeeOtherRead);
      state.otherLastRead = Number(data.state && data.state.otherLastRead) || 0;
      state.otherLastDelivered = Number(data.state && data.state.otherLastDelivered) || 0;
      state.myInitialLastRead = Number(data.state && data.state.myLastRead) || 0;
      state.blockedState = data.blocked || { byMe: false, byOther: false, any: false };
      state.whoCanMessageOther = data.whoCanMessageOther || 'everyone';

      renderThreadHeader();
      renderMessageThread({ animateLast: false, scrollToBottom: true });
      scheduleMarkVisibleMessagesRead();

      // URL query güncelle (paylaşmadan geri dönüş kolaylığı)
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('kisi', otherId);
        window.history.replaceState({}, '', url.pathname + url.search);
      } catch (_) {}
    } catch (err) {
      showToast('Hata', err.message || 'Mesajlar yüklenemedi.', { variant: 'danger' });
    }
  }

  async function loadOlderMessages() {
    if (!state.activeOtherId || !state.hasMoreOlder || state.loadingOlder || state.messages.length === 0) return;
    state.loadingOlder = true;
    els.loadOlderBtn.disabled = true;
    els.loadOlderBtn.textContent = i18n.loadingOlder || 'Yükleniyor…';

    const firstId = state.messages[0].id;
    const prevScrollHeight = els.messagesScroll.scrollHeight;

    try {
      const data = await apiJson(
        `/sohbet/api/sohbet/${encodeURIComponent(state.activeOtherId)}/mesajlar?before=${encodeURIComponent(firstId)}&limit=40`
      );
      const older = Array.isArray(data.messages) ? data.messages : [];
      state.hasMoreOlder = Boolean(data.hasMore);
      if (older.length > 0) {
        const existingIds = new Set(state.messages.map((m) => m.id));
        const uniqueOlder = older.filter((m) => !existingIds.has(m.id));
        state.messages = uniqueOlder.concat(state.messages);
        renderMessageThread({ animateLast: false, scrollToBottom: false });
        const delta = els.messagesScroll.scrollHeight - prevScrollHeight;
        els.messagesScroll.scrollTop = Math.max(0, delta);
      }
    } catch (_) {}

    state.loadingOlder = false;
    els.loadOlderBtn.disabled = false;
    els.loadOlderBtn.textContent = i18n.loadOlderBtn || 'Daha eski mesajları yükle';
    els.loadOlderWrap.hidden = !state.hasMoreOlder;
  }

  // Mesaj okuma IntersectionObserver
  const msgReadObserver =
    typeof window.IntersectionObserver === 'function'
      ? new IntersectionObserver(
          (entries) => {
            if (document.visibilityState !== 'visible') return;
            let maxVisibleTs = 0;
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              const ts = Number(entry.target.dataset.msgTs) || 0;
              if (ts > maxVisibleTs) maxVisibleTs = ts;
            }
            if (maxVisibleTs > 0) {
              queueMarkRead(maxVisibleTs);
            }
          },
          { root: els.messagesScroll, threshold: 0.45 }
        )
      : null;

  function queueMarkRead(upToTs) {
    if (!state.activeOtherId || !upToTs || document.visibilityState !== 'visible') return;
    if (upToTs <= state.pendingReadTs) return;
    state.pendingReadTs = upToTs;
    clearTimeout(state.readDebounceTimer);
    state.readDebounceTimer = setTimeout(async () => {
      const targetOther = state.activeOtherId;
      const tsToSend = state.pendingReadTs;
      if (!targetOther || !tsToSend) return;
      try {
        const res = await apiJson(`/sohbet/api/sohbet/${encodeURIComponent(targetOther)}/okundu`, {
          method: 'POST',
          body: { upTo: tsToSend },
        });
        emitUnreadGlobal(res.unread || 0);
        const conv = state.conversations.find((c) => c.other && c.other.id === targetOther);
        if (conv) {
          conv.unreadCount = 0;
          renderConversationsList();
        }
      } catch (_) {}
    }, 220);
  }

  function scheduleMarkVisibleMessagesRead() {
    if (document.visibilityState !== 'visible' || !state.activeOtherId) return;
    const latestOther = [...state.messages].reverse().find((m) => m.from !== selfId && !m.deleted);
    if (latestOther && !msgReadObserver) {
      queueMarkRead(latestOther.ts);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.activeOtherId) {
      const latestOther = [...state.messages].reverse().find((m) => m.from !== selfId && !m.deleted);
      if (latestOther) {
        queueMarkRead(latestOther.ts);
      }
    }
  });

  function getLastOwnMessageId() {
    for (let i = state.messages.length - 1; i >= 0; i -= 1) {
      const m = state.messages[i];
      if (m.from === selfId && !m.deleted && !m.system) return m.id;
    }
    return null;
  }

  function buildMessageRowEl(msg, { isGroupStart, isGroupEnd, isLastOwn, animate = false, fromTyping = false }) {
    const isSelf = msg.from === selfId;
    const row = document.createElement('div');
    row.className = `chat-msg-row ${isSelf ? 'is-self' : 'is-other'}${isGroupStart ? ' is-group-start' : ' is-group-mid'}${isGroupEnd ? ' is-group-end' : ''}`;
    row.dataset.msgId = msg.id;
    row.dataset.msgTs = String(msg.ts || 0);

    if (!isSelf && !msg.deleted && msgReadObserver) {
      msgReadObserver.observe(row);
    }

    // Karşı taraf grubunun son balonunda küçük halkalı avatar
    if (!isSelf) {
      const avSlot = document.createElement('div');
      avSlot.className = 'chat-msg-avatar-slot';
      if (isGroupEnd && state.activeOther) {
        avSlot.appendChild(
          createRingAvatarEl({
            userId: state.activeOther.id,
            avatarUrl: state.activeOther.avatarUrl,
            displayName: state.activeOther.displayName,
            ring: state.activeOther.ring,
            sizePx: 28,
            thicknessPx: 2,
            allowAnimated: false,
          })
        );
      }
      row.appendChild(avSlot);
    }

    const col = document.createElement('div');
    col.className = 'chat-msg-col';

    const bubbleWrap = document.createElement('div');
    bubbleWrap.className = 'chat-bubble-wrap';

    // Kendi mesajıysa hover/odakta silme butonu
    if (isSelf && !msg.deleted && !msg.pending && !msg.system) {
      const actions = document.createElement('div');
      actions.className = 'chat-msg-actions';
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'chat-msg-action-btn';
      delBtn.title = i18n.deleteMsgBtn || 'Mesajı sil';
      delBtn.setAttribute('aria-label', i18n.deleteMsgBtn || 'Mesajı sil');
      delBtn.textContent = '🗑️';
      delBtn.addEventListener('click', () => handleDeleteMessage(msg.id));
      actions.appendChild(delBtn);
      bubbleWrap.appendChild(actions);
    }

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble${isSelf ? ' chat-bubble--self' : ' chat-bubble--other'}${msg.deleted ? ' chat-bubble--deleted' : ''}${msg.system ? ' chat-bubble--system' : ''}`;

    if (msg.deleted) {
      const delText = document.createElement('span');
      delText.className = 'chat-msg-deleted-text';
      delText.textContent = msg.modRemoved ? i18n.msgModRemoved : i18n.msgDeleted;
      bubble.appendChild(delText);
    } else {
      if (msg.text) {
        const textEl = document.createElement('div');
        textEl.className = `chat-msg-text${isJumboEmojiOnly(msg.text) ? ' chat-msg-text--jumbo' : ''}`;
        appendSafeLinkedText(textEl, msg.text);
        bubble.appendChild(textEl);
      }

      // Parça 3 (Dosya Ekleri) için eklenti kancası
      if (
        Array.isArray(msg.attachments) &&
        msg.attachments.length > 0 &&
        window.PiyadeChatAttachments &&
        typeof window.PiyadeChatAttachments.renderBubbleAttachments === 'function'
      ) {
        window.PiyadeChatAttachments.renderBubbleAttachments(bubble, msg);
      }
    }

    // Zaman damgası + durum tiki (üzerine gelince / dokununca 30 gün silinme bilgisi)
    const meta = document.createElement('div');
    meta.className = 'chat-msg-meta';
    const timeSpan = document.createElement('span');
    timeSpan.className = 'chat-msg-time';
    timeSpan.textContent = formatTimeHHMM(msg.ts);
    timeSpan.title = formatDaysUntilExpiry(msg.ts);
    meta.appendChild(timeSpan);

    if (isSelf && !msg.deleted) {
      const tickSpan = document.createElement('span');
      tickSpan.className = 'chat-msg-tick';
      if (msg.pending) {
        tickSpan.textContent = i18n.statusSending || '⏳';
      } else if (state.otherLastDelivered >= msg.ts) {
        tickSpan.textContent = i18n.statusDelivered || '✓✓';
      } else {
        tickSpan.textContent = i18n.statusSent || '✓';
      }
      meta.appendChild(tickSpan);
    }

    bubble.appendChild(meta);
    bubbleWrap.appendChild(bubble);
    col.appendChild(bubbleWrap);

    // Instagram tarzı: "Görüldü ✓ HH:MM" yalnızca gönderenin EN SON mesajının altında
    if (isSelf && isLastOwn && state.canSeeOtherRead && state.otherLastRead >= msg.ts && !msg.pending) {
      const seenEl = document.createElement('div');
      seenEl.className = 'chat-msg-seen';
      seenEl.textContent = (i18n.statusSeen || 'Görüldü ✓ {time}').replace(
        '{time}',
        formatTimeHHMM(state.otherLastRead)
      );
      col.appendChild(seenEl);
    }

    row.appendChild(col);

    if (animate) {
      requestAnimationFrame(() => animateBubblePop(bubble, isSelf, { fromTyping }));
    }

    return row;
  }

  function renderMessageThread({ animateLast = false, fromTyping = false, scrollToBottom = false } = {}) {
    if (msgReadObserver) msgReadObserver.disconnect();
    els.messagesList.replaceChildren();
    els.loadOlderWrap.hidden = !state.hasMoreOlder;

    const lastOwnId = getLastOwnMessageId();
    let lastDateKey = '';
    let unreadDividerInserted = false;

    for (let i = 0; i < state.messages.length; i += 1) {
      const msg = state.messages[i];
      const prev = i > 0 ? state.messages[i - 1] : null;
      const next = i < state.messages.length - 1 ? state.messages[i + 1] : null;

      // Gün ayırıcısı
      const d = new Date(msg.ts);
      const dateKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (dateKey !== lastDateKey) {
        lastDateKey = dateKey;
        const divEl = document.createElement('div');
        divEl.className = 'chat-date-divider';
        const span = document.createElement('span');
        span.textContent = getDateDividerLabel(msg.ts);
        divEl.appendChild(span);
        els.messagesList.appendChild(divEl);
      }

      // Okunmamış ayırıcısı (yalnızca sohbet ilk açıldığında varsa)
      if (
        !unreadDividerInserted &&
        state.myInitialLastRead > 0 &&
        msg.from !== selfId &&
        !msg.deleted &&
        msg.ts > state.myInitialLastRead
      ) {
        unreadDividerInserted = true;
        const uDiv = document.createElement('div');
        uDiv.className = 'chat-unread-divider';
        const uSpan = document.createElement('span');
        uSpan.textContent = i18n.unreadDivider || 'Okunmamış mesajlar';
        uDiv.appendChild(uSpan);
        els.messagesList.appendChild(uDiv);
      }

      const sameAsPrev =
        prev &&
        prev.from === msg.from &&
        !prev.deleted &&
        !msg.deleted &&
        msg.ts - prev.ts < 180000 &&
        new Date(prev.ts).getDate() === d.getDate();
      const sameAsNext =
        next &&
        next.from === msg.from &&
        !next.deleted &&
        !msg.deleted &&
        next.ts - msg.ts < 180000 &&
        new Date(next.ts).getDate() === d.getDate();

      const isLastMsg = i === state.messages.length - 1;
      const rowEl = buildMessageRowEl(msg, {
        isGroupStart: !sameAsPrev,
        isGroupEnd: !sameAsNext,
        isLastOwn: msg.id === lastOwnId,
        animate: animateLast && isLastMsg,
        fromTyping: animateLast && isLastMsg && fromTyping,
      });

      els.messagesList.appendChild(rowEl);
    }

    if (scrollToBottom) {
      scrollThreadToBottom(animateLast);
    }
  }

  function scrollThreadToBottom(smooth = false) {
    if (!els.messagesScroll) return;
    const behavior = smooth && !prefersReducedMotion() ? 'smooth' : 'auto';
    try {
      els.messagesScroll.scrollTo({ top: els.messagesScroll.scrollHeight, behavior });
    } catch (_) {
      els.messagesScroll.scrollTop = els.messagesScroll.scrollHeight;
    }
  }

  function isScrolledNearBottom() {
    if (!els.messagesScroll) return true;
    const { scrollTop, scrollHeight, clientHeight } = els.messagesScroll;
    return scrollHeight - scrollTop - clientHeight < 140;
  }

  // ==========================================================================
  // 8) MESAJ GÖNDERME, SİLME, YAZIYOR VE ENGELLEME
  // ==========================================================================
  function generateClientId() {
    return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function autoResizeTextarea() {
    const ta = els.messageInput;
    if (!ta) return;
    ta.style.height = 'auto';
    const maxHeight = 144; // ~6 satır
    ta.style.height = `${Math.min(maxHeight, Math.max(40, ta.scrollHeight))}px`;
  }

  function updateComposerControls() {
    const val = els.messageInput ? els.messageInput.value : '';
    const trimmed = val.trim();
    const maxLen = (boot.limits && boot.limits.maxMessageLength) || 4000;
    const hasPendingAttachments =
      window.PiyadeChatAttachments &&
      typeof window.PiyadeChatAttachments.hasPendingFiles === 'function' &&
      window.PiyadeChatAttachments.hasPendingFiles();
    if (els.sendBtn) {
      els.sendBtn.disabled = (!trimmed && !hasPendingAttachments) || val.length > maxLen;
    }
    if (els.charCounter) {
      if (val.length >= maxLen - 400) {
        els.charCounter.textContent = `${val.length}/${maxLen}`;
        els.charCounter.hidden = false;
      } else {
        els.charCounter.hidden = true;
      }
    }
  }

  async function handleSendMessage(ev) {
    if (ev) ev.preventDefault();
    if (!state.activeOtherId) return;

    const targetOtherId = state.activeOtherId;
    const text = els.messageInput.value.trim();
    const maxLen = (boot.limits && boot.limits.maxMessageLength) || 4000;
    const attHelper = window.PiyadeChatAttachments || null;
    if (attHelper && typeof attHelper.isUploading === 'function' && attHelper.isUploading()) {
      return;
    }
    const readyFiles =
      attHelper && typeof attHelper.getReadyFiles === 'function' ? attHelper.getReadyFiles() : [];
    const attachmentIds = readyFiles.map((f) => f.id);

    if (!text && attachmentIds.length === 0) return;
    if (text.length > maxLen) {
      showToast('Uyarı', i18n.errTextTooLong || 'Mesaj çok uzun.', { variant: 'warning' });
      return;
    }

    const clientId = generateClientId();
    const tempId = `tmp_${clientId}`;
    const tempMsg = {
      id: tempId,
      from: selfId,
      ts: Date.now(),
      text,
      attachments: readyFiles.slice(),
      clientId,
      pending: true,
      deleted: false,
    };

    els.messageInput.value = '';
    if (attHelper && typeof attHelper.clearAll === 'function') {
      attHelper.clearAll();
    }
    state.drafts.set(targetOtherId, '');
    try {
      sessionStorage.removeItem(`piyade_chat_draft_${targetOtherId}`);
    } catch (_) {}
    autoResizeTextarea();
    updateComposerControls();
    closeEmojiPicker();

    state.messages.push(tempMsg);
    playChatSound('send');
    renderMessageThread({ animateLast: true, scrollToBottom: true });

    try {
      const payload = { text, clientId };
      if (attachmentIds.length > 0) payload.attachmentIds = attachmentIds;
      const data = await apiJson(`/sohbet/api/sohbet/${encodeURIComponent(targetOtherId)}/mesaj`, {
        method: 'POST',
        body: payload,
      });

      const idx = state.messages.findIndex((m) => m.id === tempId || (m.clientId && m.clientId === clientId));
      if (idx >= 0 && data.message) {
        state.messages[idx] = data.message;
      }
      if (data.delivered && data.message) {
        state.otherLastDelivered = Math.max(state.otherLastDelivered, data.message.ts);
      }
      if (state.activeOtherId === targetOtherId) {
        renderMessageThread({ animateLast: false, scrollToBottom: false });
      }
      loadConversations();
    } catch (err) {
      // Başarısız mesajı geri al ve metni koru
      state.messages = state.messages.filter((m) => m.id !== tempId);
      if (state.activeOtherId === targetOtherId) {
        els.messageInput.value = text;
        autoResizeTextarea();
        updateComposerControls();
        renderMessageThread({ animateLast: false, scrollToBottom: false });
      }
      showToast('Hata', err.message || i18n.errSendFailed, { variant: 'danger' });
    }
  }

  async function handleDeleteMessage(msgId) {
    if (!state.activeOtherId || !msgId) return;
    const ok = await showConfirmModal(i18n.deleteMsgBtn || 'Mesajı sil', i18n.deleteConfirm || '');
    if (!ok) return;
    try {
      await apiJson(
        `/sohbet/api/sohbet/${encodeURIComponent(state.activeOtherId)}/mesaj/${encodeURIComponent(msgId)}`,
        { method: 'DELETE' }
      );
      const target = state.messages.find((m) => m.id === msgId);
      if (target) {
        target.deleted = true;
        target.text = '';
        target.attachments = [];
      }
      renderMessageThread({ animateLast: false, scrollToBottom: false });
      loadConversations();
    } catch (err) {
      showToast('Hata', err.message || 'Mesaj silinemedi.', { variant: 'danger' });
    }
  }

  async function handleToggleBlock() {
    if (!state.activeOtherId) return;
    const targetId = state.activeOtherId;
    const isUnblocking = Boolean(state.blockedState.byMe);

    if (!isUnblocking) {
      const ok = await showConfirmModal(i18n.blockUser || 'Engelle', i18n.blockConfirm || '');
      if (!ok) return;
    }

    try {
      const endpoint = isUnblocking ? '/sohbet/api/engeli-kaldir' : '/sohbet/api/engelle';
      const data = await apiJson(endpoint, { method: 'POST', body: { targetId } });
      state.profile.blocked = Array.isArray(data.blocked) ? data.blocked : [];
      state.blockedState.byMe = !isUnblocking;
      state.blockedState.any = state.blockedState.byMe || state.blockedState.byOther;
      closeHeaderMenu();
      renderThreadHeader();
      loadConversations();
    } catch (err) {
      showToast('Hata', err.message || 'İşlem başarısız.', { variant: 'danger' });
    }
  }

  function showTypingIndicator() {
    if (!els.typingRow) return;
    const wasHidden = els.typingRow.hidden;
    els.typingRow.hidden = false;
    if (wasHidden) {
      const bubble = els.typingRow.querySelector('.chat-typing-bubble');
      animateBubblePop(bubble, false, { fromTyping: true });
      if (isScrolledNearBottom()) scrollThreadToBottom(true);
    }
    clearTimeout(state.typingTimer);
    state.typingTimer = setTimeout(hideTypingIndicator, 4500);
  }

  function hideTypingIndicator() {
    clearTimeout(state.typingTimer);
    if (els.typingRow) els.typingRow.hidden = true;
  }

  function maybeNotifyTyping() {
    if (!state.activeOtherId || state.blockedState.any) return;
    const now = Date.now();
    if (now - state.lastTypingSentAt < 3000) return;
    state.lastTypingSentAt = now;
    apiJson(`/sohbet/api/sohbet/${encodeURIComponent(state.activeOtherId)}/yaziyor`, {
      method: 'POST',
      body: {},
    }).catch(() => {});
  }

  // ==========================================================================
  // 9) EMOJİ PANELİ (855 YEREL EMOJİ + GLİF DESTEK TESTİ + SON KULLANILANLAR)
  // ==========================================================================
  const RECENT_EMOJIS_KEY = 'piyade_chat_recent_emojis';
  let emojiTestCanvas = null;
  let emojiTofuData = null;

  function isEmojiSupported(emojiChar) {
    if (state.emojiSupportCache.has(emojiChar)) {
      return state.emojiSupportCache.get(emojiChar);
    }
    try {
      if (!emojiTestCanvas) {
        emojiTestCanvas = document.createElement('canvas');
        emojiTestCanvas.width = 20;
        emojiTestCanvas.height = 20;
      }
      const ctx = emojiTestCanvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return true;
      ctx.textBaseline = 'top';
      ctx.font = '16px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

      if (!emojiTofuData) {
        ctx.clearRect(0, 0, 20, 20);
        ctx.fillText('\uFFFF', 0, 0);
        emojiTofuData = ctx.getImageData(0, 0, 20, 20).data.join(',');
      }

      ctx.clearRect(0, 0, 20, 20);
      ctx.fillText(emojiChar, 0, 0);
      const pixels = ctx.getImageData(0, 0, 20, 20).data;
      let nonEmpty = false;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] > 0) {
          nonEmpty = true;
          break;
        }
      }
      const supported = nonEmpty && pixels.join(',') !== emojiTofuData;
      state.emojiSupportCache.set(emojiChar, supported);
      return supported;
    } catch (_) {
      return true;
    }
  }

  function getRecentEmojis() {
    try {
      const raw = JSON.parse(localStorage.getItem(RECENT_EMOJIS_KEY) || '[]');
      return Array.isArray(raw) ? raw.slice(0, 24) : [];
    } catch (_) {
      return [];
    }
  }

  function pushRecentEmoji(ch) {
    const list = getRecentEmojis().filter((x) => x !== ch);
    list.unshift(ch);
    try {
      localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(list.slice(0, 24)));
    } catch (_) {}
  }

  async function ensureEmojiDataLoaded() {
    if (state.emojiData || state.emojiLoading) return;
    state.emojiLoading = true;
    try {
      const resp = await fetch('/data/emoji.json', { credentials: 'same-origin' });
      const data = await resp.json();
      if (data && Array.isArray(data.categories)) {
        state.emojiData = data;
      }
    } catch (_) {}
    state.emojiLoading = false;
    renderEmojiTabs();
    renderEmojiGrid();
  }

  function renderEmojiTabs() {
    if (!els.emojiTabs || !state.emojiData) return;
    els.emojiTabs.replaceChildren();

    const recents = getRecentEmojis();
    if (state.emojiActiveCat === 'recent' && recents.length === 0) {
      state.emojiActiveCat = state.emojiData.categories[0].id;
    }

    const tabs = [
      { id: 'recent', icon: '🕒', label: i18n.emojiRecentTitle || 'Son kullanılanlar' },
      ...state.emojiData.categories.map((c) => ({
        id: c.id,
        icon: c.icon,
        label: (c.name && c.name[lang]) || c.id,
      })),
    ];

    for (const tab of tabs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `chat-emoji-tab${state.emojiActiveCat === tab.id ? ' active' : ''}`;
      btn.role = 'tab';
      btn.setAttribute('aria-selected', state.emojiActiveCat === tab.id ? 'true' : 'false');
      btn.title = tab.label;
      btn.setAttribute('aria-label', tab.label);
      btn.textContent = tab.icon;
      btn.addEventListener('click', () => {
        state.emojiActiveCat = tab.id;
        state.emojiSearchQuery = '';
        if (els.emojiSearch) els.emojiSearch.value = '';
        renderEmojiTabs();
        renderEmojiGrid();
      });
      els.emojiTabs.appendChild(btn);
    }
  }

  function insertEmojiAtCursor(ch) {
    const ta = els.messageInput;
    if (!ta) return;
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    ta.value = ta.value.slice(0, start) + ch + ta.value.slice(end);
    const nextPos = start + ch.length;
    ta.focus();
    ta.setSelectionRange(nextPos, nextPos);
    autoResizeTextarea();
    updateComposerControls();
    pushRecentEmoji(ch);
  }

  function renderEmojiGrid() {
    if (!els.emojiGrid || !state.emojiData) return;
    els.emojiGrid.replaceChildren();
    const q = state.emojiSearchQuery.trim().toLowerCase();
    let list = [];

    if (q) {
      for (const cat of state.emojiData.categories) {
        for (const item of cat.items) {
          if ((item.tr && item.tr.toLowerCase().includes(q)) || (item.en && item.en.toLowerCase().includes(q))) {
            list.push(item);
          }
        }
      }
    } else if (state.emojiActiveCat === 'recent') {
      list = getRecentEmojis().map((c) => ({ c, tr: c, en: c }));
    } else {
      const cat = state.emojiData.categories.find((x) => x.id === state.emojiActiveCat);
      list = cat ? cat.items : [];
    }

    const visible = list.filter((it) => isEmojiSupported(it.c));
    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'chat-emoji-empty';
      empty.textContent = i18n.emojiEmpty || 'Emoji bulunamadı.';
      els.emojiGrid.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    for (const item of visible) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-emoji-cell';
      btn.textContent = item.c;
      btn.title = item[lang] || item.en || item.c;
      btn.addEventListener('click', () => insertEmojiAtCursor(item.c));
      frag.appendChild(btn);
    }
    els.emojiGrid.appendChild(frag);
  }

  function toggleEmojiPicker(forceState = null) {
    if (!els.emojiPopover) return;
    const nextOpen = forceState !== null ? forceState : els.emojiPopover.hidden;
    els.emojiPopover.hidden = !nextOpen;
    if (els.emojiToggleBtn) els.emojiToggleBtn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    if (nextOpen) {
      ensureEmojiDataLoaded();
      if (state.emojiData) {
        renderEmojiTabs();
        renderEmojiGrid();
      }
      if (els.emojiSearch) els.emojiSearch.focus();
    }
  }

  function closeEmojiPicker() {
    toggleEmojiPicker(false);
  }

  // ==========================================================================
  // 10) AYARLAR MODALI VE PROFİL HALKASI SEÇİCİ
  // ==========================================================================
  function getSelectedDraftRing() {
    if (state.settingsDraft.ringId === 'custom') {
      return {
        id: 'custom',
        type: state.settingsDraft.customSpin ? 'spin' : 'static',
        colors: state.settingsDraft.customColors.slice(0, 4),
      };
    }
    const preset = (boot.ringPresets || []).find((p) => p.id === state.settingsDraft.ringId) || boot.ringPresets[0];
    return preset
      ? { id: preset.id, type: preset.type, colors: preset.colors }
      : { id: DEFAULT_PRESET.id, type: DEFAULT_PRESET.type, colors: DEFAULT_PRESET.colors };
  }

  function renderRingLivePreview() {
    const ring = getSelectedDraftRing();
    els.ringLivePreviewSlot.replaceChildren(
      createRingAvatarEl({
        userId: '',
        avatarUrl: boot.selfAvatarUrl,
        displayName: boot.selfName || '?',
        ring,
        sizePx: 68,
        thicknessPx: 4,
        allowAnimated: true,
      })
    );
    const preset = (boot.ringPresets || []).find((p) => p.id === ring.id);
    els.ringPreviewName.textContent = preset
      ? (preset.name && preset.name[lang]) || preset.id
      : lang === 'en'
        ? 'Custom Ring'
        : 'Özel Halka';
  }

  function renderRingCategoryTabs() {
    els.ringCategoryTabs.replaceChildren();
    for (const cat of boot.ringCategories || []) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `chat-ring-cat-tab${state.settingsDraft.activeRingCat === cat.id ? ' active' : ''}`;
      btn.textContent = (cat.name && cat.name[lang]) || cat.id;
      btn.addEventListener('click', () => {
        state.settingsDraft.activeRingCat = cat.id;
        renderRingCategoryTabs();
        renderRingPresetGrid();
      });
      els.ringCategoryTabs.appendChild(btn);
    }
  }

  function renderRingPresetGrid() {
    els.ringPresetGrid.replaceChildren();
    const presets = (boot.ringPresets || []).filter((p) => p.category === state.settingsDraft.activeRingCat);
    for (const p of presets) {
      const selected = state.settingsDraft.ringId === p.id;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `chat-ring-preset-card${selected ? ' is-selected' : ''}`;

      const av = createRingAvatarEl({
        avatarUrl: boot.selfAvatarUrl,
        displayName: boot.selfName || '?',
        ring: p,
        sizePx: 46,
        thicknessPx: 3,
        allowAnimated: true,
      });

      const lbl = document.createElement('span');
      lbl.className = 'chat-ring-preset-name';
      lbl.textContent = (p.name && p.name[lang]) || p.id;

      card.append(av, lbl);
      card.addEventListener('click', () => {
        state.settingsDraft.ringId = p.id;
        renderRingLivePreview();
        renderRingPresetGrid();
      });
      els.ringPresetGrid.appendChild(card);
    }
  }

  function renderCustomColorsBuilder() {
    els.customColorsRow.replaceChildren();
    const colors = state.settingsDraft.customColors;
    colors.forEach((hex, idx) => {
      const item = document.createElement('div');
      item.className = 'chat-custom-color-item';

      const input = document.createElement('input');
      input.type = 'color';
      input.className = 'chat-color-input';
      input.value = HEX_RE.test(hex) ? hex : DEFAULT_PRESET.colors[0];
      input.addEventListener('input', () => {
        state.settingsDraft.customColors[idx] = input.value.toUpperCase();
        if (state.settingsDraft.ringId === 'custom') renderRingLivePreview();
      });

      item.appendChild(input);
      if (colors.length > 2) {
        const rmBtn = document.createElement('button');
        rmBtn.type = 'button';
        rmBtn.className = 'chat-color-remove-btn';
        rmBtn.textContent = '✕';
        rmBtn.title = i18n.ringRemoveColor || 'Kaldır';
        rmBtn.addEventListener('click', () => {
          state.settingsDraft.customColors.splice(idx, 1);
          renderCustomColorsBuilder();
          if (state.settingsDraft.ringId === 'custom') renderRingLivePreview();
        });
        item.appendChild(rmBtn);
      }
      els.customColorsRow.appendChild(item);
    });
    if (els.customAddColorBtn) {
      els.customAddColorBtn.disabled = colors.length >= 4;
    }
    if (els.customSpinCheck) {
      els.customSpinCheck.checked = Boolean(state.settingsDraft.customSpin);
    }
  }

  function updateBrowserNotifyStatusUI() {
    if (!els.browserNotifyStatus || !els.enableBrowserNotifyBtn) return;
    if (typeof window.Notification === 'undefined') {
      els.browserNotifyStatus.textContent = i18n.notifyBrowserUnsupported || '';
      els.enableBrowserNotifyBtn.disabled = true;
      return;
    }
    if (Notification.permission === 'granted') {
      els.browserNotifyStatus.textContent = i18n.notifyBrowserEnabled || 'Açık';
      els.enableBrowserNotifyBtn.textContent = `✅ ${i18n.notifyBrowserEnabled || 'Açık'}`;
    } else if (Notification.permission === 'denied') {
      els.browserNotifyStatus.textContent = i18n.notifyBrowserDenied || '';
    } else {
      els.browserNotifyStatus.textContent = '';
      els.enableBrowserNotifyBtn.textContent = i18n.notifyBrowserBtn || 'Tarayıcı Bildirimlerini Aç';
    }
  }

  function renderBlockedSettingsList() {
    if (!els.blockedListContainer) return;
    els.blockedListContainer.replaceChildren();
    const blockedIds = Array.isArray(state.profile.blocked) ? state.profile.blocked : [];
    if (blockedIds.length === 0) {
      const p = document.createElement('p');
      p.className = 'chat-blocked-empty';
      p.textContent = i18n.blockedEmpty || 'Engellediğiniz kimse yok.';
      els.blockedListContainer.appendChild(p);
      return;
    }

    for (const bid of blockedIds) {
      const conv = state.conversations.find((c) => c.other && c.other.id === bid);
      const label = (conv && conv.other && conv.other.displayName) || bid;
      const row = document.createElement('div');
      row.className = 'chat-blocked-row';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = label;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary btn-xs';
      btn.textContent = i18n.unblockUser || 'Engeli Kaldır';
      btn.addEventListener('click', async () => {
        try {
          const data = await apiJson('/sohbet/api/engeli-kaldir', { method: 'POST', body: { targetId: bid } });
          state.profile.blocked = Array.isArray(data.blocked) ? data.blocked : [];
          renderBlockedSettingsList();
          if (state.activeOtherId === bid) {
            state.blockedState.byMe = false;
            state.blockedState.any = state.blockedState.byOther;
            renderThreadHeader();
          }
          loadConversations();
        } catch (_) {}
      });
      row.append(nameSpan, btn);
      els.blockedListContainer.appendChild(row);
    }
  }

  function openSettingsModal() {
    const prof = state.profile;
    state.settingsDraft.ringId = prof.ringId || 'classic-google';
    if (prof.ring && Array.isArray(prof.ring.colors) && prof.ring.colors.length >= 2) {
      state.settingsDraft.customColors = prof.ring.colors.slice(0, 4);
      state.settingsDraft.customSpin = prof.ring.type === 'spin';
    }
    const preset = (boot.ringPresets || []).find((p) => p.id === state.settingsDraft.ringId);
    state.settingsDraft.activeRingCat = (preset && preset.category) || 'classic';

    if (els.setReadReceipts) els.setReadReceipts.checked = prof.readReceipts !== false;
    if (els.setWhoCanMessage) els.setWhoCanMessage.value = prof.whoCanMessage === 'nobody' ? 'nobody' : 'everyone';
    if (els.setNotifyPreview) els.setNotifyPreview.checked = Boolean(prof.notify && prof.notify.preview);
    if (els.setNotifySound) els.setNotifySound.checked = Boolean(prof.notify && prof.notify.sound);

    renderRingCategoryTabs();
    renderRingPresetGrid();
    renderCustomColorsBuilder();
    renderRingLivePreview();
    updateBrowserNotifyStatusUI();
    renderBlockedSettingsList();

    els.settingsModal.hidden = false;
    els.settingsModal.setAttribute('aria-hidden', 'false');
  }

  function closeSettingsModal() {
    els.settingsModal.hidden = true;
    els.settingsModal.setAttribute('aria-hidden', 'true');
  }

  async function saveSettingsModal() {
    const payload = {
      ringId: state.settingsDraft.ringId,
      readReceipts: els.setReadReceipts ? els.setReadReceipts.checked : true,
      whoCanMessage: els.setWhoCanMessage ? els.setWhoCanMessage.value : 'everyone',
      notify: {
        browser: typeof window.Notification !== 'undefined' && Notification.permission === 'granted' && state.profile.notify.browser,
        preview: els.setNotifyPreview ? els.setNotifyPreview.checked : false,
        sound: els.setNotifySound ? els.setNotifySound.checked : false,
      },
    };
    if (state.settingsDraft.ringId === 'custom') {
      payload.ring = {
        colors: state.settingsDraft.customColors.slice(0, 4),
        type: state.settingsDraft.customSpin ? 'spin' : 'static',
      };
    }

    if (els.settingsSaveBtn) els.settingsSaveBtn.disabled = true;
    try {
      const res = await apiJson('/sohbet/api/profil', { method: 'POST', body: payload });
      if (res.profile) {
        state.profile = Object.assign(state.profile, res.profile);
        updateAllVisibleRingsForUser(selfId, res.profile.effectiveRing);
      }
      closeSettingsModal();
      showToast('✓', i18n.ringSavedToast || 'Kaydedildi.', { variant: 'success' });
      // Karşılıklı görüldü ayarı değiştiyse mevcut konuşmayı yenile
      if (state.activeOtherId) {
        openConversation(state.activeOtherId, state.activeOther);
      }
    } catch (err) {
      showToast('Hata', err.message || 'Kaydedilemedi.', { variant: 'danger' });
    } finally {
      if (els.settingsSaveBtn) els.settingsSaveBtn.disabled = false;
    }
  }

  // ==========================================================================
  // 11) SSE BAĞLANTISI, ÜSTEL GERİ ÇEKİLME VE BİLDİRİMLER
  // ==========================================================================
  function maybeShowBrowserNotification(payload) {
    if (typeof window.Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (!state.profile.notify || !state.profile.notify.browser) return;
    if (document.visibilityState === 'visible' && state.activeOtherId === payload.otherId) return;

    const title = (payload.sender && payload.sender.displayName) || i18n.newMsgToastTitle || 'Yeni mesaj';
    const allowPreview = Boolean(state.profile.notify.preview && payload.notifyPreview);
    const bodyText = allowPreview && payload.message && payload.message.text
      ? payload.message.text.slice(0, 100)
      : i18n.newMsgBrowserBody || 'Yeni bir özel mesajın var.';

    try {
      const n = new Notification(title, { body: bodyText, tag: `chat-${payload.convId}` });
      n.onclick = () => {
        window.focus();
        if (payload.otherId) openConversation(payload.otherId, payload.sender);
        n.close();
      };
    } catch (_) {}
  }

  async function catchUpAfterReconnect() {
    await loadConversations();
    if (state.activeOtherId && state.messages.length > 0) {
      const lastTs = state.messages[state.messages.length - 1].ts;
      try {
        const data = await apiJson(
          `/sohbet/api/sohbet/${encodeURIComponent(state.activeOtherId)}/mesajlar?after=${encodeURIComponent(String(lastTs))}&limit=60`
        );
        const newer = Array.isArray(data.messages) ? data.messages : [];
        if (newer.length > 0) {
          const existing = new Set(state.messages.map((m) => m.id));
          let added = 0;
          for (const m of newer) {
            if (!existing.has(m.id)) {
              state.messages.push(m);
              added += 1;
            }
          }
          if (added > 0) {
            renderMessageThread({ animateLast: false, scrollToBottom: isScrolledNearBottom() });
          }
        }
      } catch (_) {}
    }
  }

  function connectChatSse() {
    if (typeof window.EventSource !== 'function') return;
    if (state.sse) {
      state.sse.close();
      state.sse = null;
    }

    const qs = state.sseLastEventId > 0 ? `?lastEventId=${state.sseLastEventId}` : '';
    const sse = new EventSource(`/sohbet/akis${qs}`);
    state.sse = sse;

    const trackId = (ev) => {
      const id = Number.parseInt(String(ev.lastEventId || ''), 10);
      if (Number.isFinite(id) && id > state.sseLastEventId) {
        state.sseLastEventId = id;
      }
    };

    sse.addEventListener('connected', (ev) => {
      trackId(ev);
      const wasReconnecting = !els.reconnectBanner.hidden;
      els.reconnectBanner.hidden = true;
      state.sseRetryMs = 1000;
      try {
        const d = JSON.parse(ev.data || '{}');
        if (typeof d.unread === 'number') emitUnreadGlobal(d.unread);
      } catch (_) {}
      if (wasReconnecting) {
        catchUpAfterReconnect();
      }
    });

    sse.addEventListener('unread', (ev) => {
      trackId(ev);
      try {
        const d = JSON.parse(ev.data || '{}');
        if (typeof d.unread === 'number') emitUnreadGlobal(d.unread);
      } catch (_) {}
    });

    sse.addEventListener('message', (ev) => {
      trackId(ev);
      let d;
      try {
        d = JSON.parse(ev.data || '{}');
      } catch (_) {
        return;
      }
      if (!d || !d.message) return;

      const isForActive = d.otherId && d.otherId === state.activeOtherId;
      if (isForActive) {
        const wasTyping = els.typingRow && !els.typingRow.hidden;
        hideTypingIndicator();

        const existsIdx = state.messages.findIndex(
          (m) => m.id === d.message.id || (d.message.clientId && m.clientId === d.message.clientId)
        );
        if (existsIdx >= 0) {
          state.messages[existsIdx] = d.message;
          renderMessageThread({ animateLast: false, scrollToBottom: false });
        } else {
          const nearBottom = isScrolledNearBottom();
          state.messages.push(d.message);
          if (!d.selfEcho) playChatSound('receive');
          renderMessageThread({ animateLast: true, fromTyping: wasTyping, scrollToBottom: nearBottom });
          if (!d.selfEcho && document.visibilityState === 'visible') {
            queueMarkRead(d.message.ts);
          }
        }
      } else if (!d.selfEcho) {
        playChatSound('receive');
        const senderName = (d.sender && d.sender.displayName) || i18n.newMsgToastTitle;
        const preview = state.profile.notify && state.profile.notify.preview && d.message.text
          ? d.message.text.slice(0, 70)
          : i18n.newMsgBrowserBody || 'Yeni mesaj';
        showToast(senderName, preview, {
          onClick: () => openConversation(d.otherId, d.sender),
        });
      }

      if (!d.selfEcho) {
        maybeShowBrowserNotification(d);
      }
      loadConversations();
    });

    sse.addEventListener('delivered', (ev) => {
      trackId(ev);
      try {
        const d = JSON.parse(ev.data || '{}');
        if (d.convId === state.activeConvId && d.by === state.activeOtherId) {
          state.otherLastDelivered = Math.max(state.otherLastDelivered, Number(d.upTo) || 0);
          renderMessageThread({ animateLast: false, scrollToBottom: false });
        }
      } catch (_) {}
    });

    sse.addEventListener('read', (ev) => {
      trackId(ev);
      try {
        const d = JSON.parse(ev.data || '{}');
        if (d.convId === state.activeConvId && d.by === state.activeOtherId && state.canSeeOtherRead) {
          state.otherLastRead = Math.max(state.otherLastRead, Number(d.upTo) || 0);
          state.otherLastDelivered = Math.max(state.otherLastDelivered, state.otherLastRead);
          renderMessageThread({ animateLast: false, scrollToBottom: false });
        }
      } catch (_) {}
    });

    sse.addEventListener('deleted', (ev) => {
      trackId(ev);
      try {
        const d = JSON.parse(ev.data || '{}');
        if (d.convId === state.activeConvId) {
          const target = state.messages.find((m) => m.id === d.msgId);
          if (target) {
            target.deleted = true;
            target.modRemoved = Boolean(d.modRemoved);
            target.text = '';
            target.attachments = [];
            renderMessageThread({ animateLast: false, scrollToBottom: false });
          }
        }
        loadConversations();
      } catch (_) {}
    });

    sse.addEventListener('typing', (ev) => {
      try {
        const d = JSON.parse(ev.data || '{}');
        if (d.convId === state.activeConvId && d.from === state.activeOtherId) {
          showTypingIndicator();
        }
      } catch (_) {}
    });

    sse.addEventListener('profile', (ev) => {
      try {
        const d = JSON.parse(ev.data || '{}');
        if (d.userId && d.ring) {
          updateAllVisibleRingsForUser(d.userId, d.ring);
        }
      } catch (_) {}
    });

    sse.addEventListener('settings', (ev) => {
      try {
        const d = JSON.parse(ev.data || '{}');
        state.profile = Object.assign(state.profile, d);
        if (d.effectiveRing) updateAllVisibleRingsForUser(selfId, d.effectiveRing);
      } catch (_) {}
    });

    sse.onerror = () => {
      sse.close();
      state.sse = null;
      els.reconnectBanner.hidden = false;
      const wait = state.sseRetryMs;
      state.sseRetryMs = Math.min(15000, state.sseRetryMs * 2);
      setTimeout(connectChatSse, wait);
    };
  }

  // ==========================================================================
  // 12) ETKİNLİK BAĞLANTILARI VE MOBİL VISUALVIEWPORT
  // ==========================================================================
  function closeHeaderMenu() {
    if (els.headerMenu) els.headerMenu.hidden = true;
    if (els.headerMenuBtn) els.headerMenuBtn.setAttribute('aria-expanded', 'false');
  }

  if (els.searchInput) {
    els.searchInput.addEventListener('input', () => {
      clearTimeout(dirSearchTimer);
      const val = els.searchInput.value;
      dirSearchTimer = setTimeout(() => searchDirectory(val), 240);
    });
  }

  if (els.searchClearBtn) {
    els.searchClearBtn.addEventListener('click', () => {
      els.searchInput.value = '';
      els.directorySection.hidden = true;
      els.searchClearBtn.hidden = true;
      els.searchInput.focus();
    });
  }

  if (els.mobileBackBtn) {
    els.mobileBackBtn.addEventListener('click', () => {
      appEl.classList.remove('is-thread-open');
      closeEmojiPicker();
      closeHeaderMenu();
    });
  }

  if (els.retentionInfoBtn) {
    els.retentionInfoBtn.addEventListener('click', () => {
      const nextStr =
        boot.retentionInfo && boot.retentionInfo.nextCleanupAt
          ? new Date(boot.retentionInfo.nextCleanupAt).toLocaleString(localeTag, {
              timeZone: 'Europe/Istanbul',
              dateStyle: 'short',
              timeStyle: 'short',
            })
          : '03:00';
      els.retentionPopoverBody.textContent = (i18n.retentionTooltipDesc || '').replace('{next}', nextStr);
      els.retentionPopover.hidden = !els.retentionPopover.hidden;
    });
  }

  if (els.headerMenuBtn) {
    els.headerMenuBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const willOpen = els.headerMenu.hidden;
      els.headerMenu.hidden = !willOpen;
      els.headerMenuBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
  }

  if (els.menuBlockBtn) els.menuBlockBtn.addEventListener('click', handleToggleBlock);
  if (els.quickUnblockBtn) els.quickUnblockBtn.addEventListener('click', handleToggleBlock);
  if (els.loadOlderBtn) els.loadOlderBtn.addEventListener('click', loadOlderMessages);

  if (els.messagesScroll) {
    els.messagesScroll.addEventListener('scroll', () => {
      if (els.messagesScroll.scrollTop < 60 && state.hasMoreOlder && !state.loadingOlder) {
        loadOlderMessages();
      }
    });
  }

  if (els.composerForm) {
    els.composerForm.addEventListener('submit', handleSendMessage);
  }

  if (els.messageInput) {
    els.messageInput.addEventListener('input', () => {
      autoResizeTextarea();
      updateComposerControls();
      maybeNotifyTyping();
    });
    els.messageInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        if (!els.sendBtn.disabled) handleSendMessage();
      }
    });
  }

  if (els.emojiToggleBtn) {
    els.emojiToggleBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleEmojiPicker();
    });
  }
  if (els.emojiCloseBtn) els.emojiCloseBtn.addEventListener('click', closeEmojiPicker);
  if (els.emojiSearch) {
    els.emojiSearch.addEventListener('input', () => {
      state.emojiSearchQuery = els.emojiSearch.value;
      renderEmojiGrid();
    });
  }

  if (els.openSettingsBtn) els.openSettingsBtn.addEventListener('click', openSettingsModal);
  if (els.settingsCloseBtn) els.settingsCloseBtn.addEventListener('click', closeSettingsModal);
  if (els.settingsCancelBtn) els.settingsCancelBtn.addEventListener('click', closeSettingsModal);
  if (els.settingsSaveBtn) els.settingsSaveBtn.addEventListener('click', saveSettingsModal);

  document.querySelectorAll('[data-settings-tab]').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      const target = tabBtn.dataset.settingsTab;
      document.querySelectorAll('[data-settings-tab]').forEach((b) => {
        const active = b.dataset.settingsTab === target;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      document.getElementById('chatSettingsPanelRing').hidden = target !== 'ring';
      document.getElementById('chatSettingsPanelPrivacy').hidden = target !== 'privacy';
      document.getElementById('chatSettingsPanelBlocked').hidden = target !== 'blocked';
    });
  });

  if (els.customAddColorBtn) {
    els.customAddColorBtn.addEventListener('click', () => {
      if (state.settingsDraft.customColors.length < 4) {
        const nextSample = DEFAULT_PRESET.colors[state.settingsDraft.customColors.length % DEFAULT_PRESET.colors.length];
        state.settingsDraft.customColors.push(nextSample);
        renderCustomColorsBuilder();
        if (state.settingsDraft.ringId === 'custom') renderRingLivePreview();
      }
    });
  }
  if (els.customSpinCheck) {
    els.customSpinCheck.addEventListener('change', () => {
      state.settingsDraft.customSpin = els.customSpinCheck.checked;
      if (state.settingsDraft.ringId === 'custom') renderRingLivePreview();
    });
  }
  if (els.customApplyBtn) {
    els.customApplyBtn.addEventListener('click', () => {
      state.settingsDraft.ringId = 'custom';
      renderRingLivePreview();
      renderRingPresetGrid();
    });
  }

  if (els.enableBrowserNotifyBtn) {
    els.enableBrowserNotifyBtn.addEventListener('click', async () => {
      if (typeof window.Notification === 'undefined') return;
      try {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          state.profile.notify.browser = true;
        }
        updateBrowserNotifyStatusUI();
      } catch (_) {}
    });
  }

  document.addEventListener('click', (ev) => {
    if (els.headerMenu && !els.headerMenu.hidden && !els.headerMenu.contains(ev.target)) {
      closeHeaderMenu();
    }
    if (
      els.emojiPopover &&
      !els.emojiPopover.hidden &&
      !els.emojiPopover.contains(ev.target) &&
      ev.target !== els.emojiToggleBtn
    ) {
      closeEmojiPicker();
    }
    if (
      els.retentionPopover &&
      !els.retentionPopover.hidden &&
      !els.retentionPopover.contains(ev.target) &&
      !els.retentionInfoBtn.contains(ev.target)
    ) {
      els.retentionPopover.hidden = true;
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      closeEmojiPicker();
      closeHeaderMenu();
      if (els.retentionPopover) els.retentionPopover.hidden = true;
      if (els.settingsModal && !els.settingsModal.hidden) closeSettingsModal();
    }
  });

  // Mobil sanal klavye yüksekliği takibi (visualViewport)
  if (window.visualViewport) {
    const syncViewportHeight = () => {
      document.documentElement.style.setProperty('--chat-vh', `${Math.round(window.visualViewport.height)}px`);
    };
    syncViewportHeight();
    window.visualViewport.addEventListener('resize', syncViewportHeight);
  }

  window.addEventListener('beforeunload', () => {
    saveCurrentDraft();
    if (state.sse) state.sse.close();
  });

  // Parça 3 & 4 genişletme arayüzü
  window.PiyadeChatApp = {
    boot,
    state,
    els,
    apiJson,
    showToast,
    showConfirmModal,
    openConversation,
    loadConversations,
    renderMessageThread,
    updateComposerControls,
    playChatSound,
    createRingAvatarEl,
    scrollThreadToBottom,
  };

  // İlk yükleme
  loadConversations().then(() => {
    if (boot.requestedOtherId) {
      openConversation(boot.requestedOtherId);
    }
  });
  connectChatSse();
})();
