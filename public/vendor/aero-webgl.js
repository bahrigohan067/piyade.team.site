/**
 * ==============================================================================
 * 🛠️ AERO SHARDS YEREL WEBGL YARDIMCI KÜTÜPHANESİ (PUBLIC/VENDOR/AERO-WEBGL.JS)
 * ==============================================================================
 * Harici CDN kullanmadan (Helmet CSP 'self' uyumlu) WebGL2 / WebGL1 derleme,
 * öznitelik (attribute) bağlama, tek-tuval çizim ve CSS değişkenlerinden
 * renk çözümleme işlemlerini yürüten hafif yardımcı katman.
 * ==============================================================================
 */
(function (global) {
  'use strict';

  let colorProbeEl = null;

  /**
   * public/css/theme.css içindeki bir CSS değişkenini (örn. --aero-shard-color)
   * okur ve normalize edilmiş [r, g, b] (0..1) dizisine dönüştürür.
   * Sabit renk kodu içermez.
   */
  function resolveThemeColor(cssVarName, fallbackRgb) {
    const safeFallback = Array.isArray(fallbackRgb) ? fallbackRgb : [0.54, 0.42, 0.74];
    if (typeof document === 'undefined' || !document.documentElement) {
      return safeFallback;
    }

    const rawValue = getComputedStyle(document.documentElement)
      .getPropertyValue(cssVarName)
      .trim();

    if (!rawValue || rawValue === 'transparent') {
      return rawValue === 'transparent' ? null : safeFallback;
    }

    if (!colorProbeEl && document.body) {
      colorProbeEl = document.createElement('span');
      colorProbeEl.style.position = 'fixed';
      colorProbeEl.style.left = '-9999px';
      colorProbeEl.style.visibility = 'hidden';
      colorProbeEl.style.pointerEvents = 'none';
      document.body.appendChild(colorProbeEl);
    }

    if (colorProbeEl) {
      colorProbeEl.style.color = '';
      colorProbeEl.style.color = `var(${cssVarName})`;
      const computed = getComputedStyle(colorProbeEl).color;
      const match = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/.exec(
        computed
      );
      if (match) {
        if (match[4] !== undefined && Number(match[4]) === 0) return null;
        return [
          Number(match[1]) / 255,
          Number(match[2]) / 255,
          Number(match[3]) / 255,
        ];
      }
    }

    return safeFallback;
  }

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`WebGL Shader derleme hatası: ${info}`);
    }
    return shader;
  }

  function createProgram(gl, vsSource, fsSource) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`WebGL Program bağlama hatası: ${info}`);
    }
    return program;
  }

  function createContext(canvas) {
    const attrs = {
      alpha: true,
      antialias: true,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    };
    const gl =
      canvas.getContext('webgl2', attrs) ||
      canvas.getContext('webgl', attrs) ||
      canvas.getContext('experimental-webgl', attrs);
    return gl || null;
  }

  global.AeroWebGL = {
    resolveThemeColor,
    createProgram,
    createContext,
  };
})(window);
