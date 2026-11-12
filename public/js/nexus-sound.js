/**
 * ==============================================================================
 * 🔊 NEXUS UI ORTAK WEB AUDIO SENTEZLEYİCİ (FEEDBACK PILL + 3D CAROUSEL)
 * ==============================================================================
 * - Ses dosyası gerektirmez, AudioContext yalnızca kullanıcı etkileşiminden sonra açılır.
 * - localStorage["ui-sounds"] === "off" ayarını ve sekme görünürlüğünü dikkate alır.
 * - Tıklama/patlama seslerini önlemek için DynamicsCompressor + 0.0001 başlangıç rampası kullanır.
 * ==============================================================================
 */
(function (global) {
  'use strict';

  function isTouchEnvironment() {
    if (typeof global.matchMedia !== 'function') return false;
    return global.matchMedia('(pointer: coarse)').matches;
  }

  let audioCtx = null;
  let masterGain = null;
  let compressor = null;
  let hasInteracted = false;
  let lastTypeTickAt = 0;
  const lastSoundAt = Object.create(null);

  function markInteracted() {
    hasInteracted = true;
  }

  global.addEventListener('pointerdown', markInteracted, { passive: true });
  global.addEventListener('keydown', markInteracted, { passive: true });

  function isSoundAllowed(cfg = {}) {
    if (cfg.soundEnabled === false) return false;
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
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
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

  function playTone({
    type = 'sine',
    startFreq,
    endFreq = startFreq,
    glideSec = 0,
    delaySec = 0,
    decaySec = 0.09,
    peakGain = 0.2,
  }) {
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

  function createClient(cfg = {}) {
    return {
      markUserGesture: markInteracted,

      playTick() {
        if (!isSoundAllowed(cfg) || !canPlayNamed('carouselTick', 38)) return;
        playHighpassNoise({
          cutoffHz: 5000,
          decaySec: 0.012,
          peakGain: 0.3,
        });
      },

      playPop() {
        if (!isSoundAllowed(cfg) || !canPlayNamed('pop', 30)) return;
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
        if (!isSoundAllowed(cfg) || !canPlayNamed('tap', 30)) return;
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
        if (!isSoundAllowed(cfg) || !canPlayNamed('success', 30)) return;
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
        if (!isSoundAllowed(cfg) || !canPlayNamed('error', 30)) return;
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
        if (!isSoundAllowed(cfg)) return;
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
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

  global.NexusSound = {
    createClient,
  };
})(window);
