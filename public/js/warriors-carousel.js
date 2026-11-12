/**
 * ==============================================================================
 * ⚔️ KLANIN ZİRVESİ — NEXUS UI 3D CARD CAROUSEL (VANİLLA JS + NEXUSSPRING)
 * ==============================================================================
 * - Progressive enhancement: JS yoksa SSR grid görünür; JS yüklenince 3D silindir sahnesi açılır.
 * - Fizik: NexusSpring tabanlı geri dönüş yaylanması, sürükle-bırak fırlatma ataleti,
 *   hıza bağlı radyal dışa açılma (flare) ve en yakın karta pürüzsüz oturma.
 * - Etkileşim: Fare/dokunmatik sürükleme, tekerlek, ok tuşları (Left/Right/Home/End),
 *   alt noktalar ve yan kartlara tıklama.
 * - Ses: Ortak NexusSound üzerinden kullanıcı etkileşiminde (hover'da değil) 5000 Hz highpass tick.
 * - Erişilebilirlik & Performans: prefers-reduced-motion anında geçiş, Viewport dışı RAF durdurma,
 *   touch-action: pan-y ile mobilde akıcı dikey sayfa kaydırma, XSS-güvenli textContent.
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

  function clamp(val, min, max) {
    return Math.min(max, Math.max(min, val));
  }

  function normalizeSignedAngle(deg) {
    let a = ((deg % 360) + 360) % 360;
    if (a > 180) a -= 360;
    return a;
  }

  function initWarriorsCarousel() {
    const root = document.getElementById('warriorsCarouselRoot');
    const viewport = document.getElementById('warriorsViewport');
    const track = document.getElementById('warriorsTrack');
    if (!root || !viewport || !track) return;

    const cards = Array.from(track.querySelectorAll('.warriors-card'));
    const count = cards.length;
    if (count === 0) return;

    const cfg = Object.assign(
      {
        itemWidth: 180,
        itemHeight: 236,
        mobileBreakpoint: 640,
        mobileItemWidth: 148,
        mobileItemHeight: 196,
        perspective: 1100,
        radius: null,
        autoRotate: false,
        autoSpeed: 1,
        scrollSpeed: 1,
        direction: 'cw',
        autoplay: false,
        enableSound: true,
      },
      parseJsonAttr(root, 'data-carousel-config', {})
    );

    const i18n = parseJsonAttr(root, 'data-carousel-i18n', {
      numberLocale: 'tr-TR',
      activeAnnouncement: '{rank}. sıradaki {username}, {kills} kill',
    });

    const activeRankEl = document.getElementById('warriorsActiveRank');
    const activeUsernameEl = document.getElementById('warriorsActiveUsername');
    const activeKillsEl = document.getElementById('warriorsActiveKills');
    const profileLinkEl = document.getElementById('warriorsProfileLink');
    const liveRegionEl = document.getElementById('warriorsLiveRegion');
    const dotBtns = Array.from(document.querySelectorAll('#warriorsDotsContainer .warriors-dot-btn'));

    // Kırık/yüklenemeyen görseller için CSP güvenli (inline onerror olmadan) siluet yedeği
    cards.forEach((card) => {
      const img = card.querySelector('.warriors-avatar-img');
      const fallbackEl = card.querySelector('.warriors-silhouette');
      if (img && fallbackEl) {
        img.addEventListener('error', () => {
          img.hidden = true;
          fallbackEl.hidden = false;
        });
      }
    });

    const SpringApi = global.NexusSpring || {
      create(val, opts = {}) {
        return {
          value: val,
          target: val,
          velocity: 0,
          stiffness: opts.stiffness || 280,
          damping: opts.damping || 26,
          mass: opts.mass || 0.9,
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

    const soundClient =
      global.NexusSound && typeof global.NexusSound.createClient === 'function'
        ? global.NexusSound.createClient({ soundEnabled: cfg.enableSound !== false })
        : { markUserGesture() {}, playTick() {} };

    const dirSign = cfg.direction === 'ccw' ? -1 : 1;
    const stepDeg = 360 / count;

    // Kenar kenara hesaplanan silindir yarıçapı (üst üste binmeyi önler)
    let currentItemWidth = cfg.itemWidth;
    let currentItemHeight = cfg.itemHeight;
    let baseRadius = 260;

    function recomputeGeometry() {
      const vw = global.innerWidth || document.documentElement.clientWidth || 1024;
      const isMobile = vw < (cfg.mobileBreakpoint || 640);
      currentItemWidth = isMobile ? cfg.mobileItemWidth || 148 : cfg.itemWidth || 180;
      currentItemHeight = isMobile ? cfg.mobileItemHeight || 196 : cfg.itemHeight || 236;

      root.style.setProperty('--warrior-item-w', `${currentItemWidth}px`);
      root.style.setProperty('--warrior-item-h', `${currentItemHeight}px`);
      root.style.setProperty('--carousel-perspective', `${cfg.perspective || 1100}px`);

      if (Number.isFinite(cfg.radius) && cfg.radius > 0) {
        baseRadius = cfg.radius;
      } else {
        const minEdgeToEdge =
          count > 2 ? currentItemWidth / (2 * Math.tan(Math.PI / count)) : currentItemWidth * 0.95;
        baseRadius = Math.round(minEdgeToEdge + (isMobile ? 22 : 34));
      }
    }

    recomputeGeometry();
    root.classList.add('is-3d-ready');

    // Durum & fizik değişkenleri (0° = ilk kart #1 önde!)
    let rotationDeg = 0;
    let angularVelocity = 0; // deg/s (flick inertia)
    let mode = 'idle'; // 'idle' | 'drag' | 'coast' | 'snap'
    let activeIndex = 0;
    let lastInteractionTickIndex = 0;
    let isInViewport = true;
    let isHovered = false;
    let rafId = null;
    let lastTs = 0;
    let autoplayTimer = null;

    const snapSpring = SpringApi.create(0, { stiffness: 250, damping: 24, mass: 0.9 });
    const radiusSpring = SpringApi.create(0, { stiffness: 210, damping: 18, mass: 0.85 });

    function formatKills(raw) {
      const n = Number(raw);
      return Number.isFinite(n) ? n.toLocaleString(i18n.numberLocale || 'tr-TR') : '0';
    }

    function computeNearestIndexFromRotation(rotDeg) {
      let bestIdx = 0;
      let bestAbsAngle = Infinity;
      for (let i = 0; i < count; i++) {
        const cardLocalDeg = i * stepDeg * dirSign;
        const absRel = Math.abs(normalizeSignedAngle(cardLocalDeg + rotDeg));
        if (absRel < bestAbsAngle) {
          bestAbsAngle = absRel;
          bestIdx = i;
        }
      }
      return bestIdx;
    }

    function updateActiveUi(index, userTriggered) {
      activeIndex = ((index % count) + count) % count;
      const card = cards[activeIndex];
      if (!card) return;

      const rank = card.getAttribute('data-rank') || String(activeIndex + 1);
      const username = card.getAttribute('data-username') || '';
      const kills = card.getAttribute('data-kills') || '0';
      const formattedKills = formatKills(kills);
      const profileUrl = card.getAttribute('data-profile-url') || '';

      cards.forEach((c, idx) => {
        const isFront = idx === activeIndex;
        c.classList.toggle('is-front', isFront);
        c.setAttribute('aria-current', isFront ? 'true' : 'false');
      });

      dotBtns.forEach((btn, idx) => {
        const isCur = idx === activeIndex;
        btn.classList.toggle('is-active', isCur);
        btn.setAttribute('aria-pressed', isCur ? 'true' : 'false');
      });

      if (activeRankEl) activeRankEl.textContent = `#${rank}`;
      if (activeUsernameEl) activeUsernameEl.textContent = username;
      if (activeKillsEl) activeKillsEl.textContent = formattedKills;

      if (profileLinkEl) {
        if (profileUrl && profileUrl.startsWith('https://www.roblox.com/users/')) {
          profileLinkEl.href = profileUrl;
          profileLinkEl.hidden = false;
        } else {
          profileLinkEl.removeAttribute('href');
          profileLinkEl.hidden = true;
        }
      }

      if (userTriggered && activeIndex !== lastInteractionTickIndex) {
        lastInteractionTickIndex = activeIndex;
        soundClient.playTick();

        if (liveRegionEl) {
          const tpl = i18n.activeAnnouncement || '{rank}. sıradaki {username}, {kills} kill';
          liveRegionEl.textContent = tpl
            .replace('{rank}', String(rank))
            .replace('{username}', username)
            .replace('{kills}', formattedKills);
        }
      }
    }

    function render3DScene() {
      const effectiveRadius = Math.max(80, baseRadius + radiusSpring.value);

      for (let i = 0; i < count; i++) {
        const card = cards[i];
        const cardLocalDeg = i * stepDeg * dirSign;
        const relDeg = normalizeSignedAngle(cardLocalDeg + rotationDeg);
        const rad = (relDeg * Math.PI) / 180;
        const cosVal = Math.cos(rad); // 1 ön merkez, -1 tam arka
        const depthNorm = (cosVal + 1) / 2; // 0..1

        const opacity = clamp(0.18 + Math.pow(depthNorm, 1.35) * 0.82, 0.18, 1);
        const zIndex = Math.round(depthNorm * 100) + 1;

        card.style.transform = `translateZ(${-baseRadius}px) rotateY(${relDeg.toFixed(3)}deg) translateZ(${effectiveRadius.toFixed(2)}px)`;
        card.style.opacity = opacity.toFixed(3);
        card.style.zIndex = String(zIndex);
        card.style.pointerEvents = depthNorm > 0.28 ? 'auto' : 'none';
      }
    }

    function targetRotationForIndex(targetIndex) {
      const desiredMod = -targetIndex * stepDeg * dirSign;
      const diff = normalizeSignedAngle(desiredMod - rotationDeg);
      return rotationDeg + diff;
    }

    function snapToNearestCard() {
      const nearestIdx = computeNearestIndexFromRotation(rotationDeg);
      snapToIndex(nearestIdx, true);
    }

    function snapToIndex(targetIndex, userTriggered = false) {
      const cleanIdx = ((targetIndex % count) + count) % count;
      const nextTargetDeg = targetRotationForIndex(cleanIdx);

      if (prefersReducedMotion() || !isInViewport) {
        mode = 'idle';
        rotationDeg = nextTargetDeg;
        angularVelocity = 0;
        snapSpring.value = rotationDeg;
        snapSpring.target = rotationDeg;
        snapSpring.velocity = 0;
        radiusSpring.value = 0;
        radiusSpring.target = 0;
        radiusSpring.velocity = 0;
        updateActiveUi(cleanIdx, userTriggered);
        render3DScene();
        stopLoop();
        return;
      }

      mode = 'snap';
      snapSpring.value = rotationDeg;
      snapSpring.target = nextTargetDeg;
      snapSpring.velocity = angularVelocity;
      angularVelocity = 0;
      radiusSpring.target = 0;
      updateActiveUi(cleanIdx, userTriggered);
      ensureLoopRunning();
    }

    function shouldAnimate() {
      if (prefersReducedMotion()) return false;
      if (document.visibilityState === 'hidden') return false;
      if (!isInViewport) return false;
      if (mode !== 'idle') return true;
      if (cfg.autoRotate && !isHovered) return true;
      return Math.abs(radiusSpring.target - radiusSpring.value) > 0.05 || Math.abs(radiusSpring.velocity) > 0.05;
    }

    function stepFrame(ts) {
      if (!shouldAnimate()) {
        rafId = null;
        return;
      }

      if (!lastTs) lastTs = ts;
      const dt = clamp((ts - lastTs) / 1000, 0.001, 0.045);
      lastTs = ts;

      let keepRunning = false;

      if (mode === 'drag') {
        keepRunning = true;
      } else if (mode === 'coast') {
        rotationDeg += angularVelocity * dt;
        angularVelocity *= Math.exp(-3.9 * dt);
        radiusSpring.target = clamp(Math.abs(angularVelocity) * 0.12, 0, 56);

        const passingIdx = computeNearestIndexFromRotation(rotationDeg);
        if (passingIdx !== activeIndex) {
          updateActiveUi(passingIdx, true);
        }

        if (Math.abs(angularVelocity) < 42) {
          snapToNearestCard();
        }
        keepRunning = true;
      } else if (mode === 'snap') {
        const springActive = SpringApi.step(snapSpring, dt);
        rotationDeg = snapSpring.value;
        radiusSpring.target = clamp(Math.abs(snapSpring.velocity) * 0.06, 0, 32);

        if (!springActive) {
          rotationDeg = snapSpring.target;
          mode = 'idle';
          radiusSpring.target = 0;
        } else {
          keepRunning = true;
        }
      } else if (cfg.autoRotate && !isHovered) {
        rotationDeg += (cfg.autoSpeed || 1) * dirSign * 14 * dt;
        const passingIdx = computeNearestIndexFromRotation(rotationDeg);
        if (passingIdx !== activeIndex) {
          updateActiveUi(passingIdx, false);
        }
        keepRunning = true;
      }

      const radiusMoving = SpringApi.step(radiusSpring, dt);
      if (radiusMoving) keepRunning = true;

      render3DScene();

      if (keepRunning || shouldAnimate()) {
        rafId = global.requestAnimationFrame(stepFrame);
      } else {
        rafId = null;
      }
    }

    function ensureLoopRunning() {
      if (prefersReducedMotion()) return;
      if (rafId === null && shouldAnimate()) {
        lastTs = 0;
        rafId = global.requestAnimationFrame(stepFrame);
      }
    }

    function stopLoop() {
      if (rafId !== null) {
        global.cancelAnimationFrame(rafId);
        rafId = null;
      }
      lastTs = 0;
    }

    // --------------------------------------------------------------------------
    // SÜRÜKLE-BIRAK & FIRLATMA (POINTER EVENTS)
    // --------------------------------------------------------------------------
    let dragActive = false;
    let dragMoved = false;
    let dragStartX = 0;
    let dragPrevX = 0;
    let dragPrevTs = 0;
    let smoothedVx = 0;
    let activePointerId = null;
    let suppressNextClick = false;

    viewport.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
      soundClient.markUserGesture();

      dragActive = true;
      dragMoved = false;
      dragStartX = e.clientX;
      dragPrevX = e.clientX;
      dragPrevTs = performance.now();
      smoothedVx = 0;
      activePointerId = e.pointerId;
      mode = 'drag';
      angularVelocity = 0;
      viewport.classList.add('is-dragging');
    });

    viewport.addEventListener('pointermove', (e) => {
      if (!dragActive || e.pointerId !== activePointerId) return;
      const dxTotal = e.clientX - dragStartX;
      const dxStep = e.clientX - dragPrevX;
      const now = performance.now();
      const dtMs = Math.max(4, now - dragPrevTs);

      if (!dragMoved && Math.abs(dxTotal) > 6) {
        dragMoved = true;
        if (typeof viewport.setPointerCapture === 'function') {
          try {
            viewport.setPointerCapture(activePointerId);
          } catch (_) {}
        }
      }

      if (!dragMoved) return;

      const degPerPx = (0.38 * (cfg.scrollSpeed || 1)) / Math.max(0.7, currentItemWidth / 180);
      const dDeg = dxStep * degPerPx;
      rotationDeg += dDeg;

      const instVel = (dDeg / dtMs) * 1000;
      smoothedVx = smoothedVx * 0.55 + instVel * 0.45;

      radiusSpring.target = prefersReducedMotion()
        ? 0
        : clamp(Math.abs(smoothedVx) * 0.08, 0, 38);

      dragPrevX = e.clientX;
      dragPrevTs = now;

      const curNearest = computeNearestIndexFromRotation(rotationDeg);
      if (curNearest !== activeIndex) {
        updateActiveUi(curNearest, true);
      }

      render3DScene();
      ensureLoopRunning();
    });

    function finishPointerDrag(e) {
      if (!dragActive || (e.pointerId !== undefined && e.pointerId !== activePointerId)) return;
      dragActive = false;
      viewport.classList.remove('is-dragging');

      if (typeof viewport.releasePointerCapture === 'function' && activePointerId !== null) {
        try {
          if (viewport.hasPointerCapture && viewport.hasPointerCapture(activePointerId)) {
            viewport.releasePointerCapture(activePointerId);
          }
        } catch (_) {}
      }
      activePointerId = null;

      if (!dragMoved) {
        mode = 'idle';
        radiusSpring.target = 0;
        return;
      }

      suppressNextClick = true;
      global.setTimeout(() => {
        suppressNextClick = false;
      }, 60);

      if (prefersReducedMotion()) {
        snapToNearestCard();
        return;
      }

      angularVelocity = clamp(smoothedVx, -520, 520);
      if (Math.abs(angularVelocity) >= 55) {
        mode = 'coast';
        ensureLoopRunning();
      } else {
        snapToNearestCard();
      }
    }

    viewport.addEventListener('pointerup', finishPointerDrag);
    viewport.addEventListener('pointercancel', finishPointerDrag);

    // --------------------------------------------------------------------------
    // YAN KARTLARA TIKLAMA & NOKTALARA TIKLAMA
    // --------------------------------------------------------------------------
    cards.forEach((card, idx) => {
      card.addEventListener('click', (e) => {
        if (suppressNextClick || dragMoved) {
          e.preventDefault();
          return;
        }
        soundClient.markUserGesture();
        if (idx !== activeIndex) {
          snapToIndex(idx, true);
        }
      });
    });

    dotBtns.forEach((dot, idx) => {
      dot.addEventListener('click', () => {
        soundClient.markUserGesture();
        snapToIndex(idx, true);
      });
    });

    // --------------------------------------------------------------------------
    // KLAVYE OK TUŞLARI (ArrowLeft, ArrowRight, Home, End)
    // --------------------------------------------------------------------------
    viewport.addEventListener('keydown', (e) => {
      soundClient.markUserGesture();
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        snapToIndex(activeIndex + 1, true);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        snapToIndex(activeIndex - 1, true);
      } else if (e.key === 'Home') {
        e.preventDefault();
        snapToIndex(0, true);
      } else if (e.key === 'End') {
        e.preventDefault();
        snapToIndex(count - 1, true);
      }
    });

    // --------------------------------------------------------------------------
    // TEKERLEK KAYDIRMA (YATAY VEYA VİEWPORT ÜZERİ DİKEY)
    // --------------------------------------------------------------------------
    let lastWheelStepAt = 0;
    viewport.addEventListener(
      'wheel',
      (e) => {
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (Math.abs(delta) < 4) return;
        e.preventDefault();
        soundClient.markUserGesture();

        const now = performance.now();
        if (now - lastWheelStepAt < 110) return;
        lastWheelStepAt = now;

        const stepDir = delta > 0 ? 1 : -1;
        snapToIndex(activeIndex + stepDir, true);
      },
      { passive: false }
    );

    viewport.addEventListener('pointerenter', () => {
      isHovered = true;
    });

    viewport.addEventListener('pointerleave', () => {
      isHovered = false;
      if (cfg.autoRotate && !prefersReducedMotion()) {
        ensureLoopRunning();
      }
    });

    // --------------------------------------------------------------------------
    // İSTEĞE BAĞLI AUTOPLAY / REDUCED MOTION / GÖRÜNÜRLÜK YÖNETİMİ
    // --------------------------------------------------------------------------
    function syncAutoplayTimer() {
      if (autoplayTimer) {
        global.clearInterval(autoplayTimer);
        autoplayTimer = null;
      }
      if (cfg.autoplay && !prefersReducedMotion()) {
        autoplayTimer = global.setInterval(() => {
          if (isInViewport && !isHovered && !dragActive && document.visibilityState === 'visible') {
            snapToIndex(activeIndex + 1, false);
          }
        }, 4200);
      }
    }

    if (typeof global.IntersectionObserver === 'function') {
      const io = new global.IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          isInViewport = Boolean(entry && entry.isIntersecting);
          if (isInViewport) {
            ensureLoopRunning();
          } else {
            stopLoop();
          }
        },
        { threshold: 0.05 }
      );
      io.observe(root);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        stopLoop();
      } else if (isInViewport) {
        ensureLoopRunning();
      }
    });

    global.addEventListener(
      'resize',
      () => {
        recomputeGeometry();
        render3DScene();
      },
      { passive: true }
    );

    if (reducedMotionQuery && typeof reducedMotionQuery.addEventListener === 'function') {
      reducedMotionQuery.addEventListener('change', () => {
        syncAutoplayTimer();
        if (prefersReducedMotion()) {
          snapToIndex(activeIndex, false);
        } else {
          ensureLoopRunning();
        }
      });
    }

    // Başlangıç sahnesi: 1. sıradaki savaşçı (#1 Bacon_Exe1341) tam önde
    updateActiveUi(0, false);
    render3DScene();
    syncAutoplayTimer();
    if (cfg.autoRotate && !prefersReducedMotion()) {
      ensureLoopRunning();
    }
  }

  document.addEventListener('DOMContentLoaded', initWarriorsCarousel);
})(window);
