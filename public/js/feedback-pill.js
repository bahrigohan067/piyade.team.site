/**
 * ==============================================================================
 * 💬 NEXUS UI FEEDBACK PILL (SAĞ ALT GERİ BİLDİRİM HAPI — VANİLLA JS + WEB AUDIO)
 * ==============================================================================
 * - Aşamalar: closed -> open -> sending -> sent -> closed (hata durumunda open)
 * - Mevcut public/js/nexus-components.js içindeki NexusSpring fizik motorunu kullanır
 * - Ses dosyası olmadan saf Web Audio API ile ses sentezler (kullanıcı ayarı: ui-sounds)
 * - React / Tailwind / CDN / sabit renk kodu içermez, kullanıcı metnini yalnızca textContent yazar
 * ==============================================================================
 */
(function (global) {
  'use strict';

  const reducedMotionQuery =
    typeof global.matchMedia === 'function'
      ? global.matchMedia('(prefers-reduced-motion: reduce)')
      : null;

  function prefersReducedMotion() {
    return Boolean(reducedMotionQuery && reducedMotionQuery.matches);
  }

  function isTouchEnvironment() {
    if (typeof global.matchMedia !== 'function') return false;
    return global.matchMedia('(pointer: coarse)').matches;
  }

  function isApplePlatform() {
    try {
      const platform =
        (navigator.userAgentData && navigator.userAgentData.platform) ||
        navigator.platform ||
        navigator.userAgent ||
        '';
      return /mac|iphone|ipad|ipod/i.test(platform);
    } catch (_) {
      return false;
    }
  }

  function parseJsonAttr(el, attrName, fallback = {}) {
    if (!el) return fallback;
    const raw = el.getAttribute(attrName);
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  }

  // ============================================================================
  // WEB AUDIO SENTEZLEYİCİ (SES DOSYASI YOK, DYNAMICS COMPRESSOR İLE)
  // ============================================================================
  function createFeedbackAudio(cfg) {
    let audioCtx = null;
    let masterGain = null;
    let compressor = null;
    let hasInteracted = false;
    let lastTypeTickAt = 0;
    const lastSoundAt = Object.create(null);

    function markInteracted() {
      hasInteracted = true;
    }

    global.addEventListener('pointerdown', markInteracted, { passive: true, once: false });
    global.addEventListener('keydown', markInteracted, { passive: true, once: false });

    function isSoundAllowed() {
      if (!cfg.soundEnabled) return false;
      if (!hasInteracted) return false;
      if (document.visibilityState === 'hidden') return false;
      try {
        if (global.localStorage && global.localStorage.getItem('ui-sounds') === 'off') {
          return false;
        }
      } catch (_) {}
      return true;
    }

    function ensureContext() {
      const AudioCtx = global.AudioContext || global.webkitAudioContext;
      if (!AudioCtx) return null;

      if (!audioCtx) {
        try {
          audioCtx = new AudioCtx();
          compressor = audioCtx.createDynamicsCompressor();
          masterGain = audioCtx.createGain();
          masterGain.gain.value = isTouchEnvironment() ? 0.9 : 0.5;
          masterGain.connect(compressor);
          compressor.connect(audioCtx.destination);
        } catch (_) {
          audioCtx = null;
          return null;
        }
      }

      if (audioCtx.state === 'suspended' && typeof audioCtx.resume === 'function') {
        audioCtx.resume().catch(() => {});
      }

      if (masterGain) {
        masterGain.gain.value = isTouchEnvironment() ? 0.9 : 0.5;
      }

      return audioCtx;
    }

    function canPlayNamed(soundName, throttleMs = 30) {
      const now = performance.now();
      const prev = lastSoundAt[soundName] || 0;
      if (now - prev < throttleMs) return false;
      lastSoundAt[soundName] = now;
      return true;
    }

    function safeDisconnect(nodes, delaySec) {
      const ms = Math.ceil((delaySec + 0.04) * 1000);
      global.setTimeout(() => {
        nodes.forEach((n) => {
          try {
            if (n && typeof n.disconnect === 'function') n.disconnect();
          } catch (_) {}
        });
      }, ms);
    }

    function playTone({ type = 'sine', startFreq, endFreq = startFreq, glideSec = 0, delaySec = 0, decaySec = 0.09, peakGain = 0.2 }) {
      const ctx = ensureContext();
      if (!ctx || !masterGain) return;

      const t0 = ctx.currentTime + delaySec;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(startFreq, t0);
      if (endFreq !== startFreq && glideSec > 0) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + glideSec);
      }

      // Patlama/tık sesini önlemek için 0.0001 değerinden başlat
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(Math.max(0.0002, peakGain), t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + decaySec);

      osc.connect(g);
      g.connect(masterGain);

      osc.start(t0);
      osc.stop(t0 + decaySec + 0.015);
      safeDisconnect([osc, g], delaySec + decaySec + 0.02);
    }

    function playHighpassNoise({ cutoffHz = 4000, decaySec = 0.015, peakGain = 0.04 }) {
      const ctx = ensureContext();
      if (!ctx || !masterGain) return;

      const sampleCount = Math.max(128, Math.floor(ctx.sampleRate * (decaySec + 0.01)));
      const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < sampleCount; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const src = ctx.createBufferSource();
      src.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = cutoffHz;

      const g = ctx.createGain();
      const t0 = ctx.currentTime;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(Math.max(0.0002, peakGain), t0 + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + decaySec);

      src.connect(filter);
      filter.connect(g);
      g.connect(masterGain);

      src.start(t0);
      src.stop(t0 + decaySec + 0.01);
      safeDisconnect([src, filter, g], decaySec + 0.02);
    }

    return {
      playPop() {
        if (!isSoundAllowed() || !canPlayNamed('pop', 30)) return;
        playTone({
          type: 'sine',
          startFreq: 320,
          endFreq: 980,
          glideSec: 0.07,
          decaySec: 0.09,
          peakGain: 0.35 * 0.6,
        });
      },

      playTap() {
        if (!isSoundAllowed() || !canPlayNamed('tap', 30)) return;
        playTone({
          type: 'sine',
          startFreq: 900,
          endFreq: 620,
          glideSec: 0.06,
          decaySec: 0.06,
          peakGain: 0.25 * 0.5,
        });
        playHighpassNoise({
          cutoffHz: 4000,
          decaySec: 0.015,
          peakGain: 0.08 * 0.5,
        });
      },

      playSuccess() {
        if (!isSoundAllowed() || !canPlayNamed('success', 30)) return;
        playTone({
          type: 'triangle',
          startFreq: 1046.5,
          decaySec: 0.18,
          peakGain: 0.22,
          delaySec: 0,
        });
        playTone({
          type: 'triangle',
          startFreq: 1318.5,
          decaySec: 0.32,
          peakGain: 0.22,
          delaySec: 0.09,
        });
      },

      playError() {
        if (!isSoundAllowed() || !canPlayNamed('error', 30)) return;
        playTone({
          type: 'square',
          startFreq: 220,
          decaySec: 0.09,
          peakGain: 0.18,
          delaySec: 0,
        });
        playTone({
          type: 'square',
          startFreq: 185,
          decaySec: 0.14,
          peakGain: 0.18,
          delaySec: 0.11,
        });
      },

      playKeyClick(isBackspace = false) {
        if (!isSoundAllowed()) return;
        const now = performance.now();
        if (now - lastTypeTickAt < 24) return;
        if (!canPlayNamed(isBackspace ? 'keyDel' : 'keyAdd', 24)) return;
        lastTypeTickAt = now;

        if (isBackspace) {
          playTone({
            type: 'triangle',
            startFreq: 165,
            decaySec: 0.08,
            peakGain: 0.3 * 0.45,
          });
        } else {
          playTone({
            type: 'triangle',
            startFreq: 245 + Math.random() * 60,
            decaySec: 0.04,
            peakGain: 0.3 * 0.45,
          });
        }
      },
    };
  }

  // ============================================================================
  // FEEDBACK PILL ANA KONTROLCÜSÜ
  // ============================================================================
  function initFeedbackPill() {
    const root = document.getElementById('feedbackPillRoot');
    if (!root) return;

    if (document.body && document.body.getAttribute('data-feedback') === 'off') {
      root.hidden = true;
      return;
    }

    const cfg = Object.assign(
      {
        enabled: true,
        minLength: 3,
        maxLength: 1000,
        soundEnabled: true,
        accent: '--color-accent',
        sendMinDurationMs: 900,
        sentVisibleMs: 1700,
        requestTimeoutMs: 10000,
        counterShowAt: 800,
      },
      parseJsonAttr(root, 'data-feedback-config', {})
    );

    if (!cfg.enabled) {
      root.hidden = true;
      return;
    }

    const i18n = parseJsonAttr(root, 'data-feedback-i18n', {
      pillLabel: 'Geri Bildirim',
      title: 'Geri Bildirim',
      placeholder: 'Bu site nasıl daha iyi olabilir?',
      hintMac: '⌘ Enter ile gönder',
      hintOther: 'Ctrl + Enter ile gönder',
      send: 'Gönder',
      sending: 'Gönderiliyor…',
      close: 'Kapat',
      thanks: 'Teşekkürler, ulaştı.',
      privacy: 'Mesajın, Discord kullanıcı adınla yetkililere iletilir.',
      errTooShort: 'Lütfen en az 3 karakter yaz.',
      errTooLong: 'Mesaj en fazla 1000 karakter olabilir.',
      errRate: 'Çok sık geri bildirim gönderdin. Biraz sonra tekrar dene.',
      errDuplicate: 'Bu mesajı zaten gönderdin.',
      errSession: 'Oturumun sona ermiş, lütfen tekrar giriş yap.',
      errOffline: 'Şu an ulaşılamıyor. Mesajın silinmedi, tekrar dene.',
      errGeneric: 'Gönderilemedi, lütfen tekrar dene.',
    });

    const surface = document.getElementById('feedbackPillSurface');
    const closedView = document.getElementById('feedbackClosedView');
    const openView = document.getElementById('feedbackPillDialog');
    const sentView = document.getElementById('feedbackSentView');
    const triggerBtn = document.getElementById('feedbackPillTrigger');
    const closeBtn = document.getElementById('feedbackCloseBtn');
    const textarea = document.getElementById('feedbackMessageInput');
    const submitBtn = document.getElementById('feedbackSubmitBtn');
    const errorAlert = document.getElementById('feedbackErrorAlert');
    const charCounter = document.getElementById('feedbackCharCounter');
    const shortcutHint = document.getElementById('feedbackShortcutHint');

    if (
      !surface ||
      !closedView ||
      !openView ||
      !sentView ||
      !triggerBtn ||
      !closeBtn ||
      !textarea ||
      !submitBtn
    ) {
      return;
    }

    // Platform ipucu yazısı (Mac: ⌘ Enter, diğerleri: Ctrl + Enter)
    if (shortcutHint) {
      shortcutHint.textContent = isApplePlatform() ? i18n.hintMac : i18n.hintOther;
    }

    // Mevcut NexusSpring modülünü kullan
    const SpringApi = global.NexusSpring || {
      create(val, opts = {}) {
        return {
          value: val,
          target: val,
          velocity: 0,
          stiffness: opts.stiffness || 380,
          damping: opts.damping || 32,
          mass: opts.mass || 1,
        };
      },
      step(s, dt) {
        const d = s.value - s.target;
        const f = -s.stiffness * d - s.damping * s.velocity;
        s.velocity += (f / (s.mass || 1)) * dt;
        s.value += s.velocity * dt;
        const done = Math.abs(s.velocity) < 0.002 && Math.abs(s.target - s.value) < 0.002;
        if (done) {
          s.value = s.target;
          s.velocity = 0;
        }
        return !done;
      },
    };

    const audio = createFeedbackAudio(cfg);

    let stage = 'closed'; // 'closed' | 'open' | 'sending' | 'sent'
    let previousText = '';
    let sentTimer = null;
    let morphRafId = null;
    let exitCleanupTimers = [];

    const SPRING_OPTS = { stiffness: 380, damping: 32, mass: 1 };
    const widthSpring = SpringApi.create(0, SPRING_OPTS);
    const heightSpring = SpringApi.create(0, SPRING_OPTS);
    const radiusSpring = SpringApi.create(22, SPRING_OPTS);
    let springsInitialized = false;

    function getViewForStage(st) {
      if (st === 'closed') return closedView;
      if (st === 'sent') return sentView;
      return openView;
    }

    function measureViewSize(viewEl) {
      const wasHidden = viewEl.hidden;
      const prevStyle = {
        position: viewEl.style.position,
        visibility: viewEl.style.visibility,
        pointerEvents: viewEl.style.pointerEvents,
        left: viewEl.style.left,
        top: viewEl.style.top,
      };

      viewEl.hidden = false;
      viewEl.style.position = 'fixed';
      viewEl.style.visibility = 'hidden';
      viewEl.style.pointerEvents = 'none';
      viewEl.style.left = '-9999px';
      viewEl.style.top = '-9999px';

      const rect = viewEl.getBoundingClientRect();
      const width = Math.ceil(rect.width || viewEl.offsetWidth || 150);
      const height = Math.ceil(rect.height || viewEl.offsetHeight || 44);

      viewEl.style.position = prevStyle.position;
      viewEl.style.visibility = prevStyle.visibility;
      viewEl.style.pointerEvents = prevStyle.pointerEvents;
      viewEl.style.left = prevStyle.left;
      viewEl.style.top = prevStyle.top;
      if (wasHidden) viewEl.hidden = true;

      return { width, height };
    }

    function syncClosedInitialDimensions() {
      const m = measureViewSize(closedView);
      widthSpring.value = m.width;
      widthSpring.target = m.width;
      heightSpring.value = m.height;
      heightSpring.target = m.height;
      radiusSpring.value = 22;
      radiusSpring.target = 22;
      springsInitialized = true;
    }

    function stopMorphLoop() {
      if (morphRafId !== null) {
        global.cancelAnimationFrame(morphRafId);
        morphRafId = null;
      }
    }

    function morphSurfaceToView(targetStage, targetViewEl) {
      if (!springsInitialized) syncClosedInitialDimensions();

      const targetSize = measureViewSize(targetViewEl);
      const targetRadius = targetStage === 'closed' ? 22 : 24;

      if (prefersReducedMotion()) {
        stopMorphLoop();
        widthSpring.value = targetSize.width;
        widthSpring.target = targetSize.width;
        widthSpring.velocity = 0;
        heightSpring.value = targetSize.height;
        heightSpring.target = targetSize.height;
        heightSpring.velocity = 0;
        radiusSpring.value = targetRadius;
        radiusSpring.target = targetRadius;
        radiusSpring.velocity = 0;
        surface.style.width = targetStage === 'closed' ? '' : `${targetSize.width}px`;
        surface.style.height = targetStage === 'closed' ? '' : `${targetSize.height}px`;
        surface.style.borderRadius = targetStage === 'closed' ? '999px' : '24px';
        return;
      }

      // Mevcut anlık boyutlardan başla
      const currentRect = surface.getBoundingClientRect();
      if (currentRect.width > 0) widthSpring.value = currentRect.width;
      if (currentRect.height > 0) heightSpring.value = currentRect.height;

      widthSpring.target = targetSize.width;
      heightSpring.target = targetSize.height;
      radiusSpring.target = targetRadius;

      let prevTs = 0;
      stopMorphLoop();

      function tick(ts) {
        if (!prevTs) prevTs = ts;
        const dt = Math.min(0.032, Math.max(0.001, (ts - prevTs) / 1000));
        prevTs = ts;

        const mW = SpringApi.step(widthSpring, dt);
        const mH = SpringApi.step(heightSpring, dt);
        const mR = SpringApi.step(radiusSpring, dt);

        surface.style.width = `${Math.max(44, widthSpring.value).toFixed(2)}px`;
        surface.style.height = `${Math.max(44, heightSpring.value).toFixed(2)}px`;
        surface.style.borderRadius = `${Math.max(12, radiusSpring.value).toFixed(2)}px`;

        if (mW || mH || mR) {
          morphRafId = global.requestAnimationFrame(tick);
        } else {
          morphRafId = null;
          if (stage === 'closed') {
            surface.style.width = '';
            surface.style.height = '';
            surface.style.borderRadius = '999px';
          } else {
            surface.style.width = '';
            surface.style.height = '';
            surface.style.borderRadius = '24px';
          }
        }
      }

      morphRafId = global.requestAnimationFrame(tick);
    }

    function clearExitTimers() {
      exitCleanupTimers.forEach((id) => global.clearTimeout(id));
      exitCleanupTimers = [];
    }

    function switchVisibleView(prevStage, nextStage) {
      const fromEl = getViewForStage(prevStage);
      const toEl = getViewForStage(nextStage);
      if (fromEl === toEl) return;

      clearExitTimers();

      if (prefersReducedMotion()) {
        [closedView, openView, sentView].forEach((v) => {
          v.classList.remove('is-exiting', 'is-entering', 'is-active');
          if (v === toEl) {
            v.hidden = false;
            v.classList.add('is-active');
          } else {
            v.hidden = true;
          }
        });
        return;
      }

      // Çıkan görünüm: 120 ms opaklık 1->0 & blur 0->6px
      fromEl.classList.remove('is-active', 'is-entering');
      fromEl.classList.add('is-exiting');

      const hideTimer = global.setTimeout(() => {
        fromEl.classList.remove('is-exiting');
        fromEl.hidden = true;
      }, 130);
      exitCleanupTimers.push(hideTimer);

      // Gelen görünüm: 110ms gecikmeyle blur 6px->0 & opacity 0->1
      toEl.hidden = false;
      toEl.classList.remove('is-exiting', 'is-active');
      toEl.classList.add('is-entering');
      void toEl.offsetHeight; // Reflow zorla
      toEl.classList.remove('is-entering');
      toEl.classList.add('is-active');
    }

    function setSurfaceStateClass(st) {
      surface.classList.remove('is-closed', 'is-open', 'is-sending', 'is-sent');
      surface.classList.add(`is-${st}`);
      triggerBtn.setAttribute('aria-expanded', st === 'open' || st === 'sending' ? 'true' : 'false');
    }

    function setErrorMessage(msg) {
      if (!errorAlert) return;
      if (!msg) {
        errorAlert.textContent = '';
        errorAlert.hidden = true;
        if (stage === 'open') morphSurfaceToView('open', openView);
        return;
      }
      // Yalnızca güvenli textContent kullanılır (innerHTML YOK)
      errorAlert.textContent = msg;
      errorAlert.hidden = false;
      if (stage === 'open') morphSurfaceToView('open', openView);
    }

    function syncFormControls() {
      const trimmedLen = textarea.value.trim().length;
      const rawLen = textarea.value.length;

      submitBtn.disabled = stage === 'sending' || trimmedLen === 0;
      textarea.readOnly = stage === 'sending';

      if (charCounter) {
        if (rawLen >= (cfg.counterShowAt || 800)) {
          charCounter.textContent = `${rawLen} / ${cfg.maxLength || 1000}`;
          charCounter.hidden = false;
        } else {
          charCounter.textContent = '';
          charCounter.hidden = true;
        }
      }
    }

    function openForm() {
      if (stage === 'open' || stage === 'sending') return;
      if (sentTimer) {
        global.clearTimeout(sentTimer);
        sentTimer = null;
      }
      const prevStage = stage;
      stage = 'open';
      submitBtn.classList.remove('is-sending', 'is-returning');
      setSurfaceStateClass('open');
      switchVisibleView(prevStage, 'open');
      syncFormControls();
      morphSurfaceToView('open', openView);
      audio.playPop();

      global.setTimeout(() => {
        if (stage === 'open') {
          textarea.focus();
          const len = textarea.value.length;
          if (typeof textarea.setSelectionRange === 'function') {
            textarea.setSelectionRange(len, len);
          }
        }
      }, prefersReducedMotion() ? 10 : 120);
    }

    function closeToPill({ playTapSound = true, restoreFocus = true, clearDraft = false } = {}) {
      if (stage === 'closed' || stage === 'sending') return;
      if (sentTimer) {
        global.clearTimeout(sentTimer);
        sentTimer = null;
      }

      const prevStage = stage;
      stage = 'closed';

      if (clearDraft) {
        textarea.value = '';
        previousText = '';
      }
      if (errorAlert) {
        errorAlert.textContent = '';
        errorAlert.hidden = true;
      }

      submitBtn.classList.remove('is-sending', 'is-returning');
      setSurfaceStateClass('closed');
      switchVisibleView(prevStage, 'closed');
      syncFormControls();
      morphSurfaceToView('closed', closedView);

      if (playTapSound) {
        audio.playTap();
      }

      if (restoreFocus) {
        global.setTimeout(() => {
          triggerBtn.focus();
        }, prefersReducedMotion() ? 10 : 140);
      }
    }

    function mapServerCodeToMessage(code, wasNetworkOrTimeout) {
      if (wasNetworkOrTimeout) return i18n.errOffline;
      switch (code) {
        case 'TOO_SHORT':
          return i18n.errTooShort;
        case 'TOO_LONG':
          return i18n.errTooLong;
        case 'RATE_LIMITED':
          return i18n.errRate;
        case 'DUPLICATE':
          return i18n.errDuplicate;
        case 'SESSION_EXPIRED':
        case 'NOT_IN_GUILD':
        case 'CSRF_INVALID':
          return i18n.errSession;
        case 'BOT_UNAVAILABLE':
          return i18n.errOffline;
        default:
          return i18n.errGeneric;
      }
    }

    function transitionSendingToError(code, wasNetworkOrTimeout, maybeNextKey) {
      stage = 'open';
      setSurfaceStateClass('open');
      submitBtn.classList.remove('is-sending');
      if (!prefersReducedMotion()) {
        submitBtn.classList.add('is-returning');
        global.setTimeout(() => submitBtn.classList.remove('is-returning'), 240);
      }

      // Ağ/zaman aşımı hatalarında aynı idempotency anahtarıyla tekrar denemeye izin ver;
      // yeni anahtarı sadece sunucu "işlem uygulanmadı" (applied: false) dediğinde al.
      if (!wasNetworkOrTimeout && maybeNextKey) {
        root.setAttribute('data-idempotency-key', maybeNextKey);
      }

      syncFormControls();
      setErrorMessage(mapServerCodeToMessage(code, wasNetworkOrTimeout));
      audio.playError();
      textarea.focus();
    }

    function transitionSendingToSent(nextKey) {
      if (nextKey) {
        root.setAttribute('data-idempotency-key', nextKey);
      }

      const prevStage = stage;
      stage = 'sent';
      submitBtn.classList.remove('is-sending', 'is-returning');
      setSurfaceStateClass('sent');
      switchVisibleView(prevStage, 'sent');
      morphSurfaceToView('sent', sentView);
      audio.playSuccess();

      sentTimer = global.setTimeout(() => {
        sentTimer = null;
        if (stage === 'sent') {
          closeToPill({ playTapSound: false, restoreFocus: true, clearDraft: true });
        }
      }, cfg.sentVisibleMs || 1700);
    }

    async function handleSubmit() {
      if (stage !== 'open') return;
      const trimmed = textarea.value.trim();
      if (trimmed.length === 0) return;

      // Çok kısa/boşluk spam kontrolü
      const compactLen = trimmed.replace(/\s+/g, '').length;
      if (trimmed.length < (cfg.minLength || 3) || compactLen < 2) {
        setErrorMessage(i18n.errTooShort);
        audio.playError();
        textarea.focus();
        return;
      }
      if (trimmed.length > (cfg.maxLength || 1000)) {
        setErrorMessage(i18n.errTooLong);
        audio.playError();
        textarea.focus();
        return;
      }

      setErrorMessage('');
      stage = 'sending';
      setSurfaceStateClass('sending');
      submitBtn.classList.remove('is-returning');
      submitBtn.classList.add('is-sending');
      syncFormControls();

      const startedAt = performance.now();
      const csrfVal = root.getAttribute('data-csrf-token') || '';
      const idemVal = root.getAttribute('data-idempotency-key') || '';

      const controller =
        typeof global.AbortController === 'function' ? new global.AbortController() : null;
      const timeoutId = global.setTimeout(() => {
        if (controller) controller.abort();
      }, cfg.requestTimeoutMs || 10000);

      let responseOk = false;
      let responseData = null;
      let wasNetworkOrTimeout = false;

      try {
        const res = await fetch('/geri-bildirim', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'x-csrf-token': csrfVal,
            'x-idempotency-key': idemVal,
          },
          body: JSON.stringify({
            message: textarea.value,
            page: global.location ? global.location.pathname : '/',
          }),
          signal: controller ? controller.signal : undefined,
        });

        responseData = await res.json().catch(() => null);
        responseOk = res.ok && Boolean(responseData && responseData.success);
      } catch (_) {
        wasNetworkOrTimeout = true;
      } finally {
        global.clearTimeout(timeoutId);
      }

      // Spinner en az sendMinDurationMs (900ms) görünsün
      const elapsed = performance.now() - startedAt;
      const minWait = prefersReducedMotion() ? 200 : cfg.sendMinDurationMs || 900;
      if (elapsed < minWait) {
        await new Promise((resolve) => global.setTimeout(resolve, minWait - elapsed));
      }

      if (responseOk) {
        transitionSendingToSent(responseData && responseData.nextIdempotencyKey);
        return;
      }

      const code = (responseData && responseData.code) || 'GENERIC';
      const nextKey =
        responseData && responseData.applied === false ? responseData.nextIdempotencyKey : null;
      transitionSendingToError(code, wasNetworkOrTimeout, nextKey);
    }

    // Olay Dinleyicileri
    triggerBtn.addEventListener('click', () => {
      if (stage === 'closed') {
        openForm();
      } else if (stage === 'open') {
        closeToPill({ playTapSound: true, restoreFocus: true, clearDraft: false });
      }
    });

    closeBtn.addEventListener('click', () => {
      closeToPill({ playTapSound: true, restoreFocus: true, clearDraft: false });
    });

    openView.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSubmit();
    });

    textarea.addEventListener('input', () => {
      const currentVal = textarea.value;
      // Yalnızca metin sonuna tek karakter ekleme/silmede yazım tık sesi
      if (currentVal.length === previousText.length + 1 && currentVal.startsWith(previousText)) {
        audio.playKeyClick(false);
      } else if (
        currentVal.length === previousText.length - 1 &&
        previousText.startsWith(currentVal)
      ) {
        audio.playKeyClick(true);
      }
      previousText = currentVal;

      if (errorAlert && !errorAlert.hidden) {
        setErrorMessage('');
      }
      syncFormControls();
    });

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (!submitBtn.disabled && stage === 'open') {
          handleSubmit();
        }
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && stage === 'open') {
        e.preventDefault();
        closeToPill({ playTapSound: true, restoreFocus: true, clearDraft: false });
      }
    });

    // Mobilde klavye açılınca alt boşluğu ayarla (visualViewport)
    if (global.visualViewport) {
      const syncKeyboardOffset = () => {
        const vv = global.visualViewport;
        const layoutHeight = global.innerHeight || document.documentElement.clientHeight || 0;
        const overlap = Math.max(0, Math.round(layoutHeight - (vv.height + vv.offsetTop)));
        root.style.setProperty('--feedback-kb-offset', `${overlap}px`);
      };
      global.visualViewport.addEventListener('resize', syncKeyboardOffset, { passive: true });
      global.visualViewport.addEventListener('scroll', syncKeyboardOffset, { passive: true });
    }

    syncFormControls();
    syncClosedInitialDimensions();

    // Testler veya debugging için salt okunur durum erişimi
    global.NexusFeedbackPill = {
      getStage: () => stage,
      open: openForm,
      close: () => closeToPill({ playTapSound: true, restoreFocus: true, clearDraft: false }),
    };
  }

  document.addEventListener('DOMContentLoaded', initFeedbackPill);
})(window);
