/**
 * ==============================================================================
 * ⚔️ KLANIN ZİRVESİ — NEXUS UI 3D CARD CAROUSEL (VANİLLA JS + TEK RAF MOTORU)
 * ==============================================================================
 * - Progressive enhancement: JS yoksa CSS Grid görünür; JS yüklenince section'a .is-enhanced eklenir.
 * - Gerçek CSS 3D Silindir: stage üzerinde perspective(1100px), ring üzerinde preserve-3d
 *   ve `translateZ(-r) rotateY(rot)`, her kart `rotateY(i * step) translateZ(r)` + backface-visibility: hidden.
 * - Fizik & Savrulma:
 *   * baseR = (W/2 + gap/2) / tan(PI / N)
 *   * Bırakınca atalet: vel *= exp(-dt * 3.0), eşik/yay hedefi = round((rot + vel * 0.35) / step) * step
 *   * Yay ivmesi: 170 * (hedef - rot) - 23 * vel (dt <= 1/30 sn), sonunda rot kesin step katı.
 *   * Hızlı dönünce savrulma: swing -> |vel| / 600 (6/sn açılır, 2.5/sn toplanır), r = baseR * (1 + 0.45 * swing)
 * - Etkileşim: yatay sürükleme/fırlatma, yalnızca yatay baskın veya Shift+tekerlek (120ms snap),
 *   klavye okları (ArrowLeft/Right/Home/End), alt noktalar, karta tıklama, 450ms kill sayaç geçişi.
 * - Ses: Yalnızca kullanıcı etkileşimi sonrası ön kart değiştiğinde 5000 Hz highpass tick (NexusSound).
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

  function initZirveCarousel() {
    const section = document.getElementById('savascilar');
    const root = document.getElementById('warriorsCarouselRoot');
    const stage = document.getElementById('warriorsViewport');
    const ring = document.getElementById('warriorsTrack');
    if (!section || !root || !stage || !ring) return;

    const cards = Array.from(ring.querySelectorAll('.zirve-card'));
    const N = cards.length;
    if (N === 0) return;

    const cfg = Object.assign(
      {
        itemWidth: 180,
        itemHeight: 236,
        mobileBreakpoint: 640,
        mobileItemWidth: 148,
        mobileItemHeight: 196,
        gap: 28,
        mobileGap: 24,
        perspective: 1100,
        radius: null,
        autoRotate: false,
        autoSpeed: 1,
        scrollSpeed: 1,
        direction: 'cw',
        autoplay: false,
        enableSound: true,
        countUp: true,
      },
      parseJsonAttr(root, 'data-carousel-config', {})
    );

    const i18n = parseJsonAttr(root, 'data-carousel-i18n', {
      numberLocale: 'tr-TR',
    });

    const captionEl = document.getElementById('warriorsCaption');
    const activeUsernameEl = document.getElementById('warriorsActiveUsername');
    const activeKillsEl = document.getElementById('warriorsActiveKills');
    const profileLinkEl = document.getElementById('warriorsProfileLink');
    const dotBtns = Array.from(document.querySelectorAll('#warriorsDotsContainer .zirve-dot'));

    const soundClient =
      global.NexusSound && typeof global.NexusSound.createClient === 'function'
        ? global.NexusSound.createClient({ soundEnabled: cfg.enableSound !== false })
        : { markUserGesture() {}, playTick() {} };

    // Shimmer iskeletini kaldır & yüklenemezse yer tutucu siluet göster (CSP-uyumlu JS dinleyici)
    cards.forEach((card) => {
      const photoBox = card.querySelector('.zirve-photo');
      const img = card.querySelector('.zirve-avatar');
      const silhouette = card.querySelector('.warriors-silhouette');
      if (!img) return;

      const finishLoaded = () => {
        if (photoBox) photoBox.classList.remove('is-loading');
      };
      const showFallback = () => {
        if (photoBox) photoBox.classList.remove('is-loading');
        img.hidden = true;
        if (silhouette) silhouette.hidden = false;
      };

      if (img.complete) {
        if (img.naturalWidth > 0) finishLoaded();
        else showFallback();
      } else {
        img.addEventListener('load', finishLoaded, { once: true });
        img.addEventListener('error', showFallback, { once: true });
      }
    });

    const step = 360 / N;
    const dirSign = cfg.direction === 'ccw' ? -1 : 1;

    let itemWidth = cfg.itemWidth || 180;
    let itemHeight = cfg.itemHeight || 236;
    let gap = cfg.gap || 28;
    let baseR = 180;

    function recomputeGeometry() {
      const vw = global.innerWidth || document.documentElement.clientWidth || 1024;
      const isMobile = vw <= (cfg.mobileBreakpoint || 640);
      itemWidth = isMobile ? cfg.mobileItemWidth || 148 : cfg.itemWidth || 180;
      itemHeight = isMobile ? cfg.mobileItemHeight || 196 : cfg.itemHeight || 236;
      gap = isMobile ? cfg.mobileGap || 24 : cfg.gap || 28;

      if (Number.isFinite(cfg.radius) && cfg.radius > 0) {
        baseR = cfg.radius;
      } else if (N > 2) {
        baseR = (itemWidth / 2 + gap / 2) / Math.tan(Math.PI / N);
      } else {
        baseR = itemWidth * 0.9;
      }

      section.style.setProperty('--item-w', `${itemWidth}px`);
      section.style.setProperty('--item-h', `${itemHeight}px`);
      section.style.setProperty('--gap', `${gap}px`);
      section.style.setProperty('--step', `${step}deg`);
      section.style.setProperty('--r', `${(baseR * (1 + 0.45 * swing)).toFixed(2)}px`);
    }

    // Fizik durumu: rot=0 -> #1 kart tam karşıda ortada
    let rot = 0;
    let vel = 0;
    let swing = 0;
    let snapTarget = 0;
    let phase = 'idle'; // 'idle' | 'drag' | 'coast' | 'spring'
    let activeIndex = 0;
    let lastSoundIndex = 0;
    let displayedKillsValue = Number(cards[0].getAttribute('data-kills') || 0);
    let countUpAnimStart = 0;
    let countUpFrom = displayedKillsValue;
    let countUpTo = displayedKillsValue;
    let countUpActive = false;

    let isInViewport = true;
    let isHovered = false;
    let rafId = null;
    let lastTs = 0;
    let wheelTimer = null;
    let autoplayTimer = null;
    let captionFadeRaf = null;
    let interactionActive = false;

    recomputeGeometry();
    section.classList.add('is-enhanced');

    function formatKills(n) {
      const clean = Number.isFinite(Number(n)) ? Math.round(Number(n)) : 0;
      return clean.toLocaleString(i18n.numberLocale || 'tr-TR');
    }

    function computeIndexFromRot(angleDeg) {
      return ((Math.round(-angleDeg / step) % N) + N) % N;
    }

    function applyVisualTransforms() {
      const currentR = baseR * (1 + 0.45 * swing);
      section.style.setProperty('--r', `${currentR.toFixed(2)}px`);
      ring.style.transform = `translateZ(${-currentR.toFixed(2)}px) rotateY(${rot.toFixed(3)}deg)`;

      let bestIdx = 0;
      let bestFacing = -Infinity;

      for (let i = 0; i < N; i++) {
        const effectiveDeg = normalizeSignedAngle(i * step + rot);
        const facing = Math.cos((effectiveDeg * Math.PI) / 180);
        const dim = 0.65 * (1 - Math.max(0, facing));
        cards[i].style.setProperty('--dim', dim.toFixed(3));
        if (facing > bestFacing) {
          bestFacing = facing;
          bestIdx = i;
        }
      }

      cards.forEach((c, idx) => {
        c.classList.toggle('is-front', idx === bestIdx);
      });

      return bestIdx;
    }

    function triggerCaptionSwap(newIdx, userTriggered) {
      const card = cards[newIdx];
      if (!card) return;

      const username = card.getAttribute('data-username') || '';
      const targetKills = Number(card.getAttribute('data-kills') || 0);
      const profileUrl = card.getAttribute('data-profile-url') || '';

      dotBtns.forEach((btn, idx) => {
        const isCurrent = idx === newIdx;
        btn.classList.toggle('is-active', isCurrent);
        if (isCurrent) btn.setAttribute('aria-current', 'true');
        else btn.removeAttribute('aria-current');
      });

      if (captionEl && !prefersReducedMotion()) {
        if (captionFadeRaf) global.cancelAnimationFrame(captionFadeRaf);
        captionEl.classList.add('is-updating');
        captionFadeRaf = global.requestAnimationFrame(() => {
          if (activeUsernameEl) activeUsernameEl.textContent = username;
          captionFadeRaf = global.requestAnimationFrame(() => {
            captionEl.classList.remove('is-updating');
            captionFadeRaf = null;
          });
        });
      } else if (activeUsernameEl) {
        activeUsernameEl.textContent = username;
      }

      if (profileLinkEl) {
        if (profileUrl && profileUrl.startsWith('https://www.roblox.com/users/')) {
          profileLinkEl.href = profileUrl;
          profileLinkEl.hidden = false;
        } else {
          profileLinkEl.removeAttribute('href');
          profileLinkEl.hidden = true;
        }
      }

      if (cfg.countUp !== false && !prefersReducedMotion() && isInViewport) {
        countUpFrom = displayedKillsValue;
        countUpTo = targetKills;
        countUpAnimStart = performance.now();
        countUpActive = true;
        ensureLoopRunning();
      } else {
        countUpActive = false;
        displayedKillsValue = targetKills;
        if (activeKillsEl) activeKillsEl.textContent = formatKills(targetKills);
      }

      if (userTriggered && newIdx !== lastSoundIndex) {
        lastSoundIndex = newIdx;
        soundClient.playTick();
      }

      if (typeof cfg.onChange === 'function') {
        try {
          cfg.onChange(newIdx);
        } catch (_) {}
      }
    }

    function stepCountUp(nowMs) {
      if (!countUpActive || !activeKillsEl) return false;
      const elapsed = nowMs - countUpAnimStart;
      const duration = 450;
      const t = clamp(elapsed / duration, 0, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out kübik
      displayedKillsValue = Math.round(countUpFrom + (countUpTo - countUpFrom) * eased);
      activeKillsEl.textContent = formatKills(displayedKillsValue);
      if (t >= 1) {
        countUpActive = false;
        displayedKillsValue = countUpTo;
        activeKillsEl.textContent = formatKills(countUpTo);
        return false;
      }
      return true;
    }

    function snapToAngle(targetAngle, userTriggered = false) {
      const snappedTarget = Math.round(targetAngle / step) * step;
      const nextIdx = computeIndexFromRot(snappedTarget);

      if (prefersReducedMotion() || (!isInViewport && !checkBoundsVisible())) {
        phase = 'idle';
        rot = snappedTarget;
        vel = 0;
        swing = 0;
        applyVisualTransforms();
        if (nextIdx !== activeIndex || userTriggered) {
          const changed = nextIdx !== activeIndex;
          activeIndex = nextIdx;
          if (changed) triggerCaptionSwap(activeIndex, userTriggered);
        }
        stopLoop();
        return;
      }

      interactionActive = userTriggered;
      phase = 'spring';
      snapTarget = snappedTarget;
      ensureLoopRunning();
    }

    function goToIndex(targetIdx, userTriggered = false) {
      const cleanIdx = ((targetIdx % N) + N) % N;
      const desiredMod = -cleanIdx * step;
      const shortestDelta = normalizeSignedAngle(desiredMod - rot);
      const targetAngle = rot + shortestDelta;
      snapToAngle(targetAngle, userTriggered);
    }

    function checkBoundsVisible() {
      const rect = section.getBoundingClientRect();
      const vh = global.innerHeight || document.documentElement.clientHeight || 900;
      return rect.bottom > 0 && rect.top < vh && rect.width > 0 && rect.height > 0;
    }

    function shouldLoopRun() {
      if (prefersReducedMotion()) return false;
      if (document.visibilityState === 'hidden') return false;
      if (!isInViewport) {
        if (checkBoundsVisible()) {
          isInViewport = true;
        } else {
          return false;
        }
      }
      if (phase !== 'idle') return true;
      if (countUpActive) return true;
      if (cfg.autoRotate && !isHovered) return true;
      return swing > 0.002;
    }

    function tick(ts) {
      if (!shouldLoopRun()) {
        rafId = null;
        return;
      }

      if (!lastTs) lastTs = ts;
      const dt = Math.min(1 / 30, Math.max(0.001, (ts - lastTs) / 1000));
      lastTs = ts;

      if (phase === 'coast') {
        rot += vel * dt;
        vel *= Math.exp(-dt * 3.0);

        const swingTarget = clamp(Math.abs(vel) / 600, 0, 1);
        const rate = swingTarget > swing ? 6.0 : 2.5;
        swing += (swingTarget - swing) * Math.min(1, rate * dt);

        if (Math.abs(vel) <= 25) {
          snapTarget = Math.round((rot + vel * 0.35) / step) * step;
          phase = 'spring';
        }
      } else if (phase === 'spring') {
        const accel = 170 * (snapTarget - rot) - 23 * vel;
        vel += accel * dt;
        rot += vel * dt;

        const swingTarget = clamp(Math.abs(vel) / 600, 0, 1);
        const rate = swingTarget > swing ? 6.0 : 2.5;
        swing += (swingTarget - swing) * Math.min(1, rate * dt);

        if (Math.abs(snapTarget - rot) < 0.01 && Math.abs(vel) < 0.3 && swing < 0.004) {
          rot = snapTarget;
          vel = 0;
          swing = 0;
          phase = 'idle';
          interactionActive = false;
        }
      } else if (phase === 'idle' && cfg.autoRotate && !isHovered) {
        rot += (cfg.autoSpeed || 1) * dirSign * 14 * dt;
        swing += (0 - swing) * Math.min(1, 2.5 * dt);
      } else if (phase === 'drag') {
        const swingTarget = clamp(Math.abs(vel) / 600, 0, 1);
        const rate = swingTarget > swing ? 6.0 : 2.5;
        swing += (swingTarget - swing) * Math.min(1, rate * dt);
      } else if (swing > 0.002) {
        swing += (0 - swing) * Math.min(1, 2.5 * dt);
        if (swing <= 0.002) swing = 0;
      }

      const currentFront = applyVisualTransforms();
      if (currentFront !== activeIndex) {
        activeIndex = currentFront;
        triggerCaptionSwap(activeIndex, interactionActive);
      }

      stepCountUp(ts);

      if (shouldLoopRun()) {
        rafId = global.requestAnimationFrame(tick);
      } else {
        rafId = null;
      }
    }

    function ensureLoopRunning() {
      if (prefersReducedMotion()) return;
      if (rafId === null && shouldLoopRun()) {
        lastTs = 0;
        rafId = global.requestAnimationFrame(tick);
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
    // SÜRÜKLEME, FIRLATMA & TIKLAMA AYRIMI (POINTER EVENTS)
    // --------------------------------------------------------------------------
    let dragActive = false;
    let dragPointerId = null;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragPrevX = 0;
    let dragMaxTravel = 0;
    let suppressNextClickUntil = 0;
    let velocitySamples = [];

    function pushVelSample(nowMs, curRot) {
      velocitySamples.push({ t: nowMs, rot: curRot });
      const cutoff = nowMs - 95;
      while (velocitySamples.length > 2 && velocitySamples[0].t < cutoff) {
        velocitySamples.shift();
      }
    }

    stage.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
      soundClient.markUserGesture();

      dragActive = true;
      dragPointerId = e.pointerId;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragPrevX = e.clientX;
      dragMaxTravel = 0;
      vel = 0;
      phase = 'drag';
      interactionActive = true;
      velocitySamples = [{ t: performance.now(), rot }];
      stage.classList.add('is-dragging');

      if (typeof stage.setPointerCapture === 'function') {
        try {
          stage.setPointerCapture(e.pointerId);
        } catch (_) {}
      }
    });

    stage.addEventListener('pointermove', (e) => {
      if (!dragActive || e.pointerId !== dragPointerId) return;
      const dxTotal = e.clientX - dragStartX;
      const dyTotal = e.clientY - dragStartY;
      dragMaxTravel = Math.max(dragMaxTravel, Math.hypot(dxTotal, dyTotal));

      // Dokunmatikte baskın dikey sayfa kaydırmasını bozma
      if (e.pointerType === 'touch' && Math.abs(dyTotal) > Math.abs(dxTotal) && dragMaxTravel > 8) {
        dragActive = false;
        dragPointerId = null;
        phase = 'idle';
        stage.classList.remove('is-dragging');
        snapToAngle(rot, false);
        return;
      }

      const dxStep = e.clientX - dragPrevX;
      dragPrevX = e.clientX;

      // Sağa sürükleyince (+dx) ön kart sağa hareket etsin (+dRot)
      const degPerPx = (step / (itemWidth * 0.55)) * (cfg.scrollSpeed || 1);
      rot += dxStep * degPerPx;

      const now = performance.now();
      pushVelSample(now, rot);
      if (velocitySamples.length >= 2) {
        const oldest = velocitySamples[0];
        const latest = velocitySamples[velocitySamples.length - 1];
        const spanSec = Math.max(0.012, (latest.t - oldest.t) / 1000);
        vel = clamp((latest.rot - oldest.rot) / spanSec, -1400, 1400);
      }

      const currentFront = applyVisualTransforms();
      if (currentFront !== activeIndex) {
        activeIndex = currentFront;
        triggerCaptionSwap(activeIndex, true);
      }
      ensureLoopRunning();
    });

    function handlePointerEnd(e) {
      if (!dragActive || (e.pointerId !== undefined && e.pointerId !== dragPointerId)) return;
      dragActive = false;
      stage.classList.remove('is-dragging');

      if (typeof stage.releasePointerCapture === 'function' && dragPointerId !== null) {
        try {
          if (stage.hasPointerCapture && stage.hasPointerCapture(dragPointerId)) {
            stage.releasePointerCapture(dragPointerId);
          }
        } catch (_) {}
      }
      dragPointerId = null;

      if (dragMaxTravel < 6) {
        // Gerçek tıklama: kart seçilmişse en kısa yoldan öne getir, hemen ardındaki sentetik click'i yut
        suppressNextClickUntil = performance.now() + 140;
        phase = 'idle';
        vel = 0;
        const clickedCard = e.target && typeof e.target.closest === 'function' ? e.target.closest('.zirve-card') : null;
        if (clickedCard) {
          const idx = Number.parseInt(clickedCard.getAttribute('data-warrior-index') || '', 10);
          if (Number.isInteger(idx)) {
            goToIndex(idx, true);
          }
        }
        return;
      }

      // Sürükleme sonrası olası click olayını yut
      suppressNextClickUntil = performance.now() + 140;

      if (prefersReducedMotion()) {
        snapToAngle(rot, true);
        return;
      }

      const now = performance.now();
      pushVelSample(now, rot);
      if (velocitySamples.length >= 2) {
        const oldest = velocitySamples[0];
        const latest = velocitySamples[velocitySamples.length - 1];
        const spanSec = Math.max(0.014, (latest.t - oldest.t) / 1000);
        vel = clamp((latest.rot - oldest.rot) / spanSec, -1400, 1400);
      }

      if (Math.abs(vel) > 160) {
        phase = 'coast';
        ensureLoopRunning();
      } else {
        snapTarget = Math.round((rot + vel * 0.35) / step) * step;
        phase = 'spring';
        ensureLoopRunning();
      }
    }

    stage.addEventListener('pointerup', handlePointerEnd);
    stage.addEventListener('pointercancel', handlePointerEnd);

    stage.addEventListener(
      'click',
      (e) => {
        if (performance.now() < suppressNextClickUntil) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        // Dokunma/klavye sentetik click'i (pointerdown olmadan tetiklenirse)
        const clickedCard = e.target && typeof e.target.closest === 'function' ? e.target.closest('.zirve-card') : null;
        if (clickedCard) {
          soundClient.markUserGesture();
          const idx = Number.parseInt(clickedCard.getAttribute('data-warrior-index') || '', 10);
          if (Number.isInteger(idx)) {
            goToIndex(idx, true);
          }
        }
      },
      true
    );

    // --------------------------------------------------------------------------
    // ALT NOKTALAR VE KLAVYE OK TUŞLARI (ArrowLeft/Right/Home/End)
    // --------------------------------------------------------------------------
    dotBtns.forEach((dot, idx) => {
      dot.addEventListener('click', () => {
        soundClient.markUserGesture();
        goToIndex(idx, true);
      });
    });

    stage.addEventListener('keydown', (e) => {
      soundClient.markUserGesture();
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        goToIndex(activeIndex + 1, true);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToIndex(activeIndex - 1, true);
      } else if (e.key === 'Home') {
        e.preventDefault();
        goToIndex(0, true);
      } else if (e.key === 'End') {
        e.preventDefault();
        goToIndex(N - 1, true);
      }
    });

    // --------------------------------------------------------------------------
    // TEKERLEK: YALNIZCA YATAY BASKIN VEYA SHIFT+TEKERLEK (DİKEY KAYDIRMA SERBEST)
    // --------------------------------------------------------------------------
    stage.addEventListener(
      'wheel',
      (e) => {
        const isHorizontalDominant = Math.abs(e.deltaX) > Math.abs(e.deltaY);
        const isShiftWheel = Boolean(e.shiftKey && Math.abs(e.deltaY) > 0);
        if (!isHorizontalDominant && !isShiftWheel) {
          return; // Dikey sayfa kaydırmasını asla engelleme
        }

        e.preventDefault();
        soundClient.markUserGesture();

        const rawDelta = isHorizontalDominant ? e.deltaX : e.deltaY;
        const degPerPx = (step / (itemWidth * 0.65)) * (cfg.scrollSpeed || 1);
        rot -= rawDelta * degPerPx * 0.45;
        vel = clamp(-rawDelta * 3.2, -900, 900);
        interactionActive = true;
        phase = prefersReducedMotion() ? 'idle' : 'coast';

        const currentFront = applyVisualTransforms();
        if (currentFront !== activeIndex) {
          activeIndex = currentFront;
          triggerCaptionSwap(activeIndex, true);
        }

        if (wheelTimer) global.clearTimeout(wheelTimer);
        wheelTimer = global.setTimeout(() => {
          wheelTimer = null;
          vel = 0;
          snapToAngle(rot, true);
        }, 120);

        ensureLoopRunning();
      },
      { passive: false }
    );

    stage.addEventListener('pointerenter', () => {
      isHovered = true;
    });

    stage.addEventListener('pointerleave', () => {
      isHovered = false;
      if (cfg.autoRotate && !prefersReducedMotion()) {
        ensureLoopRunning();
      }
    });

    // --------------------------------------------------------------------------
    // GÖRÜNÜRLÜK, RESIZE & REDUCED-MOTION YÖNETİMİ
    // --------------------------------------------------------------------------
    function syncAutoplayTimer() {
      if (autoplayTimer) {
        global.clearInterval(autoplayTimer);
        autoplayTimer = null;
      }
      if (cfg.autoplay && !prefersReducedMotion()) {
        autoplayTimer = global.setInterval(() => {
          if (isInViewport && !isHovered && !dragActive && document.visibilityState === 'visible') {
            goToIndex(activeIndex + 1, false);
          }
        }, 4200);
      }
    }

    function settleAndStopLoop() {
      if (phase === 'spring' || phase === 'coast') {
        rot = phase === 'spring' ? snapTarget : Math.round((rot + vel * 0.35) / step) * step;
        vel = 0;
        swing = 0;
        phase = 'idle';
        interactionActive = false;
        const settledIdx = applyVisualTransforms();
        if (settledIdx !== activeIndex) {
          activeIndex = settledIdx;
          triggerCaptionSwap(activeIndex, false);
        }
      }
      stopLoop();
    }

    if (typeof global.IntersectionObserver === 'function') {
      const io = new global.IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          isInViewport = Boolean(entry && entry.isIntersecting) || checkBoundsVisible();
          if (isInViewport) ensureLoopRunning();
          else settleAndStopLoop();
        },
        { threshold: 0.05 }
      );
      io.observe(section);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') settleAndStopLoop();
      else if (isInViewport) ensureLoopRunning();
    });

    function handleResize() {
      recomputeGeometry();
      const snapped = Math.round(rot / step) * step;
      if (phase === 'idle') {
        rot = snapped;
      }
      applyVisualTransforms();
    }

    if (typeof global.ResizeObserver === 'function') {
      const ro = new global.ResizeObserver(handleResize);
      ro.observe(section);
    } else {
      global.addEventListener('resize', handleResize, { passive: true });
    }

    if (reducedMotionQuery && typeof reducedMotionQuery.addEventListener === 'function') {
      reducedMotionQuery.addEventListener('change', () => {
        syncAutoplayTimer();
        if (prefersReducedMotion()) {
          snapToAngle(rot, false);
        } else {
          ensureLoopRunning();
        }
      });
    }

    // İlk kare: #1 Bacon_Exe1341 tam önde (rot = 0)
    applyVisualTransforms();
    syncAutoplayTimer();
    if (cfg.autoRotate && !prefersReducedMotion()) {
      ensureLoopRunning();
    }
  }

  document.addEventListener('DOMContentLoaded', initZirveCarousel);
})(window);
