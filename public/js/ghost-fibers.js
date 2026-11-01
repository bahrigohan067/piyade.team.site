/**
 * 🌌 GHOST FIBERS (PRESET: VIOLET) CANVAS ENGINE
 * Inspired by ReactBits Background Studio
 * Renders flowing, layered glowing fiber ribbons in electric violet, magenta, and indigo.
 */

(function initGhostFibers() {
  const canvas = document.createElement('canvas');
  canvas.id = 'ghost-fibers-canvas';
  canvas.style.position = 'fixed';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  canvas.style.zIndex = '-2';
  canvas.style.pointerEvents = 'none';
  canvas.style.opacity = '0.9';
  document.body.prepend(canvas);

  const ctx = canvas.getContext('2d');
  let width = 0;
  let height = 0;
  let dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
  }

  window.addEventListener('resize', resize);
  resize();

  // Mouse konumu ve yumuşatılmış takip
  const mouse = { x: width * 0.5, y: height * 0.5, targetX: width * 0.5, targetY: height * 0.5 };
  window.addEventListener('mousemove', (e) => {
    mouse.targetX = e.clientX;
    mouse.targetY = e.clientY;
  });

  // Fiber Şeritleri (Ribbons) Yapılandırması (Preset: Violet)
  const RIBBON_COUNT = 7;
  const FILAMENTS_PER_RIBBON = 8;
  const ribbons = [];

  const VIOLET_PALETTE = [
    { r: 139, g: 92, b: 246 },  // #8b5cf6 Electric Violet
    { r: 168, g: 85, b: 247 },  // #a855f7 Vivid Violet
    { r: 192, g: 132, b: 252 }, // #c084fc Neon Lilac
    { r: 217, g: 70, b: 239 },  // #d946ef Bright Magenta
    { r: 99, g: 102, b: 241 },  // #6366f1 Indigo Glow
  ];

  for (let i = 0; i < RIBBON_COUNT; i++) {
    ribbons.push({
      baseY: 0.15 + (i / RIBBON_COUNT) * 0.75, // Dikey başlangıç oranı
      speed: 0.0006 + Math.random() * 0.0008,
      freq1: 0.0012 + Math.random() * 0.001,
      freq2: 0.0025 + Math.random() * 0.0015,
      amp1: 70 + Math.random() * 90,
      amp2: 40 + Math.random() * 50,
      phase: Math.random() * Math.PI * 2,
      phase2: Math.random() * Math.PI * 2,
      thickness: 1.2 + Math.random() * 1.5,
      color: VIOLET_PALETTE[i % VIOLET_PALETTE.length],
      alpha: 0.35 + Math.random() * 0.35,
      twistSpeed: 0.001 + Math.random() * 0.0015,
      nodes: 36,
    });
  }

  // Uçuşan toz partikülleri (Floating fiber motes)
  const PARTICLES_COUNT = 45;
  const particles = [];
  for (let p = 0; p < PARTICLES_COUNT; p++) {
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      size: 0.75 + Math.random() * 1.75,
      vx: (Math.random() - 0.5) * 0.4,
      vy: -0.2 - Math.random() * 0.5,
      alpha: 0.2 + Math.random() * 0.6,
      color: VIOLET_PALETTE[Math.floor(Math.random() * VIOLET_PALETTE.length)],
      pulse: Math.random() * Math.PI,
    });
  }

  let time = 0;

  function render() {
    time += 1;

    // Mouse yumuşatma
    mouse.x += (mouse.targetX - mouse.x) * 0.04;
    mouse.y += (mouse.targetY - mouse.y) * 0.04;

    // Arka planı koyu derin mor ile temizle
    ctx.clearRect(0, 0, width, height);

    // Derin nebulalar (Yumuşak parıldayan mor alanlar)
    const bgGrad = ctx.createRadialGradient(
      mouse.x,
      mouse.y,
      50,
      width * 0.5,
      height * 0.4,
      Math.max(width, height) * 0.8
    );
    bgGrad.addColorStop(0, 'rgba(49, 16, 92, 0.35)');
    bgGrad.addColorStop(0.4, 'rgba(23, 10, 48, 0.25)');
    bgGrad.addColorStop(1, 'rgba(7, 4, 15, 0.95)');

    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Işık birleşimi modu
    ctx.globalCompositeOperation = 'screen';

    // 1. Fiber Şeritlerini Çiz
    for (let r = 0; r < ribbons.length; r++) {
      const rib = ribbons[r];
      const startY = rib.baseY * height;
      const mouseOffsetY = ((mouse.y - height * 0.5) / height) * 50 * (r % 2 === 0 ? 1 : -1);

      for (let f = 0; f < FILAMENTS_PER_RIBBON; f++) {
        const filamentOffset = (f - FILAMENTS_PER_RIBBON / 2) * 4.5;
        const filamentPhase = rib.phase + f * 0.18 + time * rib.twistSpeed;

        ctx.beginPath();
        const step = width / rib.nodes;

        for (let x = -50; x <= width + 50; x += step) {
          // Çok frekanslı kıvrılma denklemi
          const wave1 = Math.sin(x * rib.freq1 + time * rib.speed + filamentPhase) * rib.amp1;
          const wave2 = Math.cos(x * rib.freq2 - time * rib.speed * 0.8 + rib.phase2) * rib.amp2;
          const mouseDeflect = Math.sin((x / width) * Math.PI) * mouseOffsetY;

          const y = startY + wave1 + wave2 + filamentOffset + mouseDeflect;

          if (x === -50) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }

        // Parlayan gradyan kontur
        const c = rib.color;
        const grad = ctx.createLinearGradient(0, 0, width, 0);
        grad.addColorStop(0, `rgba(${c.r}, ${c.g}, ${c.b}, 0)`);
        grad.addColorStop(0.2, `rgba(${c.r}, ${c.g}, ${c.b}, ${rib.alpha * 0.4})`);
        grad.addColorStop(0.5, `rgba(${c.r + 30}, ${c.g + 30}, ${c.b + 30}, ${rib.alpha})`);
        grad.addColorStop(0.8, `rgba(${c.r}, ${c.g}, ${c.b}, ${rib.alpha * 0.4})`);
        grad.addColorStop(1, `rgba(${c.r}, ${c.g}, ${c.b}, 0)`);

        ctx.strokeStyle = grad;
        ctx.lineWidth = f === Math.floor(FILAMENTS_PER_RIBBON / 2) ? rib.thickness * 1.8 : rib.thickness;
        ctx.shadowColor = `rgba(${c.r}, ${c.g}, ${c.b}, 0.8)`;
        ctx.shadowBlur = 12;
        ctx.stroke();
      }
    }

    // 2. Parıldayan Toz Partikülleri (Fiber Motes)
    for (let p = 0; p < particles.length; p++) {
      const pt = particles[p];
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.pulse += 0.03;

      if (pt.y < -10) {
        pt.y = height + 10;
        pt.x = Math.random() * width;
      }
      if (pt.x < -10) pt.x = width + 10;
      if (pt.x > width + 10) pt.x = -10;

      const currentAlpha = pt.alpha * (0.6 + 0.4 * Math.sin(pt.pulse));
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${pt.color.r}, ${pt.color.g}, ${pt.color.b}, ${currentAlpha})`;
      ctx.shadowColor = `rgba(${pt.color.r}, ${pt.color.g}, ${pt.color.b}, 0.9)`;
      ctx.shadowBlur = 8;
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
})();
