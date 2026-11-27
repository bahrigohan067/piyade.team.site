/**
 * ==============================================================================
 * 🛸 PIYADE WORLD — TEK MERKEZLİ UZUN KOPUŞ / ÇEVRİMDIŞI YÜKLENİYOR BİLEŞENİ
 * ==============================================================================
 * - Kısa kopuşlarda (< 3 sn) HİÇBİR ŞEY göstermez.
 * - 3 sn'den uzun kopuş veya navigator.onLine === false:
 *   Sohbet alanının üstünde ortalı, cam stilli yüzen hap (20px Orbital kuyruklu yıldız
 *   + "Yeniden bağlanıyor…", NexusSpring ile yaylanarak belirir). Yazma ve gezinme açık!
 * - 12 sn'den uzun kopuş:
 *   Konuşma alanını yumuşak bulanıklaştıran yarı saydam katman (pointer-events: none;
 *   mesaj kutusu üstte ve kullanılabilir) + büyük Orbital Loader +
 *   "Bağlantı bekleniyor… Mesajların güvende; yazdıkların bağlantı gelince gönderilecek."
 *   (kuyrukta bekleyen mesaj varsa "N mesaj sırada").
 * - Bağlantı gelince: yeşil tik çizimi + "Bağlandı" (~900 ms), sonra yumuşak kapanış.
 * - prefers-reduced-motion: dönüş yerine nabız; tüm renkler theme.css değişkenlerinden.
 * ==============================================================================
 */
(function (root) {
  'use strict';

  const PILL_DELAY_MS = 3000;
  const OVERLAY_DELAY_MS = 12000;
  const CONNECTED_HOLD_MS = 900;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function createSvgEl(doc, tag, attrs) {
    const el = doc.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        el.setAttribute(k, String(v));
      }
    }
    return el;
  }

  function buildOrbitalSvg(doc, sizePx, { variant = 'ring' } = {}) {
    const svg = createSvgEl(doc, 'svg', {
      viewBox: '0 0 48 48',
      width: sizePx,
      height: sizePx,
      class: `offline-orbital-svg offline-orbital-svg--${variant}`,
      'aria-hidden': 'true',
      focusable: 'false',
    });

    const track = createSvgEl(doc, 'circle', {
      cx: '24',
      cy: '24',
      r: '19',
      class: 'offline-orbital-track',
    });
    svg.appendChild(track);

    if (variant === 'check') {
      const ringDone = createSvgEl(doc, 'circle', {
        cx: '24',
        cy: '24',
        r: '19',
        class: 'offline-orbital-done-ring',
      });
      const check = createSvgEl(doc, 'path', {
        d: 'M15 24.5 L21.2 30.8 L33.5 17.5',
        class: 'offline-orbital-check-path',
      });
      svg.append(ringDone, check);
      return svg;
    }

    const cometGroup = createSvgEl(doc, 'g', { class: 'offline-orbital-comet-group' });
    const tail = createSvgEl(doc, 'circle', {
      cx: '24',
      cy: '24',
      r: '19',
      class: 'offline-orbital-comet-tail',
    });
    const head = createSvgEl(doc, 'circle', {
      cx: '24',
      cy: '5',
      r: '2.8',
      class: 'offline-orbital-comet-head',
    });
    cometGroup.append(tail, head);
    svg.appendChild(cometGroup);
    return svg;
  }

  function createOfflineIndicator(options) {
    const opts = Object.assign(
      {
        mountEl: null,
        doc: typeof document !== 'undefined' ? document : null,
        win: typeof window !== 'undefined' ? window : null,
        i18n: {},
        pillDelayMs: PILL_DELAY_MS,
        overlayDelayMs: OVERLAY_DELAY_MS,
        connectedHoldMs: CONNECTED_HOLD_MS,
        setTimeoutFn: (fn, ms) => setTimeout(fn, ms),
        clearTimeoutFn: (id) => clearTimeout(id),
        nowFn: () => Date.now(),
      },
      options || {}
    );

    const texts = Object.assign(
      {
        reconnecting: 'Yeniden bağlanıyor…',
        waitingTitle: 'Bağlantı bekleniyor…',
        waitingDesc: 'Mesajların güvende; yazdıkların bağlantı gelince gönderilecek.',
        queuedCount: '{count} mesaj sırada',
        connected: 'Bağlandı',
      },
      opts.i18n || {}
    );

    let phase = 'hidden'; // 'hidden' | 'pill' | 'overlay' | 'connected'
    let disconnected = false;
    let queuedCount = 0;
    let pillTimer = null;
    let overlayTimer = null;
    let hideConnectedTimer = null;
    let pillSpringHandle = null;

    let rootEl = null;
    let pillEl = null;
    let pillIconSlot = null;
    let pillLabelEl = null;
    let overlayEl = null;
    let overlayIconSlot = null;
    let overlayTitleEl = null;
    let overlayDescEl = null;
    let overlayQueueEl = null;

    const prefersReducedMotion = () =>
      Boolean(
        opts.win &&
          typeof opts.win.matchMedia === 'function' &&
          opts.win.matchMedia('(prefers-reduced-motion: reduce)').matches
      );

    function ensureDom() {
      if (rootEl || !opts.doc) return;
      const doc = opts.doc;
      const mount = opts.mountEl || doc.body;
      if (!mount) return;

      rootEl = doc.createElement('div');
      rootEl.className = 'offline-indicator-root';
      rootEl.setAttribute('data-offline-indicator', 'true');
      rootEl.setAttribute('data-phase', 'hidden');

      // 1) 3 sn üstü yüzen cam hap
      pillEl = doc.createElement('div');
      pillEl.className = 'offline-pill';
      pillEl.setAttribute('role', 'status');
      pillEl.setAttribute('aria-live', 'polite');
      pillEl.hidden = true;

      pillIconSlot = doc.createElement('span');
      pillIconSlot.className = 'offline-pill-icon';
      pillIconSlot.appendChild(buildOrbitalSvg(doc, 20, { variant: 'ring' }));

      pillLabelEl = doc.createElement('span');
      pillLabelEl.className = 'offline-pill-label';
      pillLabelEl.textContent = texts.reconnecting;

      pillEl.append(pillIconSlot, pillLabelEl);

      // 2) 12 sn üstü tıklamaları ENGELLEMEYEN (pointer-events: none) bulanık katman
      overlayEl = doc.createElement('div');
      overlayEl.className = 'offline-overlay';
      overlayEl.setAttribute('role', 'status');
      overlayEl.setAttribute('aria-live', 'polite');
      overlayEl.hidden = true;

      const card = doc.createElement('div');
      card.className = 'offline-overlay-card';

      overlayIconSlot = doc.createElement('div');
      overlayIconSlot.className = 'offline-overlay-icon';
      overlayIconSlot.appendChild(buildOrbitalSvg(doc, 48, { variant: 'ring' }));

      overlayTitleEl = doc.createElement('strong');
      overlayTitleEl.className = 'offline-overlay-title';
      overlayTitleEl.textContent = texts.waitingTitle;

      overlayDescEl = doc.createElement('p');
      overlayDescEl.className = 'offline-overlay-desc';
      overlayDescEl.textContent = texts.waitingDesc;

      overlayQueueEl = doc.createElement('span');
      overlayQueueEl.className = 'offline-overlay-queue';
      overlayQueueEl.hidden = true;

      card.append(overlayIconSlot, overlayTitleEl, overlayDescEl, overlayQueueEl);
      overlayEl.appendChild(card);

      rootEl.append(pillEl, overlayEl);
      mount.appendChild(rootEl);
    }

    function clearTimers() {
      if (pillTimer !== null) {
        opts.clearTimeoutFn(pillTimer);
        pillTimer = null;
      }
      if (overlayTimer !== null) {
        opts.clearTimeoutFn(overlayTimer);
        overlayTimer = null;
      }
      if (hideConnectedTimer !== null) {
        opts.clearTimeoutFn(hideConnectedTimer);
        hideConnectedTimer = null;
      }
    }

    function updateQueueLabel() {
      if (!overlayQueueEl) return;
      const n = Math.max(0, Number(queuedCount) || 0);
      if (n > 0) {
        overlayQueueEl.textContent = String(texts.queuedCount || '{count} mesaj sırada').replace(
          '{count}',
          String(n)
        );
        overlayQueueEl.hidden = false;
      } else {
        overlayQueueEl.textContent = '';
        overlayQueueEl.hidden = true;
      }
    }

    function animatePillIn() {
      if (!pillEl) return;
      if (pillSpringHandle && typeof pillSpringHandle.cancel === 'function') {
        pillSpringHandle.cancel();
        pillSpringHandle = null;
      }
      const Spring = opts.win && opts.win.NexusSpring;
      if (prefersReducedMotion() || !Spring || typeof Spring.animate !== 'function') {
        pillEl.style.opacity = '';
        pillEl.style.transform = '';
        return;
      }
      pillEl.style.opacity = '0';
      pillEl.style.transform = 'translate3d(-50%, -14px, 0) scale(0.9)';
      pillSpringHandle = Spring.animate({
        from: 0,
        to: 1,
        stiffness: 420,
        damping: 26,
        mass: 0.85,
        onUpdate: (v) => {
          const y = -14 * (1 - v);
          const sc = 0.9 + 0.1 * v;
          pillEl.style.opacity = String(Math.max(0, Math.min(1, v * 1.3)));
          pillEl.style.transform = `translate3d(-50%, ${y.toFixed(2)}px, 0) scale(${sc.toFixed(4)})`;
        },
        onComplete: () => {
          pillEl.style.opacity = '';
          pillEl.style.transform = '';
          pillSpringHandle = null;
        },
      });
    }

    function setPhase(nextPhase) {
      ensureDom();
      const prevPhase = phase;
      phase = nextPhase;
      const reduced = prefersReducedMotion();

      if (rootEl) {
        rootEl.setAttribute('data-phase', phase);
        rootEl.classList.toggle('is-reduced-motion', reduced);
      }
      if (!pillEl || !overlayEl) return;

      if (phase === 'hidden') {
        pillEl.hidden = true;
        pillEl.classList.remove('is-connected', 'is-leaving');
        overlayEl.hidden = true;
        return;
      }

      if (phase === 'pill') {
        overlayEl.hidden = true;
        pillEl.classList.remove('is-connected', 'is-leaving');
        pillIconSlot.replaceChildren(buildOrbitalSvg(opts.doc, 20, { variant: 'ring' }));
        pillLabelEl.textContent = texts.reconnecting;
        pillEl.hidden = false;
        if (prevPhase === 'hidden') {
          animatePillIn();
        }
        return;
      }

      if (phase === 'overlay') {
        pillEl.hidden = true;
        overlayIconSlot.replaceChildren(buildOrbitalSvg(opts.doc, 48, { variant: 'ring' }));
        overlayTitleEl.textContent = texts.waitingTitle;
        overlayDescEl.textContent = texts.waitingDesc;
        updateQueueLabel();
        overlayEl.hidden = false;
        return;
      }

      if (phase === 'connected') {
        overlayEl.hidden = true;
        pillEl.classList.remove('is-leaving');
        pillEl.classList.add('is-connected');
        pillIconSlot.replaceChildren(buildOrbitalSvg(opts.doc, 20, { variant: 'check' }));
        pillLabelEl.textContent = texts.connected;
        pillEl.hidden = false;
        if (prevPhase === 'hidden') {
          animatePillIn();
        }
      }
    }

    function setDisconnected({ offline = false } = {}) {
      if (hideConnectedTimer !== null) {
        opts.clearTimeoutFn(hideConnectedTimer);
        hideConnectedTimer = null;
      }
      if (disconnected) {
        if (offline && phase === 'hidden') {
          if (pillTimer !== null) {
            opts.clearTimeoutFn(pillTimer);
            pillTimer = null;
          }
          setPhase('pill');
        }
        return;
      }

      disconnected = true;
      clearTimers();

      if (offline) {
        // navigator.onLine === false ise hap hemen görünür
        setPhase('pill');
      } else {
        pillTimer = opts.setTimeoutFn(() => {
          pillTimer = null;
          if (disconnected && phase === 'hidden') {
            setPhase('pill');
          }
        }, opts.pillDelayMs);
      }

      overlayTimer = opts.setTimeoutFn(() => {
        overlayTimer = null;
        if (disconnected) {
          setPhase('overlay');
        }
      }, opts.overlayDelayMs);
    }

    function setConnected() {
      const wasVisible = phase === 'pill' || phase === 'overlay';
      disconnected = false;
      clearTimers();

      if (!wasVisible) {
        setPhase('hidden');
        return;
      }

      setPhase('connected');
      hideConnectedTimer = opts.setTimeoutFn(() => {
        hideConnectedTimer = null;
        if (!disconnected) {
          if (pillEl) pillEl.classList.add('is-leaving');
          setPhase('hidden');
        }
      }, opts.connectedHoldMs);
    }

    function setQueuedCount(count) {
      queuedCount = Math.max(0, Number(count) || 0);
      updateQueueLabel();
    }

    function updateTexts(nextI18n) {
      if (nextI18n && typeof nextI18n === 'object') {
        Object.assign(texts, nextI18n);
      }
      updateQueueLabel();
    }

    function bindToRealtime(rtClient) {
      if (!rtClient || typeof rtClient.on !== 'function') return () => {};
      const unsub = rtClient.on('status', (snap) => {
        if (!snap) return;
        if (snap.status === 'connected') {
          setConnected();
        } else if (snap.status === 'offline' || snap.status === 'reconnecting') {
          setDisconnected({ offline: snap.status === 'offline' || snap.online === false });
        }
      });
      const current = typeof rtClient.getState === 'function' ? rtClient.getState() : null;
      if (current && (current.status === 'offline' || current.status === 'reconnecting')) {
        setDisconnected({ offline: current.status === 'offline' || current.online === false });
      }
      return unsub;
    }

    function destroy() {
      clearTimers();
      if (pillSpringHandle && typeof pillSpringHandle.cancel === 'function') {
        pillSpringHandle.cancel();
        pillSpringHandle = null;
      }
      if (rootEl && rootEl.parentNode) {
        rootEl.parentNode.removeChild(rootEl);
      }
      rootEl = null;
    }

    return {
      setDisconnected,
      setConnected,
      setQueuedCount,
      updateTexts,
      bindToRealtime,
      getPhase: () => phase,
      getElements: () => ({ rootEl, pillEl, overlayEl, overlayQueueEl }),
      destroy,
      PILL_DELAY_MS,
      OVERLAY_DELAY_MS,
      CONNECTED_HOLD_MS,
    };
  }

  const exported = {
    createOfflineIndicator,
    PILL_DELAY_MS,
    OVERLAY_DELAY_MS,
    CONNECTED_HOLD_MS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  } else if (root) {
    root.PiyadeOfflineIndicator = exported;
  }
})(typeof window !== 'undefined' ? window : globalThis);
