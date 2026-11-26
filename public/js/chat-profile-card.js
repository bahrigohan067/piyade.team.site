/**
 * ==============================================================================
 * 🌌 PIYADE WORLD — NEBULA GLASS PROFİL BİLGİ KARTI (Saf Vanilla JS + CSS)
 * ==============================================================================
 * - Tıklanan avatardan/isimden NexusSpring ile yaylanarak açılır, kapanırken geri döner
 * - Açıldıktan sonra Nebula Glass Card fiziği çalışır:
 *   * 3 renkli yavaş süzülen bulutsu (üyenin kendi profil halkasındaki ilk 3 renkten)
 *   * İmlece doğru yaylanarak 3B eğilme + katman derinlikleri (translateZ)
 *   * İmleç kenarını izleyen dönen kenar ışığı (rim light)
 *   * Basınca içeri çökme + kenar ışığı parlaması + yaylanarak geri dönüş
 * - Mobil (<768px): alttan açılan sayfa (bottom sheet), eğilme efekti kapalı
 * - prefers-reduced-motion: animasyon ve eğilme kapalı, yalnızca statik buzlu cam
 * - Esc, dışına tıklama, klavye odak yakalama (focus trap), sıfır sabit #hex renk
 * ==============================================================================
 */
(function () {
  'use strict';

  const chatApp = window.PiyadeChatApp;
  if (!chatApp) return;

  const { boot, state, apiJson, showToast, showConfirmModal, createRingAvatarEl } = chatApp;
  const i18n = boot.i18n || {};
  const lang = boot.lang === 'en' ? 'en' : 'tr';
  const selfId = String(boot.selfId || '');
  const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

  const overlay = document.getElementById('chatProfileCardOverlay');
  const stage = document.getElementById('chatProfileCardStage');
  const cardEl = document.getElementById('chatProfileCard');
  const closeBtn = document.getElementById('chatProfileCardCloseBtn');
  const contentEl = document.getElementById('chatProfileCardContent');

  if (!overlay || !stage || !cardEl || !contentEl) return;

  // Sabit pencerenin üst yığınlama katmanında (viewport) görünmesi için body altına taşı
  if (overlay.parentElement !== document.body) {
    document.body.appendChild(overlay);
  }

  const prefersReducedMotion = () =>
    Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const isMobileViewport = () =>
    Boolean(window.matchMedia && window.matchMedia('(max-width: 767px)').matches);

  const canUseDesktopTilt = () => !prefersReducedMotion() && !isMobileViewport();

  // ============================================================================
  // 1) HALKA RENKLERİNDEN 3 NEBULA RENGİ TÜRETME (Sabit hex yok; yedekler theme.css'ten)
  // ============================================================================
  function getThemeFallbackHues() {
    const cs = window.getComputedStyle ? window.getComputedStyle(document.documentElement) : null;
    const readVar = (name) => (cs ? cs.getPropertyValue(name).trim() : '') || `var(${name})`;
    return [
      readVar('--color-accent'),
      readVar('--color-primary'),
      readVar('--dart-bullseye-start'),
    ];
  }

  function resolveNebulaHues(ring, serverHues) {
    const fallbacks = getThemeFallbackHues();
    const out = [];

    const tryPush = (raw) => {
      if (typeof raw !== 'string') return;
      const clean = raw.trim();
      if (!clean) return;
      if (HEX_COLOR_RE.test(clean)) {
        const up = clean.toUpperCase();
        if (!out.includes(up)) out.push(up);
      } else if (clean.startsWith('var(--')) {
        const varName = clean.slice(4, -1).trim();
        const cs = window.getComputedStyle ? window.getComputedStyle(document.documentElement) : null;
        const resolved = cs ? cs.getPropertyValue(varName).trim() : '';
        if (resolved && !out.includes(resolved)) out.push(resolved);
      }
    };

    if (ring && Array.isArray(ring.colors)) {
      for (const c of ring.colors) {
        tryPush(c);
        if (out.length >= 3) break;
      }
    }
    if (out.length < 3 && Array.isArray(serverHues)) {
      for (const c of serverHues) {
        tryPush(c);
        if (out.length >= 3) break;
      }
    }
    let fbIdx = 0;
    while (out.length < 3) {
      out.push(fallbacks[fbIdx % fallbacks.length]);
      fbIdx += 1;
    }
    return out.slice(0, 3);
  }

  function applyNebulaHues(hues) {
    cardEl.style.setProperty('--nebula-hue-1', hues[0]);
    cardEl.style.setProperty('--nebula-hue-2', hues[1]);
    cardEl.style.setProperty('--nebula-hue-3', hues[2]);
  }

  // ============================================================================
  // 2) NEBULA GLASS CARD FİZİK MOTORU (NexusSpring 3B Eğilme + Kenar Işığı + Basma)
  // ============================================================================
  const TILT_MAX_DEG = 12;
  const SPRING_TILT_CFG = { stiffness: 185, damping: 22, mass: 0.62 };
  const SPRING_PRESS_CFG = { stiffness: 320, damping: 20, mass: 0.65 };
  const SPRING_OPEN_CFG = { stiffness: 420, damping: 28, mass: 0.85 };

  let openState = {
    isOpen: false,
    isClosing: false,
    physicsActive: false,
    targetId: null,
    triggerEl: null,
    triggerRect: null,
    cardData: null,
    openAnimHandle: null,
    openFallbackTimer: null,
    closeFallbackTimer: null,
    rafId: null,
    lastFrameTs: 0,
    isPressed: false,
    isHovering: false,
    rxSpring: null,
    rySpring: null,
    scaleSpring: null,
    zSpring: null,
    rimFlareSpring: null,
  };

  function resetCardPhysicsVisuals() {
    cardEl.style.transform = '';
    cardEl.style.setProperty('--rim-opacity', '0');
    cardEl.style.setProperty('--rim-flare', '0');
    cardEl.style.setProperty('--nebula-shift-x', '0px');
    cardEl.style.setProperty('--nebula-shift-y', '0px');
    cardEl.classList.remove('is-pressed', 'is-tilting');
  }

  function initPhysicsSprings() {
    const Spring = window.NexusSpring;
    if (!Spring || typeof Spring.create !== 'function') return false;
    openState.rxSpring = Spring.create(0, SPRING_TILT_CFG);
    openState.rySpring = Spring.create(0, SPRING_TILT_CFG);
    openState.scaleSpring = Spring.create(1, SPRING_PRESS_CFG);
    openState.zSpring = Spring.create(0, SPRING_PRESS_CFG);
    openState.rimFlareSpring = Spring.create(0, SPRING_PRESS_CFG);
    return true;
  }

  function stopPhysicsLoop() {
    if (openState.rafId !== null) {
      cancelAnimationFrame(openState.rafId);
      openState.rafId = null;
    }
  }

  function startPhysicsLoop() {
    if (openState.rafId !== null || !openState.physicsActive) return;
    if (!canUseDesktopTilt()) return;
    const Spring = window.NexusSpring;
    if (!Spring || typeof Spring.step !== 'function') return;
    if (!openState.rxSpring) initPhysicsSprings();

    openState.lastFrameTs = performance.now();

    const tick = (now) => {
      if (!openState.isOpen || !openState.physicsActive) {
        openState.rafId = null;
        return;
      }
      const dt = Math.min(0.04, Math.max(0.001, (now - openState.lastFrameTs) / 1000));
      openState.lastFrameTs = now;

      const m1 = Spring.step(openState.rxSpring, dt);
      const m2 = Spring.step(openState.rySpring, dt);
      const m3 = Spring.step(openState.scaleSpring, dt);
      const m4 = Spring.step(openState.zSpring, dt);
      const m5 = Spring.step(openState.rimFlareSpring, dt);

      const rx = openState.rxSpring.value;
      const ry = openState.rySpring.value;
      const sc = openState.scaleSpring.value;
      const tz = openState.zSpring.value;
      const flare = Math.max(0, Math.min(1, openState.rimFlareSpring.value));

      cardEl.style.transform = `perspective(960px) rotateX(${rx.toFixed(3)}deg) rotateY(${ry.toFixed(3)}deg) translateZ(${tz.toFixed(2)}px) scale(${sc.toFixed(4)})`;
      cardEl.style.setProperty('--rim-flare', flare.toFixed(3));
      cardEl.style.setProperty('--nebula-shift-x', `${(ry * 1.1).toFixed(2)}px`);
      cardEl.style.setProperty('--nebula-shift-y', `${(-rx * 1.1).toFixed(2)}px`);

      if (m1 || m2 || m3 || m4 || m5) {
        openState.rafId = requestAnimationFrame(tick);
      } else {
        openState.rafId = null;
        if (!openState.isHovering && !openState.isPressed) {
          cardEl.classList.remove('is-tilting');
        }
      }
    };

    openState.rafId = requestAnimationFrame(tick);
  }

  function updatePointerPhysics(ev) {
    if (!openState.isOpen || !openState.physicsActive || !canUseDesktopTilt()) {
      return;
    }
    if (ev && ev.pointerType === 'touch') {
      return;
    }
    const rect = cardEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const px = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
    const py = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
    const nx = (px - 0.5) * 2; // -1..1
    const ny = (py - 0.5) * 2; // -1..1

    const angleDeg = (Math.atan2(ny, nx) * 180) / Math.PI + 90;
    cardEl.style.setProperty('--rim-angle', `${angleDeg.toFixed(1)}deg`);
    cardEl.style.setProperty('--rim-x', `${(px * 100).toFixed(1)}%`);
    cardEl.style.setProperty('--rim-y', `${(py * 100).toFixed(1)}%`);
    cardEl.style.setProperty('--rim-opacity', '1');
    cardEl.classList.add('is-tilting');

    if (!openState.rxSpring) initPhysicsSprings();
    openState.isHovering = true;
    openState.rxSpring.target = -ny * TILT_MAX_DEG;
    openState.rySpring.target = nx * TILT_MAX_DEG;
    startPhysicsLoop();
  }

  cardEl.addEventListener('pointermove', updatePointerPhysics);

  cardEl.addEventListener('pointerenter', (ev) => {
    updatePointerPhysics(ev);
  });

  cardEl.addEventListener('pointerleave', () => {
    openState.isHovering = false;
    openState.isPressed = false;
    cardEl.classList.remove('is-pressed');
    cardEl.style.setProperty('--rim-opacity', '0');
    if (openState.rxSpring) {
      openState.rxSpring.target = 0;
      openState.rySpring.target = 0;
      openState.scaleSpring.target = 1;
      openState.zSpring.target = 0;
      openState.rimFlareSpring.target = 0;
      startPhysicsLoop();
    }
  });

  cardEl.addEventListener('pointerdown', (ev) => {
    if (!openState.isOpen || !openState.physicsActive || !canUseDesktopTilt()) return;
    if (ev.pointerType === 'touch') return;
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    openState.isPressed = true;
    cardEl.classList.add('is-pressed');
    if (!openState.scaleSpring) initPhysicsSprings();
    openState.scaleSpring.target = 0.962;
    openState.zSpring.target = -12;
    openState.rimFlareSpring.target = 1;
    startPhysicsLoop();
  });

  const releasePress = () => {
    if (!openState.isPressed) return;
    openState.isPressed = false;
    cardEl.classList.remove('is-pressed');
    if (openState.scaleSpring) {
      openState.scaleSpring.target = 1;
      openState.zSpring.target = 0;
      openState.rimFlareSpring.target = 0;
      startPhysicsLoop();
    }
  };

  cardEl.addEventListener('pointerup', releasePress);
  cardEl.addEventListener('pointercancel', releasePress);

  // ============================================================================
  // 3) KART İÇERİĞİ ÇİZİMİ (Sıfır innerHTML, tüm veriler textContent)
  // ============================================================================
  function renderLoadingState(hintMember) {
    contentEl.replaceChildren();
    const wrap = document.createElement('div');
    wrap.className = 'nebula-card-body';

    const head = document.createElement('div');
    head.className = 'nebula-card-head nebula-layer--top';
    const avSlot = document.createElement('div');
    avSlot.className = 'nebula-avatar-wrap nebula-layer--front';
    avSlot.appendChild(
      createRingAvatarEl({
        userId: (hintMember && hintMember.id) || '',
        avatarUrl: (hintMember && hintMember.avatarUrl) || null,
        displayName: (hintMember && hintMember.displayName) || '…',
        ring: (hintMember && hintMember.ring) || null,
        sizePx: 76,
        thicknessPx: 3,
        allowAnimated: !prefersReducedMotion(),
      })
    );
    const titleEl = document.createElement('h3');
    titleEl.className = 'nebula-card-name';
    titleEl.id = 'chatProfileCardTitle';
    titleEl.textContent = (hintMember && hintMember.displayName) || i18n.profileCardLoading || 'Yükleniyor…';

    head.append(avSlot, titleEl);
    const loadingNote = document.createElement('p');
    loadingNote.className = 'nebula-card-loading';
    loadingNote.textContent = i18n.profileCardLoading || 'Profil bilgileri yükleniyor…';

    wrap.append(head, loadingNote);
    contentEl.appendChild(wrap);
  }

  function renderErrorState(message) {
    contentEl.replaceChildren();
    const wrap = document.createElement('div');
    wrap.className = 'nebula-card-body';
    const titleEl = document.createElement('h3');
    titleEl.className = 'nebula-card-name';
    titleEl.id = 'chatProfileCardTitle';
    titleEl.textContent = '⚠️';
    const p = document.createElement('p');
    p.className = 'nebula-card-empty';
    p.textContent = message || i18n.directoryError || 'Profil bilgileri yüklenemedi.';
    wrap.append(titleEl, p);
    contentEl.appendChild(wrap);
  }

  async function copyGameUsername(username, btnEl) {
    let copied = false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(username);
        copied = true;
      }
    } catch (_) {}
    if (!copied) {
      try {
        const ta = document.createElement('textarea');
        ta.value = username;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        copied = true;
      } catch (_) {}
    }
    if (copied) {
      if (btnEl) {
        const orig = btnEl.textContent;
        btnEl.textContent = '✓';
        setTimeout(() => {
          btnEl.textContent = orig;
        }, 1200);
      }
      showToast('✓', i18n.profileCardCopiedToast || 'Kullanıcı adı kopyalandı.', { variant: 'success' });
    }
  }

  function renderCardContent(card) {
    openState.cardData = card;
    const hues = resolveNebulaHues(card.ring, card.nebulaHues);
    applyNebulaHues(hues);

    contentEl.replaceChildren();
    const body = document.createElement('div');
    body.className = 'nebula-card-body';

    // Üst kısım: Büyük halkalı avatar + Ad + Kimlik ve Yönetici rozetleri
    const head = document.createElement('div');
    head.className = 'nebula-card-head nebula-layer--top';

    const avatarWrap = document.createElement('div');
    avatarWrap.className = 'nebula-avatar-wrap nebula-layer--front';
    avatarWrap.appendChild(
      createRingAvatarEl({
        userId: card.id,
        avatarUrl: card.avatarUrl,
        displayName: card.displayName,
        ring: card.ring,
        sizePx: 80,
        thicknessPx: 3,
        allowAnimated: !prefersReducedMotion(),
      })
    );

    const identityCol = document.createElement('div');
    identityCol.className = 'nebula-card-identity';

    const nameEl = document.createElement('h3');
    nameEl.className = 'nebula-card-name';
    nameEl.id = 'chatProfileCardTitle';
    nameEl.textContent = card.displayName || card.id;

    const badgesRow = document.createElement('div');
    badgesRow.className = 'nebula-card-badges';

    const kindBadge = document.createElement('span');
    kindBadge.className =
      card.kind === 'google'
        ? 'chat-identity-badge chat-identity-badge--site'
        : 'chat-identity-badge chat-identity-badge--discord';
    kindBadge.textContent =
      card.kind === 'google'
        ? i18n.identityBadgeSite || 'Site Üyesi'
        : i18n.identityBadgeDiscord || 'Discord Üyesi';
    badgesRow.appendChild(kindBadge);

    if (card.isGroupAdmin) {
      const adminBadge = document.createElement('span');
      adminBadge.className = 'chat-identity-badge chat-identity-badge--admin';
      adminBadge.textContent = i18n.groupAdminBadge || 'Yönetici';
      badgesRow.appendChild(adminBadge);
    }

    identityCol.append(nameEl, badgesRow);
    head.append(avatarWrap, identityCol);
    body.appendChild(head);

    // Orta kısım: Oynadığı oyunlar
    const gamesBox = document.createElement('div');
    gamesBox.className = 'nebula-games-box nebula-layer--mid';

    const gamesTitle = document.createElement('div');
    gamesTitle.className = 'nebula-games-title';
    gamesTitle.textContent = `🎮 ${i18n.profileCardGamesTitle || 'Oynadığı oyunlar'}`;
    gamesBox.appendChild(gamesTitle);

    if (card.gamesHidden) {
      const hiddenNotice = document.createElement('div');
      hiddenNotice.className = 'nebula-games-hidden';
      hiddenNotice.textContent = `🔒 ${i18n.profileCardGamesHidden || 'Bu üye oyun kullanıcı adlarını gizledi'}`;
      gamesBox.appendChild(hiddenNotice);
    } else if (!Array.isArray(card.games) || card.games.length === 0) {
      const emptyNotice = document.createElement('div');
      emptyNotice.className = 'nebula-games-empty';
      emptyNotice.textContent = i18n.profileCardNoGames || 'Kayıtlı oyun bilgisi bulunmuyor.';
      gamesBox.appendChild(emptyNotice);
    } else {
      const list = document.createElement('ul');
      list.className = 'nebula-games-list';

      for (const g of card.games) {
        const li = document.createElement('li');
        li.className = 'nebula-game-row';

        const labelWrap = document.createElement('div');
        labelWrap.className = 'nebula-game-label';
        const emojiSpan = document.createElement('span');
        emojiSpan.className = 'nebula-game-emoji';
        emojiSpan.setAttribute('aria-hidden', 'true');
        emojiSpan.textContent = g.emoji || '🎮';

        const gName = document.createElement('span');
        gName.className = 'nebula-game-name';
        gName.textContent = (g.name && (g.name[lang] || g.name.tr)) || g.id;

        labelWrap.append(emojiSpan, gName);

        const valWrap = document.createElement('div');
        valWrap.className = 'nebula-game-value-wrap';

        const codeEl = document.createElement('code');
        codeEl.className = 'nebula-game-username';
        codeEl.textContent = g.username;

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'nebula-game-copy-btn';
        copyBtn.title = i18n.profileCardCopyBtn || 'Kopyala';
        copyBtn.setAttribute('aria-label', `${i18n.profileCardCopyBtn || 'Kopyala'}: ${g.username}`);
        copyBtn.textContent = `${i18n.profileCardCopyBtn || 'Kopyala'} 📋`;
        copyBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          copyGameUsername(g.username, copyBtn);
        });

        valWrap.append(codeEl, copyBtn);

        if (g.profileUrl) {
          const link = document.createElement('a');
          link.className = 'nebula-game-ext-link';
          link.href = g.profileUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = `${i18n.profileCardRobloxLink || 'Roblox'} ↗`;
          link.addEventListener('click', (ev) => ev.stopPropagation());
          valWrap.appendChild(link);
        }

        li.append(labelWrap, valWrap);
        list.appendChild(li);
      }

      gamesBox.appendChild(list);
    }

    body.appendChild(gamesBox);

    // Alt kısım: Eylem düğmeleri
    const actionsRow = document.createElement('div');
    actionsRow.className = 'nebula-card-actions nebula-layer--actions';

    if (card.isSelf) {
      const editLink = document.createElement('a');
      editLink.href = '/profil';
      editLink.className = 'btn btn-primary btn-sm nebula-action-btn nebula-action-btn--full';
      editLink.textContent = `⚙️ ${i18n.profileCardEditOwnBtn || 'Profilimi düzenle'}`;
      actionsRow.appendChild(editLink);
    } else {
      // 1) Mesaj Yaz (DM aç)
      const msgBtn = document.createElement('button');
      msgBtn.type = 'button';
      msgBtn.className = 'btn btn-primary btn-sm nebula-action-btn';
      msgBtn.textContent = `💬 ${i18n.profileCardMessageBtn || 'Mesaj Yaz'}`;
      msgBtn.addEventListener('click', () => {
        close();
        chatApp.openConversation(card.id, {
          id: card.id,
          kind: card.kind,
          badgeKind: card.badgeKind,
          isGroupAdmin: card.isGroupAdmin,
          displayName: card.displayName,
          avatarUrl: card.avatarUrl,
          ring: card.ring,
        });
      });

      // 2) Engelle / Engeli kaldır (mevcut onay penceresiyle)
      const blockBtn = document.createElement('button');
      blockBtn.type = 'button';
      blockBtn.className = card.blockedByMe
        ? 'btn btn-secondary btn-sm nebula-action-btn'
        : 'btn btn-danger btn-sm nebula-action-btn';
      blockBtn.textContent = card.blockedByMe
        ? `✅ ${i18n.unblockUser || 'Engeli Kaldır'}`
        : `🚫 ${i18n.blockUser || 'Engelle'}`;
      blockBtn.addEventListener('click', async () => {
        const isUnblocking = Boolean(card.blockedByMe);
        if (!isUnblocking) {
          const ok = await showConfirmModal(i18n.blockUser || 'Engelle', i18n.blockConfirm || '');
          if (!ok) return;
        }
        blockBtn.disabled = true;
        try {
          const endpoint = isUnblocking ? '/sohbet/api/engeli-kaldir' : '/sohbet/api/engelle';
          const res = await apiJson(endpoint, { method: 'POST', body: { targetId: card.id } });
          state.profile.blocked = Array.isArray(res.blocked) ? res.blocked : [];
          card.blockedByMe = !isUnblocking;
          blockBtn.className = card.blockedByMe
            ? 'btn btn-secondary btn-sm nebula-action-btn'
            : 'btn btn-danger btn-sm nebula-action-btn';
          blockBtn.textContent = card.blockedByMe
            ? `✅ ${i18n.unblockUser || 'Engeli Kaldır'}`
            : `🚫 ${i18n.blockUser || 'Engelle'}`;
          if (state.activeMode === 'dm' && state.activeOtherId === card.id) {
            state.blockedState.byMe = card.blockedByMe;
            state.blockedState.any = state.blockedState.byMe || state.blockedState.byOther;
            if (typeof chatApp.renderThreadHeader === 'function') chatApp.renderThreadHeader();
          }
          chatApp.loadConversations();
        } catch (err) {
          showToast('Hata', err.message || 'İşlem başarısız.', { variant: 'danger' });
        } finally {
          blockBtn.disabled = false;
        }
      });

      // 3) Raporla (mevcut rapor modalını aç)
      const reportBtn = document.createElement('button');
      reportBtn.type = 'button';
      reportBtn.className = 'btn btn-secondary btn-sm nebula-action-btn';
      reportBtn.textContent = `🚩 ${i18n.reportBtn || 'Raporla'}`;
      reportBtn.addEventListener('click', () => {
        close();
        if (typeof chatApp.openReportForMember === 'function') {
          chatApp.openReportForMember(card.id);
        }
      });

      actionsRow.append(msgBtn, blockBtn, reportBtn);
    }

    body.appendChild(actionsRow);
    contentEl.appendChild(body);
  }

  // ============================================================================
  // 4) ODAK YAKALAMA (FOCUS TRAP), AÇILMA / KAPANMA YAY ANİMASYONU (NexusSpring)
  // ============================================================================
  function getFocusableEls() {
    return Array.from(
      cardEl.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !el.hidden && el.offsetParent !== null);
  }

  function handleKeyDown(ev) {
    if (!openState.isOpen) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      close();
      return;
    }
    if (ev.key === 'Tab') {
      const focusables = getFocusableEls();
      if (focusables.length === 0) {
        ev.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (ev.shiftKey) {
        if (document.activeElement === first || !cardEl.contains(document.activeElement)) {
          ev.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last || !cardEl.contains(document.activeElement)) {
        ev.preventDefault();
        first.focus();
      }
    }
  }

  function clearAnimTimers() {
    if (openState.openFallbackTimer) {
      clearTimeout(openState.openFallbackTimer);
      openState.openFallbackTimer = null;
    }
    if (openState.closeFallbackTimer) {
      clearTimeout(openState.closeFallbackTimer);
      openState.closeFallbackTimer = null;
    }
  }

  function animatePopupOpen(triggerRect) {
    clearAnimTimers();
    const mobile = isMobileViewport();
    overlay.classList.toggle('is-mobile-sheet', mobile);
    cardEl.classList.toggle('is-reduced-motion', prefersReducedMotion());

    const Spring = window.NexusSpring;
    if (prefersReducedMotion() || !Spring || typeof Spring.animate !== 'function') {
      stage.style.transform = '';
      stage.style.opacity = '1';
      openState.physicsActive = canUseDesktopTilt();
      if (openState.physicsActive) initPhysicsSprings();
      return;
    }

    if (openState.openAnimHandle) {
      openState.openAnimHandle.cancel();
      openState.openAnimHandle = null;
    }

    if (mobile) {
      stage.style.opacity = '0';
      stage.style.transform = 'translate3d(0, 64px, 0)';
      const settleMobile = () => {
        clearAnimTimers();
        if (openState.openAnimHandle) {
          openState.openAnimHandle.cancel();
          openState.openAnimHandle = null;
        }
        stage.style.transform = '';
        stage.style.opacity = '';
        openState.physicsActive = false;
      };
      openState.openFallbackTimer = setTimeout(settleMobile, 420);
      openState.openAnimHandle = Spring.animate({
        from: 0,
        to: 1,
        stiffness: 380,
        damping: 30,
        mass: 0.9,
        onUpdate: (v) => {
          const y = 64 * (1 - v);
          stage.style.opacity = String(Math.max(0, Math.min(1, v * 1.4)));
          stage.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
        },
        onComplete: settleMobile,
      });
      return;
    }

    // Masaüstü: tıklanan avatardan kartın ortasına doğru yaylanarak büyüyerek açıl
    let dx = 0;
    let dy = 18;
    if (triggerRect) {
      const targetRect = stage.getBoundingClientRect();
      const fromX = triggerRect.left + triggerRect.width / 2;
      const fromY = triggerRect.top + triggerRect.height / 2;
      const toX = targetRect.left + targetRect.width / 2;
      const toY = targetRect.top + targetRect.height / 2;
      dx = Math.max(-360, Math.min(360, fromX - toX));
      dy = Math.max(-280, Math.min(280, fromY - toY));
    }

    const activateDesktopPhysics = () => {
      if (!openState.isOpen || openState.isClosing) return;
      if (!openState.physicsActive) {
        openState.physicsActive = canUseDesktopTilt();
        if (openState.physicsActive) initPhysicsSprings();
      }
    };

    const settleDesktopOpen = () => {
      clearAnimTimers();
      if (openState.openAnimHandle) {
        openState.openAnimHandle.cancel();
        openState.openAnimHandle = null;
      }
      stage.style.transform = '';
      stage.style.opacity = '';
      activateDesktopPhysics();
    };

    openState.physicsActive = false;
    stage.style.opacity = '0';
    stage.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) scale(0.32)`;
    openState.openFallbackTimer = setTimeout(settleDesktopOpen, 420);

    openState.openAnimHandle = Spring.animate({
      from: 0,
      to: 1,
      stiffness: SPRING_OPEN_CFG.stiffness,
      damping: SPRING_OPEN_CFG.damping,
      mass: SPRING_OPEN_CFG.mass,
      onUpdate: (v) => {
        const curX = dx * (1 - v);
        const curY = dy * (1 - v);
        const sc = 0.32 + 0.68 * v;
        stage.style.opacity = String(Math.max(0, Math.min(1, v * 1.45)));
        stage.style.transform = `translate3d(${curX.toFixed(2)}px, ${curY.toFixed(2)}px, 0) scale(${sc.toFixed(4)})`;
        if (v >= 0.88) {
          activateDesktopPhysics();
        }
      },
      onComplete: settleDesktopOpen,
    });
  }

  async function open(targetId, triggerEl = null, hintMember = null) {
    const cleanId = String(targetId || '').trim();
    if (!cleanId) return;

    clearAnimTimers();
    if (openState.openAnimHandle) {
      openState.openAnimHandle.cancel();
      openState.openAnimHandle = null;
    }
    stopPhysicsLoop();
    resetCardPhysicsVisuals();

    openState.isOpen = true;
    openState.isClosing = false;
    openState.targetId = cleanId;
    openState.triggerEl = triggerEl && triggerEl.nodeType === 1 ? triggerEl : document.activeElement;
    openState.triggerRect =
      triggerEl && typeof triggerEl.getBoundingClientRect === 'function'
        ? triggerEl.getBoundingClientRect()
        : null;

    // Ön renkler (hintMember halkası varsa anında uygula)
    const initialHues = resolveNebulaHues(hintMember && hintMember.ring, null);
    applyNebulaHues(initialHues);
    renderLoadingState(hintMember);

    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    animatePopupOpen(openState.triggerRect);

    document.addEventListener('keydown', handleKeyDown, true);
    if (closeBtn) closeBtn.focus();

    try {
      const data = await apiJson(`/sohbet/api/uye-karti/${encodeURIComponent(cleanId)}`);
      if (!openState.isOpen || openState.targetId !== cleanId) return;
      if (data && data.card) {
        renderCardContent(data.card);
      } else {
        renderErrorState(i18n.directoryError);
      }
    } catch (err) {
      if (!openState.isOpen || openState.targetId !== cleanId) return;
      renderErrorState((err && err.message) || i18n.directoryError);
    }
  }

  function finishClose() {
    clearAnimTimers();
    if (openState.openAnimHandle) {
      openState.openAnimHandle.cancel();
      openState.openAnimHandle = null;
    }
    stopPhysicsLoop();
    resetCardPhysicsVisuals();
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.classList.remove('is-mobile-sheet');
    stage.style.transform = '';
    stage.style.opacity = '';
    document.removeEventListener('keydown', handleKeyDown, true);

    const returnFocusTo = openState.triggerEl;
    openState.isOpen = false;
    openState.isClosing = false;
    openState.physicsActive = false;
    openState.targetId = null;
    openState.cardData = null;

    if (returnFocusTo && typeof returnFocusTo.focus === 'function' && document.contains(returnFocusTo)) {
      try {
        returnFocusTo.focus();
      } catch (_) {}
    }
  }

  function close() {
    if (!openState.isOpen || openState.isClosing) return;
    openState.isClosing = true;
    openState.physicsActive = false;
    clearAnimTimers();
    stopPhysicsLoop();
    resetCardPhysicsVisuals();

    if (openState.openAnimHandle) {
      openState.openAnimHandle.cancel();
      openState.openAnimHandle = null;
    }

    const Spring = window.NexusSpring;
    if (prefersReducedMotion() || !Spring || typeof Spring.animate !== 'function') {
      finishClose();
      return;
    }

    openState.closeFallbackTimer = setTimeout(finishClose, 360);

    const mobile = isMobileViewport();
    if (mobile) {
      openState.openAnimHandle = Spring.animate({
        from: 0,
        to: 1,
        stiffness: 420,
        damping: 34,
        mass: 0.85,
        onUpdate: (v) => {
          stage.style.opacity = String(Math.max(0, 1 - v * 1.3));
          stage.style.transform = `translate3d(0, ${(64 * v).toFixed(1)}px, 0)`;
          if (v >= 0.96) finishClose();
        },
        onComplete: finishClose,
      });
      return;
    }

    let dx = 0;
    let dy = 14;
    if (openState.triggerEl && typeof openState.triggerEl.getBoundingClientRect === 'function' && document.contains(openState.triggerEl)) {
      const tr = openState.triggerEl.getBoundingClientRect();
      const sr = stage.getBoundingClientRect();
      dx = Math.max(-360, Math.min(360, tr.left + tr.width / 2 - (sr.left + sr.width / 2)));
      dy = Math.max(-280, Math.min(280, tr.top + tr.height / 2 - (sr.top + sr.height / 2)));
    }

    openState.openAnimHandle = Spring.animate({
      from: 0,
      to: 1,
      stiffness: 460,
      damping: 34,
      mass: 0.78,
      onUpdate: (v) => {
        const sc = 1 - 0.62 * v;
        stage.style.opacity = String(Math.max(0, 1 - v * 1.35));
        stage.style.transform = `translate3d(${(dx * v).toFixed(2)}px, ${(dy * v).toFixed(2)}px, 0) scale(${sc.toFixed(4)})`;
        if (v >= 0.96) finishClose();
      },
      onComplete: finishClose,
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', close);
  }
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) close();
  });

  window.PiyadeChatProfileCard = {
    open,
    close,
    isOpen: () => Boolean(openState.isOpen),
    resolveNebulaHues,
  };
})();
