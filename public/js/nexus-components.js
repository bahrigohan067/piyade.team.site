/**
 * ==============================================================================
 * 🌟 PIYADE CLAN | TSB — NEXUS UI BİLEŞENLERİ (SAF VANİLLA JS + YAY FİZİĞİ)
 * ==============================================================================
 * 1. NexusSpring   : Hafif Hooke yay fiziği çözücüsü (bağımsız)
 * 2. Meteors       : Tek canvas katmanlı, imleç bükümlü ve kıvılcımlı meteor gökyüzü
 * 3. Dart Rating   : Mor hedef tahtası, titreyen nişangah, güç çubuğu ve ARIA slider
 * 4. Scroll Reveal : Aşağı kaydırınca netleşen tek birleşik .is-revealed sınıfı
 * 5. Floating Dock : Giriş sonrası sol menü için yaylı yakınlık & kayar aktif nokta
 * 6. Orbital Loader: Kanıt dosyası yüklenirken XHR ilerlemeli yörünge yükleyici
 *
 * Not: Harici CDN, React/Tailwind veya sabit renk kodu içermez.
 * Tüm renkler yalnızca public/css/theme.css değişkenlerinden okunur.
 * ==============================================================================
 */

(function (global) {
  'use strict';

  function prefersReducedMotion() {
    return Boolean(
      global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  function isTouchDevice() {
    return Boolean(
      global.matchMedia &&
        global.matchMedia('(hover: none) and (pointer: coarse)').matches
    );
  }

  function readCssVar(name, fallback) {
    if (!document.documentElement || !global.getComputedStyle) return fallback || '';
    const val = global.getComputedStyle(document.documentElement).getPropertyValue(name);
    return (val && val.trim()) || fallback || '';
  }

  function safeParseJson(str, fallback) {
    if (!str) return fallback;
    try {
      return JSON.parse(str);
    } catch (_) {
      return fallback;
    }
  }

  /**
   * Hafif Hooke yay fiziği (damped harmonic oscillator)
   */
  function createSpring(options) {
    const opts = options || {};
    const stiffness = typeof opts.stiffness === 'number' ? opts.stiffness : 320;
    const damping = typeof opts.damping === 'number' ? opts.damping : 24;
    const mass = typeof opts.mass === 'number' ? opts.mass : 0.85;
    let value = typeof opts.initialValue === 'number' ? opts.initialValue : 0;
    let target = value;
    let velocity = 0;

    return {
      get value() {
        return value;
      },
      get target() {
        return target;
      },
      setTarget(nextTarget) {
        target = nextTarget;
      },
      snap(nextVal) {
        value = nextVal;
        target = nextVal;
        velocity = 0;
      },
      impulse(velDelta) {
        velocity += velDelta;
      },
      isSettled() {
        return Math.abs(target - value) < 0.002 && Math.abs(velocity) < 0.002;
      },
      step(dt) {
        const clampedDt = Math.min(0.032, Math.max(0.001, dt || 0.016));
        const force = -stiffness * (value - target) - damping * velocity;
        const accel = force / mass;
        velocity += accel * clampedDt;
        value += velocity * clampedDt;
        if (this.isSettled()) {
          value = target;
          velocity = 0;
        }
        return value;
      },
    };
  }

  global.NexusSpring = { createSpring };

  // ============================================================================
  // 1. 🌠 METEORS CANVAS BİLEŞENİ
  // ============================================================================
  const METEOR_INTENSITY_MAP = {
    low: 0.65,
    medium: 1,
    high: 1.45,
  };

  function initAllMeteors() {
    const containers = document.querySelectorAll('#meteorsContainer, [data-nexus-meteors]');
    containers.forEach((container) => initSingleMeteors(container));
  }

  function initSingleMeteors(container) {
    if (!container || container.dataset.meteorsBound === 'true') return;
    container.dataset.meteorsBound = 'true';

    const rawConfig = safeParseJson(container.getAttribute('data-meteors-config'), {});
    const config = Object.assign(
      {
        number: 18,
        intensity: 'medium',
        angle: 215,
        minDelay: 0.12,
        maxDelay: 2.4,
        minDuration: 3.2,
        maxDuration: 7.2,
        glow: true,
        colorVar: '--meteors-color',
        tailColorVar: '--meteors-tail-color',
        sparkColorVar: '--meteors-spark-color',
        starColorVar: '--meteors-star-color',
        hoverOnly: false,
        interactive: true,
        stars: 0,
        autoplay: false,
      },
      rawConfig
    );

    const canvas = document.createElement('canvas');
    canvas.className = 'meteors-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    container.insertBefore(canvas, container.firstChild);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Açı vektörü: sağa bakmaktan (+X) saat yönünün tersi (215° -> sol-aşağı)
    const angleRad = ((Number(config.angle) || 215) * Math.PI) / 180;
    const dirX = Math.cos(angleRad);
    const dirY = -Math.sin(angleRad);
    const perpX = -dirY;
    const perpY = dirX;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let isHovered = false;
    let isInViewport = true;
    let pointerX = -9999;
    let pointerY = -9999;
    let hasPointer = false;
    let rafId = null;
    let lastTimestamp = 0;

    let resolvedColors = {
      head: '',
      tail: '',
      spark: '',
      star: '',
    };

    function refreshPalette() {
      resolvedColors = {
        head: readCssVar(config.colorVar || '--meteors-color', ''),
        tail: readCssVar(config.tailColorVar || '--meteors-tail-color', ''),
        spark: readCssVar(config.sparkColorVar || '--meteors-spark-color', ''),
        star: readCssVar(config.starColorVar || '--meteors-star-color', ''),
      };
    }

    function computeEffectiveCount() {
      const mult = METEOR_INTENSITY_MAP[config.intensity] || 1;
      let count = Math.min(72, Math.max(1, Math.round((Number(config.number) || 18) * mult)));
      if (global.innerWidth < 768 || width < 520) {
        count = Math.max(4, Math.round(count * 0.55));
      }
      return count;
    }

    let ambientMeteors = [];
    let strikeMeteors = [];
    let sparkRings = [];
    let sparkParticles = [];
    let bgStars = [];

    function randomBetween(min, max) {
      return min + Math.random() * (max - min);
    }

    function createAmbientMeteor(initialSpread) {
      const minDur = Number(config.minDuration) || 3.2;
      const maxDur = Math.max(minDur, Number(config.maxDuration) || 7.2);
      const minDel = Number(config.minDelay) || 0.12;
      const maxDel = Math.max(minDel, Number(config.maxDelay) || 2.4);

      const duration = randomBetween(minDur, maxDur);
      const delay = initialSpread ? randomBetween(0, maxDel) : randomBetween(minDel, maxDel);

      const spanW = Math.max(300, width);
      const spanH = Math.max(240, height);
      const diag = Math.hypot(spanW, spanH);
      const centerX = spanW * 0.5;
      const centerY = spanH * 0.5;
      const startBackOffset = diag * randomBetween(0.52, 0.72);
      const lateralOffset = randomBetween(-diag * 0.65, diag * 0.65);

      const originX = centerX - dirX * startBackOffset + perpX * lateralOffset;
      const originY = centerY - dirY * startBackOffset + perpY * lateralOffset;
      const travelDistance = diag * randomBetween(1.15, 1.45);

      return {
        originX,
        originY,
        x: originX,
        y: originY,
        bendX: 0,
        bendY: 0,
        bendVx: 0,
        bendVy: 0,
        travelDistance,
        duration,
        elapsed: initialSpread ? -delay : -delay,
        tailLength: randomBetween(95, 175),
        headRadius: randomBetween(1.5, 2.6),
        opacityScale: randomBetween(0.65, 1),
      };
    }

    function rebuildAmbientPool() {
      const targetCount = computeEffectiveCount();
      ambientMeteors = [];
      for (let i = 0; i < targetCount; i++) {
        ambientMeteors.push(createAmbientMeteor(true));
      }

      const starCount = Math.max(0, Math.min(200, Number(config.stars) || 0));
      bgStars = [];
      for (let s = 0; s < starCount; s++) {
        bgStars.push({
          x: Math.random() * Math.max(width, 320),
          y: Math.random() * Math.max(height, 240),
          r: randomBetween(0.7, 1.6),
          phase: Math.random() * Math.PI * 2,
          speed: randomBetween(1.2, 2.8),
        });
      }
    }

    function resizeCanvas() {
      const rect = container.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      dpr = Math.min(2, global.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      refreshPalette();
      rebuildAmbientPool();
      if (prefersReducedMotion()) {
        drawReducedStatic();
      }
    }

    function spawnStrikeAt(targetX, targetY) {
      if (!config.interactive) return;
      const spawnDist = Math.max(240, Math.hypot(width, height) * 0.65);
      const startX = targetX - dirX * spawnDist;
      const startY = targetY - dirY * spawnDist;

      strikeMeteors.push({
        startX,
        startY,
        targetX,
        targetY,
        x: startX,
        y: startY,
        progress: 0,
        duration: 0.46,
        tailLength: 185,
        headRadius: 3.1,
      });
    }

    function spawnSparkBurst(x, y) {
      sparkRings.push({
        x,
        y,
        radius: 4,
        maxRadius: 68,
        alpha: 0.95,
      });

      const count = 18;
      for (let i = 0; i < count; i++) {
        const ang = (Math.PI * 2 * i) / count + randomBetween(-0.18, 0.18);
        const speed = randomBetween(85, 220);
        sparkParticles.push({
          x,
          y,
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          life: 0,
          maxLife: randomBetween(0.45, 0.8),
          radius: randomBetween(1.4, 2.7),
        });
      }
    }

    function drawMeteorBody(x, y, vxNorm, vyNorm, tailLen, headR, alpha) {
      if (alpha <= 0.01) return;
      const tailX = x - vxNorm * tailLen;
      const tailY = y - vyNorm * tailLen;

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

      // İncelen üçgen iz (tapering trail)
      const pX = -vyNorm * headR;
      const pY = vxNorm * headR;

      const grad = ctx.createLinearGradient(x, y, tailX, tailY);
      grad.addColorStop(0, resolvedColors.head);
      grad.addColorStop(0.28, resolvedColors.tail);
      grad.addColorStop(1, 'transparent');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x + pX, y + pY);
      ctx.lineTo(x - pX, y - pY);
      ctx.lineTo(tailX, tailY);
      ctx.closePath();
      ctx.fill();

      // Meteor başı ve parlama (glow)
      if (config.glow) {
        ctx.shadowBlur = 14;
        ctx.shadowColor = resolvedColors.spark || resolvedColors.head;
      }
      ctx.fillStyle = resolvedColors.head;
      ctx.beginPath();
      ctx.arc(x, y, headR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function drawReducedStatic() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // Soluk yanıp sönmeyen sabit yıldızlar (stars > 0 ise)
      bgStars.forEach((st) => {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = resolvedColors.star;
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      // Reduced-motion: soluk sabit çapraz çizgiler
      const staticCount = Math.min(ambientMeteors.length, 14);
      for (let i = 0; i < staticCount; i++) {
        const sx = ((i + 0.7) / staticCount) * width;
        const sy = (((i * 37) % 85) / 100) * height;
        drawMeteorBody(sx, sy, dirX, dirY, 110, 1.5, 0.28);
      }
    }

    function updateAndRender(dt, timeSec) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // Arka plan yıldızları (stars > 0 ise)
      for (let s = 0; s < bgStars.length; s++) {
        const st = bgStars[s];
        const twinkle = 0.22 + 0.38 * (0.5 + 0.5 * Math.sin(timeSec * st.speed + st.phase));
        ctx.save();
        ctx.globalAlpha = twinkle;
        ctx.fillStyle = resolvedColors.star;
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      const ambientActive = !config.hoverOnly || isHovered;

      // Normal meteorlar: yanarak belirir, hızlanır, imleç çekimine bükülür
      for (let i = 0; i < ambientMeteors.length; i++) {
        const m = ambientMeteors[i];
        m.elapsed += dt;
        if (m.elapsed < 0) continue;

        const normT = m.elapsed / m.duration;
        if (normT >= 1) {
          if (ambientActive) {
            ambientMeteors[i] = createAmbientMeteor(false);
          } else {
            m.elapsed = -999;
          }
          continue;
        }

        // Hızlanma eğrisi (easeInQuad karışımı: başlangıçta belirip hızlanır)
        const easedPos = 0.32 * normT + 0.68 * normT * normT;
        const baseX = m.originX + dirX * (m.travelDistance * easedPos);
        const baseY = m.originY + dirY * (m.travelDistance * easedPos);

        // İmleç yakınından geçerken kendine doğru bükme (gravitational pointer bend)
        if (config.interactive && hasPointer) {
          const dxP = pointerX - (baseX + m.bendX);
          const dyP = pointerY - (baseY + m.bendY);
          const distP = Math.hypot(dxP, dyP);
          const attractRadius = 210;
          if (distP > 4 && distP < attractRadius) {
            const falloff = (1 - distP / attractRadius) * (1 - distP / attractRadius);
            const pullStrength = 340 * falloff;
            m.bendVx += (dxP / distP) * pullStrength * dt;
            m.bendVy += (dyP / distP) * pullStrength * dt;
          }
        }

        // Yumuşak yaylı geri dönüş ve sönümleme
        m.bendVx *= Math.pow(0.28, dt);
        m.bendVy *= Math.pow(0.28, dt);
        m.bendVx -= m.bendX * 2.2 * dt;
        m.bendVy -= m.bendY * 2.2 * dt;
        m.bendX += m.bendVx * dt;
        m.bendY += m.bendVy * dt;

        const prevX = m.x;
        const prevY = m.y;
        m.x = baseX + m.bendX;
        m.y = baseY + m.bendY;

        // Yanarak belirme (burn-in) ve çıkış solması
        const burnIn = Math.min(1, normT / 0.16);
        const fadeOut = normT > 0.8 ? Math.max(0, (1 - normT) / 0.2) : 1;
        const alpha = burnIn * fadeOut * m.opacityScale;

        // Hız vektörü (bükülme açısını da izlesin)
        const stepDx = m.x - prevX;
        const stepDy = m.y - prevY;
        const stepLen = Math.hypot(stepDx, stepDy);
        const vx = stepLen > 0.2 ? stepDx / stepLen : dirX;
        const vy = stepLen > 0.2 ? stepDy / stepLen : dirY;

        const dynamicTail = m.tailLength * (0.45 + 0.55 * Math.min(1, normT * 1.4));
        drawMeteorBody(m.x, m.y, vx, vy, dynamicTail, m.headRadius, alpha);
      }

      // Tıklanan noktaya düşen özel meteorlar
      for (let j = strikeMeteors.length - 1; j >= 0; j--) {
        const sm = strikeMeteors[j];
        sm.progress += dt / sm.duration;
        if (sm.progress >= 1) {
          spawnSparkBurst(sm.targetX, sm.targetY);
          strikeMeteors.splice(j, 1);
          continue;
        }
        const t = sm.progress;
        const eased = t * t * (2 - t * 0.45) * 0.65 + t * 0.35;
        sm.x = sm.startX + (sm.targetX - sm.startX) * Math.min(1, eased);
        sm.y = sm.startY + (sm.targetY - sm.startY) * Math.min(1, eased);
        drawMeteorBody(sm.x, sm.y, dirX, dirY, sm.tailLength, sm.headRadius, 1);
      }

      // Çarpma kıvılcım halkası (spark ring)
      for (let r = sparkRings.length - 1; r >= 0; r--) {
        const ring = sparkRings[r];
        ring.radius += 165 * dt;
        ring.alpha -= 1.85 * dt;
        if (ring.alpha <= 0 || ring.radius >= ring.maxRadius) {
          sparkRings.splice(r, 1);
          continue;
        }
        ctx.save();
        ctx.globalAlpha = Math.max(0, ring.alpha);
        ctx.strokeStyle = resolvedColors.spark || resolvedColors.head;
        ctx.lineWidth = 2.2;
        if (config.glow) {
          ctx.shadowBlur = 14;
          ctx.shadowColor = resolvedColors.spark;
        }
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Çarpma kıvılcım parçacıkları
      for (let p = sparkParticles.length - 1; p >= 0; p--) {
        const sp = sparkParticles[p];
        sp.life += dt;
        if (sp.life >= sp.maxLife) {
          sparkParticles.splice(p, 1);
          continue;
        }
        sp.vx *= Math.pow(0.18, dt);
        sp.vy *= Math.pow(0.18, dt);
        sp.vy += 90 * dt;
        sp.x += sp.vx * dt;
        sp.y += sp.vy * dt;

        const alpha = 1 - sp.life / sp.maxLife;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = resolvedColors.spark || resolvedColors.head;
        if (config.glow) {
          ctx.shadowBlur = 10;
          ctx.shadowColor = resolvedColors.spark;
        }
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, sp.radius * alpha, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    function tick(now) {
      if (document.hidden || !isInViewport || prefersReducedMotion()) {
        rafId = null;
        return;
      }
      if (!lastTimestamp) lastTimestamp = now;
      const dt = Math.min(0.05, (now - lastTimestamp) / 1000);
      lastTimestamp = now;

      updateAndRender(dt, now / 1000);
      rafId = global.requestAnimationFrame(tick);
    }

    function ensureRunning() {
      if (prefersReducedMotion()) {
        drawReducedStatic();
        return;
      }
      if (!document.hidden && isInViewport && !rafId) {
        lastTimestamp = 0;
        rafId = global.requestAnimationFrame(tick);
      }
    }

    // Etkileşim dinleyicileri (imleç çekimi + tıklama/dokunma çarpma halkası)
    if (config.interactive || config.hoverOnly) {
      container.addEventListener(
        'pointermove',
        (e) => {
          const rect = container.getBoundingClientRect();
          pointerX = e.clientX - rect.left;
          pointerY = e.clientY - rect.top;
          hasPointer = true;
          isHovered = true;
        },
        { passive: true }
      );

      container.addEventListener(
        'pointerenter',
        () => {
          isHovered = true;
          ensureRunning();
        },
        { passive: true }
      );

      container.addEventListener(
        'pointerleave',
        () => {
          isHovered = false;
          hasPointer = false;
        },
        { passive: true }
      );

      container.addEventListener('pointerdown', (e) => {
        if (!config.interactive) return;
        const rect = container.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        pointerX = cx;
        pointerY = cy;
        hasPointer = true;

        if (prefersReducedMotion()) {
          // Reduced-motion'da tıklamada sadece sakin nokta/halka yenile
          drawReducedStatic();
          ctx.save();
          ctx.globalAlpha = 0.55;
          ctx.strokeStyle = resolvedColors.spark;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy, 18, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
          return;
        }

        spawnStrikeAt(cx, cy);
        ensureRunning();
      });
    }

    // Boyut değişimi & görünürlük yönetimi
    if (typeof global.ResizeObserver === 'function') {
      const ro = new global.ResizeObserver(() => resizeCanvas());
      ro.observe(container);
    } else {
      global.addEventListener('resize', resizeCanvas, { passive: true });
    }

    if (typeof global.IntersectionObserver === 'function') {
      const io = new global.IntersectionObserver(
        (entries) => {
          isInViewport = entries.some((entry) => entry.isIntersecting);
          if (isInViewport) ensureRunning();
        },
        { threshold: 0.05 }
      );
      io.observe(container);
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) ensureRunning();
    });

    resizeCanvas();
    ensureRunning();
  }

  // ============================================================================
  // 2. 📜 SCROLL REVEAL TEXT BİLEŞENİ (Tek birleşik .is-revealed sınıfı)
  // ============================================================================
  function initScrollReveal() {
    const scrollLines = Array.from(document.querySelectorAll('.scroll-reveal-line'));
    if (scrollLines.length === 0) return;

    if (prefersReducedMotion()) {
      scrollLines.forEach((line) => line.classList.add('is-revealed'));
      return;
    }

    function updateRevealVisibility() {
      const vh = global.innerHeight || document.documentElement.clientHeight || 800;
      scrollLines.forEach((line, index) => {
        const rect = line.getBoundingClientRect();
        if (rect.top <= vh * 0.88 && rect.bottom >= 0) {
          line.style.transitionDelay = `${index * 70}ms`;
          line.classList.add('is-revealed');
        } else if (rect.top > vh * 1.05) {
          line.style.transitionDelay = '0ms';
          line.classList.remove('is-revealed');
        }
      });
    }

    if (typeof global.IntersectionObserver === 'function') {
      const io = new global.IntersectionObserver(
        () => updateRevealVisibility(),
        { threshold: [0, 0.15, 0.4, 0.85] }
      );
      scrollLines.forEach((line) => io.observe(line));
    }

    global.addEventListener('scroll', updateRevealVisibility, { passive: true });
    global.addEventListener('resize', updateRevealVisibility, { passive: true });
    updateRevealVisibility();
  }

  // ============================================================================
  // 3. 🎯 DART RATING BİLEŞENİ (Slider + Nişangah Titremesi + Güç Çubuğu + Mor Tema)
  // ============================================================================
  function initDartRating() {
    const dartWrapper = document.getElementById('dartboardWrapper');
    const reticle = document.getElementById('dartAimReticle');
    const scoreDisplay = document.getElementById('dartScoreDisplay');
    const feedbackDisplay = document.getElementById('dartFeedbackDisplay');
    const ratingWordEl = document.getElementById('dartRatingWord');
    const starsContainer = document.getElementById('dartStarsContainer');
    const clearBtn = document.getElementById('btnClearDarts');
    const powerFill = document.getElementById('dartPowerFill');
    const powerValue = document.getElementById('dartPowerValue');
    const dartCard = document.getElementById('dartRatingCard');

    if (!dartWrapper || !reticle) return;

    const i18nData = safeParseJson(
      dartCard ? dartCard.getAttribute('data-dart-i18n') : '',
      {
        unratedScore: '–',
        unratedWord: 'Puan verilmedi',
        initialFeedback: 'Hedef almak için tahtaya basılı tut ve bırak.',
        words: {},
        feedbacks: {},
      }
    );

    const VIEWBOX_SIZE = 280;
    const CENTER = 140;
    const BOARD_RADIUS = 130;
    const RING_STEP = 13; // 10 halka * 13 = 130

    let currentScore = null;
    let isAiming = false;
    let activePointerId = null;
    let pointerX = CENTER;
    let pointerY = CENTER;
    let jitteredX = CENTER;
    let jitteredY = CENTER;
    let holdStartMs = 0;
    let aimRafId = null;

    function clientToSvgCoords(clientX, clientY) {
      const rect = dartWrapper.getBoundingClientRect();
      const relX = ((clientX - rect.left) / Math.max(1, rect.width)) * VIEWBOX_SIZE;
      const relY = ((clientY - rect.top) / Math.max(1, rect.height)) * VIEWBOX_SIZE;
      return { x: relX, y: relY };
    }

    function clampToBoard(x, y) {
      const dx = x - CENTER;
      const dy = y - CENTER;
      const dist = Math.hypot(dx, dy);
      if (dist <= BOARD_RADIUS - 1.5) return { x, y };
      const scale = (BOARD_RADIUS - 1.5) / dist;
      return { x: CENTER + dx * scale, y: CENTER + dy * scale };
    }

    function setPowerUI(pct) {
      const rounded = Math.max(0, Math.min(100, Math.round(pct)));
      if (powerFill) powerFill.style.width = `${rounded}%`;
      if (powerValue) powerValue.textContent = `%${rounded}`;
    }

    function updateReticlePosition(x, y) {
      reticle.style.left = `${(x / VIEWBOX_SIZE) * 100}%`;
      reticle.style.top = `${(y / VIEWBOX_SIZE) * 100}%`;
    }

    function aimTick(now) {
      if (!isAiming) {
        aimRafId = null;
        return;
      }

      const elapsedMs = Math.max(0, now - holdStartMs);
      // Güç 1.35 saniyede %100'e ulaşır, ardından yüksek güçte nefes alır
      const baseRamp = Math.min(1, elapsedMs / 1350);
      const pulse = baseRamp >= 1 ? 0.92 + 0.08 * Math.sin((elapsedMs - 1350) / 180) : baseRamp;
      const powerPct = Math.max(6, Math.round(pulse * 100));
      setPowerUI(powerPct);

      if (prefersReducedMotion()) {
        const clamped = clampToBoard(pointerX, pointerY);
        jitteredX = clamped.x;
        jitteredY = clamped.y;
      } else {
        // Basılı tuttukça nişangah titremesi (tremor) artar
        const tremorRadius = 1.5 + Math.pow(baseRamp, 1.35) * 12;
        const jx =
          (Math.sin(now * 0.023) * 0.65 + Math.sin(now * 0.061) * 0.35) * tremorRadius;
        const jy =
          (Math.cos(now * 0.029) * 0.65 + Math.cos(now * 0.053) * 0.35) * tremorRadius;
        const clamped = clampToBoard(pointerX + jx, pointerY + jy);
        jitteredX = clamped.x;
        jitteredY = clamped.y;
      }

      updateReticlePosition(jitteredX, jitteredY);
      aimRafId = global.requestAnimationFrame(aimTick);
    }

    function computeScoreFromCoords(x, y) {
      const dx = x - CENTER;
      const dy = y - CENTER;
      const dist = Math.hypot(dx, dy);
      if (dist <= RING_STEP) return 10;
      const ringIdx = Math.ceil(dist / RING_STEP);
      return Math.max(1, Math.min(10, 11 - ringIdx));
    }

    function renderSingleDartPin(svgX, svgY) {
      // KURAL: Yeni atışta eski dart çıkarılır; tahtada her zaman en fazla TEK dart vardır
      dartWrapper.querySelectorAll('.dart-pin').forEach((existing) => existing.remove());

      const pin = document.createElement('div');
      pin.className = prefersReducedMotion() ? 'dart-pin' : 'dart-pin is-sticking';
      pin.style.left = `${(svgX / VIEWBOX_SIZE) * 100}%`;
      pin.style.top = `${(svgY / VIEWBOX_SIZE) * 100}%`;
      pin.innerHTML = `
        <svg class="dart-pin-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="3.2" fill="var(--dart-pin-core)" />
          <path d="M12 9 L8 2 L12 5 L16 2 Z" fill="var(--dart-pin-wing-1)" />
          <path d="M12 15 L8 22 L12 19 L16 22 Z" fill="var(--dart-pin-wing-2)" />
          <path d="M9 12 L2 8 L5 12 L2 16 Z" fill="var(--dart-pin-wing-3)" />
          <path d="M15 12 L22 8 L19 12 L22 16 Z" fill="var(--dart-pin-wing-4)" />
        </svg>
      `;
      dartWrapper.appendChild(pin);
    }

    function updateScoreUI(score) {
      currentScore = score;
      const isRated = typeof score === 'number' && score >= 1 && score <= 10;

      if (scoreDisplay) {
        const displayNum = isRated ? String(score) : String(i18nData.unratedScore || '–');
        scoreDisplay.innerHTML = `<span class="dart-score-value">${displayNum}</span> / 10`;
      }

      if (starsContainer) {
        const stars = starsContainer.querySelectorAll('.dart-star');
        if (stars.length === 10) {
          stars.forEach((star, idx) => {
            star.classList.toggle('is-filled', isRated && idx < score);
          });
        } else {
          let html = '';
          for (let i = 1; i <= 10; i++) {
            html += `<span class="dart-star ${isRated && i <= score ? 'is-filled' : ''}" aria-hidden="true">★</span>`;
          }
          starsContainer.innerHTML = html;
        }
      }

      const word = isRated
        ? (i18nData.words && i18nData.words[String(score)]) || String(score)
        : i18nData.unratedWord || 'Puan verilmedi';

      if (ratingWordEl) {
        ratingWordEl.textContent = word;
        ratingWordEl.classList.toggle('is-rated', isRated);
      }

      if (feedbackDisplay) {
        feedbackDisplay.textContent = isRated
          ? (i18nData.feedbacks && i18nData.feedbacks[String(score)]) || ''
          : i18nData.initialFeedback || '';
      }

      // Gerçek Slider ARIA Güncellemesi
      if (isRated) {
        dartWrapper.setAttribute('aria-valuenow', String(score));
        dartWrapper.setAttribute('aria-valuetext', `${score} / 10 — ${word}`);
      } else {
        dartWrapper.removeAttribute('aria-valuenow');
        dartWrapper.setAttribute('aria-valuetext', word);
      }
    }

    function throwDartAtRing(ringNumber) {
      const safeRing = Math.max(1, Math.min(10, Math.round(ringNumber)));
      // Seçilen halkanın tam ortasına düşür
      const targetRadius = safeRing === 10 ? 0 : (10 - safeRing + 0.5) * RING_STEP;
      const randomAngle = prefersReducedMotion() ? -Math.PI / 4 : Math.random() * Math.PI * 2;
      const x = CENTER + Math.cos(randomAngle) * targetRadius;
      const y = CENTER + Math.sin(randomAngle) * targetRadius;

      renderSingleDartPin(x, y);
      updateScoreUI(safeRing);
    }

    function stopAiming(shouldThrow) {
      if (!isAiming) return;
      isAiming = false;
      reticle.classList.remove('is-aiming');
      if (aimRafId) {
        global.cancelAnimationFrame(aimRafId);
        aimRafId = null;
      }

      if (shouldThrow) {
        const clamped = clampToBoard(jitteredX, jitteredY);
        const landedScore = computeScoreFromCoords(clamped.x, clamped.y);
        renderSingleDartPin(clamped.x, clamped.y);
        updateScoreUI(landedScore);
      }
      setPowerUI(0);
      activePointerId = null;
    }

    dartWrapper.addEventListener('pointerdown', (e) => {
      if (e.button && e.button !== 0) return;
      e.preventDefault();
      dartWrapper.focus({ preventScroll: true });

      const coords = clientToSvgCoords(e.clientX, e.clientY);
      const clamped = clampToBoard(coords.x, coords.y);
      pointerX = clamped.x;
      pointerY = clamped.y;
      jitteredX = clamped.x;
      jitteredY = clamped.y;

      isAiming = true;
      activePointerId = e.pointerId;
      holdStartMs = performance.now();
      reticle.classList.add('is-aiming');
      updateReticlePosition(jitteredX, jitteredY);

      if (dartWrapper.setPointerCapture && e.pointerId !== undefined) {
        try {
          dartWrapper.setPointerCapture(e.pointerId);
        } catch (_) {}
      }
      aimTick(holdStartMs);
    });

    global.addEventListener(
      'pointermove',
      (e) => {
        if (!isAiming || (activePointerId !== null && e.pointerId !== activePointerId)) return;
        const coords = clientToSvgCoords(e.clientX, e.clientY);
        const clamped = clampToBoard(coords.x, coords.y);
        pointerX = clamped.x;
        pointerY = clamped.y;
      },
      { passive: true }
    );

    global.addEventListener('pointerup', (e) => {
      if (!isAiming || (activePointerId !== null && e.pointerId !== activePointerId)) return;
      stopAiming(true);
    });

    global.addEventListener('pointercancel', (e) => {
      if (!isAiming || (activePointerId !== null && e.pointerId !== activePointerId)) return;
      stopAiming(false);
    });

    function isEditableElementFocused() {
      const active = document.activeElement;
      if (!active) return false;
      if (active.isContentEditable) return true;
      return ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName);
    }

    function isBoardVisible() {
      if (!dartWrapper || dartWrapper.offsetParent === null) return false;
      const rect = dartWrapper.getBoundingClientRect();
      const vh = global.innerHeight || document.documentElement.clientHeight;
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < vh;
    }

    // Klavye kısayolları:
    // - Yazı alanı odaktayken ÇALIŞMAZ
    // - Ok tuşları / Home / End sadece tahta odaktayken (role="slider") çalışır
    // - 1–9 ve 0 tuşları sadece tahta odaktayken veya ekranda görünürdeyken çalışır
    global.addEventListener('keydown', (e) => {
      if (isEditableElementFocused() || e.ctrlKey || e.altKey || e.metaKey) return;

      const isFocused = document.activeElement === dartWrapper;

      if (isFocused) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
          e.preventDefault();
          const nextVal = currentScore === null ? 1 : Math.min(10, currentScore + 1);
          throwDartAtRing(nextVal);
          return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
          e.preventDefault();
          const prevVal = currentScore === null ? 1 : Math.max(1, currentScore - 1);
          throwDartAtRing(prevVal);
          return;
        }
        if (e.key === 'Home') {
          e.preventDefault();
          throwDartAtRing(1);
          return;
        }
        if (e.key === 'End') {
          e.preventDefault();
          throwDartAtRing(10);
          return;
        }
      }

      if (!isFocused && !isBoardVisible()) return;

      if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        throwDartAtRing(parseInt(e.key, 10));
      } else if (e.key === '0') {
        e.preventDefault();
        throwDartAtRing(10);
      }
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        dartWrapper.querySelectorAll('.dart-pin').forEach((p) => p.remove());
        setPowerUI(0);
        updateScoreUI(null);
      });
    }

    // Açılışta kesinlikle "Puan verilmedi" (– / 10, boş yıldızlar) durumu
    updateScoreUI(null);
    setPowerUI(0);
  }

  // ============================================================================
  // 4. ⛵ FLOATING DOCK: SOL MENÜ YAYLI ANİMASYONLARI (#appSidebar)
  // ============================================================================
  function initFloatingDock() {
    const appSidebar = document.getElementById('appSidebar');
    const sidebarNav = appSidebar ? appSidebar.querySelector('.sidebar-nav') : null;
    if (!appSidebar || !sidebarNav) return;

    document.body.classList.add('dock-enhanced');

    const links = Array.from(sidebarNav.querySelectorAll('.sidebar-link'));
    const menuItems = Array.from(sidebarNav.querySelectorAll('.sidebar-menu-item'));
    const activeLink = sidebarNav.querySelector('.sidebar-link.active');

    // Mobil çekmece sırayla yaylanma indeksi
    menuItems.forEach((item, index) => {
      item.style.setProperty('--dock-stagger-index', String(index));
    });

    // Sağ tarafta kırpılmayan (unclipped) Floating Dock etiketi
    const dockTooltip = document.createElement('div');
    dockTooltip.id = 'sidebarDockTooltip';
    dockTooltip.className = 'sidebar-dock-tooltip';
    dockTooltip.setAttribute('role', 'tooltip');
    dockTooltip.setAttribute('aria-hidden', 'true');
    document.body.appendChild(dockTooltip);

    const dockDot = document.getElementById('sidebarDockDot');

    function isCollapsedDesktop() {
      return (
        global.innerWidth >= 1024 &&
        document.documentElement.getAttribute('data-sidebar') === 'collapsed'
      );
    }

    function showTooltipFor(link) {
      if (!link || !isCollapsedDesktop()) {
        hideTooltip();
        return;
      }
      const labelText = link.getAttribute('data-tooltip') || '';
      if (!labelText) return;
      const rect = link.getBoundingClientRect();
      dockTooltip.textContent = labelText;
      dockTooltip.style.left = `${Math.round(rect.right + 14)}px`;
      dockTooltip.style.top = `${Math.round(rect.top + rect.height / 2)}px`;
      dockTooltip.classList.add('is-visible');
      dockTooltip.setAttribute('aria-hidden', 'false');
    }

    function hideTooltip() {
      dockTooltip.classList.remove('is-visible');
      dockTooltip.setAttribute('aria-hidden', 'true');
    }

    // Sayfa geçişlerinde aktif göstergenin ("running dot") yumuşakça yeni öğeye kayması ve ikon zıplaması
    function syncActiveDot(animateFromPrevious) {
      if (!dockDot || !activeLink) {
        if (dockDot) dockDot.classList.remove('is-visible');
        return;
      }

      const navRect = sidebarNav.getBoundingClientRect();
      const linkRect = activeLink.getBoundingClientRect();
      const targetY = isCollapsedDesktop()
        ? Math.round(linkRect.bottom - navRect.top + sidebarNav.scrollTop - 6)
        : Math.round(linkRect.top - navRect.top + sidebarNav.scrollTop + linkRect.height / 2 - 3);

      let prevY = null;
      let bouncedPath = null;
      try {
        const storedPrev = global.sessionStorage.getItem('piyade_dock_prev_y');
        bouncedPath = global.sessionStorage.getItem('piyade_dock_bounced');
        global.sessionStorage.removeItem('piyade_dock_prev_y');
        global.sessionStorage.removeItem('piyade_dock_bounced');
        if (storedPrev !== null) {
          const parsed = parseFloat(storedPrev);
          if (!Number.isNaN(parsed)) prevY = parsed;
        }
      } catch (_) {}

      dockDot.classList.add('is-visible');

      if (animateFromPrevious && prevY !== null && !prefersReducedMotion()) {
        const dotSpring = createSpring({
          stiffness: 340,
          damping: 26,
          mass: 0.9,
          initialValue: prevY,
        });
        dotSpring.setTarget(targetY);

        let lastT = performance.now();
        function stepDot(now) {
          const dt = Math.min(0.032, (now - lastT) / 1000);
          lastT = now;
          const y = dotSpring.step(dt);
          dockDot.style.top = `${y.toFixed(2)}px`;
          if (!dotSpring.isSettled()) {
            global.requestAnimationFrame(stepDot);
          }
        }
        dockDot.style.top = `${prevY}px`;
        global.requestAnimationFrame(stepDot);
      } else {
        dockDot.style.top = `${targetY}px`;
      }

      if (bouncedPath && bouncedPath === global.location.pathname && !prefersReducedMotion()) {
        activeLink.classList.remove('is-bouncing');
        void activeLink.offsetWidth;
        activeLink.classList.add('is-bouncing');
      }
    }

    syncActiveDot(true);

    // Her bağlantı için yay sürücüleri
    const itemPhysics = links.map((link) => ({
      link,
      scaleSpring: createSpring({ stiffness: 360, damping: 24, mass: 0.78, initialValue: 1 }),
      pushSpring: createSpring({ stiffness: 340, damping: 24, mass: 0.85, initialValue: 0 }),
      gapSpring: createSpring({ stiffness: 340, damping: 24, mass: 0.85, initialValue: 0 }),
      shiftSpring: createSpring({ stiffness: 360, damping: 25, mass: 0.8, initialValue: 0 }),
    }));

    let dockRafId = null;
    let dockLastTime = 0;
    let pointerInsideNav = false;
    let pointerY = 0;
    let focusedLink = null;
    let lastInteractionTouch = isTouchDevice();

    function applyDockTargets() {
      const reduced = prefersReducedMotion();
      const desktop = global.innerWidth >= 1024;
      const collapsed = isCollapsedDesktop();

      if (reduced || !desktop || lastInteractionTouch) {
        for (const p of itemPhysics) {
          p.scaleSpring.setTarget(1);
          p.pushSpring.setTarget(0);
          p.gapSpring.setTarget(0);
          p.shiftSpring.setTarget(0);
        }
        return;
      }

      // İmleç yaklaşınca mesafeye göre yaylanan değerler hesapla
      const metrics = itemPhysics.map((p) => {
        const rect = p.link.getBoundingClientRect();
        return {
          p,
          centerY: rect.top + rect.height / 2,
        };
      });

      const PROXIMITY_RADIUS = 132;

      for (const m of metrics) {
        let influence = 0;
        let signedDir = 0;

        if (pointerInsideNav) {
          const dy = m.centerY - pointerY;
          const dist = Math.abs(dy);
          if (dist < PROXIMITY_RADIUS) {
            const c = Math.cos((dist / PROXIMITY_RADIUS) * (Math.PI / 2));
            influence = c * c;
            signedDir = dist < 4 ? 0 : Math.sign(dy);
          }
        } else if (focusedLink === m.p.link) {
          influence = 0.88;
          signedDir = 0;
        }

        if (collapsed) {
          // Daraltılmış 72px menü: dikey macOS Dock (büyüme + komşuları yaylanarak itme)
          m.p.scaleSpring.setTarget(1 + influence * 0.5);
          m.p.gapSpring.setTarget(influence * 6);
          m.p.pushSpring.setTarget(signedDir * (1 - influence) * (pointerInsideNav ? 5 : 0));
          m.p.shiftSpring.setTarget(0);
        } else {
          // Açık 260px menü: yazılar okunur kalsın; sadece ikon büyüsün, satır hafif sağa kaysın
          m.p.scaleSpring.setTarget(1 + influence * 0.28);
          m.p.shiftSpring.setTarget(influence * 6.5);
          m.p.gapSpring.setTarget(0);
          m.p.pushSpring.setTarget(0);
        }
      }
    }

    function stepDockAnimation(now) {
      if (!dockLastTime) dockLastTime = now;
      const dt = Math.min(0.032, (now - dockLastTime) / 1000);
      dockLastTime = now;

      applyDockTargets();

      let allSettled = true;
      for (const p of itemPhysics) {
        const scale = p.scaleSpring.step(dt);
        const pushY = p.pushSpring.step(dt);
        const gapY = p.gapSpring.step(dt);
        const shiftX = p.shiftSpring.step(dt);

        p.link.style.setProperty('--dock-scale', scale.toFixed(4));
        p.link.style.setProperty('--dock-push-y', `${pushY.toFixed(2)}px`);
        p.link.style.setProperty('--dock-neighbor-gap', `${gapY.toFixed(2)}px`);
        p.link.style.setProperty('--dock-row-shift-x', `${shiftX.toFixed(2)}px`);

        if (
          !p.scaleSpring.isSettled() ||
          !p.pushSpring.isSettled() ||
          !p.gapSpring.isSettled() ||
          !p.shiftSpring.isSettled()
        ) {
          allSettled = false;
        }
      }

      if (!allSettled || pointerInsideNav) {
        dockRafId = global.requestAnimationFrame(stepDockAnimation);
      } else {
        dockRafId = null;
      }
    }

    function kickDockAnimation() {
      if (!dockRafId) {
        dockLastTime = 0;
        dockRafId = global.requestAnimationFrame(stepDockAnimation);
      }
    }

    sidebarNav.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType === 'touch') {
          lastInteractionTouch = true;
          return;
        }
        lastInteractionTouch = false;
        pointerInsideNav = true;
        pointerY = e.clientY;
        kickDockAnimation();
      },
      { passive: true }
    );

    sidebarNav.addEventListener('pointerleave', () => {
      pointerInsideNav = false;
      hideTooltip();
      kickDockAnimation();
    });

    links.forEach((link) => {
      link.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'touch' || prefersReducedMotion()) return;
        showTooltipFor(link);
      });

      link.addEventListener('focusin', () => {
        focusedLink = link;
        if (!prefersReducedMotion()) {
          showTooltipFor(link);
          kickDockAnimation();
        }
      });

      link.addEventListener('focusout', () => {
        if (focusedLink === link) focusedLink = null;
        hideTooltip();
        kickDockAnimation();
      });

      // Tıklamada ikon zıplaması + aktif nokta konumu kaydı
      link.addEventListener('click', () => {
        if (!prefersReducedMotion()) {
          link.classList.remove('is-bouncing');
          void link.offsetWidth;
          link.classList.add('is-bouncing');
        }
        hideTooltip();
        try {
          if (dockDot) {
            global.sessionStorage.setItem('piyade_dock_prev_y', dockDot.style.top || '0');
          }
          const href = link.getAttribute('href');
          if (href) {
            global.sessionStorage.setItem('piyade_dock_bounced', href);
          }
        } catch (_) {}
      });
    });

    const observer = new MutationObserver(() => {
      hideTooltip();
      setTimeout(() => syncActiveDot(false), 180);
      kickDockAnimation();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-sidebar', 'data-mobile-sidebar'],
    });

    global.addEventListener(
      'resize',
      () => {
        hideTooltip();
        syncActiveDot(false);
      },
      { passive: true }
    );
  }

  // ============================================================================
  // 5. 🪐 ORBITAL LOADER (UYARI VER KANIT DOSYASI YÜKLEME YÖNETİCİSİ)
  // ============================================================================
  function initOrbitalWarnUpload() {
    const form = document.getElementById('warnForm');
    const fileInput = document.getElementById('evidenceFile');
    const overlay = document.getElementById('orbitalLoaderOverlay');
    if (!form || !fileInput || !overlay) return;

    const cometPath = overlay.querySelector('.orbital-loader-comet');
    const progressCircle = overlay.querySelector('.orbital-loader-progress');
    const percentEl = overlay.querySelector('.orbital-loader-percent');
    const statusTextEl = overlay.querySelector('.orbital-loader-text');
    const subtextEl = overlay.querySelector('.orbital-loader-subtext');
    const closeBtn = overlay.querySelector('.orbital-loader-close-btn');

    const CIRCUMFERENCE = 2 * Math.PI * 46; // r = 46 -> ~289.03
    if (progressCircle) {
      progressCircle.style.strokeDasharray = `${CIRCUMFERENCE} ${CIRCUMFERENCE}`;
      progressCircle.style.strokeDashoffset = String(CIRCUMFERENCE);
    }

    const i18n = safeParseJson(overlay.getAttribute('data-loader-i18n'), {
      uploading: 'Kanıt yükleniyor…',
      delivering: "Kanıt Discord'a iletiliyor…",
      success: 'Uyarı ve kanıt başarıyla iletildi!',
      errorTitle: 'Yükleme Başarısız',
      timeout: 'İstek zaman aşımına uğradı. Lütfen tekrar deneyiniz.',
      networkError: 'Ağ hatası oluştu. Sunucuya ulaşılamadı.',
    });

    let cometRafId = null;
    let cometPhase = 0;
    let loaderActive = false;
    let currentMode = 'idle'; // 'progress' | 'indeterminate' | 'success' | 'error'
    let watchdogTimer = null;

    function polarPoint(cx, cy, r, rad) {
      return {
        x: cx + Math.cos(rad) * r,
        y: cy + Math.sin(rad) * r,
      };
    }

    // Tek halka üzerinde hızlanıp yavaşlayan, kuyruğu dinamik uzayıp kısalan kuyruklu yıldız
    function stepComet(now) {
      if (!loaderActive || currentMode === 'success' || currentMode === 'error' || prefersReducedMotion()) {
        cometRafId = null;
        return;
      }

      cometPhase = (now / 1000) * 1.45;
      // Her turda hızlanıp yavaşlayan açı ve hızlı uzayıp kısalan kuyruk
      const cycle = cometPhase * Math.PI * 2;
      const headAngle = cycle + 0.48 * Math.sin(cycle);
      const speedDerivative = 1 + 0.48 * Math.cos(cycle);
      const tailRadians = Math.max(0.45, Math.min(2.1, 0.72 + 0.65 * speedDerivative));
      const tailAngle = headAngle - tailRadians;

      const startPt = polarPoint(60, 60, 46, tailAngle);
      const endPt = polarPoint(60, 60, 46, headAngle);
      const largeArc = tailRadians > Math.PI ? 1 : 0;

      if (cometPath) {
        cometPath.setAttribute(
          'd',
          `M ${startPt.x.toFixed(2)} ${startPt.y.toFixed(2)} A 46 46 0 ${largeArc} 1 ${endPt.x.toFixed(2)} ${endPt.y.toFixed(2)}`
        );
      }

      cometRafId = global.requestAnimationFrame(stepComet);
    }

    function setProgress(pct) {
      currentMode = 'progress';
      overlay.classList.remove('is-indeterminate', 'is-success', 'is-error');
      const clamped = Math.max(0, Math.min(100, Math.round(pct)));
      if (progressCircle) {
        const offset = CIRCUMFERENCE * (1 - clamped / 100);
        progressCircle.style.strokeDashoffset = offset.toFixed(2);
      }
      if (percentEl) percentEl.textContent = `%${clamped}`;
      if (statusTextEl) statusTextEl.textContent = i18n.uploading;
      if (subtextEl) subtextEl.textContent = '';
    }

    function setIndeterminateDelivering() {
      currentMode = 'indeterminate';
      overlay.classList.add('is-indeterminate');
      overlay.classList.remove('is-success', 'is-error');
      if (progressCircle) {
        progressCircle.style.strokeDashoffset = String(CIRCUMFERENCE);
      }
      if (statusTextEl) statusTextEl.textContent = i18n.delivering;
      if (subtextEl) subtextEl.textContent = '';
    }

    function setSuccessState() {
      currentMode = 'success';
      overlay.classList.remove('is-indeterminate', 'is-error');
      overlay.classList.add('is-success');
      if (progressCircle) {
        progressCircle.style.strokeDashoffset = '0';
      }
      if (statusTextEl) statusTextEl.textContent = i18n.success;
      if (subtextEl) subtextEl.textContent = '';
    }

    function setErrorState(errorMsg) {
      currentMode = 'error';
      overlay.classList.remove('is-indeterminate', 'is-success');
      overlay.classList.add('is-error');
      if (progressCircle) {
        progressCircle.style.strokeDashoffset = '0';
      }
      if (statusTextEl) statusTextEl.textContent = i18n.errorTitle;
      if (subtextEl) subtextEl.textContent = errorMsg || i18n.networkError;
      if (closeBtn) {
        closeBtn.hidden = false;
        closeBtn.focus();
      }
    }

    function openLoader() {
      loaderActive = true;
      overlay.hidden = false;
      overlay.setAttribute('aria-hidden', 'false');
      if (closeBtn) closeBtn.hidden = true;
      setProgress(0);
      global.requestAnimationFrame(() => {
        overlay.classList.add('is-open');
      });
      if (!prefersReducedMotion() && !cometRafId) {
        cometRafId = global.requestAnimationFrame(stepComet);
      }
    }

    function closeLoader() {
      loaderActive = false;
      clearTimeout(watchdogTimer);
      if (cometRafId) {
        global.cancelAnimationFrame(cometRafId);
        cometRafId = null;
      }
      overlay.classList.remove('is-open', 'is-success', 'is-error', 'is-indeterminate');
      overlay.setAttribute('aria-hidden', 'true');
      setTimeout(() => {
        if (!loaderActive) overlay.hidden = true;
      }, 220);
    }

    function unlockForm(newIdempotencyKey) {
      form.dataset.submitted = 'false';
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.style.opacity = '';
        submitBtn.style.cursor = '';
        const originalText = submitBtn.getAttribute('data-original-text');
        if (originalText) {
          const spanEl = submitBtn.querySelector('span');
          if (spanEl) spanEl.textContent = originalText;
          else submitBtn.textContent = originalText;
        }
      }

      if (newIdempotencyKey) {
        applyIdempotencyKey(newIdempotencyKey);
      } else {
        // Sunucudan yeni tek kullanımlık idempotency anahtarı istemeyi dene
        fetch('/yonetim/api/idempotency-key', {
          headers: { Accept: 'application/json' },
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data && data.idempotencyKey) {
              applyIdempotencyKey(data.idempotencyKey);
            }
          })
          .catch(() => {});
      }
    }

    function applyIdempotencyKey(key) {
      const hiddenKeyInput = form.querySelector('input[name="_idempotencyKey"]');
      if (hiddenKeyInput) hiddenKeyInput.value = key;
      try {
        const urlObj = new URL(form.action, global.location.origin);
        urlObj.searchParams.set('_idempotencyKey', key);
        form.action = `${urlObj.pathname}${urlObj.search}`;
      } catch (_) {}
    }

    function showInlineErrorAlert(msg) {
      let alertBox = document.getElementById('warnAjaxErrorAlert');
      if (!alertBox) {
        alertBox = document.createElement('div');
        alertBox.id = 'warnAjaxErrorAlert';
        alertBox.className = 'alert alert-danger';
        alertBox.setAttribute('role', 'alert');
        const cardContainer = form.parentElement;
        const outerContainer =
          cardContainer && cardContainer.parentElement ? cardContainer.parentElement : null;
        if (outerContainer) {
          outerContainer.insertBefore(alertBox, cardContainer);
        } else if (cardContainer) {
          cardContainer.insertBefore(alertBox, form);
        }
      }
      alertBox.innerHTML = '';
      const iconSpan = document.createElement('span');
      iconSpan.textContent = '🛑';
      const msgDiv = document.createElement('div');
      msgDiv.textContent = msg;
      alertBox.appendChild(iconSpan);
      alertBox.appendChild(msgDiv);
      if (typeof alertBox.scrollIntoView === 'function') {
        alertBox.scrollIntoView({
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          block: 'center',
        });
      }
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        closeLoader();
      });
    }

    // Orijinal buton metnini sakla (hata durumunda geri dönülebilsin)
    const submitBtnInit = form.querySelector('button[type="submit"]');
    if (submitBtnInit) {
      submitBtnInit.setAttribute('data-original-text', submitBtnInit.textContent.trim());
    }

    // Capture fazında yakalayarak yalnızca kanıt dosyası seçilmişse Orbital Loader + XHR akışını başlat
    form.addEventListener(
      'submit',
      (e) => {
        const hasFile = Boolean(fileInput.files && fileInput.files.length > 0);
        if (!hasFile) {
          // Kanıt dosyası yoksa mevcut standart form gönderimi çalışır, loader ÇIKMAZ
          return;
        }

        e.preventDefault();
        e.stopImmediatePropagation();

        if (form.dataset.submitted === 'true') {
          return;
        }

        const confirmMsg = form.getAttribute('data-confirm');
        if (confirmMsg && !global.confirm(confirmMsg)) {
          return;
        }

        form.dataset.submitted = 'true';
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.style.opacity = '0.65';
          submitBtn.style.cursor = 'not-allowed';
          const submittingText = submitBtn.getAttribute('data-submitting-text');
          if (submittingText) submitBtn.textContent = submittingText;
        }

        const oldAlert = document.getElementById('warnAjaxErrorAlert');
        if (oldAlert) oldAlert.remove();

        const formData = new FormData(form);
        const csrfTokenInput = form.querySelector('input[name="_csrf"]');
        const csrfToken = csrfTokenInput ? csrfTokenInput.value : '';
        const idemInput = form.querySelector('input[name="_idempotencyKey"]');
        const idemKey = idemInput ? idemInput.value : '';

        openLoader();

        const xhr = new XMLHttpRequest();
        xhr.open('POST', form.getAttribute('action') || '/yonetim/uyari', true);
        xhr.timeout = 25000;
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
        if (csrfToken) {
          xhr.setRequestHeader('x-csrf-token', csrfToken);
        }
        if (idemKey) {
          xhr.setRequestHeader('x-idempotency-key', idemKey);
        }

        let settled = false;
        watchdogTimer = global.setTimeout(() => {
          if (settled) return;
          settled = true;
          try {
            xhr.abort();
          } catch (_) {}
          setErrorState(i18n.timeout);
          unlockForm(null);
        }, 28000);

        xhr.upload.addEventListener('progress', (ev) => {
          if (!ev.lengthComputable || settled) return;
          const pct = Math.min(99, Math.round((ev.loaded / Math.max(1, ev.total)) * 100));
          setProgress(pct);
        });

        xhr.upload.addEventListener('load', () => {
          if (settled) return;
          // Yükleme %100 oldu -> Bot API / Discord'a iletilirken sonsuz dönen aşamaya geç
          setIndeterminateDelivering();
        });

        xhr.addEventListener('load', () => {
          if (settled) return;
          settled = true;
          clearTimeout(watchdogTimer);

          const parsed = safeParseJson(xhr.responseText, null);

          if (xhr.status >= 200 && xhr.status < 300 && parsed && parsed.success) {
            setSuccessState();
            const delayMs = prefersReducedMotion() ? 250 : 780;
            global.setTimeout(() => {
              // PRG yönlendirmesi: sayfa yenilense bile form tekrar gönderilmez
              global.location.replace(parsed.redirectUrl || '/yonetim/uyari');
            }, delayMs);
            return;
          }

          const errMessage =
            (parsed && parsed.error) ||
            `${i18n.errorTitle} (HTTP ${xhr.status || 500})`;
          const freshKey = parsed && parsed.newIdempotencyKey ? parsed.newIdempotencyKey : null;
          setErrorState(errMessage);
          const sessionInvalid =
            xhr.status === 401 ||
            (parsed && (parsed.code === 'SESSION_EXPIRED' || parsed.code === 'PERMISSION_REVOKED' || parsed.code === 'NOT_IN_GUILD'));
          if (!sessionInvalid) {
            unlockForm(freshKey);
          }
          showInlineErrorAlert(errMessage);
        });

        xhr.addEventListener('error', () => {
          if (settled) return;
          settled = true;
          clearTimeout(watchdogTimer);
          setErrorState(i18n.networkError);
          unlockForm(null);
          showInlineErrorAlert(i18n.networkError);
        });

        xhr.addEventListener('timeout', () => {
          if (settled) return;
          settled = true;
          clearTimeout(watchdogTimer);
          setErrorState(i18n.timeout);
          unlockForm(null);
          showInlineErrorAlert(i18n.timeout);
        });

        xhr.send(formData);
      },
      true
    );
  }

  document.addEventListener('DOMContentLoaded', () => {
    initAllMeteors();
    initScrollReveal();
    initDartRating();
    initFloatingDock();
    initOrbitalWarnUpload();
  });
})(window);
