/**
 * ==============================================================================
 * 🌟 NEXUS UI BAĞIMSIZ VANİLLA JS BİLEŞENLERİ (REACT / TAILWIND / CDN YOK)
 * ==============================================================================
 * 1) Meteors      : Tek Canvas katmanı, imleç çekimi, tıklama/dokunma meteor + kıvılcım halkası
 * 2) Dart Rating  : Bas-tut nişan alma, artan titreme, güç çubuğu, tek dart yaylanma, ARIA slider
 * 3) ScrollReveal : Tek sınıf (.is-revealed), reduced-motion uyumlu bulanıklıktan netliğe geçiş
 * 4) FloatingDock : Giriş sonrası sol menü için yaylı macOS dock + mobil kademeli giriş
 * 5) OrbitalLoader: Uyarı Formunda yalnızca kanıt dosyası seçiliyken gerçek % yükleme halkası
 *
 * Tüm renkler yalnızca public/css/theme.css içindeki mor tema değişkenlerinden okunur.
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

  function hasFinePointer() {
    if (typeof global.matchMedia !== 'function') return true;
    return global.matchMedia('(hover: hover) and (pointer: fine)').matches;
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

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function randBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  // ============================================================================
  // YARDIMCI 1: KÜÇÜK YAYLANMA (SPRING) FİZİK MOTORU (Vanilla JS)
  // ============================================================================
  function createSpring(initialValue = 0, options = {}) {
    return {
      value: initialValue,
      target: initialValue,
      velocity: 0,
      stiffness: Number.isFinite(options.stiffness) ? options.stiffness : 340,
      damping: Number.isFinite(options.damping) ? options.damping : 24,
      mass: Number.isFinite(options.mass) ? options.mass : 0.85,
    };
  }

  function stepSpring(spring, dt) {
    const displacement = spring.value - spring.target;
    const force = -spring.stiffness * displacement - spring.damping * spring.velocity;
    const acceleration = force / spring.mass;
    spring.velocity += acceleration * dt;
    spring.value += spring.velocity * dt;

    const settled =
      Math.abs(spring.velocity) < 0.002 && Math.abs(spring.target - spring.value) < 0.002;
    if (settled) {
      spring.value = spring.target;
      spring.velocity = 0;
    }
    return !settled;
  }

  // ============================================================================
  // YARDIMCI 2: THEME.CSS DEĞİŞKENLERİNDEN CANVAS RENKLERİNİ ÇÖZÜMLEME
  // ============================================================================
  let colorProbeEl = null;

  function getColorProbe() {
    if (!colorProbeEl && document.body) {
      colorProbeEl = document.createElement('span');
      colorProbeEl.setAttribute('aria-hidden', 'true');
      colorProbeEl.style.position = 'fixed';
      colorProbeEl.style.visibility = 'hidden';
      colorProbeEl.style.pointerEvents = 'none';
      colorProbeEl.style.width = '0';
      colorProbeEl.style.height = '0';
      document.body.appendChild(colorProbeEl);
    }
    return colorProbeEl;
  }

  function resolveCssRgb(varName) {
    const probe = getColorProbe();
    if (!probe || !varName) return { r: 192, g: 132, b: 252, a: 1 };
    probe.style.color = '';
    probe.style.color = `var(${varName})`;
    const computed = global.getComputedStyle(probe).color;
    const nums = computed && computed.match(/[\d.]+/g);
    if (nums && nums.length >= 3) {
      return {
        r: Number(nums[0]),
        g: Number(nums[1]),
        b: Number(nums[2]),
        a: nums.length >= 4 ? Number(nums[3]) : 1,
      };
    }
    return { r: 192, g: 132, b: 252, a: 1 };
  }

  function rgbaStr(rgb, alphaMultiplier = 1) {
    const alpha = clamp((rgb.a ?? 1) * alphaMultiplier, 0, 1);
    return `rgba(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}, ${alpha.toFixed(3)})`;
  }

  // ============================================================================
  // 1) METEORS BİLEŞENİ (Tek Canvas Katmanı, İmleç Çekimi, Tıklama Kıvılcımı)
  // ============================================================================
  function initMeteors() {
    const containers = document.querySelectorAll('#meteorsContainer, .meteors-container');
    if (!containers.length) return;

    const defaults = {
      number: 18,
      intensity: 'medium',
      intensityMultipliers: { low: 0.65, medium: 1, high: 1.45 },
      maxCount: 72,
      mobileFactor: 0.55,
      angle: 215,
      minDelay: 0.12,
      maxDelay: 2.4,
      minDuration: 3.2,
      maxDuration: 7.2,
      glow: true,
      colorVar: '--meteor-color',
      coreColorVar: '--meteor-core-color',
      sparkColorVar: '--meteor-spark-color',
      glowColorVar: '--meteor-glow-color',
      starColorVar: '--meteor-star-color',
      hoverOnly: false,
      interactive: true,
      stars: 0,
      autoplay: false,
    };

    containers.forEach((container) => {
      if (container.dataset.meteorsInit === 'true') return;
      container.dataset.meteorsInit = 'true';

      const userCfg = parseJsonAttr(container, 'data-meteors-config', {});
      const cfg = Object.assign({}, defaults, userCfg);
      cfg.intensityMultipliers = Object.assign(
        {},
        defaults.intensityMultipliers,
        userCfg.intensityMultipliers || {}
      );

      // Canvas dışında yalnızca üst başlık overlay öğesini koru
      Array.from(container.children).forEach((child) => {
        if (!child.classList.contains('meteors-overlay')) {
          child.remove();
        }
      });

      const canvas = document.createElement('canvas');
      canvas.className = 'meteors-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      container.insertBefore(canvas, container.firstChild);

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Tema renklerini theme.css'ten çöz
      let palette = {
        meteor: resolveCssRgb(cfg.colorVar),
        core: resolveCssRgb(cfg.coreColorVar),
        spark: resolveCssRgb(cfg.sparkColorVar),
        glow: resolveCssRgb(cfg.glowColorVar),
        star: resolveCssRgb(cfg.starColorVar),
      };

      const rad = (Number(cfg.angle || 215) * Math.PI) / 180;
      // Ekran koordinatı (X sağ, Y aşağı) için sağdan saat yönünün tersine açı
      const dirX = Math.cos(rad);
      const dirY = -Math.sin(rad);

      let width = 1;
      let height = 1;
      let dpr = 1;
      let rafId = null;
      let lastTs = 0;
      let elapsedSec = 0;
      let isInViewport = true;
      let isHovered = false;

      const pointer = {
        active: false,
        x: 0,
        y: 0,
      };

      let ambientMeteors = [];
      let calledMeteors = [];
      let sparks = [];
      let shockwaves = [];
      let bgStars = [];

      function getTargetCount() {
        const mult =
          (cfg.intensityMultipliers && cfg.intensityMultipliers[cfg.intensity]) || 1;
        let base = Math.min(cfg.maxCount || 72, Math.round((cfg.number || 18) * mult));
        if (width < 640 || !hasFinePointer()) {
          base = Math.max(5, Math.round(base * (cfg.mobileFactor || 0.55)));
        }
        return clamp(base, 1, cfg.maxCount || 72);
      }

      function createBgStars() {
        const count = Math.max(0, Math.round(Number(cfg.stars) || 0));
        bgStars = [];
        for (let i = 0; i < count; i++) {
          bgStars.push({
            x: Math.random() * width,
            y: Math.random() * height,
            radius: randBetween(0.6, 1.6),
            phase: randBetween(0, Math.PI * 2),
            speed: randBetween(0.8, 2.4),
            baseAlpha: randBetween(0.15, 0.55),
          });
        }
      }

      function spawnAmbientMeteor(staggerInitially = false) {
        const margin = 90;
        const spanX = width + margin * 2;
        const spanY = height + margin * 2;

        // Hareket yönüne göre giriş kenarından doğur
        let startX;
        let startY;
        const pickHorizontalEdge = Math.random() < 0.65;
        if (pickHorizontalEdge) {
          startX = randBetween(-margin * 0.4, width + margin);
          startY = dirY >= 0 ? randBetween(-margin, 10) : randBetween(height - 10, height + margin);
        } else {
          startX = dirX <= 0 ? randBetween(width - 10, width + margin) : randBetween(-margin, 10);
          startY = randBetween(-margin * 0.4, height + margin * 0.6);
        }

        const duration = randBetween(cfg.minDuration, cfg.maxDuration);
        const travelDist = Math.hypot(spanX, spanY) * randBetween(0.55, 0.95);
        const baseSpeed = travelDist / duration;

        return {
          x: startX,
          y: startY,
          vx: dirX * baseSpeed,
          vy: dirY * baseSpeed,
          baseSpeed,
          age: staggerInitially ? -randBetween(0, cfg.maxDelay * 0.6) : -randBetween(cfg.minDelay, cfg.maxDelay),
          duration,
          thickness: randBetween(1.3, 2.5),
          maxTrail: Math.round(randBetween(12, 22)),
          trail: [],
          opacityScale: randBetween(0.55, 1),
        };
      }

      function syncMeteorPool(initial = false) {
        const target = getTargetCount();
        while (ambientMeteors.length < target) {
          ambientMeteors.push(spawnAmbientMeteor(initial));
        }
        if (ambientMeteors.length > target) {
          ambientMeteors.length = target;
        }
      }

      function spawnSparkRing(x, y) {
        shockwaves.push({
          x,
          y,
          radius: 4,
          maxRadius: randBetween(34, 52),
          age: 0,
          duration: 0.52,
        });

        const count = 18;
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 + randBetween(-0.18, 0.18);
          const speed = randBetween(55, 165);
          sparks.push({
            x,
            y,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            size: randBetween(1.1, 2.4),
            age: 0,
            life: randBetween(0.32, 0.62),
          });
        }
      }

      function spawnCalledMeteor(targetX, targetY) {
        if (!cfg.interactive) return;
        const speed = 960;
        const distBack = Math.max(width, height) * 0.65 + 120;
        const startX = targetX - dirX * distBack;
        const startY = targetY - dirY * distBack;

        calledMeteors.push({
          x: startX,
          y: startY,
          targetX,
          targetY,
          vx: dirX * speed,
          vy: dirY * speed,
          speed,
          distRemaining: distBack,
          trail: [],
          thickness: 2.8,
        });
      }

      function updateCanvasSize() {
        const rect = container.getBoundingClientRect();
        width = Math.max(1, Math.round(rect.width));
        height = Math.max(1, Math.round(rect.height));
        dpr = Math.min(global.devicePixelRatio || 1, 2);

        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        syncMeteorPool(false);
        createBgStars();

        if (prefersReducedMotion()) {
          drawReducedMotionSnapshot();
        }
      }

      function drawTaperedTrail(trail, headX, headY, alpha, thickness, isSparkHighlight) {
        const points = trail.concat([{ x: headX, y: headY }]);
        if (points.length < 2) return;

        const baseRgb = isSparkHighlight ? palette.spark : palette.meteor;
        const segments = points.length - 1;

        for (let i = 0; i < segments; i++) {
          const p0 = points[i];
          const p1 = points[i + 1];
          const t = (i + 1) / segments; // 0 kuyruk ucu -> 1 kafa
          const segAlpha = alpha * Math.pow(t, 1.75) * 0.92;
          const segWidth = Math.max(0.3, thickness * Math.pow(t, 1.25));

          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.strokeStyle = rgbaStr(baseRgb, segAlpha);
          ctx.lineWidth = segWidth;
          ctx.lineCap = 'round';
          ctx.stroke();
        }

        // Parlak kafa noktası ve parlama (glow)
        ctx.save();
        if (cfg.glow) {
          ctx.shadowColor = rgbaStr(palette.glow, alpha * 0.95);
          ctx.shadowBlur = isSparkHighlight ? 14 : 9;
        }
        ctx.beginPath();
        ctx.arc(headX, headY, thickness * 0.85, 0, Math.PI * 2);
        ctx.fillStyle = rgbaStr(palette.core, alpha);
        ctx.fill();
        ctx.restore();
      }

      function drawReducedMotionSnapshot() {
        ctx.clearRect(0, 0, width, height);

        // Soluk sabit arka plan yıldızları (stars > 0 ise)
        for (const s of bgStars) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
          ctx.fillStyle = rgbaStr(palette.star, s.baseAlpha);
          ctx.fill();
        }

        // prefers-reduced-motion: hareket etmeyen soluk sabit meteor çizgileri
        const staticCount = Math.min(12, getTargetCount());
        const trailLen = 78;
        for (let i = 0; i < staticCount; i++) {
          const ratioX = ((i * 37 + 19) % 100) / 100;
          const ratioY = ((i * 53 + 11) % 100) / 100;
          const hx = width * (0.1 + ratioX * 0.8);
          const hy = height * (0.12 + ratioY * 0.76);
          const tx = hx - dirX * trailLen;
          const ty = hy - dirY * trailLen;

          const grad = ctx.createLinearGradient(tx, ty, hx, hy);
          grad.addColorStop(0, rgbaStr(palette.meteor, 0));
          grad.addColorStop(1, rgbaStr(palette.meteor, 0.28));

          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(hx, hy);
          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.4;
          ctx.lineCap = 'round';
          ctx.stroke();
        }
      }

      function stepSimulation(dt) {
        elapsedSec += dt;

        const runAmbient = !cfg.hoverOnly || isHovered;
        const attractRadius = 175;

        // 1. Ortam meteorları (yanarak belirir, hızlanır, imlece doğru bükülür)
        if (runAmbient) {
          for (let i = 0; i < ambientMeteors.length; i++) {
            const m = ambientMeteors[i];
            m.age += dt;
            if (m.age < 0) continue;

            if (m.age >= m.duration) {
              ambientMeteors[i] = spawnAmbientMeteor(false);
              continue;
            }

            const lifeT = clamp(m.age / m.duration, 0, 1);
            // Hızlanma eğrisi
            const accelFactor = 0.55 + Math.pow(lifeT, 1.35) * 1.45;
            let targetVx = dirX * m.baseSpeed * accelFactor;
            let targetVy = dirY * m.baseSpeed * accelFactor;

            // İmleç yakınsa meteorun rotasını imlece doğru bük (çekim)
            if (cfg.interactive && pointer.active) {
              const dx = pointer.x - m.x;
              const dy = pointer.y - m.y;
              const dist = Math.hypot(dx, dy);
              if (dist > 6 && dist < attractRadius) {
                const pull = Math.pow(1 - dist / attractRadius, 1.7) * 340;
                targetVx += (dx / dist) * pull;
                targetVy += (dy / dist) * pull;
              }
            }

            const steerBlend = clamp(dt * 7.5, 0, 1);
            m.vx = lerp(m.vx, targetVx, steerBlend);
            m.vy = lerp(m.vy, targetVy, steerBlend);

            m.trail.push({ x: m.x, y: m.y });
            if (m.trail.length > m.maxTrail) {
              m.trail.shift();
            }

            m.x += m.vx * dt;
            m.y += m.vy * dt;
          }
        }

        // 2. Tıklama / dokunma ile çağrılan meteorlar
        for (let i = calledMeteors.length - 1; i >= 0; i--) {
          const cm = calledMeteors[i];
          cm.trail.push({ x: cm.x, y: cm.y });
          if (cm.trail.length > 18) cm.trail.shift();

          const step = cm.speed * dt;
          if (step >= cm.distRemaining) {
            spawnSparkRing(cm.targetX, cm.targetY);
            calledMeteors.splice(i, 1);
          } else {
            cm.x += cm.vx * dt;
            cm.y += cm.vy * dt;
            cm.distRemaining -= step;
          }
        }

        // 3. Çarpma halkaları ve kıvılcım parçacıkları
        for (let i = shockwaves.length - 1; i >= 0; i--) {
          const sw = shockwaves[i];
          sw.age += dt;
          if (sw.age >= sw.duration) {
            shockwaves.splice(i, 1);
          }
        }

        for (let i = sparks.length - 1; i >= 0; i--) {
          const sp = sparks[i];
          sp.age += dt;
          if (sp.age >= sp.life) {
            sparks.splice(i, 1);
            continue;
          }
          const drag = Math.pow(0.08, dt);
          sp.vx *= drag;
          sp.vy *= drag;
          sp.x += sp.vx * dt;
          sp.y += sp.vy * dt;
        }
      }

      function renderFrame() {
        ctx.clearRect(0, 0, width, height);

        // Soluk yanıp sönen yıldızlar (stars > 0 ise)
        if (bgStars.length > 0) {
          for (const s of bgStars) {
            const twinkle = 0.55 + 0.45 * Math.sin(elapsedSec * s.speed + s.phase);
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
            ctx.fillStyle = rgbaStr(palette.star, s.baseAlpha * twinkle);
            ctx.fill();
          }
        }

        const runAmbient = !cfg.hoverOnly || isHovered;
        if (runAmbient) {
          for (const m of ambientMeteors) {
            if (m.age < 0) continue;
            const lifeT = clamp(m.age / m.duration, 0, 1);
            const burnIn = smoothstep(0, 0.14, lifeT);
            const fadeOut = 1 - smoothstep(0.76, 1, lifeT);
            const alpha = burnIn * fadeOut * m.opacityScale;
            if (alpha <= 0.01) continue;
            drawTaperedTrail(m.trail, m.x, m.y, alpha, m.thickness, false);
          }
        }

        for (const cm of calledMeteors) {
          drawTaperedTrail(cm.trail, cm.x, cm.y, 1, cm.thickness, true);
        }

        for (const sw of shockwaves) {
          const t = clamp(sw.age / sw.duration, 0, 1);
          const eased = 1 - Math.pow(1 - t, 3);
          const radCur = lerp(4, sw.maxRadius, eased);
          const alpha = (1 - t) * 0.72;
          ctx.beginPath();
          ctx.arc(sw.x, sw.y, radCur, 0, Math.PI * 2);
          ctx.strokeStyle = rgbaStr(palette.spark, alpha);
          ctx.lineWidth = 2 * (1 - t) + 0.5;
          ctx.stroke();
        }

        for (const sp of sparks) {
          const t = clamp(sp.age / sp.life, 0, 1);
          const alpha = 1 - t;
          ctx.save();
          if (cfg.glow) {
            ctx.shadowColor = rgbaStr(palette.glow, alpha);
            ctx.shadowBlur = 7;
          }
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, sp.size * (1 - t * 0.4), 0, Math.PI * 2);
          ctx.fillStyle = rgbaStr(palette.core, alpha);
          ctx.fill();
          ctx.restore();
        }
      }

      function tick(ts) {
        if (!shouldAnimate()) {
          rafId = null;
          return;
        }
        if (!lastTs) lastTs = ts;
        const dt = clamp((ts - lastTs) / 1000, 0.001, 0.05);
        lastTs = ts;

        stepSimulation(dt);
        renderFrame();

        rafId = global.requestAnimationFrame(tick);
      }

      function shouldAnimate() {
        return (
          !prefersReducedMotion() &&
          document.visibilityState === 'visible' &&
          isInViewport
        );
      }

      function startLoop() {
        if (prefersReducedMotion()) {
          stopLoop();
          drawReducedMotionSnapshot();
          return;
        }
        if (rafId === null && shouldAnimate()) {
          lastTs = 0;
          rafId = global.requestAnimationFrame(tick);
        }
      }

      function stopLoop() {
        if (rafId !== null) {
          global.cancelAnimationFrame(rafId);
          rafId = null;
        }
      }

      // Etkileşim Olayları (İmleç çekimi + Tıklama/Dokunma Meteor Çağırma)
      if (cfg.interactive) {
        container.addEventListener('pointermove', (e) => {
          if (e.pointerType !== 'mouse') return;
          const rect = container.getBoundingClientRect();
          pointer.x = e.clientX - rect.left;
          pointer.y = e.clientY - rect.top;
          pointer.active = true;
        });

        container.addEventListener('pointerenter', (e) => {
          isHovered = true;
          if (e.pointerType === 'mouse') {
            const rect = container.getBoundingClientRect();
            pointer.x = e.clientX - rect.left;
            pointer.y = e.clientY - rect.top;
            pointer.active = true;
          }
        });

        container.addEventListener('pointerleave', () => {
          isHovered = false;
          pointer.active = false;
        });

        container.addEventListener('pointerdown', (e) => {
          const rect = container.getBoundingClientRect();
          const targetX = clamp(e.clientX - rect.left, 8, width - 8);
          const targetY = clamp(e.clientY - rect.top, 8, height - 8);
          if (prefersReducedMotion()) {
            // Reduced-motion modunda hareketli düşüş yerine sessiz kısa pırıltı halkası
            drawReducedMotionSnapshot();
            ctx.beginPath();
            ctx.arc(targetX, targetY, 16, 0, Math.PI * 2);
            ctx.strokeStyle = rgbaStr(palette.spark, 0.55);
            ctx.lineWidth = 2;
            ctx.stroke();
            return;
          }
          spawnCalledMeteor(targetX, targetY);
        });
      }

      // Sekme gizlenince / görünür olunca dur-başlat
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          stopLoop();
        } else {
          startLoop();
        }
      });

      // Ekranda görünürlük izleme (Viewport dışında GPU/CPU tasarrufu)
      if (typeof global.IntersectionObserver === 'function') {
        const observer = new global.IntersectionObserver(
          (entries) => {
            const entry = entries[0];
            isInViewport = Boolean(entry && entry.isIntersecting);
            if (isInViewport) startLoop();
            else stopLoop();
          },
          { threshold: 0.05 }
        );
        observer.observe(container);
      }

      // Konteyner boyutu değiştikçe Canvas'ı yeniden boyutlandır
      if (typeof global.ResizeObserver === 'function') {
        const ro = new global.ResizeObserver(() => updateCanvasSize());
        ro.observe(container);
      } else {
        global.addEventListener('resize', updateCanvasSize, { passive: true });
      }

      if (reducedMotionQuery && typeof reducedMotionQuery.addEventListener === 'function') {
        reducedMotionQuery.addEventListener('change', () => {
          if (prefersReducedMotion()) {
            stopLoop();
            drawReducedMotionSnapshot();
          } else {
            startLoop();
          }
        });
      }

      updateCanvasSize();
      syncMeteorPool(true);
      startLoop();
    });
  }

  // ============================================================================
  // 2) SCROLL REVEAL TEXT BİLEŞENİ (Tek Sınıf: .is-revealed)
  // ============================================================================
  function initScrollRevealText() {
    const scrollLines = Array.from(document.querySelectorAll('.scroll-reveal-line'));
    if (!scrollLines.length) return;

    function revealAllImmediately() {
      scrollLines.forEach((line) => {
        line.style.transitionDelay = '0ms';
        line.classList.add('is-revealed');
      });
    }

    if (prefersReducedMotion()) {
      revealAllImmediately();
      return;
    }

    function updateLineVisibility() {
      const windowHeight = global.innerHeight || document.documentElement.clientHeight;
      let revealIdx = 0;
      scrollLines.forEach((line) => {
        const rect = line.getBoundingClientRect();
        if (rect.top <= windowHeight * 0.88 && rect.bottom >= 0) {
          if (!line.classList.contains('is-revealed')) {
            line.style.transitionDelay = `${Math.min(revealIdx * 80, 240)}ms`;
            line.classList.add('is-revealed');
            revealIdx++;
          }
        } else if (rect.top > windowHeight * 1.05) {
          line.style.transitionDelay = '0ms';
          line.classList.remove('is-revealed');
        }
      });
    }

    if (typeof global.IntersectionObserver === 'function') {
      const io = new global.IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const idx = scrollLines.indexOf(entry.target);
              entry.target.style.transitionDelay = `${Math.max(0, idx) * 75}ms`;
              entry.target.classList.add('is-revealed');
            }
          });
        },
        { threshold: 0.12, rootMargin: '0px 0px -10% 0px' }
      );
      scrollLines.forEach((line) => io.observe(line));
    }

    global.addEventListener('scroll', updateLineVisibility, { passive: true });
    updateLineVisibility();

    if (reducedMotionQuery && typeof reducedMotionQuery.addEventListener === 'function') {
      reducedMotionQuery.addEventListener('change', () => {
        if (prefersReducedMotion()) {
          revealAllImmediately();
        }
      });
    }
  }

  // ============================================================================
  // 3) DART RATING BİLEŞENİ (ARIA Slider, Titreme, Güç Çubuğu, Tek Dart)
  // ============================================================================
  function initDartRating() {
    const widget = document.getElementById('dartRatingWidget');
    const dartWrapper = document.getElementById('dartboardWrapper');
    const reticle = document.getElementById('dartAimReticle');
    const powerFill = document.getElementById('dartPowerFill');
    const powerPercent = document.getElementById('dartPowerPercent');
    const scoreDisplay = document.getElementById('dartScoreDisplay');
    const feedbackDisplay = document.getElementById('dartFeedbackDisplay');
    const starsContainer = document.getElementById('dartStarsContainer');
    const clearBtn = document.getElementById('btnClearDarts');

    if (!widget || !dartWrapper || !reticle) return;

    const cfg = Object.assign(
      {
        autoplay: false,
        minValue: 1,
        maxValue: 10,
        maxHoldSeconds: 1.4,
        maxJitterPx: 14,
      },
      parseJsonAttr(widget, 'data-dart-config', {})
    );

    const i18n = parseJsonAttr(widget, 'data-dart-i18n', {
      notRated: 'Puan verilmedi',
      dash: '–',
      holdPrompt: 'Basılı tutup nişan al...',
      words: {
        1: 'Acemi',
        2: 'Zayıf',
        3: 'Gelişmeli',
        4: 'Sıradan',
        5: 'Orta',
        6: 'İyi',
        7: 'Başarılı',
        8: 'Keskin',
        9: 'Usta',
        10: 'Efsanevi',
      },
    });

    const SVG_SIZE = 280;
    const CENTER = 140;
    const BOARD_RADIUS = 130;

    let isAiming = false;
    let isBoardVisible = false;
    let currentScore = null; // Başlangıç: puan verilmedi
    let baseAimX = CENTER;
    let baseAimY = CENTER;
    let jitteredX = CENTER;
    let jitteredY = CENTER;
    let aimStartTs = 0;
    let aimRafId = null;
    let throwRafId = null;
    let activePinEl = null;

    function getBoardMetrics() {
      const rect = dartWrapper.getBoundingClientRect();
      const width = rect.width || SVG_SIZE;
      const height = rect.height || SVG_SIZE;
      const scale = SVG_SIZE / width;
      return { rect, width, height, scale };
    }

    function clampToBoardCircle(px, py, sizePx) {
      const cx = sizePx / 2;
      const cy = sizePx / 2;
      const maxR = (BOARD_RADIUS / SVG_SIZE) * sizePx - 2;
      const dx = px - cx;
      const dy = py - cy;
      const dist = Math.hypot(dx, dy);
      if (dist <= maxR || dist === 0) {
        return { x: px, y: py };
      }
      const ratio = maxR / dist;
      return { x: cx + dx * ratio, y: cy + dy * ratio };
    }

    function setPowerMeter(charge) {
      const pct = Math.round(clamp(charge, 0, 1) * 100);
      if (powerFill) powerFill.style.width = `${pct}%`;
      if (powerPercent) powerPercent.textContent = `${pct}%`;
    }

    function setScoreUI(score) {
      currentScore = score;
      const word = score !== null ? (i18n.words && i18n.words[String(score)]) || '' : '';

      if (scoreDisplay) {
        scoreDisplay.innerHTML = '';
        const span = document.createElement('span');
        span.className = 'dart-score-num';
        span.textContent = score !== null ? String(score) : i18n.dash || '–';
        scoreDisplay.appendChild(span);
        scoreDisplay.appendChild(document.createTextNode(' / 10'));
      }

      if (starsContainer) {
        const stars = starsContainer.querySelectorAll('.dart-star');
        stars.forEach((star, idx) => {
          if (score !== null && idx < score) {
            star.classList.add('is-filled');
          } else {
            star.classList.remove('is-filled');
          }
        });
      }

      if (feedbackDisplay) {
        feedbackDisplay.textContent = score !== null ? word : i18n.notRated || 'Puan verilmedi';
      }

      // Gerçek ARIA Slider özellikleri
      if (score !== null) {
        dartWrapper.setAttribute('aria-valuenow', String(score));
        dartWrapper.setAttribute('aria-valuetext', `${score} / 10 — ${word}`);
      } else {
        dartWrapper.setAttribute('aria-valuenow', '0');
        dartWrapper.setAttribute('aria-valuetext', i18n.notRated || 'Puan verilmedi');
      }
    }

    function removeExistingDart() {
      if (throwRafId !== null) {
        global.cancelAnimationFrame(throwRafId);
        throwRafId = null;
      }
      dartWrapper.querySelectorAll('.dart-pin').forEach((el) => el.remove());
      activePinEl = null;
    }

    function createDartPinSvg() {
      return `
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="3" class="dart-pin-core" />
          <path d="M12 9 L8 2 L12 5 L16 2 Z" class="dart-pin-fletch-1" />
          <path d="M12 15 L8 22 L12 19 L16 22 Z" class="dart-pin-fletch-2" />
          <path d="M9 12 L2 8 L5 12 L2 16 Z" class="dart-pin-fletch-3" />
          <path d="M15 12 L22 8 L19 12 L22 16 Z" class="dart-pin-fletch-4" />
        </svg>
      `;
    }

    function spawnImpactRipple(x, y) {
      if (prefersReducedMotion()) return;
      const ripple = document.createElement('div');
      ripple.className = 'dart-impact-ripple';
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;
      dartWrapper.appendChild(ripple);
      global.setTimeout(() => ripple.remove(), 600);
    }

    function placeDartAt(x, y, forcedScore = null) {
      const { width, scale } = getBoardMetrics();
      const clamped = clampToBoardCircle(x, y, width);
      const landX = clamped.x;
      const landY = clamped.y;

      // Eski dartı çıkar: tahtada her zaman yalnızca TEK dart bulunur
      removeExistingDart();

      // Puanı SVG merkez uzaklığından hesapla (1..10)
      let score = forcedScore;
      if (score === null) {
        const svgX = landX * scale;
        const svgY = landY * scale;
        const svgDist = Math.hypot(svgX - CENTER, svgY - CENTER);
        score = clamp(11 - Math.ceil(Math.max(1, svgDist) / 13), cfg.minValue, cfg.maxValue);
      }

      const pin = document.createElement('div');
      pin.className = 'dart-pin';
      pin.style.left = `${landX}px`;
      pin.style.top = `${landY}px`;
      pin.innerHTML = createDartPinSvg();
      dartWrapper.appendChild(pin);
      activePinEl = pin;

      if (prefersReducedMotion()) {
        pin.style.transform = 'translate(-50%, -50%) scale(1)';
        setScoreUI(score);
        return;
      }

      // Küçük yaylanma fonksiyonu ile fırlatma & saplanma animasyonu
      pin.classList.add('is-landing');
      const scaleSpring = createSpring(2.05, { stiffness: 420, damping: 22, mass: 0.75 });
      scaleSpring.target = 1;
      const offsetXSpring = createSpring(16, { stiffness: 360, damping: 24, mass: 0.8 });
      offsetXSpring.target = 0;
      const offsetYSpring = createSpring(-22, { stiffness: 360, damping: 24, mass: 0.8 });
      offsetYSpring.target = 0;

      let prevTs = 0;
      let rippleFired = false;

      function animateThrow(ts) {
        if (pin !== activePinEl) return;
        if (!prevTs) prevTs = ts;
        const dt = clamp((ts - prevTs) / 1000, 0.001, 0.032);
        prevTs = ts;

        const m1 = stepSpring(scaleSpring, dt);
        const m2 = stepSpring(offsetXSpring, dt);
        const m3 = stepSpring(offsetYSpring, dt);

        if (!rippleFired && scaleSpring.value <= 1.12) {
          rippleFired = true;
          spawnImpactRipple(landX, landY);
        }

        pin.style.transform = `translate(calc(-50% + ${offsetXSpring.value.toFixed(2)}px), calc(-50% + ${offsetYSpring.value.toFixed(2)}px)) scale(${scaleSpring.value.toFixed(3)})`;

        if (m1 || m2 || m3) {
          throwRafId = global.requestAnimationFrame(animateThrow);
        } else {
          pin.classList.remove('is-landing');
          pin.style.transform = 'translate(-50%, -50%) scale(1)';
          throwRafId = null;
        }
      }

      throwRafId = global.requestAnimationFrame(animateThrow);
      setScoreUI(score);
    }

    function throwPerfectRing(targetRing) {
      const score = clamp(targetRing, cfg.minValue, cfg.maxValue);
      const { width } = getBoardMetrics();
      const pxPerSvg = width / SVG_SIZE;
      // Hedef halkanın orta yarıçapı (10 = 6.5 svg px, 1 = 123.5 svg px)
      const ringCenterRadiusPx = (10.5 - score) * 13 * pxPerSvg;
      const angle = score === 10 ? 0 : randBetween(0, Math.PI * 2);
      const x = width / 2 + Math.cos(angle) * ringCenterRadiusPx;
      const y = width / 2 + Math.sin(angle) * ringCenterRadiusPx;
      placeDartAt(x, y, score);
    }

    function updateAimFrame(ts) {
      if (!isAiming) {
        aimRafId = null;
        return;
      }

      const holdSec = (ts - aimStartTs) / 1000;
      const rawCharge = holdSec / (cfg.maxHoldSeconds || 1.4);
      const charge = clamp(rawCharge, 0, 1);

      setPowerMeter(charge);

      // Tuttukça nişangah daha çok titrer (reduced-motion'da titreme kapalı)
      let jx = 0;
      let jy = 0;
      if (!prefersReducedMotion() && charge > 0.08) {
        const amp = (cfg.maxJitterPx || 14) * Math.pow(charge, 1.35);
        jx =
          (Math.sin(holdSec * 29.3) * 0.55 + Math.cos(holdSec * 47.1) * 0.45) * amp;
        jy =
          (Math.cos(holdSec * 33.7) * 0.55 + Math.sin(holdSec * 53.9) * 0.45) * amp;
      }

      const { width } = getBoardMetrics();
      const clamped = clampToBoardCircle(baseAimX + jx, baseAimY + jy, width);
      jitteredX = clamped.x;
      jitteredY = clamped.y;

      reticle.style.left = `${jitteredX}px`;
      reticle.style.top = `${jitteredY}px`;

      aimRafId = global.requestAnimationFrame(updateAimFrame);
    }

    function startAiming(clientX, clientY) {
      const { rect, width } = getBoardMetrics();
      const local = clampToBoardCircle(clientX - rect.left, clientY - rect.top, width);
      baseAimX = local.x;
      baseAimY = local.y;
      jitteredX = local.x;
      jitteredY = local.y;
      isAiming = true;
      aimStartTs = global.performance ? global.performance.now() : Date.now();

      reticle.style.left = `${jitteredX}px`;
      reticle.style.top = `${jitteredY}px`;
      reticle.classList.add('is-aiming');
      if (feedbackDisplay && currentScore === null) {
        feedbackDisplay.textContent = i18n.holdPrompt || 'Basılı tutup nişan al...';
      }

      if (aimRafId !== null) global.cancelAnimationFrame(aimRafId);
      aimRafId = global.requestAnimationFrame(updateAimFrame);
    }

    function finishAiming(throwDart) {
      if (!isAiming) return;
      isAiming = false;
      if (aimRafId !== null) {
        global.cancelAnimationFrame(aimRafId);
        aimRafId = null;
      }
      reticle.classList.remove('is-aiming');

      if (throwDart) {
        placeDartAt(jitteredX, jitteredY, null);
      } else {
        setPowerMeter(0);
      }
      global.setTimeout(() => {
        if (!isAiming) setPowerMeter(0);
      }, 280);
    }

    // Pointer Olayları (Masaüstü Fare + Mobil Dokunmatik Birlikte)
    dartWrapper.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      dartWrapper.focus({ preventScroll: true });
      if (typeof dartWrapper.setPointerCapture === 'function') {
        try {
          dartWrapper.setPointerCapture(e.pointerId);
        } catch (_) {}
      }
      startAiming(e.clientX, e.clientY);
    });

    dartWrapper.addEventListener('pointermove', (e) => {
      if (!isAiming) return;
      const { rect, width } = getBoardMetrics();
      const local = clampToBoardCircle(e.clientX - rect.left, e.clientY - rect.top, width);
      baseAimX = local.x;
      baseAimY = local.y;
    });

    dartWrapper.addEventListener('pointerup', () => finishAiming(true));
    dartWrapper.addEventListener('pointercancel', () => finishAiming(false));

    // Viewport görünürlüğü izleme (kısayolları yalnızca görünür/odaktayken çalıştırmak için)
    if (typeof global.IntersectionObserver === 'function') {
      const io = new global.IntersectionObserver(
        (entries) => {
          isBoardVisible = Boolean(entries[0] && entries[0].isIntersecting);
        },
        { threshold: 0.25 }
      );
      io.observe(dartWrapper);
    } else {
      isBoardVisible = true;
    }

    // Klavye Etkileşimi (1-9, 0 ve Slider Ok Tuşları)
    global.addEventListener('keydown', (e) => {
      const active = document.activeElement;
      if (
        active &&
        (['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(active.tagName) ||
          active.isContentEditable)
      ) {
        return;
      }

      const isFocused = active === dartWrapper;
      if (!isFocused && !isBoardVisible) return;

      // Sayısal kısayollar (1-9 -> halka 1-9, 0 -> Bullseye 10)
      if (e.key >= '1' && e.key <= '9') {
        throwPerfectRing(parseInt(e.key, 10));
        return;
      }
      if (e.key === '0') {
        throwPerfectRing(10);
        return;
      }

      // Gerçek Slider ok tuşları (tahta odaktayken çalışır)
      if (!isFocused) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = currentScore === null ? 1 : clamp(currentScore + 1, 1, 10);
        throwPerfectRing(next);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        const prev = currentScore === null ? 1 : clamp(currentScore - 1, 1, 10);
        throwPerfectRing(prev);
      } else if (e.key === 'Home') {
        e.preventDefault();
        throwPerfectRing(1);
      } else if (e.key === 'End') {
        e.preventDefault();
        throwPerfectRing(10);
      }
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        removeExistingDart();
        setPowerMeter(0);
        setScoreUI(null);
      });
    }

    // Başlangıç: "Puan verilmedi", – / 10, boş yıldızlar, sıfır dart (autoplay = false)
    setPowerMeter(0);
    setScoreUI(null);
  }

  // ============================================================================
  // 4) FLOATING DOCK: SOL MENÜ ANİMASYONU (macOS Dock + Mobil Çekmece Yaylanma)
  // ============================================================================
  function initSidebarFloatingDock() {
    const appSidebar = document.getElementById('appSidebar');
    const sidebarNav = document.getElementById('sidebarNav');
    const dockDot = document.getElementById('sidebarDockDot');
    const dockTooltip = document.getElementById('sidebarDockTooltip');

    if (!appSidebar || !sidebarNav) return;

    const links = Array.from(sidebarNav.querySelectorAll('.sidebar-link'));
    if (!links.length) return;

    const rawCfg = parseJsonAttr(appSidebar, 'data-dock-config', {});
    const cfg = Object.assign(
      {
        distance: 112,
        magnification: 1.45,
        neighborShiftPx: 9,
        expandedIconScale: 1.24,
        expandedRowShiftPx: 6,
        spring: { stiffness: 340, damping: 24, mass: 0.85 },
        mobileStaggerMs: 42,
      },
      rawCfg
    );
    const springOpts = cfg.spring || { stiffness: 340, damping: 24, mass: 0.85 };

    appSidebar.classList.add('dock-ready');

    const items = links.map((link) => ({
      link,
      icon: link.querySelector('.sidebar-link-icon'),
      scale: createSpring(1, springOpts),
      shiftY: createSpring(0, springOpts),
      rowShiftX: createSpring(0, springOpts),
      bounceY: createSpring(0, { stiffness: 420, damping: 18, mass: 0.75 }),
      mobileX: createSpring(0, { stiffness: 300, damping: 24, mass: 0.9 }),
      mobileOpacity: createSpring(1, { stiffness: 300, damping: 24, mass: 0.9 }),
    }));

    const dotYSpring = createSpring(0, { stiffness: 360, damping: 26, mass: 0.8 });
    let pointerClientY = null;
    let focusedItem = null;
    let dockRafId = null;
    let lastDockTs = 0;
    let mobileSequenceTimers = [];

    function isCollapsedDesktop() {
      return (
        global.innerWidth >= 1024 &&
        document.documentElement.getAttribute('data-sidebar') === 'collapsed'
      );
    }

    function isExpandedDesktop() {
      return (
        global.innerWidth >= 1024 &&
        document.documentElement.getAttribute('data-sidebar') !== 'collapsed'
      );
    }

    function computeDotTargetY(linkEl) {
      if (!linkEl || !dockDot) return null;
      const navRect = sidebarNav.getBoundingClientRect();
      const linkRect = linkEl.getBoundingClientRect();
      if (!linkRect.height) return null;
      const dotH = dockDot.offsetHeight || 18;
      if (isCollapsedDesktop()) {
        // Daraltılmış dock'ta nokta aktif ikonun altına konumlanır
        return linkRect.bottom - navRect.top + sidebarNav.scrollTop - dotH - 2;
      }
      return linkRect.top - navRect.top + sidebarNav.scrollTop + (linkRect.height - dotH) / 2;
    }

    function showTooltipFor(item) {
      if (!dockTooltip || !isCollapsedDesktop()) return;
      const label = item.link.getAttribute('data-tooltip');
      if (!label) return;
      const sidebarRect = appSidebar.getBoundingClientRect();
      const linkRect = item.link.getBoundingClientRect();
      dockTooltip.textContent = label;
      dockTooltip.style.left = `${Math.round(sidebarRect.right + 12)}px`;
      dockTooltip.style.top = `${Math.round(linkRect.top + linkRect.height / 2)}px`;
      dockTooltip.classList.add('is-visible');
      dockTooltip.setAttribute('aria-hidden', 'false');
    }

    function hideTooltip() {
      if (!dockTooltip) return;
      dockTooltip.classList.remove('is-visible');
      dockTooltip.setAttribute('aria-hidden', 'true');
    }

    function updateDockTargets() {
      const reduced = prefersReducedMotion();
      const fine = hasFinePointer();

      // Masaüstü olmayan veya hover desteklemeyen dokunmatik cihazlarda büyütme YOK
      if (reduced || !fine || global.innerWidth < 1024) {
        items.forEach((it) => {
          it.scale.target = 1;
          it.shiftY.target = 0;
          it.rowShiftX.target = 0;
        });
        return;
      }

      let activeY = pointerClientY;
      if (activeY === null && focusedItem) {
        const rect = focusedItem.link.getBoundingClientRect();
        activeY = rect.top + rect.height / 2;
      }

      if (activeY === null) {
        items.forEach((it) => {
          it.scale.target = 1;
          it.shiftY.target = 0;
          it.rowShiftX.target = 0;
        });
        return;
      }

      const collapsed = isCollapsedDesktop();
      const radius = cfg.distance || 112;

      items.forEach((it) => {
        const rect = it.link.getBoundingClientRect();
        const centerY = rect.top + rect.height / 2;
        const delta = centerY - activeY;
        const absDist = Math.abs(delta);

        let influence = 0;
        if (absDist < radius) {
          influence = Math.pow(0.5 * (1 + Math.cos((Math.PI * absDist) / radius)), 1.35);
        }

        if (collapsed) {
          it.scale.target = 1 + (cfg.magnification - 1) * influence;
          // Yakındaki komşuları yukarı/aşağı yaylanarak iter
          const pushFactor =
            absDist > 4 && absDist < radius
              ? (delta > 0 ? 1 : -1) * Math.sin((absDist / radius) * Math.PI)
              : 0;
          it.shiftY.target = pushFactor * (cfg.neighborShiftPx || 9);
          it.rowShiftX.target = 0;
        } else if (isExpandedDesktop()) {
          // Açık menüde (260px): yazılar sabit/okunur; sadece ikon büyür, satır hafif sağa kayar
          it.scale.target = 1 + (cfg.expandedIconScale - 1) * influence;
          it.shiftY.target = 0;
          it.rowShiftX.target = (cfg.expandedRowShiftPx || 6) * influence;
        }
      });
    }

    function applyItemStyles(it) {
      const finalX = it.rowShiftX.value + it.mobileX.value;
      it.link.style.setProperty('--dock-row-shift-x', `${finalX.toFixed(2)}px`);
      it.link.style.setProperty('--dock-shift-y', `${it.shiftY.value.toFixed(2)}px`);
      it.link.style.setProperty('--dock-mobile-opacity', `${clamp(it.mobileOpacity.value, 0, 1).toFixed(3)}`);

      if (it.icon) {
        it.icon.style.setProperty('--dock-scale', `${it.scale.value.toFixed(3)}`);
        it.icon.style.setProperty('--dock-bounce-y', `${it.bounceY.value.toFixed(2)}px`);
      }
    }

    function dockTick(ts) {
      if (!lastDockTs) lastDockTs = ts;
      const dt = clamp((ts - lastDockTs) / 1000, 0.001, 0.032);
      lastDockTs = ts;

      let anyMoving = false;

      if (dockDot && dockDot.classList.contains('is-moving')) {
        if (stepSpring(dotYSpring, dt)) anyMoving = true;
        dockDot.style.setProperty('--dock-dot-y', `${dotYSpring.value.toFixed(2)}px`);
      }

      for (const it of items) {
        const s1 = stepSpring(it.scale, dt);
        const s2 = stepSpring(it.shiftY, dt);
        const s3 = stepSpring(it.rowShiftX, dt);
        const s4 = stepSpring(it.bounceY, dt);
        const s5 = stepSpring(it.mobileX, dt);
        const s6 = stepSpring(it.mobileOpacity, dt);
        applyItemStyles(it);
        if (s1 || s2 || s3 || s4 || s5 || s6) {
          anyMoving = true;
        }
      }

      if (anyMoving) {
        dockRafId = global.requestAnimationFrame(dockTick);
      } else {
        dockRafId = null;
        lastDockTs = 0;
      }
    }

    function ensureDockRunning() {
      if (dockRafId === null) {
        lastDockTs = 0;
        dockRafId = global.requestAnimationFrame(dockTick);
      }
    }

    // Aktif sayfa noktasını konumlandır (sayfalar arası kayma hissi)
    const activeLink = sidebarNav.querySelector('.sidebar-link.active');
    if (activeLink && dockDot) {
      const targetY = computeDotTargetY(activeLink);
      if (targetY !== null) {
        let startY = targetY;
        try {
          const prevRaw = global.sessionStorage.getItem('piyade_dock_last_y');
          if (prevRaw !== null && !prefersReducedMotion()) {
            const parsedPrev = parseFloat(prevRaw);
            if (Number.isFinite(parsedPrev)) startY = parsedPrev;
          }
          global.sessionStorage.setItem('piyade_dock_last_y', String(targetY));
        } catch (_) {}

        dotYSpring.value = prefersReducedMotion() ? targetY : startY;
        dotYSpring.target = targetY;
        dockDot.classList.add('is-moving');
        dockDot.style.setProperty('--dock-dot-y', `${dotYSpring.value.toFixed(2)}px`);
        if (Math.abs(dotYSpring.target - dotYSpring.value) > 0.5) {
          ensureDockRunning();
        }
      }
    }

    // Masaüstü fare hareketleri
    sidebarNav.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || global.innerWidth < 1024) return;
      pointerClientY = e.clientY;
      updateDockTargets();
      ensureDockRunning();
    });

    sidebarNav.addEventListener('pointerleave', () => {
      pointerClientY = null;
      updateDockTargets();
      ensureDockRunning();
      if (!focusedItem) hideTooltip();
    });

    // Öğe olayları (Tooltip + Klavye Focus + Tıklamada Zıplama)
    items.forEach((it) => {
      it.link.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'mouse' && isCollapsedDesktop()) {
          showTooltipFor(it);
        }
      });

      it.link.addEventListener('pointerleave', () => {
        if (focusedItem !== it) {
          hideTooltip();
        }
      });

      it.link.addEventListener('focusin', () => {
        focusedItem = it;
        updateDockTargets();
        ensureDockRunning();
        if (isCollapsedDesktop()) {
          showTooltipFor(it);
        }
      });

      it.link.addEventListener('focusout', () => {
        if (focusedItem === it) focusedItem = null;
        updateDockTargets();
        ensureDockRunning();
        hideTooltip();
      });

      it.link.addEventListener('click', () => {
        // Tıklamada zıplama (masaüstü ve dokunmatik) + çalışan nokta hedefi kaydet
        if (!prefersReducedMotion() && it.icon) {
          it.bounceY.velocity = -255;
          it.icon.classList.add('is-bouncing');
          global.setTimeout(() => {
            if (it.icon) it.icon.classList.remove('is-bouncing');
          }, 340);
          ensureDockRunning();
        }

        const nextDotY = computeDotTargetY(it.link);
        if (nextDotY !== null && dockDot) {
          dotYSpring.target = nextDotY;
          dockDot.classList.add('is-moving');
          try {
            global.sessionStorage.setItem('piyade_dock_last_y', String(nextDotY));
          } catch (_) {}
          ensureDockRunning();
        }
      });
    });

    // Mobil/Tablet Çekmece (<1024px) Açılınca Kademeli Yaylı Giriş
    function clearMobileTimers() {
      mobileSequenceTimers.forEach((t) => global.clearTimeout(t));
      mobileSequenceTimers = [];
    }

    function runMobileStaggerEntrance() {
      clearMobileTimers();
      if (prefersReducedMotion() || global.innerWidth >= 1024) {
        items.forEach((it) => {
          it.mobileX.value = 0;
          it.mobileX.target = 0;
          it.mobileOpacity.value = 1;
          it.mobileOpacity.target = 1;
          applyItemStyles(it);
        });
        return;
      }

      items.forEach((it, idx) => {
        it.link.classList.add('is-dock-entering');
        it.mobileX.value = -24;
        it.mobileX.target = -24;
        it.mobileX.velocity = 0;
        it.mobileOpacity.value = 0;
        it.mobileOpacity.target = 0;
        it.mobileOpacity.velocity = 0;
        applyItemStyles(it);

        const timer = global.setTimeout(() => {
          it.mobileX.target = 0;
          it.mobileOpacity.target = 1;
          ensureDockRunning();
        }, idx * (cfg.mobileStaggerMs || 42));
        mobileSequenceTimers.push(timer);
      });
    }

    // data-mobile-sidebar veya data-sidebar değişimlerini izle
    const attrObserver = new global.MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'data-mobile-sidebar') {
          const mobileOpen = document.documentElement.getAttribute('data-mobile-sidebar') === 'open';
          if (mobileOpen) {
            runMobileStaggerEntrance();
          } else {
            clearMobileTimers();
          }
        }
        if (m.attributeName === 'data-sidebar') {
          hideTooltip();
          updateDockTargets();
          if (activeLink && dockDot) {
            const newDotY = computeDotTargetY(activeLink);
            if (newDotY !== null) {
              dotYSpring.target = newDotY;
            }
          }
          ensureDockRunning();
        }
      }
    });

    attrObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-mobile-sidebar', 'data-sidebar'],
    });
  }

  // ============================================================================
  // 5) ORBITAL LOADER: YALNIZCA KANIT DOSYASI YÜKLENİRKEN (admin-warn)
  // ============================================================================
  function initAdminWarnOrbitalLoader() {
    const form = document.getElementById('adminWarnForm');
    const overlay = document.getElementById('orbitalLoaderOverlay');
    if (!form || !overlay) return;

    const fileInput = document.getElementById('evidenceFile');
    const progressArc = document.getElementById('orbitalProgressArc');
    const cometArc = document.getElementById('orbitalCometArc');
    const cometHead = document.getElementById('orbitalCometHead');
    const statusText = document.getElementById('orbitalStatusText');
    const subText = document.getElementById('orbitalSubText');
    const closeBtn = document.getElementById('orbitalCloseBtn');
    const errorBanner = document.getElementById('adminWarnErrorBanner');
    const errorBannerText = document.getElementById('adminWarnErrorText');

    const cfg = Object.assign(
      {
        enableSound: false,
        requestTimeoutMs: 45000,
        successRedirectDelayMs: 750,
      },
      parseJsonAttr(form, 'data-loader-config', {})
    );

    const i18n = parseJsonAttr(form, 'data-loader-i18n', {
      uploading: 'Kanıt yükleniyor…',
      forwarding: "Kanıt Discord'a iletiliyor…",
      success: 'Kanıt ve uyarı başarıyla iletildi!',
      errorTitle: 'Kanıt İletilemedi',
      timeoutError: 'İşlem zaman aşımına uğradı. Lütfen tekrar deneyin.',
      networkError: 'Ağ hatası oluştu. Lütfen tekrar deneyin.',
      closeBtn: 'Kapat ve Düzenle',
    });

    const CIRCUMFERENCE = 2 * Math.PI * 52; // 326.7256
    const CX = 70;
    const CY = 70;
    const RADIUS = 52;

    let cometPhase = 0;
    let cometHeadDeg = 0;
    let cometRafId = null;
    let lastCometTs = 0;
    let mode = 'idle'; // 'uploading' | 'forwarding' | 'success' | 'error' | 'idle'
    let uploadPercent = 0;

    function updateCometGeometry(headDeg, tailDeg) {
      if (!cometArc || !cometHead) return;
      const headRad = ((headDeg - 90) * Math.PI) / 180;
      const tailRad = ((headDeg - tailDeg - 90) * Math.PI) / 180;

      const hx = CX + RADIUS * Math.cos(headRad);
      const hy = CY + RADIUS * Math.sin(headRad);
      const tx = CX + RADIUS * Math.cos(tailRad);
      const ty = CY + RADIUS * Math.sin(tailRad);
      const largeArc = tailDeg > 180 ? 1 : 0;

      cometArc.setAttribute(
        'd',
        `M ${tx.toFixed(2)} ${ty.toFixed(2)} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${hx.toFixed(2)} ${hy.toFixed(2)}`
      );
      cometHead.setAttribute('cx', hx.toFixed(2));
      cometHead.setAttribute('cy', hy.toFixed(2));
    }

    function setDeterminateProgress(pct) {
      uploadPercent = clamp(pct, 0, 100);
      if (progressArc) {
        const offset = CIRCUMFERENCE * (1 - uploadPercent / 100);
        progressArc.style.strokeDashoffset = `${offset.toFixed(2)}`;
      }
      if (subText && mode === 'uploading') {
        subText.textContent = `${Math.round(uploadPercent)}%`;
      }
    }

    function cometTick(ts) {
      if (mode !== 'uploading' && mode !== 'forwarding') {
        cometRafId = null;
        return;
      }

      if (prefersReducedMotion()) {
        // Reduced-motion'da dönme ve uzayıp kısalma durur
        updateCometGeometry(90, 45);
        cometRafId = null;
        return;
      }

      if (!lastCometTs) lastCometTs = ts;
      const dt = clamp((ts - lastCometTs) / 1000, 0.001, 0.04);
      lastCometTs = ts;

      cometPhase += dt * 3.4;

      if (mode === 'forwarding') {
        // İlerleme olmadan sonsuz dönme: her turda hızlanıp yavaşlar, kuyruk hızla uzayıp kısalır
        const speedDegPerSec = 260 + 230 * Math.sin(cometPhase);
        cometHeadDeg = (cometHeadDeg + speedDegPerSec * dt) % 360;
        const tailDeg = 28 + 92 * Math.pow(0.5 + 0.5 * Math.sin(cometPhase - 0.55), 1.35);
        updateCometGeometry(cometHeadDeg, tailDeg);
      } else {
        // Yükleme aşamasında ilerleme yayı kuyruklu yıldızın arkasında dolar
        const progDeg = (uploadPercent / 100) * 360;
        const whip = 0.5 + 0.5 * Math.sin(cometPhase * 1.4);
        const tailDeg = Math.min(progDeg + 28, 34 + 62 * whip);
        const headDeg = Math.max(progDeg, cometHeadDeg);
        cometHeadDeg = (cometHeadDeg + (300 + 180 * whip) * dt) % 360;
        updateCometGeometry(uploadPercent > 2 ? progDeg : headDeg, tailDeg);
      }

      cometRafId = global.requestAnimationFrame(cometTick);
    }

    function stopCometLoop() {
      if (cometRafId !== null) {
        global.cancelAnimationFrame(cometRafId);
        cometRafId = null;
      }
      lastCometTs = 0;
    }

    function openOverlayUploading() {
      mode = 'uploading';
      overlay.classList.remove('is-success', 'is-error', 'is-indeterminate');
      overlay.hidden = false;
      if (closeBtn) closeBtn.hidden = true;
      if (statusText) statusText.textContent = i18n.uploading || 'Kanıt yükleniyor…';
      setDeterminateProgress(0);
      cometPhase = 0;
      cometHeadDeg = 0;

      // Tarayıcı görünüm geçişi için frame sonrası is-open
      global.requestAnimationFrame(() => {
        overlay.classList.add('is-open');
      });

      if (!prefersReducedMotion()) {
        lastCometTs = 0;
        cometRafId = global.requestAnimationFrame(cometTick);
      } else {
        updateCometGeometry(90, 45);
      }
    }

    function switchToForwarding() {
      mode = 'forwarding';
      setDeterminateProgress(100);
      overlay.classList.add('is-indeterminate');
      if (statusText) statusText.textContent = i18n.forwarding || "Kanıt Discord'a iletiliyor…";
      if (subText) subText.textContent = '';
    }

    function switchToSuccess() {
      mode = 'success';
      stopCometLoop();
      overlay.classList.remove('is-indeterminate', 'is-error');
      overlay.classList.add('is-success');
      if (statusText) statusText.textContent = i18n.success || 'Kanıt ve uyarı başarıyla iletildi!';
      if (subText) subText.textContent = '100%';
    }

    function closeOverlay() {
      mode = 'idle';
      stopCometLoop();
      overlay.classList.remove('is-open', 'is-success', 'is-error', 'is-indeterminate');
      overlay.hidden = true;
    }

    async function refreshIdempotencyKeyIfNeeded(providedKey) {
      let nextKey = providedKey;
      if (!nextKey) {
        try {
          const resp = await fetch('/yonetim/api/idempotency-key', {
            headers: { Accept: 'application/json' },
          });
          if (resp.ok) {
            const payload = await resp.json();
            nextKey = payload && payload.idempotencyKey;
          }
        } catch (_) {}
      }

      if (nextKey) {
        const keyInput = form.querySelector('input[name="_idempotencyKey"]');
        if (keyInput) keyInput.value = nextKey;
        try {
          const url = new URL(form.action, global.location.origin);
          url.searchParams.set('_idempotencyKey', nextKey);
          form.action = `${url.pathname}${url.search}`;
        } catch (_) {}
      }
    }

    function unlockForm() {
      form.dataset.submitted = 'false';
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
        submitBtn.style.cursor = 'pointer';
        if (submitBtn.dataset.originalHtml) {
          submitBtn.innerHTML = submitBtn.dataset.originalHtml;
        }
      }
    }

    function switchToError(errMsg, maybeFreshKey) {
      mode = 'error';
      stopCometLoop();
      overlay.classList.remove('is-indeterminate', 'is-success');
      overlay.classList.add('is-error');
      if (statusText) statusText.textContent = i18n.errorTitle || 'Kanıt İletilemedi';
      if (subText) subText.textContent = errMsg;
      if (closeBtn) {
        closeBtn.hidden = false;
        global.setTimeout(() => closeBtn.focus(), 60);
      }

      if (errorBanner && errorBannerText) {
        errorBannerText.textContent = errMsg;
        errorBanner.hidden = false;
      }

      unlockForm();
      refreshIdempotencyKeyIfNeeded(maybeFreshKey);
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        if (mode === 'error') {
          closeOverlay();
        }
      });
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && mode === 'error') {
        closeOverlay();
      }
    });

    global.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mode === 'error') {
        closeOverlay();
      }
    });

    // app.js ile koordine işaretleme: Dosya seçiliyse XHR + Orbital Loader devralır
    global.NexusOrbitalUploadReady = true;

    form.addEventListener('submit', (e) => {
      const hasFile = Boolean(fileInput && fileInput.files && fileInput.files.length > 0);
      if (!hasFile) {
        // Dosya yoksa loader çıkmaz; app.js / normal form gönderimi devam eder
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

      // Mevcut buton kilitleme mantığı
      form.dataset.submitted = 'true';
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        if (!submitBtn.dataset.originalHtml) {
          submitBtn.dataset.originalHtml = submitBtn.innerHTML;
        }
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.65';
        submitBtn.style.cursor = 'not-allowed';
        const submittingText = submitBtn.getAttribute('data-submitting-text');
        if (submittingText) submitBtn.textContent = submittingText;
      }

      if (errorBanner) errorBanner.hidden = true;

      // Ses KESİNLİKLE kapalıdır (enableSound: false)
      openOverlayUploading();

      const formData = new FormData(form);
      const csrfInput = form.querySelector('input[name="_csrf"]');
      const csrfVal = csrfInput ? csrfInput.value : '';

      const xhr = new XMLHttpRequest();
      xhr.open('POST', form.action, true);
      xhr.timeout = cfg.requestTimeoutMs || 45000;
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.setRequestHeader('Accept', 'application/json');
      if (csrfVal) {
        xhr.setRequestHeader('X-CSRF-Token', csrfVal);
      }

      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && ev.total > 0) {
          const pct = (ev.loaded / ev.total) * 100;
          setDeterminateProgress(pct);
        }
      };

      xhr.upload.onload = () => {
        // Dosya %100 sunucuya çıktıktan sonra Bot / Discord iletimi boyunca sonsuz döner
        switchToForwarding();
      };

      xhr.onload = () => {
        let data = null;
        try {
          data = JSON.parse(xhr.responseText || '{}');
        } catch (_) {
          data = null;
        }

        if (xhr.status >= 200 && xhr.status < 300 && data && data.ok) {
          switchToSuccess();
          const waitMs = prefersReducedMotion() ? 220 : cfg.successRedirectDelayMs || 750;
          global.setTimeout(() => {
            global.location.assign(data.redirectUrl || '/yonetim/uyari');
          }, waitMs);
          return;
        }

        const msg =
          (data && data.error) ||
          (xhr.status === 413 ? i18n.fileTooLarge : null) ||
          i18n.networkError ||
          'İşlem sırasında bir hata oluştu.';
        switchToError(msg, data && data.nextIdempotencyKey);
      };

      xhr.ontimeout = () => {
        switchToError(
          i18n.timeoutError || 'İşlem zaman aşımına uğradı. Lütfen tekrar deneyin.',
          null
        );
      };

      xhr.onerror = () => {
        switchToError(
          i18n.networkError || 'Ağ hatası oluştu. Lütfen tekrar deneyin.',
          null
        );
      };

      xhr.onabort = () => {
        switchToError(
          i18n.networkError || 'Yükleme iptal edildi. Lütfen tekrar deneyin.',
          null
        );
      };

      xhr.send(formData);
    });
  }

  // Tüm bileşenleri DOM hazır olduğunda başlat
  document.addEventListener('DOMContentLoaded', () => {
    initMeteors();
    initScrollRevealText();
    initDartRating();
    initSidebarFloatingDock();
    initAdminWarnOrbitalLoader();
  });
})(window);
