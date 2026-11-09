/**
 * ==============================================================================
 * 🌌 AERO SHARDS — PARAMETRİK WEBGL 3B PRİZMA & AKIŞ ARKA PLAN MOTORU
 * ==============================================================================
 * React Bits Background Studio (bg=aero-shards) dışa aktarımının Express + EJS
 * mimarisi için bağımsız (vanilla JS + WebGL) uyarlaması.
 *
 * Özellikler:
 * - 5 derinlik katmanında prosedürel akış yolları (Stream / Vortex / Ribbon)
 * - Biçimler arası animasyonu sıfırlamadan yay fiziğiyle yumuşak geçiş (morphing)
 * - 3 yüzey stili: Pearl / Glass (inci/opal cam), Chrome (aynalı), Satin (mat-saten)
 * - Akış yönelimli sönümlü imleç fiziği (Repel / Attract) + Basılı tutunca toplama
 * - Tıklama / dokunma anında tüm yapıya yayılan vurgu renkli dalga (Ripple)
 * - Otomatik FPS ölçümü ve kademeli kalite adaptasyonu (high -> medium -> low)
 * - Renklerin tamamı public/css/theme.css içindeki CSS değişkenlerinden okunur.
 * ==============================================================================
 */
(function (global) {
  'use strict';

  const PLACEMENTS = ['full', 'left', 'right', 'center'];
  const ARRANGEMENT_TO_PLACEMENT = {
    stream: 'full',
    full: 'full',
    ribbon: 'left',
    left: 'left',
    right: 'right',
    vortex: 'center',
    center: 'center',
  };
  const FINISH_MODES = {
    pearl: 0,
    glass: 0,
    chrome: 1,
    satin: 2,
  };
  const MARKER_STYLES = {
    plus: 0,
    dots: 1,
    none: -1,
  };

  const SAMPLES = 160;
  const CAMERA = 4.0;
  const FOCUS = 3.1;
  const SHARD_FOCUS = 2.75;
  const MAX_BANK = 1.0;
  const DEPTHS = [2.7, 3.9, 5.6, 8.1, 11.6];
  const SHARE = [0.26, 0.23, 0.2, 0.17, 0.14];
  const GROWTH = [1, 1.3, 1.8, 2.6, 3.6];
  const FADE = [1, 0.8, 0.52, 0.32, 0.2];
  const LEVELS = DEPTHS.length;
  const INTRO_SECONDS = 3.4;
  const MARKER_PHASES = [
    [0.37, 0.61],
    [0.83, 0.12],
    [0.21, 0.88],
    [0.66, 0.44],
    [0.05, 0.27],
  ];
  const MAX_RINGS = 4;
  const RING_SECONDS = 2.6;
  const FULL_SLOPES = [
    [0.2, -0.78],
    [-0.72, 0.02],
    [0.58, -0.06],
    [-0.24, 0.62],
    [0.8, 0.3],
  ];
  const SIDE_OFFSETS = [0.84, 0.62, 0.44, 0.28, 0.14];
  const RING_SIZES = [
    [0.98, 0.78],
    [0.9, 0.7],
    [0.84, 0.64],
    [0.8, 0.6],
    [0.76, 0.56],
  ];
  const TAU = Math.PI * 2;

  const SHARD_FLOATS_PER_VERTEX = 28;
  const SHARD_VERTICES = 6;
  const MARKER_FLOATS_PER_VERTEX = 12;
  const MARKER_VERTICES = 6;

  // ============================================================================
  // GLSL SHADER: 3B PRİZMA KIYMIKLAR (Studio Lighting, Bevel, Fresnel, Refraction)
  // ============================================================================
  const SHARD_VS = `
    attribute vec4 a_pos;      // xy: clipPos, zw: localPlateCoord
    attribute vec4 a_center;   // xyz: worldCenter, w: size
    attribute vec4 a_axis;     // xyz: worldAxis, w: halfThickness
    attribute vec4 a_normal;   // xyz: worldNormal, w: tint
    attribute vec4 a_p01;      // xy: p0, zw: p1
    attribute vec4 a_p23;      // xy: p2, zw: p3
    attribute vec4 a_p4;       // xy: p4, z: sides, w: flash

    varying vec2 v_local;
    varying vec4 v_center;
    varying vec4 v_axis;
    varying vec4 v_normal;
    varying vec4 v_p01;
    varying vec4 v_p23;
    varying vec4 v_p4;

    void main() {
      gl_Position = vec4(a_pos.xy, 0.5, 1.0);
      v_local = a_pos.zw;
      v_center = a_center;
      v_axis = a_axis;
      v_normal = a_normal;
      v_p01 = a_p01;
      v_p23 = a_p23;
      v_p4 = a_p4;
    }
  `;

  const SHARD_FS = `
    precision highp float;

    varying vec2 v_local;
    varying vec4 v_center;
    varying vec4 v_axis;
    varying vec4 v_normal;
    varying vec4 v_p01;
    varying vec4 v_p23;
    varying vec4 v_p4;

    uniform vec3 u_eye;
    uniform vec3 u_shardColor;
    uniform vec3 u_accentColor;
    uniform vec4 u_surface; // x: finishMode (0=pearl/glass, 1=chrome, 2=satin), y: glow, z: grain, w: clock
    uniform vec2 u_resolution;

    const vec3 KEY_DIR = vec3(-0.2614, 0.6722, 0.5975);
    const vec3 LEFT_DIR = vec3(-0.8583, 0.1198, 0.4990);
    const vec3 LEFT_ACROSS = vec3(0.5026, 0.0, 0.8645);
    const vec3 RIM_DIR = vec3(0.7826, 0.2207, -0.5820);
    const vec3 TOP_DIR = vec3(0.0500, 0.9396, -0.3299);
    const vec3 TOP_ACROSS = vec3(1.0, 0.0, 0.0);

    float lobe(vec3 r, vec3 dir, float width) {
      return exp((dot(r, dir) - 1.0) / (width * width));
    }

    float rectLight(vec3 r, vec3 dir, vec3 across, vec2 extent, float soft) {
      float facing = dot(r, dir);
      if (facing <= 0.0) return 0.0;
      vec3 up = cross(dir, across);
      float u = dot(r, across) / facing;
      float v = dot(r, up) / facing;
      float a = 1.0 - smoothstep(extent.x - soft, extent.x + soft, abs(u));
      float b = 1.0 - smoothstep(extent.y - soft, extent.y + soft, abs(v));
      return a * b;
    }

    vec3 studio(vec3 r, float soft, vec3 accent, vec3 ink) {
      float sky = clamp(r.y * 0.5 + 0.5, 0.0, 1.0);
      vec3 col = mix(ink * 0.04, ink * 0.14 + accent * 0.04, smoothstep(0.25, 0.95, sky));
      col += mix(ink, vec3(1.0), 0.6) * lobe(r, KEY_DIR, 0.38) * 3.5;
      col += mix(accent, vec3(1.0), 0.22) * lobe(r, RIM_DIR, 0.34) * 3.3;
      col += vec3(1.0, 0.98, 1.0) * rectLight(r, LEFT_DIR, LEFT_ACROSS, vec2(0.12, 0.8), 0.08 + soft) * 3.0;
      col += vec3(1.0, 0.98, 1.0) * rectLight(r, TOP_DIR, TOP_ACROSS, vec2(0.9, 0.1), 0.08 + soft) * 2.5;
      return col;
    }

    float schlick(float cosine, float f0) {
      float c = clamp(1.0 - clamp(cosine, 0.0, 1.0), 0.0, 1.0);
      float c2 = c * c;
      return f0 + (1.0 - f0) * c2 * c2 * c;
    }

    float edgeDist(vec2 p, vec2 a, vec2 b, float orient) {
      vec2 e = b - a;
      float len = max(length(e), 1e-4);
      vec2 n = vec2(e.y, -e.x) * (orient / len);
      return dot(p - a, n);
    }

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 p0 = v_p01.xy;
      vec2 p1 = v_p01.zw;
      vec2 p2 = v_p23.xy;
      vec2 p3 = v_p23.zw;
      vec2 p4 = v_p4.xy;
      float sides = v_p4.z;

      float area = (p0.x * p1.y - p0.y * p1.x) + (p1.x * p2.y - p1.y * p2.x);
      if (sides < 3.5) {
        area += (p2.x * p0.y - p2.y * p0.x);
      } else if (sides < 4.5) {
        area += (p2.x * p3.y - p2.y * p3.x) + (p3.x * p0.y - p3.y * p0.x);
      } else {
        area += (p2.x * p3.y - p2.y * p3.x) + (p3.x * p4.y - p3.y * p4.x) + (p4.x * p0.y - p4.y * p0.x);
      }
      float orient = area >= 0.0 ? 1.0 : -1.0;

      float d0 = edgeDist(v_local, p0, p1, orient);
      float d1 = edgeDist(v_local, p1, p2, orient);
      float d2 = sides < 3.5 ? edgeDist(v_local, p2, p0, orient) : edgeDist(v_local, p2, p3, orient);
      float d3 = sides < 3.5 ? -10.0 : (sides < 4.5 ? edgeDist(v_local, p3, p0, orient) : edgeDist(v_local, p3, p4, orient));
      float d4 = sides < 4.5 ? -10.0 : edgeDist(v_local, p4, p0, orient);

      float maxDist = max(max(d0, d1), max(d2, max(d3, d4)));
      float aa = clamp(v_axis.w, 0.018, 0.22);
      float coverage = 1.0 - smoothstep(-aa, aa, maxDist);
      if (coverage <= 0.002) discard;

      float bevelRadius = max(0.14, aa * 2.4);
      float gap = max(-maxDist, 0.0);
      float bevel = clamp(1.0 - gap / bevelRadius, 0.0, 1.0);

      vec2 edgeGrad = vec2(0.0);
      edgeGrad += normalize(vec2(p1.y - p0.y, p0.x - p1.x) * orient) * exp(-abs(d0 - maxDist) * 14.0);
      edgeGrad += normalize(vec2(p2.y - p1.y, p1.x - p2.x) * orient) * exp(-abs(d1 - maxDist) * 14.0);
      if (sides < 3.5) {
        edgeGrad += normalize(vec2(p0.y - p2.y, p2.x - p0.x) * orient) * exp(-abs(d2 - maxDist) * 14.0);
      } else {
        edgeGrad += normalize(vec2(p3.y - p2.y, p2.x - p3.x) * orient) * exp(-abs(d2 - maxDist) * 14.0);
        if (sides < 4.5) {
          edgeGrad += normalize(vec2(p0.y - p3.y, p3.x - p0.x) * orient) * exp(-abs(d3 - maxDist) * 14.0);
        } else {
          edgeGrad += normalize(vec2(p4.y - p3.y, p3.x - p4.x) * orient) * exp(-abs(d3 - maxDist) * 14.0);
          edgeGrad += normalize(vec2(p0.y - p4.y, p4.x - p0.x) * orient) * exp(-abs(d4 - maxDist) * 14.0);
        }
      }
      vec2 toward = length(edgeGrad) > 1e-4 ? normalize(edgeGrad) : vec2(0.0, 1.0);

      vec3 axis = normalize(v_axis.xyz);
      vec3 plateNormal = normalize(v_normal.xyz);
      vec3 side = normalize(cross(plateNormal, axis));

      float angle = bevel * bevel * 0.82;
      vec3 localN = normalize(vec3(toward * sin(angle), cos(angle)));
      vec3 worldNormal = normalize(axis * localN.x + side * localN.y + plateNormal * localN.z);

      vec3 worldPos = v_center.xyz + (axis * v_local.x + side * v_local.y) * v_center.w;
      vec3 viewDir = normalize(u_eye - worldPos);
      if (dot(worldNormal, viewDir) < 0.0) {
        worldNormal = -worldNormal;
      }

      vec3 worldRay = -viewDir;
      vec3 reflected = reflect(worldRay, worldNormal);
      float ndv = clamp(dot(worldNormal, viewDir), 0.0, 1.0);

      float height = clamp(0.5 + worldPos.y * 0.45, 0.0, 1.0);
      vec3 tone = mix(u_accentColor, u_shardColor, height);
      vec3 body = mix(tone, mix(u_shardColor, u_accentColor, 0.5), fract(v_normal.w) * 0.35);

      float finishMode = u_surface.x;
      float soft = 0.04 + bevel * 0.14;
      float wrap = clamp(dot(worldNormal, KEY_DIR) * 0.5 + 0.5, 0.0, 1.0);
      float edgeFactor = max(pow(1.0 - localN.z, 1.15), bevel * bevel * 0.92);

      vec3 color = vec3(0.0);
      float alpha = 1.0;

      if (finishMode > 0.5 && finishMode < 1.5) {
        // CHROME (Keskin, aynalı, yüksek kontrast)
        vec3 env = studio(reflected, soft * 0.45, u_accentColor, body);
        float fresnel = schlick(ndv, 0.25);
        color = env * mix(body, vec3(1.0), 0.58) * (0.75 + 0.35 * fresnel) + body * 0.04;
        color += mix(u_accentColor, vec3(1.0), 0.45) * edgeFactor * 0.55;
        alpha = 0.92;
      } else if (finishMode >= 1.5) {
        // SATIN (Mat-saten, yumuşak ipeksi yansıma)
        vec3 env = studio(reflected, soft + 0.24, u_accentColor, body);
        float fresnel = schlick(ndv, 0.08);
        vec3 sheen = mix(body, u_accentColor, 0.45) * pow(1.0 - ndv, 2.2) * 0.85;
        color = body * (0.18 + 0.42 * wrap) + env * (0.28 + 0.48 * fresnel) + sheen;
        color += mix(body, vec3(1.0), 0.3) * edgeFactor * 0.45;
        alpha = clamp(0.55 + edgeFactor * 0.38 + fresnel * 0.25, 0.0, 0.95);
      } else {
        // PEARL / GLASS (Opal cam, kırılma ve parlak kenar yansıması)
        float fresnel = schlick(ndv, 0.045);
        vec3 env = studio(reflected, soft, u_accentColor, body);
        vec3 refractedDir = refract(worldRay, worldNormal, 0.67);
        vec3 refractedEnv = studio(refractedDir, soft * 1.8 + 0.06, u_accentColor, body);
        vec3 absorb = exp(-(vec3(1.0) - body) * 2.1);
        vec3 internalLight = refractedEnv * absorb * (1.0 - fresnel) * 0.85;
        vec3 edgeGlow = mix(mix(body, u_accentColor, 0.42), vec3(1.0), 0.32) * edgeFactor * (0.42 + 0.52 * wrap);
        color = env * fresnel * 0.92 + internalLight * (1.0 - smoothstep(0.0, 0.65, bevel)) + body * 0.04 + edgeGlow;
        alpha = clamp(0.28 + fresnel * 0.62 + edgeFactor * 0.55, 0.0, 0.96);
      }

      // Atmosferik derinlik sisi ve katman solması (fade)
      float viewDepth = max(length(u_eye - worldPos), 0.1);
      float haze = smoothstep(3.5, 12.0, viewDepth) * 0.68;
      vec3 hazeColor = mix(u_shardColor, u_accentColor, 0.5) * 0.28;
      color = mix(color, hazeColor * alpha + color * 0.32, haze);

      // Tıklama dalgası (ripple flash) parlaması
      float flash = v_p4.w;
      color += mix(u_accentColor, vec3(1.0), 0.38) * flash * 0.65 * max(alpha, 0.4);
      alpha = max(alpha, flash * 0.48);

      // Katman görünürlük çarpanı (fade * coverage)
      float layerFade = floor(v_normal.w) * 0.001;
      float finalAlpha = clamp(alpha * coverage * layerFade, 0.0, 1.0);

      // Tone-mapping, Bloom ışıması ve hafif kumlanma (Grain)
      float glowBoost = 1.0 + u_surface.y * 0.65;
      vec3 mapped = (1.0 - exp(-max(color, vec3(0.0)) * 1.35 * glowBoost));
      if (u_surface.z > 0.001) {
        float noise = hash12(floor(gl_FragCoord.xy) + vec2(u_surface.w, u_surface.w * 1.618)) - 0.5;
        mapped *= (1.0 + noise * u_surface.z);
      }

      gl_FragColor = vec4(mapped * finalAlpha, finalAlpha);
    }
  `;

  // ============================================================================
  // GLSL SHADER: LATTICE İŞARETÇİLERİ ('plus' ve 'dots' + hedef parantezi)
  // ============================================================================
  const MARKER_VS = `
    attribute vec4 a_pos;   // xy: clipPos, zw: localOffset
    attribute vec4 a_shape; // x: size, y: blur, z: frame, w: pixelScale
    attribute vec4 a_light; // x: glow, y: fade, z: style (0=plus, 1=dots), w: unused

    varying vec2 v_local;
    varying vec4 v_shape;
    varying vec4 v_light;

    void main() {
      gl_Position = vec4(a_pos.xy, 0.5, 1.0);
      v_local = a_pos.zw;
      v_shape = a_shape;
      v_light = a_light;
    }
  `;

  const MARKER_FS = `
    precision highp float;

    varying vec2 v_local;
    varying vec4 v_shape;
    varying vec4 v_light;

    uniform vec3 u_shardColor;
    uniform vec3 u_accentColor;

    float bar(float value, float edge, float soft) {
      return clamp((edge - value) / max(soft, 1e-4) + 0.5, 0.0, 1.0);
    }

    void main() {
      float size = v_shape.x;
      float blur = v_shape.y;
      float frame = v_shape.z;
      float pixel = v_shape.w;
      vec2 q = abs(v_local);
      float soft = 1.0 + blur;
      float thick = 0.65 * pixel + blur * 0.5;
      float energy = (0.65 * pixel) / max(thick, 1e-4);

      float cover = 0.0;
      if (v_light.z < 0.5) {
        float across = bar(q.x, size, soft) * bar(q.y, thick, soft);
        float down = bar(q.y, size, soft) * bar(q.x, thick, soft);
        cover = max(across, down) * energy;
      } else {
        cover = bar(length(v_local), size * 0.44 + blur * 0.3, soft) * mix(1.0, energy, 0.6);
      }

      if (frame > 0.001) {
        float edge = size * 2.3;
        float span = edge * 0.45;
        float line = 0.55 * pixel;
        float sides = bar(abs(q.x - edge), line, 1.0) * bar(edge - span - q.y, 0.0, 1.0) * bar(q.y - edge - line, 0.0, 1.0);
        float caps = bar(abs(q.y - edge), line, 1.0) * bar(edge - span - q.x, 0.0, 1.0) * bar(q.x - edge - line, 0.0, 1.0);
        cover = max(cover, max(sides, caps) * frame * 0.85);
      }

      float glow = v_light.x;
      float fade = v_light.y;
      float light = cover * glow * fade;
      if (light <= 0.002) discard;

      vec3 tint = mix(u_shardColor, u_accentColor, 0.42);
      vec3 color = (1.0 - exp(-mix(tint, vec3(1.0), 0.35) * light * 1.6)) * 1.35;
      float alpha = clamp(max(max(color.r, color.g), color.b) * 0.82, 0.0, 1.0);
      gl_FragColor = vec4(color * alpha, alpha);
    }
  `;

  // ============================================================================
  // MATEMATİK VE PROSEDÜREL KIYMIK FONKSİYONLARI
  // ============================================================================
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const smoother = (x) => {
    const t = clamp(x, 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
  };

  const prefersReduced = () =>
    typeof window !== 'undefined' &&
    Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const latticeHash = (a, b, c, d) => {
    let h = Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
    h ^= Math.imul(c + 0x27d4eb2f, 0x165667b1) ^ Math.imul(d + 0x7f4a7c15, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  };

  const random = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const ribbonPoint = (placement, level, s, aspect, out) => {
    let u;
    let v;
    let d;
    if (placement === 0) {
      u = -1.32 + 2.64 * s;
      const slope = FULL_SLOPES[level];
      v =
        slope[0] +
        (slope[1] - slope[0]) * s +
        0.1 * Math.sin(s * TAU * 0.7 + level * 2.3) +
        0.045 * Math.sin(s * TAU * 1.9 + level);
      d = DEPTHS[level] + 0.35 * Math.sin(s * Math.PI * 1.4 + level * 1.9);
    } else if (placement === 3) {
      const angle = s * TAU + level * 0.9 + Math.PI * 0.5;
      const size = RING_SIZES[level];
      u = Math.cos(angle) * size[0];
      v = Math.sin(angle) * size[1] - 0.02;
      d = DEPTHS[level] * 1.1 - Math.sin(angle) * (0.5 + level * 0.25);
    } else {
      const mirror = placement === 1 ? -1 : 1;
      v = 1.32 - 2.64 * s;
      u =
        mirror *
        (SIDE_OFFSETS[level] +
          0.1 * Math.sin(s * TAU * 0.6 + level * 1.3) +
          0.03 * Math.sin(s * TAU * 2.1 + level) -
          0.08 * (1 - s));
      d = DEPTHS[level] + 0.3 * Math.sin(s * Math.PI * 1.2 + level);
    }
    out[0] = (u * aspect * d) / CAMERA;
    out[1] = (v * d) / CAMERA;
    out[2] = CAMERA - d;
    return out;
  };

  const createShards = (count, seed) => {
    const next = random(seed);
    const shards = [];
    let made = 0;
    for (let level = 0; level < LEVELS; level += 1) {
      const amount = level === LEVELS - 1 ? count - made : Math.round(count * SHARE[level]);
      made += amount;
      for (let index = 0; index < amount; index += 1) {
        const flat = next() * 2 - 1;
        const family = next();
        const outline = [];
        if (family < 0.55) {
          const spread = 0.17 + next() * 0.15;
          outline.push([1, (next() - 0.5) * 0.08]);
          outline.push([-0.5 - next() * 0.25, spread * (0.8 + next() * 0.4)]);
          outline.push([-0.5 - next() * 0.25, -spread * (0.8 + next() * 0.4)]);
        } else if (family < 0.8) {
          const spread = 0.2 + next() * 0.14;
          outline.push([1, 0]);
          outline.push([(next() - 0.3) * 0.5, spread]);
          outline.push([-0.55 - next() * 0.2, (next() - 0.5) * 0.1]);
          outline.push([(next() - 0.3) * 0.5, -spread * (0.8 + next() * 0.4)]);
        } else {
          const sides = next() < 0.5 ? 4 : 5;
          const stretch = 0.4 + next() * 0.3;
          const turn = next() * TAU;
          for (let corner = 0; corner < sides; corner += 1) {
            const angle = turn + ((corner + (next() - 0.5) * 0.6) * TAU) / sides;
            outline.push([Math.cos(angle), Math.sin(angle) * stretch]);
          }
        }
        const sides = outline.length;
        let mx = 0;
        let my = 0;
        for (const point of outline) {
          mx += point[0] / sides;
          my += point[1] / sides;
        }
        const shape = [];
        let maxRadius = 0.2;
        for (let corner = 0; corner < 5; corner += 1) {
          const point = outline[Math.min(corner, sides - 1)];
          const sx = point[0] - mx;
          const sy = point[1] - my;
          shape.push(sx, sy);
          const r = Math.hypot(sx, sy);
          if (r > maxRadius) maxRadius = r;
        }
        shards.push({
          level,
          phase: (index + next()) / Math.max(amount, 1),
          lane: Math.sign(flat) * Math.pow(Math.abs(flat), 0.85),
          layer: Math.sqrt(-2 * Math.log(Math.max(next(), 1e-6))) * Math.cos(TAU * next()),
          size: 0.6 + next() * next() * 1.25,
          shape,
          maxRadius: maxRadius + 0.12,
          sides,
          thickness: 0.06 + next() * 0.04,
          yaw: (next() - 0.5) * 0.36,
          bank: (next() - 0.5) * 0.5,
          pitch: (next() - 0.5) * 0.24,
          tint: next(),
          drift: [next() * TAU, next() * TAU, next() * TAU],
          rate: [0.3 + next() * 0.35, 0.25 + next() * 0.35, 0.3 + next() * 0.3],
          flutter: [next() * TAU, 0.5 + next() * 0.5],
          arrive: next(),
          sign: next() < 0.5 ? -1 : 1,
          slot: [next() * TAU, 0.06 + 0.3 * Math.sqrt(next()), next() - 0.5, next() < 0.85 ? 1 : -1],
          offset: [0, 0, 0],
          velocity: [0, 0, 0],
          tilt: 0,
          tiltVelocity: 0,
          flash: 0,
          gather: 0,
          joined: false,
          position: [0, 0, 0],
          s: 0,
        });
      }
    }
    return shards;
  };

  // ============================================================================
  // YAPILANDIRMA VE URL SORGU PARAMETRELERİNİ BİRLEŞTİRME
  // ============================================================================
  function resolvePlacementIndex(cfg) {
    const raw = String(cfg.placement || cfg.arrangement || 'full').toLowerCase();
    const mapped = ARRANGEMENT_TO_PLACEMENT[raw] || 'full';
    return Math.max(0, PLACEMENTS.indexOf(mapped));
  }

  function resolveFinishMode(cfg) {
    const raw = String(cfg.finish || cfg.material || 'pearl').toLowerCase();
    return FINISH_MODES[raw] !== undefined ? FINISH_MODES[raw] : 0;
  }

  function applyUrlOverrides(baseConfig) {
    const cfg = JSON.parse(JSON.stringify(baseConfig));
    if (typeof window === 'undefined' || !window.location) return cfg;

    const params = new URLSearchParams(window.location.search);
    if (params.has('bg') || params.has('arrangement') || params.has('placement')) {
      const val = (params.get('bg') || params.get('arrangement') || params.get('placement')).toLowerCase();
      if (ARRANGEMENT_TO_PLACEMENT[val]) {
        cfg.arrangement = val;
        cfg.placement = ARRANGEMENT_TO_PLACEMENT[val];
      }
    }
    if (params.has('finish') || params.has('material')) {
      const val = (params.get('finish') || params.get('material')).toLowerCase();
      if (FINISH_MODES[val] !== undefined) {
        cfg.finish = val;
        cfg.material = val;
      }
    }
    if (params.has('mode') || params.has('mouseMode')) {
      const val = (params.get('mode') || params.get('mouseMode')).toLowerCase();
      if (val === 'repel' || val === 'attract' || val === 'push' || val === 'pull') {
        cfg.mouseMode = val === 'attract' || val === 'pull' ? 'attract' : 'repel';
      }
    }
    if (params.has('markers')) {
      const val = params.get('markers').toLowerCase();
      if (MARKER_STYLES[val] !== undefined) cfg.markers = val;
    }
    if (params.has('count')) {
      const n = parseInt(params.get('count'), 10);
      if (!Number.isNaN(n)) cfg.count = clamp(n, 120, 4000);
    }
    if (params.has('speed')) {
      const spd = parseFloat(params.get('speed'));
      if (!Number.isNaN(spd)) cfg.speed = clamp(spd, 0, 4);
    }
    if (params.has('tier')) {
      const tier = params.get('tier').toLowerCase();
      if (cfg.qualityTiers && cfg.qualityTiers[tier]) {
        cfg.activeTier = tier;
      }
    }
    return cfg;
  }

  // ============================================================================
  // ANA AERO SHARDS MOTORU BAŞLATICI
  // ============================================================================
  async function initAeroShards() {
    const container = document.getElementById('aero-shards-bg');
    if (!container) return;

    // 1. Yapılandırmayı public/js/background/config.json üzerinden yükle
    let loadedConfig = {
      arrangement: 'stream',
      placement: 'full',
      finish: 'pearl',
      material: 'glass',
      colors: {
        shardColorVar: '--aero-shard-color',
        accentColorVar: '--aero-accent-color',
        backgroundColorVar: '--aero-bg-color',
      },
      count: 1300,
      shardSize: 1,
      spread: 1,
      twist: 1,
      billow: 1,
      speed: 1,
      scale: 1,
      depthOfField: 0.75,
      glow: 0.35,
      grain: 0.06,
      vignette: 0.3,
      intro: true,
      markers: 'plus',
      mouseInteraction: true,
      mouseMode: 'repel',
      mouseStrength: 0.6,
      pulseOnClick: true,
      holdToGather: true,
      parallax: 0.5,
      dpr: 2,
      qualityTiers: {
        high: { count: 1300, dpr: 2, depthOfField: 0.75, glow: 0.35 },
        medium: { count: 750, dpr: 1.5, depthOfField: 0.5, glow: 0.28 },
        low: { count: 420, dpr: 1.0, depthOfField: 0, glow: 0.2 },
      },
      performance: {
        desktopDefaultTier: 'high',
        mobileDefaultTier: 'medium',
        fpsSampleFrames: 55,
        downgradeFpsThreshold: 44,
        criticalFpsThreshold: 28,
        resizeDebounceMs: 120,
      },
    };

    try {
      const res = await fetch('/js/background/config.json', { cache: 'no-cache' });
      if (res.ok) {
        const json = await res.json();
        loadedConfig = Object.assign({}, loadedConfig, json);
      }
    } catch (_) {
      // Varsayılan parametrik yapılandırma ile devam et
    }

    const config = applyUrlOverrides(loadedConfig);
    const isMobileDevice =
      window.innerWidth < 1024 ||
      (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

    let currentTierName =
      config.activeTier ||
      (isMobileDevice
        ? config.performance?.mobileDefaultTier || 'medium'
        : config.performance?.desktopDefaultTier || 'high');

    const applyTierSettings = (tierName) => {
      const tier = config.qualityTiers?.[tierName];
      if (!tier) return;
      currentTierName = tierName;
      if (!new URLSearchParams(window.location.search).has('count')) {
        config.count = tier.count;
      }
      config.dpr = tier.dpr;
      config.depthOfField = tier.depthOfField;
      config.glow = tier.glow;
    };

    applyTierSettings(currentTierName);

    // 2. Canvas oluştur ve WebGL bağlamını hazırla
    const canvas = document.createElement('canvas');
    canvas.className = 'aero-shards-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);

    const activateStaticFallback = (reason) => {
      console.warn(`[Aero Shards] WebGL devre dışı veya bağlam kaybedildi (${reason}). Statik gradyan arka plana geçildi.`);
      container.classList.add('aero-shards-fallback');
      canvas.style.opacity = '0';
    };

    if (!global.AeroWebGL) {
      activateStaticFallback('AeroWebGL yardımcısı bulunamadı');
      return;
    }

    const gl = global.AeroWebGL.createContext(canvas);
    if (!gl) {
      activateStaticFallback('WebGL desteklenmiyor');
      return;
    }

    let shardProgram;
    let markerProgram;
    try {
      shardProgram = global.AeroWebGL.createProgram(gl, SHARD_VS, SHARD_FS);
      markerProgram = global.AeroWebGL.createProgram(gl, MARKER_VS, MARKER_FS);
    } catch (err) {
      activateStaticFallback(err.message);
      return;
    }

    // Shader konumları
    const shardLocs = {
      a_pos: gl.getAttribLocation(shardProgram, 'a_pos'),
      a_center: gl.getAttribLocation(shardProgram, 'a_center'),
      a_axis: gl.getAttribLocation(shardProgram, 'a_axis'),
      a_normal: gl.getAttribLocation(shardProgram, 'a_normal'),
      a_p01: gl.getAttribLocation(shardProgram, 'a_p01'),
      a_p23: gl.getAttribLocation(shardProgram, 'a_p23'),
      a_p4: gl.getAttribLocation(shardProgram, 'a_p4'),
      u_eye: gl.getUniformLocation(shardProgram, 'u_eye'),
      u_shardColor: gl.getUniformLocation(shardProgram, 'u_shardColor'),
      u_accentColor: gl.getUniformLocation(shardProgram, 'u_accentColor'),
      u_surface: gl.getUniformLocation(shardProgram, 'u_surface'),
      u_resolution: gl.getUniformLocation(shardProgram, 'u_resolution'),
    };

    const markerLocs = {
      a_pos: gl.getAttribLocation(markerProgram, 'a_pos'),
      a_shape: gl.getAttribLocation(markerProgram, 'a_shape'),
      a_light: gl.getAttribLocation(markerProgram, 'a_light'),
      u_shardColor: gl.getUniformLocation(markerProgram, 'u_shardColor'),
      u_accentColor: gl.getUniformLocation(markerProgram, 'u_accentColor'),
    };

    const shardBuffer = gl.createBuffer();
    const markerBuffer = gl.createBuffer();

    // 3. CSS Değişkenlerinden Renkleri Oku (Sabit renk kodu yok!)
    const readThemePalette = () => {
      const shardVar = config.colors?.shardColorVar || '--aero-shard-color';
      const accentVar = config.colors?.accentColorVar || '--aero-accent-color';
      return {
        shard: global.AeroWebGL.resolveThemeColor(shardVar, [0.537, 0.416, 0.741]),
        accent: global.AeroWebGL.resolveThemeColor(accentVar, [0.659, 0.333, 0.969]),
      };
    };

    let palette = readThemePalette();

    // 4. Simülasyon Durumu
    const paths = Array.from({ length: LEVELS }, () => ({
      position: new Float32Array(SAMPLES * 3),
      tangent: new Float32Array(SAMPLES * 3),
      across: new Float32Array(SAMPLES * 3),
      lift: new Float32Array(SAMPLES * 3),
      length: 1,
    }));
    const raw = new Float32Array((SAMPLES + 1) * 3);
    const lengths = new Float32Array(SAMPLES + 1);
    const point = [0, 0, 0];
    let pathKey = '';

    const initialPlacement = resolvePlacementIndex(config);
    const state = {
      clock: 0,
      last: 0,
      travel: new Float64Array(LEVELS),
      roll: 0,
      twist: 0,
      drift: 0,
      introAt: -1,
      placement: initialPlacement,
      finishMode: resolveFinishMode(config),
      weights: PLACEMENTS.map((_, idx) => (idx === initialPlacement ? 1 : 0)),
      weightVelocity: [0, 0, 0, 0],
      shards: createShards(config.count, 1337),
      order: [],
      pointer: [0.5, 0.5],
      inside: false,
      presence: 0,
      yaw: 0,
      pitch: 0,
      yawVelocity: 0,
      pitchVelocity: 0,
      pressAt: -1,
      pressPoint: null,
      holding: false,
      hold: 0,
      reach: 0,
      gatherCenter: [0, 0, 0],
      rings: [],
      markerDrift: 0,
      markerTarget: '',
      targets: new Map(),
      contextLost: false,
      firstFrameRendered: false,
      fpsFrames: 0,
      fpsElapsed: 0,
      fpsEvaluated: false,
    };

    let shardVertexData = new Float32Array(config.count * SHARD_VERTICES * SHARD_FLOATS_PER_VERTEX);
    let staging = new Float32Array(config.count * 24);
    let depths = new Float32Array(config.count);
    let markerVertexData = new Float32Array(1024 * MARKER_VERTICES * MARKER_FLOATS_PER_VERTEX);

    const ensureShardBuffers = (count) => {
      const neededVertFloats = count * SHARD_VERTICES * SHARD_FLOATS_PER_VERTEX;
      if (shardVertexData.length < neededVertFloats) {
        shardVertexData = new Float32Array(neededVertFloats);
        staging = new Float32Array(count * 24);
        depths = new Float32Array(count);
      }
    };

    const ensureMarkerBuffers = (markerCount) => {
      const needed = markerCount * MARKER_VERTICES * MARKER_FLOATS_PER_VERTEX;
      if (markerVertexData.length < needed) {
        markerVertexData = new Float32Array(Math.max(needed, markerVertexData.length * 2));
      }
    };

    // 5. Çözünürlük ve Debounced Boyutlandırma (100dvh uyumlu, max DPR = 2)
    let viewWidth = 1;
    let viewHeight = 1;
    let cssWidth = 1;
    let cssHeight = 1;

    const updateCanvasSize = () => {
      const maxDpr = clamp(config.dpr || 2, 0.5, 2);
      const ratio = Math.min(window.devicePixelRatio || 1, maxDpr);
      cssWidth = Math.max(1, container.clientWidth || window.innerWidth);
      cssHeight = Math.max(1, container.clientHeight || window.innerHeight);
      const nextW = Math.max(1, Math.round(cssWidth * ratio));
      const nextH = Math.max(1, Math.round(cssHeight * ratio));
      if (nextW !== viewWidth || nextH !== viewHeight) {
        viewWidth = nextW;
        viewHeight = nextH;
        canvas.width = viewWidth;
        canvas.height = viewHeight;
        gl.viewport(0, 0, viewWidth, viewHeight);
      }
    };

    let resizeTimer = null;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(updateCanvasSize, config.performance?.resizeDebounceMs || 120);
    };
    updateCanvasSize();
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', onResize, { passive: true });

    // 6. Prosedürel Akış Yolu İnşası
    const buildPaths = (aspect) => {
      const closed = state.weights[3] > 0.999;
      const key = `${aspect.toFixed(4)}|${state.weights.map((w) => w.toFixed(4)).join(',')}`;
      if (key === pathKey) return closed;
      pathKey = key;

      for (let level = 0; level < LEVELS; level += 1) {
        const path = paths[level];
        let total = 0;
        for (let i = 0; i <= SAMPLES; i += 1) {
          const s = i / SAMPLES;
          let x = 0;
          let y = 0;
          let z = 0;
          for (let k = 0; k < 4; k += 1) {
            const weight = state.weights[k];
            if (weight < 0.0001) continue;
            ribbonPoint(k, level, s, aspect, point);
            x += point[0] * weight;
            y += point[1] * weight;
            z += point[2] * weight;
          }
          raw[i * 3] = x;
          raw[i * 3 + 1] = y;
          raw[i * 3 + 2] = z;
          if (i > 0) {
            total += Math.hypot(x - raw[i * 3 - 3], y - raw[i * 3 - 2], z - raw[i * 3 - 1]);
          }
          lengths[i] = total;
        }
        path.length = Math.max(total, 1e-3);
        let cursor = 0;
        for (let i = 0; i < SAMPLES; i += 1) {
          const want = (i / (SAMPLES - 1)) * total;
          while (cursor < SAMPLES - 1 && lengths[cursor + 1] < want) cursor += 1;
          const span = Math.max(lengths[cursor + 1] - lengths[cursor], 1e-6);
          const f = clamp((want - lengths[cursor]) / span, 0, 1);
          for (let c = 0; c < 3; c += 1) {
            path.position[i * 3 + c] =
              raw[cursor * 3 + c] + (raw[cursor * 3 + 3 + c] - raw[cursor * 3 + c]) * f;
          }
        }
        let px = 0;
        let py = 1;
        let pz = 0;
        for (let i = 0; i < SAMPLES; i += 1) {
          const a = Math.max(0, i - 1);
          const b = Math.min(SAMPLES - 1, i + 1);
          let tx = path.position[b * 3] - path.position[a * 3];
          let ty = path.position[b * 3 + 1] - path.position[a * 3 + 1];
          let tz = path.position[b * 3 + 2] - path.position[a * 3 + 2];
          const tl = Math.hypot(tx, ty, tz) || 1;
          tx /= tl;
          ty /= tl;
          tz /= tl;
          if (i === 0) {
            px = -ty;
            py = tx;
            pz = 0;
          }
          const along = px * tx + py * ty + pz * tz;
          px -= tx * along;
          py -= ty * along;
          pz -= tz * along;
          const pl = Math.hypot(px, py, pz) || 1;
          px /= pl;
          py /= pl;
          pz /= pl;
          path.tangent[i * 3] = tx;
          path.tangent[i * 3 + 1] = ty;
          path.tangent[i * 3 + 2] = tz;
          path.across[i * 3] = px;
          path.across[i * 3 + 1] = py;
          path.across[i * 3 + 2] = pz;
          path.lift[i * 3] = ty * pz - tz * py;
          path.lift[i * 3 + 1] = tz * px - tx * pz;
          path.lift[i * 3 + 2] = tx * py - ty * px;
        }
      }
      return closed;
    };

    const cam = {
      eye: [0, 0, CAMERA],
      forward: [0, 0, -1],
      right: [1, 0, 0],
      up: [0, 1, 0],
      focal: 1,
    };

    const updateCamera = () => {
      const cy = Math.cos(state.yaw);
      const sy = Math.sin(state.yaw);
      const cp = Math.cos(state.pitch);
      const sp = Math.sin(state.pitch);
      cam.eye[0] = sy * cp * CAMERA;
      cam.eye[1] = sp * CAMERA;
      cam.eye[2] = cy * cp * CAMERA;
      cam.forward[0] = -sy * cp;
      cam.forward[1] = -sp;
      cam.forward[2] = -cy * cp;
      const rl = Math.hypot(cam.forward[2], cam.forward[0]) || 1;
      cam.right[0] = -cam.forward[2] / rl;
      cam.right[1] = 0;
      cam.right[2] = cam.forward[0] / rl;
      cam.up[0] = cam.right[1] * cam.forward[2] - cam.right[2] * cam.forward[1];
      cam.up[1] = cam.right[2] * cam.forward[0] - cam.right[0] * cam.forward[2];
      cam.up[2] = cam.right[0] * cam.forward[1] - cam.right[1] * cam.forward[0];
      cam.focal = viewHeight * 0.5 * CAMERA * (config.scale || 1);
    };

    const ray = [0, 0, 1];
    const rayAt = (px, py) => {
      const x = (px - 0.5) * viewWidth;
      const y = (0.5 - py) * viewHeight;
      ray[0] = cam.forward[0] * cam.focal + cam.right[0] * x + cam.up[0] * y;
      ray[1] = cam.forward[1] * cam.focal + cam.right[1] * x + cam.up[1] * y;
      ray[2] = cam.forward[2] * cam.focal + cam.right[2] * x + cam.up[2] * y;
      const length = Math.hypot(ray[0], ray[1], ray[2]) || 1;
      ray[0] /= length;
      ray[1] /= length;
      ray[2] /= length;
      return ray;
    };

    // 7. Fizik Simülasyonu ve Geometri Üretimi
    const flat = [0, 0];
    const screenOf = (x, y, z, out) => {
      const ex = x - cam.eye[0];
      const ey = y - cam.eye[1];
      const ez = z - cam.eye[2];
      const depth = Math.max(
        ex * cam.forward[0] + ey * cam.forward[1] + ez * cam.forward[2],
        0.05
      );
      const halfHeight = viewHeight * 0.5;
      out[0] =
        ((ex * cam.right[0] + ey * cam.right[1] + ez * cam.right[2]) * cam.focal) /
        depth /
        halfHeight;
      out[1] =
        ((ex * cam.up[0] + ey * cam.up[1] + ez * cam.up[2]) * cam.focal) /
        depth /
        halfHeight;
      return depth;
    };

    const simulateAndRender = (dt, reduced) => {
      updateCamera();
      const shards = state.shards;
      ensureShardBuffers(shards.length);

      const aspect = viewWidth / Math.max(viewHeight, 1);
      const closed = buildPaths(aspect);
      const introOn = config.intro && !reduced;
      const introAge = state.introAt < 0 ? 0 : state.clock - state.introAt;
      const hover =
        config.mouseInteraction && !reduced ? state.presence * (config.mouseStrength || 0.6) : 0;
      const cursorDirectionSign = config.mouseMode === 'attract' ? -1 : 1;

      let rx = 0;
      let ry = 0;
      let rz = 0;
      if (hover > 0.001) {
        rayAt(state.pointer[0], state.pointer[1]);
        rx = ray[0];
        ry = ray[1];
        rz = ray[2];
      }

      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / Math.max(steps, 1);
      const rings = state.rings.map((ring) => {
        const life = ring.age / RING_SECONDS;
        return {
          x: ring.x,
          y: ring.y,
          age: ring.age,
          strength: (1 - Math.exp(-ring.age / 0.06)) * (1 - life) * (1 - life),
        };
      });

      const ringBand = (sx, sy, level) => {
        let total = 0;
        for (const ring of rings) {
          const radius = Math.max(0, ring.age - level * 0.07) * 2.3;
          const distance = Math.hypot(sx - ring.x, sy - ring.y);
          total += Math.exp(-((distance - radius) * (distance - radius)) / 0.012) * ring.strength;
        }
        return total;
      };

      const twistWeight = Math.min(1, config.twist);

      for (let index = 0; index < shards.length; index += 1) {
        const shard = shards[index];
        const level = shard.level;
        const path = paths[level];
        let s0 = (shard.phase + state.travel[level]) % 1;
        let appear = 1;
        let introBank = 0;
        if (introOn) {
          const begin =
            level * 0.22 +
            Math.max(0, s0 - 0.1) * (INTRO_SECONDS - 1.0 - (LEVELS - 1) * 0.22) +
            shard.arrive * 0.15;
          const local = clamp((introAge - begin) / 0.9, 0, 1);
          appear = smoother(local);
          const glide = (1 - local) * (1 - local);
          s0 = closed ? s0 - glide * 0.06 : Math.max(0, s0 - glide * 0.06);
          introBank = glide * 0.9 * shard.sign;
        }
        shard.s = s0;
        const f = (((s0 % 1) + 1) % 1) * (SAMPLES - 1);
        const i0 = Math.floor(f);
        const i1 = Math.min(i0 + 1, SAMPLES - 1);
        const t = f - i0;
        const at = (array, c) => array[i0 * 3 + c] + (array[i1 * 3 + c] - array[i0 * 3 + c]) * t;

        const cx = at(path.position, 0);
        const cy = at(path.position, 1);
        const cz = at(path.position, 2);
        const tx = at(path.tangent, 0);
        const ty = at(path.tangent, 1);
        const tz = at(path.tangent, 2);
        const ax0 = at(path.across, 0);
        const ay0 = at(path.across, 1);
        const az0 = at(path.across, 2);
        const lx0 = at(path.lift, 0);
        const ly0 = at(path.lift, 1);
        const lz0 = at(path.lift, 2);

        const angle = config.twist * (s0 * TAU * 0.6 + state.twist + level * 1.7);
        const ca = Math.cos(angle);
        const sa = Math.sin(angle);
        const ax = ax0 * ca + lx0 * sa;
        const ay = ay0 * ca + ly0 * sa;
        const az = az0 * ca + lz0 * sa;
        const bx = lx0 * ca - ax0 * sa;
        const by = ly0 * ca - ay0 * sa;
        const bz = lz0 * ca - az0 * sa;

        const depthScale = DEPTHS[level] / CAMERA;
        const width =
          config.spread *
          (0.15 + 0.035 * DEPTHS[level]) *
          (0.8 + 0.3 * Math.sin(s0 * TAU * 1.3 + level * 0.8));
        const lane = shard.lane * width;
        const layer = shard.layer * 0.012 * depthScale;
        const taper = closed ? 1 : smoother(s0 / 0.12) * smoother((1 - s0) / 0.12);
        const billow =
          config.billow *
          0.16 *
          depthScale *
          Math.sin(s0 * TAU * 1.3 - state.drift * 0.5 + level * 1.1) *
          (0.4 + 0.6 * taper);
        const sway =
          config.billow *
          0.06 *
          depthScale *
          Math.sin(s0 * TAU * 0.8 - state.drift * 0.35 + level * 2.4);
        const wobble = 0.009 * depthScale;
        const drift = state.drift;

        const hx =
          cx +
          lx0 * billow +
          ax0 * sway +
          ax * lane +
          bx * layer +
          Math.sin(drift * shard.rate[0] + shard.drift[0]) * wobble;
        const hy =
          cy +
          ly0 * billow +
          ay0 * sway +
          ay * lane +
          by * layer +
          Math.sin(drift * shard.rate[1] + shard.drift[1]) * wobble;
        const hz =
          cz +
          lz0 * billow +
          az0 * sway +
          az * lane +
          bz * layer +
          Math.sin(drift * shard.rate[2] + shard.drift[2]) * wobble;

        let fx = 0;
        let fy = 0;
        let fz = 0;
        let tiltTarget = 0;
        const px = hx + shard.offset[0];
        const py = hy + shard.offset[1];
        const pz = hz + shard.offset[2];

        if (hover > 0.001) {
          const ex = px - cam.eye[0];
          const ey = py - cam.eye[1];
          const ez = pz - cam.eye[2];
          const along = ex * rx + ey * ry + ez * rz;
          const qx = ex - rx * along;
          const qy = ey - ry * along;
          const qz = ez - rz * along;
          const gap = Math.hypot(qx, qy, qz);
          const reach = (0.24 * depthScale) / (config.scale || 1);
          const falloff = Math.exp(-(gap * gap) / (reach * reach));
          if (falloff > 0.002 && gap > 1e-5) {
            const nx = (qx / gap) * cursorDirectionSign;
            const ny = (qy / gap) * cursorDirectionSign;
            const nz = (qz / gap) * cursorDirectionSign;
            const sideways = (nx * tx + ny * ty + nz * tz) * 0.7;
            const strength = hover * falloff * 9 * depthScale;
            fx += (nx - tx * sideways) * strength;
            fy += (ny - ty * sideways) * strength;
            fz += (nz - tz * sideways) * strength;
            tiltTarget += hover * falloff * 1.1 * (nx * ax0 + ny * ay0 + nz * az0);
          }
        }

        if (state.hold > 0.001 && shard.joined) {
          const slot = shard.slot;
          const orbit = slot[0] + state.clock * (0.8 / (0.12 + slot[1])) * slot[3];
          const radius = slot[1] / (config.scale || 1);
          const gx = state.gatherCenter[0] + Math.cos(orbit) * radius;
          const gy = state.gatherCenter[1] + Math.sin(orbit) * radius * 0.75;
          const gz = state.gatherCenter[2] + Math.sin(orbit) * radius * 0.45 + slot[2] * 0.3;
          shard.gather += (state.hold - shard.gather) * (1 - Math.exp(-dt / 0.3));
          const pull = shard.gather * 30;
          fx += (gx - px) * pull;
          fy += (gy - py) * pull;
          fz += (gz - pz) * pull;
          tiltTarget += shard.gather * 0.6 * Math.sin(orbit);
        } else {
          shard.gather += (0 - shard.gather) * (1 - Math.exp(-dt / 0.2));
        }

        if (rings.length) {
          screenOf(px, py, pz, flat);
          for (const ring of rings) {
            const radius = Math.max(0, ring.age - level * 0.07) * 2.3;
            const dxr = flat[0] - ring.x;
            const dyr = flat[1] - ring.y;
            const distance = Math.hypot(dxr, dyr);
            const band = Math.exp(-((distance - radius) * (distance - radius)) / 0.012) * ring.strength;
            if (band > 0.01) {
              shard.flash = Math.max(shard.flash, band * 0.75);
              const outward = Math.max(distance, 0.05);
              const ux = (cam.right[0] * dxr + cam.up[0] * dyr) / outward;
              const uy = (cam.right[1] * dxr + cam.up[1] * dyr) / outward;
              const uz = (cam.right[2] * dxr + cam.up[2] * dyr) / outward;
              tiltTarget += band * 1.4 * (ux * ax0 + uy * ay0 + uz * az0);
              const push = (band * 2.2 * depthScale) / Math.max(distance, 0.05);
              fx += (cam.right[0] * dxr + cam.up[0] * dyr) * push;
              fy += (cam.right[1] * dxr + cam.up[1] * dyr) * push;
              fz += (cam.right[2] * dxr + cam.up[2] * dyr) * push;
            }
          }
        }

        const stiffness = 24 * (1 - shard.gather * 0.95);
        for (let step = 0; step < steps; step += 1) {
          shard.velocity[0] += (fx - stiffness * shard.offset[0] - 7.5 * shard.velocity[0]) * h;
          shard.velocity[1] += (fy - stiffness * shard.offset[1] - 7.5 * shard.velocity[1]) * h;
          shard.velocity[2] += (fz - stiffness * shard.offset[2] - 7.5 * shard.velocity[2]) * h;
          shard.offset[0] += shard.velocity[0] * h;
          shard.offset[1] += shard.velocity[1] * h;
          shard.offset[2] += shard.velocity[2] * h;
          shard.tiltVelocity += (90 * (tiltTarget - shard.tilt) - 15 * shard.tiltVelocity) * h;
          shard.tilt += shard.tiltVelocity * h;
        }
        shard.flash *= Math.exp(-dt / 0.45);

        const ox = hx + shard.offset[0];
        const oy = hy + shard.offset[1];
        const oz = hz + shard.offset[2];
        shard.position[0] = ox;
        shard.position[1] = oy;
        shard.position[2] = oz;

        let vx = cam.eye[0] - ox;
        let vy = cam.eye[1] - oy;
        let vz = cam.eye[2] - oz;
        const vl = Math.hypot(vx, vy, vz) || 1;
        vx /= vl;
        vy /= vl;
        vz /= vl;
        let dx = tx + shard.velocity[0] * 0.05;
        let dy = ty + shard.velocity[1] * 0.05;
        let dz = tz + shard.velocity[2] * 0.05;
        const facingPart = dx * vx + dy * vy + dz * vz;
        dx -= vx * facingPart;
        dy -= vy * facingPart;
        dz -= vz * facingPart;
        let dl = Math.hypot(dx, dy, dz);
        if (dl < 1e-4) {
          dx = cam.right[0];
          dy = cam.right[1];
          dz = cam.right[2];
          dl = 1;
        }
        dx /= dl;
        dy /= dl;
        dz /= dl;
        const wx = vy * dz - vz * dy;
        const wy = vz * dx - vx * dz;
        const wz = vx * dy - vy * dx;
        const yaw = shard.yaw + 0.05 * Math.sin(state.clock * shard.flutter[1] * 0.7 + shard.flutter[0]);
        const cyaw = Math.cos(yaw);
        const syaw = Math.sin(yaw);
        const kx = dx * cyaw + wx * syaw;
        const ky = dy * cyaw + wy * syaw;
        const kz = dz * cyaw + wz * syaw;
        const jx = wx * cyaw - dx * syaw;
        const jy = wy * cyaw - dy * syaw;
        const jz = wz * cyaw - dz * syaw;
        const wave =
          0.8 * twistWeight * Math.sin(angle) +
          0.3 * Math.sin(s0 * TAU * 1.6 - state.roll * 0.55 + level * 0.9 + shard.lane * 0.7);
        const flutter = 0.06 * Math.sin(state.clock * shard.flutter[1] + shard.flutter[0]);
        const bank = MAX_BANK * Math.tanh((wave + shard.bank + flutter + shard.tilt + introBank) / MAX_BANK);
        const cb = Math.cos(bank);
        const sb = Math.sin(bank);
        const mx = vx * cb + jx * sb;
        const my = vy * cb + jy * sb;
        const mz = vz * cb + jz * sb;
        const pitch = shard.pitch + 0.2 * Math.sin(s0 * TAU * 1.1 - state.roll * 0.4 + level * 2.1);
        const cp = Math.cos(pitch);
        const sp = Math.sin(pitch);
        const axisX = kx * cp + mx * sp;
        const axisY = ky * cp + my * sp;
        const axisZ = kz * cp + mz * sp;
        const nx = mx * cp - kx * sp;
        const ny = my * cp - ky * sp;
        const nz = mz * cp - kz * sp;

        const ex = ox - cam.eye[0];
        const ey = oy - cam.eye[1];
        const ez = oz - cam.eye[2];
        const viewDepth = ex * cam.forward[0] + ey * cam.forward[1] + ez * cam.forward[2];
        depths[index] = viewDepth + level * 100;

        const core = 1 - 0.45 * shard.lane * shard.lane;
        const size =
          0.062 *
          (config.shardSize || 1) *
          shard.size *
          GROWTH[level] *
          appear *
          Math.sqrt(taper) *
          core;

        const o = index * 24;
        staging[o] = ox;
        staging[o + 1] = oy;
        staging[o + 2] = oz;
        staging[o + 3] = size > 1e-5 ? size : 0;
        staging[o + 4] = axisX;
        staging[o + 5] = axisY;
        staging[o + 6] = axisZ;
        staging[o + 7] = shard.thickness;
        staging[o + 8] = nx;
        staging[o + 9] = ny;
        staging[o + 10] = nz;
        staging[o + 11] = shard.tint;
        for (let k = 0; k < 10; k += 1) staging[o + 12 + k] = shard.shape[k];
        staging[o + 22] = shard.sides;
        staging[o + 23] = shard.flash;
      }

      // Derinlik sıralaması (arkadan öne)
      if (state.order.length !== shards.length) {
        state.order = shards.map((_, index) => index);
      }
      const order = state.order;
      for (let i = 1; i < order.length; i += 1) {
        const value = order[i];
        const key = depths[value];
        let j = i - 1;
        while (j >= 0 && depths[order[j]] < key) {
          order[j + 1] = order[j];
          j -= 1;
        }
        order[j + 1] = value;
      }

      // Shard Vertex Buffer Dolumu
      let activeShardVertices = 0;
      const quadCorners = [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ];

      for (let slot = 0; slot < order.length; slot += 1) {
        const idx = order[slot];
        const shard = shards[idx];
        const o = idx * 24;
        const size = staging[o + 3];
        if (size <= 1e-5) continue;

        const ox = staging[o];
        const oy = staging[o + 1];
        const oz = staging[o + 2];
        const ex = ox - cam.eye[0];
        const ey = oy - cam.eye[1];
        const ez = oz - cam.eye[2];
        const depth = ex * cam.forward[0] + ey * cam.forward[1] + ez * cam.forward[2];
        if (depth < 0.35) continue;

        const axisX = staging[o + 4];
        const axisY = staging[o + 5];
        const axisZ = staging[o + 6];
        const nx = staging[o + 8];
        const ny = staging[o + 9];
        const nz = staging[o + 10];

        // side = cross(normal, axis)
        let sx = ny * axisZ - nz * axisY;
        let sy = nz * axisX - nx * axisZ;
        let sz = nx * axisY - ny * axisX;
        const sl = Math.hypot(sx, sy, sz) || 1;
        sx /= sl;
        sy /= sl;
        sz /= sl;

        const level = shard.level;
        const dofBlur =
          0.02 +
          (config.depthOfField || 0) * Math.min(0.18, Math.abs(1 - SHARD_FOCUS / DEPTHS[level]) * 0.16);
        const reach = shard.maxRadius * (1 + dofBlur * 1.6);
        const fadeEncoded = Math.round(FADE[level] * 1000) + clamp(shard.tint, 0.01, 0.99);

        for (let v = 0; v < 6; v += 1) {
          const lx = quadCorners[v][0] * reach;
          const ly = quadCorners[v][1] * reach;
          const wx = ox + (axisX * lx + sx * ly) * size;
          const wy = oy + (axisY * lx + sy * ly) * size;
          const wz = oz + (axisZ * lx + sz * ly) * size;

          const pex = wx - cam.eye[0];
          const pey = wy - cam.eye[1];
          const pez = wz - cam.eye[2];
          const pDepth = Math.max(
            pex * cam.forward[0] + pey * cam.forward[1] + pez * cam.forward[2],
            0.05
          );
          const projX =
            viewWidth * 0.5 +
            ((pex * cam.right[0] + pey * cam.right[1] + pez * cam.right[2]) * cam.focal) / pDepth;
          const projY =
            viewHeight * 0.5 -
            ((pex * cam.up[0] + pey * cam.up[1] + pez * cam.up[2]) * cam.focal) / pDepth;

          const clipX = (projX / viewWidth) * 2 - 1;
          const clipY = 1 - (projY / viewHeight) * 2;

          const base = activeShardVertices * SHARD_FLOATS_PER_VERTEX;
          shardVertexData[base] = clipX;
          shardVertexData[base + 1] = clipY;
          shardVertexData[base + 2] = lx;
          shardVertexData[base + 3] = ly;

          shardVertexData[base + 4] = ox;
          shardVertexData[base + 5] = oy;
          shardVertexData[base + 6] = oz;
          shardVertexData[base + 7] = size;

          shardVertexData[base + 8] = axisX;
          shardVertexData[base + 9] = axisY;
          shardVertexData[base + 10] = axisZ;
          shardVertexData[base + 11] = dofBlur;

          shardVertexData[base + 12] = nx;
          shardVertexData[base + 13] = ny;
          shardVertexData[base + 14] = nz;
          shardVertexData[base + 15] = fadeEncoded;

          for (let k = 0; k < 12; k += 1) {
            shardVertexData[base + 16 + k] = staging[o + 12 + k];
          }
          activeShardVertices += 1;
        }
      }

      // 8. Lattice İşaretçileri ('plus' / 'dots')
      const markerStyle = MARKER_STYLES[config.markers] ?? 0;
      let activeMarkerVertices = 0;

      if (markerStyle >= 0) {
        const ratio = viewHeight / Math.max(cssHeight, 1);
        const halfHeight = viewHeight * 0.5;
        const pointerX = (state.pointer[0] - 0.5) * 2 * aspect;
        const pointerY = (0.5 - state.pointer[1]) * 2;
        const engaged = config.mouseInteraction && !reduced ? state.presence : 0;
        const previousTargets = state.targets;
        const nextTargets = new Map();
        const targetEase = 1 - Math.exp(-dt / 0.12);
        let nearestKey = '';
        let nearestGap = 72;

        for (let level = LEVELS - 1; level >= 0; level -= 1) {
          const depth = DEPTHS[level];
          const depthScale = depth / CAMERA;
          const spacing = 0.42 * Math.pow(depthScale, 0.55);
          const halfW = ((aspect * depth) / (CAMERA * (config.scale || 1))) * 1.12 + spacing;
          const halfH = (depth / (CAMERA * (config.scale || 1))) * 1.12 + spacing;
          const drift = state.markerDrift;
          const phase = MARKER_PHASES[level];
          const i0 = Math.floor((drift - halfW) / spacing - phase[0]);
          const i1 = Math.ceil((drift + halfW) / spacing - phase[0]);
          const j0 = Math.floor(-halfH / spacing - phase[1]);
          const j1 = Math.ceil(halfH / spacing - phase[1]);
          const band = config.spread * (0.15 + 0.035 * depth) * 1.4;
          const position = paths[level].position;

          for (let i = i0; i <= i1; i += 1) {
            for (let j = j0; j <= j1; j += 1) {
              const keep = latticeHash(level, i, j, 11);
              if (keep > 0.5) continue;
              const x = (i + phase[0]) * spacing - drift;
              const y = (j + phase[1]) * spacing;
              const z = CAMERA - depth;
              const markerDepth = screenOf(x, y, z, flat);
              if (Math.abs(flat[0]) > aspect * 1.05 || Math.abs(flat[1]) > 1.05) continue;

              let best = Infinity;
              for (let k = 0; k < SAMPLES; k += 4) {
                const dx = x - position[k * 3];
                const dy = y - position[k * 3 + 1];
                const dz = z - position[k * 3 + 2];
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 < best) best = d2;
              }
              const near = Math.exp(-best / (band * band));
              const blinkSeed = latticeHash(level, i, j, 23);
              const blinkRate = latticeHash(level, i, j, 37);
              const blink =
                blinkSeed < 0.07
                  ? 0.5 + 0.5 * Math.sin(state.clock * (1.4 + blinkRate * 2.2) + blinkRate * 40)
                  : 0;
              const pointerGap = (Math.hypot(flat[0] - pointerX, flat[1] - pointerY) * halfHeight) / ratio;
              const key = `${level}:${i}:${j}`;
              if (level <= 2 && engaged > 0.01 && pointerGap < nearestGap) {
                nearestGap = pointerGap;
                nearestKey = key;
              }
              const wanted =
                key === state.markerTarget ? engaged * (1 - smoother((pointerGap - 30) / 42)) : 0;
              const before = previousTargets.get(key) ?? 0;
              const target = before + (wanted - before) * targetEase;
              if (target > 0.002) nextTargets.set(key, target);
              const bracket = Math.max(smoother((blink - 0.55) / 0.4), target);
              let ring = 0;
              if (rings.length) ring = ringBand(flat[0], flat[1], level);
              let reveal = 1;
              if (introOn) {
                const across = clamp((flat[0] / aspect + 1) * 0.5, 0, 1);
                const begin =
                  level * 0.22 + 0.35 + across * (INTRO_SECONDS - 1.3 - (LEVELS - 1) * 0.22);
                reveal = smoother((introAge - begin) / 0.5);
              }
              const fade = FADE[level] * (1 - smoother((markerDepth - 3) / 10) * 0.45) * reveal;
              if (fade < 0.002) continue;

              ensureMarkerBuffers(activeMarkerVertices / 6 + 2);
              const ex = x - cam.eye[0];
              const ey = y - cam.eye[1];
              const ez = z - cam.eye[2];
              const mDepth = Math.max(
                ex * cam.forward[0] + ey * cam.forward[1] + ez * cam.forward[2],
                0.05
              );
              const cxScreen =
                viewWidth * 0.5 +
                ((ex * cam.right[0] + ey * cam.right[1] + ez * cam.right[2]) * cam.focal) / mDepth;
              const cyScreen =
                viewHeight * 0.5 -
                ((ex * cam.up[0] + ey * cam.up[1] + ez * cam.up[2]) * cam.focal) / mDepth;

              const scaleFactor = 1 + 0.15 * near + 0.3 * blink + 0.2 * target;
              const mSize = 4 * ratio * clamp(Math.sqrt(FOCUS / mDepth), 0.6, 1.3) * scaleFactor;
              const mBlur =
                Math.min(
                  (config.depthOfField || 0) * viewHeight * 0.03 * Math.abs(1 - FOCUS / mDepth),
                  viewHeight * 0.05
                ) * 0.18;
              const mReach = (bracket > 0.001 ? mSize * 2.6 : mSize) + mBlur + 1.5 * ratio;
              const mGlow = 0.42 + 0.5 * near + blink * 0.9 + target * 1.3 + ring * 2.5;

              for (let v = 0; v < 6; v += 1) {
                const oxLocal = quadCorners[v][0] * mReach;
                const oyLocal = quadCorners[v][1] * mReach;
                const atX = cxScreen + oxLocal;
                const atY = cyScreen + oyLocal;
                const clipX = (atX / viewWidth) * 2 - 1;
                const clipY = 1 - (atY / viewHeight) * 2;

                const mb = activeMarkerVertices * MARKER_FLOATS_PER_VERTEX;
                markerVertexData[mb] = clipX;
                markerVertexData[mb + 1] = clipY;
                markerVertexData[mb + 2] = oxLocal;
                markerVertexData[mb + 3] = oyLocal;
                markerVertexData[mb + 4] = mSize;
                markerVertexData[mb + 5] = mBlur;
                markerVertexData[mb + 6] = bracket;
                markerVertexData[mb + 7] = ratio;
                markerVertexData[mb + 8] = mGlow;
                markerVertexData[mb + 9] = fade;
                markerVertexData[mb + 10] = markerStyle;
                markerVertexData[mb + 11] = 0;
                activeMarkerVertices += 1;
              }
            }
          }
        }
        state.targets = nextTargets;
        state.markerTarget = nearestKey;
      }

      // 9. WebGL Çizim Çağrıları
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      // A) İşaretçileri Çiz (Markers)
      if (activeMarkerVertices > 0) {
        gl.useProgram(markerProgram);
        gl.uniform3fv(markerLocs.u_shardColor, palette.shard);
        gl.uniform3fv(markerLocs.u_accentColor, palette.accent);

        gl.bindBuffer(gl.ARRAY_BUFFER, markerBuffer);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          markerVertexData.subarray(0, activeMarkerVertices * MARKER_FLOATS_PER_VERTEX),
          gl.DYNAMIC_DRAW
        );

        const mStride = MARKER_FLOATS_PER_VERTEX * 4;
        gl.enableVertexAttribArray(markerLocs.a_pos);
        gl.vertexAttribPointer(markerLocs.a_pos, 4, gl.FLOAT, false, mStride, 0);
        gl.enableVertexAttribArray(markerLocs.a_shape);
        gl.vertexAttribPointer(markerLocs.a_shape, 4, gl.FLOAT, false, mStride, 16);
        gl.enableVertexAttribArray(markerLocs.a_light);
        gl.vertexAttribPointer(markerLocs.a_light, 4, gl.FLOAT, false, mStride, 32);

        gl.drawArrays(gl.TRIANGLES, 0, activeMarkerVertices);
      }

      // B) 3B Prizma Kıymıklarını Çiz (Shards)
      if (activeShardVertices > 0) {
        gl.useProgram(shardProgram);
        gl.uniform3fv(shardLocs.u_eye, cam.eye);
        gl.uniform3fv(shardLocs.u_shardColor, palette.shard);
        gl.uniform3fv(shardLocs.u_accentColor, palette.accent);
        gl.uniform4f(
          shardLocs.u_surface,
          state.finishMode,
          config.glow || 0.35,
          config.grain || 0.06,
          Math.floor(state.clock * 24)
        );
        gl.uniform2f(shardLocs.u_resolution, viewWidth, viewHeight);

        gl.bindBuffer(gl.ARRAY_BUFFER, shardBuffer);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          shardVertexData.subarray(0, activeShardVertices * SHARD_FLOATS_PER_VERTEX),
          gl.DYNAMIC_DRAW
        );

        const stride = SHARD_FLOATS_PER_VERTEX * 4;
        gl.enableVertexAttribArray(shardLocs.a_pos);
        gl.vertexAttribPointer(shardLocs.a_pos, 4, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(shardLocs.a_center);
        gl.vertexAttribPointer(shardLocs.a_center, 4, gl.FLOAT, false, stride, 16);
        gl.enableVertexAttribArray(shardLocs.a_axis);
        gl.vertexAttribPointer(shardLocs.a_axis, 4, gl.FLOAT, false, stride, 32);
        gl.enableVertexAttribArray(shardLocs.a_normal);
        gl.vertexAttribPointer(shardLocs.a_normal, 4, gl.FLOAT, false, stride, 48);
        gl.enableVertexAttribArray(shardLocs.a_p01);
        gl.vertexAttribPointer(shardLocs.a_p01, 4, gl.FLOAT, false, stride, 64);
        gl.enableVertexAttribArray(shardLocs.a_p23);
        gl.vertexAttribPointer(shardLocs.a_p23, 4, gl.FLOAT, false, stride, 80);
        gl.enableVertexAttribArray(shardLocs.a_p4);
        gl.vertexAttribPointer(shardLocs.a_p4, 4, gl.FLOAT, false, stride, 96);

        gl.drawArrays(gl.TRIANGLES, 0, activeShardVertices);
      }

      // İlk kare hazır olduğunda yumuşak fade-in ile tuvali görünür yap
      if (!state.firstFrameRendered) {
        state.firstFrameRendered = true;
        canvas.classList.add('is-ready');
      }
    };

    // 10. Otomatik Performans / FPS Ölçümü (High -> Medium -> Low)
    const evaluateAutoPerformance = (dt) => {
      if (state.fpsEvaluated || dt <= 0 || dt >= 0.2) return;
      state.fpsFrames += 1;
      state.fpsElapsed += dt;
      const sampleTarget = config.performance?.fpsSampleFrames || 55;
      if (state.fpsFrames >= sampleTarget) {
        const avgFps = state.fpsFrames / Math.max(state.fpsElapsed, 0.001);
        const downgradeThreshold = config.performance?.downgradeFpsThreshold || 44;
        const criticalThreshold = config.performance?.criticalFpsThreshold || 28;

        if (avgFps < criticalThreshold && currentTierName !== 'low') {
          applyTierSettings('low');
          state.shards = createShards(config.count, 1337);
          state.order = [];
          updateCanvasSize();
        } else if (avgFps < downgradeThreshold && currentTierName === 'high') {
          applyTierSettings('medium');
          state.shards = createShards(config.count, 1337);
          state.order = [];
          updateCanvasSize();
          // Medium seviyesinde bir kez daha ölçüm yapabilsin
          state.fpsFrames = 0;
          state.fpsElapsed = 0;
          return;
        }
        state.fpsEvaluated = true;
      }
    };

    // 11. Ana Animasyon Döngüsü (RAF + visibilitychange + prefers-reduced-motion)
    let rafId = 0;
    const tick = (now) => {
      if (state.contextLost) return;
      rafId = requestAnimationFrame(tick);

      if (document.hidden) {
        state.last = now;
        return;
      }

      const reduced = prefersReduced();
      const dt = state.last ? Math.min((now - state.last) / 1000, 0.05) : 0.016;
      state.last = now;

      if (!reduced) {
        evaluateAutoPerformance(dt);
      }

      state.clock += reduced ? 0 : dt;
      if (state.introAt < 0) state.introAt = state.clock;

      if (state.shards.length !== config.count) {
        state.shards = createShards(config.count, 1337);
        state.order = [];
      }

      if (!reduced) {
        for (let level = 0; level < LEVELS; level += 1) {
          state.travel[level] =
            (state.travel[level] + (dt * config.speed * 0.09) / paths[level].length) % 1;
        }
        state.roll += dt * config.speed * 1.0;
        state.twist += dt * config.speed * 0.08;
        state.drift += dt * config.speed;
        state.markerDrift += dt * config.speed * 0.045;
      }

      // Biçimler (Stream / Vortex / Ribbon) arası yay fiziğiyle yumuşak morphing
      const goal = PLACEMENTS.map((_, index) => (index === state.placement ? 1 : 0));
      let settling = false;
      const decay = Math.exp(-4 * dt);
      for (let index = 0; index < 4; index += 1) {
        const offset = state.weights[index] - goal[index];
        const momentum = state.weightVelocity[index] + 4 * offset;
        state.weights[index] = goal[index] + (offset + momentum * dt) * decay;
        state.weightVelocity[index] = (state.weightVelocity[index] - 4 * momentum * dt) * decay;
        if (Math.abs(state.weights[index] - goal[index]) > 0.0005) settling = true;
      }
      if (!settling) {
        state.weights = goal;
        state.weightVelocity = [0, 0, 0, 0];
      }

      const engaged = config.mouseInteraction && state.inside && !reduced;
      state.presence += ((engaged ? 1 : 0) - state.presence) * (1 - Math.exp(-dt / 0.25));
      const lean = engaged ? config.parallax : 0;
      const targetYaw = (state.pointer[0] - 0.5) * lean * 0.14;
      const targetPitch = (state.pointer[1] - 0.5) * lean * 0.08;
      state.yawVelocity += (38 * (targetYaw - state.yaw) - 11 * state.yawVelocity) * dt;
      state.pitchVelocity += (38 * (targetPitch - state.pitch) - 11 * state.pitchVelocity) * dt;
      state.yaw += state.yawVelocity * dt;
      state.pitch += state.pitchVelocity * dt;

      if (
        state.pressAt >= 0 &&
        state.pressPoint &&
        config.holdToGather &&
        !reduced &&
        state.clock - state.pressAt > 0.18
      ) {
        if (!state.holding) {
          state.holding = true;
          updateCamera();
          rayAt(state.pressPoint[0], state.pressPoint[1]);
          const travelTo =
            FOCUS /
            Math.max(
              ray[0] * cam.forward[0] + ray[1] * cam.forward[1] + ray[2] * cam.forward[2],
              0.2
            );
          state.gatherCenter = [
            cam.eye[0] + ray[0] * travelTo,
            cam.eye[1] + ray[1] * travelTo,
            cam.eye[2] + ray[2] * travelTo,
          ];
          state.reach = 0;
        }
        state.hold = Math.min(1, state.hold + dt / 0.5);
        state.reach = Math.min(state.reach + dt * 0.5, 0.55);
        const reach = (0.22 + state.reach) / (config.scale || 1);
        for (const shard of state.shards) {
          if (shard.joined || shard.level > 2) continue;
          const gx = shard.position[0] - state.gatherCenter[0];
          const gy = shard.position[1] - state.gatherCenter[1];
          if (gx * gx + gy * gy < reach * reach) shard.joined = true;
        }
      } else if (state.hold > 0) {
        state.hold = Math.max(0, state.hold - dt / 0.3);
        if (state.hold === 0) {
          for (const shard of state.shards) shard.joined = false;
        }
      }

      for (const ring of state.rings) ring.age += dt;
      state.rings = state.rings.filter((ring) => ring.age < RING_SECONDS);

      simulateAndRender(dt, reduced);

      // prefers-reduced-motion açıksa ilk statik kareyi çizdikten sonra döngüyü dondur
      if (reduced && state.firstFrameRendered) {
        cancelAnimationFrame(rafId);
      }
    };

    // 12. Pencere İmleç ve Dokunmatik Olayları (Scroll engellemez, passive: true)
    const getNormalizedPoint = (clientX, clientY) => [
      clamp(clientX / Math.max(window.innerWidth, 1), 0, 1),
      clamp(clientY / Math.max(window.innerHeight, 1), 0, 1),
    ];

    const triggerRippleAt = (normX, normY) => {
      if (!config.pulseOnClick || prefersReduced()) return;
      const aspect = viewWidth / Math.max(viewHeight, 1);
      state.rings.push({
        x: (normX * 2 - 1) * aspect,
        y: 1 - normY * 2,
        age: 0,
      });
      if (state.rings.length > MAX_RINGS) state.rings.shift();
    };

    const onPointerMove = (event) => {
      state.inside = true;
      state.pointer = getNormalizedPoint(event.clientX, event.clientY);
    };

    const onPointerLeave = () => {
      state.inside = false;
    };

    const onPointerDown = (event) => {
      if (prefersReduced() || !config.mouseInteraction) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (
        event.target instanceof Element &&
        event.target.closest('a, button, input, textarea, select, label, [role="button"]')
      ) {
        return;
      }
      const pt = getNormalizedPoint(event.clientX, event.clientY);
      state.inside = true;
      state.pointer = pt;
      state.pressAt = state.clock;
      state.pressPoint = pt;
    };

    const onPointerUp = () => {
      if (state.pressAt < 0) return;
      if (!state.holding && config.pulseOnClick && state.pressPoint) {
        triggerRippleAt(state.pressPoint[0], state.pressPoint[1]);
      }
      if (state.holding) {
        for (const shard of state.shards) {
          if (shard.joined) shard.tiltVelocity += 9 * shard.sign;
        }
      }
      state.pressAt = -1;
      state.holding = false;
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    document.documentElement.addEventListener('pointerleave', onPointerLeave, { passive: true });

    // Sekme görünürlüğü değiştiğinde (visibilitychange) pil dostu duraklat/devam ettir
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        state.last = performance.now();
      }
    });

    // WebGL bağlam kaybı (webglcontextlost) koruması
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      state.contextLost = true;
      cancelAnimationFrame(rafId);
      activateStaticFallback('webglcontextlost olayı tetiklendi');
    });

    // Geliştirici / Canlı Test API'si (window.AeroShards)
    global.AeroShards = {
      setArrangement(name) {
        const key = String(name || '').toLowerCase();
        const mapped = ARRANGEMENT_TO_PLACEMENT[key];
        if (mapped) {
          config.arrangement = key;
          config.placement = mapped;
          state.placement = PLACEMENTS.indexOf(mapped);
        }
      },
      setFinish(name) {
        const key = String(name || '').toLowerCase();
        if (FINISH_MODES[key] !== undefined) {
          config.finish = key;
          config.material = key;
          state.finishMode = FINISH_MODES[key];
        }
      },
      setMouseMode(mode) {
        config.mouseMode = mode === 'attract' ? 'attract' : 'repel';
      },
      setQualityTier(tier) {
        if (config.qualityTiers?.[tier]) {
          applyTierSettings(tier);
          state.shards = createShards(config.count, 1337);
          state.order = [];
          updateCanvasSize();
        }
      },
      refreshThemeColors() {
        palette = readThemePalette();
      },
      triggerRipple(normX = 0.5, normY = 0.5) {
        triggerRippleAt(normX, normY);
      },
      getConfig() {
        return Object.assign({}, config, { activeTier: currentTierName });
      },
    };

    rafId = requestAnimationFrame(tick);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAeroShards);
  } else {
    initAeroShards();
  }
})(window);
