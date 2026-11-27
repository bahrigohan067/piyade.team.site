/**
 * ==============================================================================
 * 🌐 PİYADE SUNUCULARIMIZ — NEXUS UI 3D CARD CAROUSEL (SAF VANİLLA JS + CSS)
 * ==============================================================================
 * Klanın Zirvesi (commit c6cc3da) 3B silindir fizik motorundan geri getirilip
 * Nexus UI card-carousel-3d şartnamesine uyarlandı:
 * - Props: radius, itemWidth, itemHeight, perspective, autoRotate, autoSpeed,
 *   scrollSpeed, direction ('cw' | 'ccw'), onChange(index), hint, autoplay, enableSound
 * - N = 1 tek ortalı, N = 2 yan yana iki kart, N >= 3 silindir:
 *   r = (itemWidth / 2 + 16) / tan(PI / N)
 * - Etkileşim kuralı: ön olmayan karta tıklamak öne getirir ve linki AÇMAZ;
 *   "Sunucuya git" düğmesi yalnızca ÖN kartta tıklanabilir.
 * - autoRotate: açılışta 2.5 sn bekler, hover / focus-within / dokunma / sürüklemede
 *   DURUR, etkileşim bitince 3.5 sn sonra devam eder; sekme gizli veya sahne ekran
 *   dışındaysa (IntersectionObserver) döngü tamamen durur.
 * - Canlı güncelleme: 60 sn'de bir ETag/If-None-Match (304) ile kartları yerinde
 *   (carousel açısını sıfırlamadan) yumuşak geçişle günceller.
 * ==============================================================================
 */
(function (rootScope) {
  'use strict';

  function clamp(val, min, max) {
    return Math.min(max, Math.max(min, val));
  }

  function normalizeSignedAngle(deg) {
    let a = ((deg % 360) + 360) % 360;
    if (a > 180) a -= 360;
    return a;
  }

  function computeLayoutMode(count, reducedMotion) {
    const n = Number(count) || 0;
    if (n <= 0) return 'empty';
    if (reducedMotion) return 'grid';
    if (n === 1) return 'single';
    if (n === 2) return 'pair';
    return 'cylinder';
  }

  function computeRadius(count, itemWidth, customRadius, edgePadding) {
    const n = Number(count) || 0;
    if (n < 3) return 0;
    if (Number.isFinite(Number(customRadius)) && Number(customRadius) > 0) {
      return Number(customRadius);
    }
    const w = Number.isFinite(Number(itemWidth)) && Number(itemWidth) > 0 ? Number(itemWidth) : 300;
    const pad = Number.isFinite(Number(edgePadding)) && Number(edgePadding) >= 0 ? Number(edgePadding) : 16;
    return (w / 2 + pad) / Math.tan(Math.PI / n);
  }

  function computeIndexFromRot(angleDeg, count) {
    const n = Number(count) || 1;
    const step = 360 / n;
    return ((Math.round(-angleDeg / step) % n) + n) % n;
  }

  function shouldPlaySound(enableSoundProp, storageValue, userHasInteracted) {
    if (enableSoundProp === false) return false;
    if (!userHasInteracted) return false;
    if (storageValue === 'off') return false;
    return true;
  }

  function parseJsonAttr(el, attrName, fallback) {
    if (!el || typeof el.getAttribute !== 'function') return fallback;
    const raw = el.getAttribute(attrName);
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  }

  // Test edilebilir saf zamanlayıcı ve etkileşim durum makinesi
  function createCarouselController(options) {
    const opts = Object.assign(
      {
        count: 6,
        initialIndex: 0,
        itemWidth: 300,
        itemHeight: 410,
        radius: null,
        edgePadding: 16,
        autoRotate: true,
        autoSpeed: 1,
        scrollSpeed: 1,
        direction: 'cw',
        autoplay: false,
        autoplayIntervalMs: 2400,
        autoRotateStartDelayMs: 2500,
        autoRotateResumeDelayMs: 3500,
        reducedMotion: false,
        nowFn: () => Date.now(),
        onChange: null,
      },
      options || {}
    );

    const N = Math.max(0, Number(opts.count) || 0);
    const step = N > 0 ? 360 / N : 360;
    const startIdx = N > 0 ? ((Number(opts.initialIndex) || 0) % N + N) % N : 0;
    const dirSign = opts.direction === 'ccw' ? -1 : 1;

    const state = {
      count: N,
      step,
      layoutMode: computeLayoutMode(N, opts.reducedMotion),
      baseR: computeRadius(N, opts.itemWidth, opts.radius, opts.edgePadding),
      rot: -startIdx * step,
      vel: 0,
      swing: 0,
      snapTarget: -startIdx * step,
      phase: 'idle',
      activeIndex: startIdx,
      isHovered: false,
      isFocusWithin: false,
      isDragging: false,
      isInViewport: true,
      isTabVisible: true,
      userInteractedForAutoplay: false,
      autoRotateResumeAt: opts.nowFn() + (opts.autoRotateStartDelayMs || 2500),
    };

    function pauseAutoRotateFor(ms) {
      const target = opts.nowFn() + (ms !== undefined ? ms : opts.autoRotateResumeDelayMs || 3500);
      if (target > state.autoRotateResumeAt) {
        state.autoRotateResumeAt = target;
      }
    }

    function markUserInteraction() {
      state.userInteractedForAutoplay = true;
      pauseAutoRotateFor(opts.autoRotateResumeDelayMs || 3500);
    }

    function canAutoRotateNow() {
      if (!opts.autoRotate || opts.reducedMotion) return false;
      if (state.layoutMode !== 'cylinder') return false;
      if (!state.isInViewport || !state.isTabVisible) return false;
      if (state.isHovered || state.isFocusWithin || state.isDragging) return false;
      if (state.phase !== 'idle') return false;
      return opts.nowFn() >= state.autoRotateResumeAt;
    }

    function shouldLoopRun() {
      if (opts.reducedMotion || state.layoutMode !== 'cylinder') return false;
      if (!state.isInViewport || !state.isTabVisible) return false;
      if (state.phase !== 'idle') return true;
      if (state.swing > 0.002) return true;
      return canAutoRotateNow();
    }

    function handleCardClick(cardIndex) {
      if (state.layoutMode !== 'cylinder') {
        return { allowLinkNavigation: true, rotatedToFront: false, targetIndex: cardIndex };
      }
      if (cardIndex !== state.activeIndex) {
        markUserInteraction();
        const desiredMod = -cardIndex * state.step;
        const delta = normalizeSignedAngle(desiredMod - state.rot);
        state.snapTarget = state.rot + delta;
        state.phase = 'spring';
        return { allowLinkNavigation: false, rotatedToFront: true, targetIndex: cardIndex };
      }
      return { allowLinkNavigation: true, rotatedToFront: false, targetIndex: cardIndex };
    }

    function stepPhysics(dtSec) {
      const dt = Math.min(1 / 30, Math.max(0.001, dtSec));
      if (state.phase === 'coast') {
        state.rot += state.vel * dt;
        state.vel *= Math.exp(-dt * 3.0);
        const swingTarget = clamp(Math.abs(state.vel) / 600, 0, 1);
        const rate = swingTarget > state.swing ? 6.0 : 2.5;
        state.swing += (swingTarget - state.swing) * Math.min(1, rate * dt);
        if (Math.abs(state.vel) <= 25) {
          state.snapTarget = Math.round((state.rot + state.vel * 0.35) / state.step) * state.step;
          state.phase = 'spring';
        }
      } else if (state.phase === 'spring') {
        const accel = 170 * (state.snapTarget - state.rot) - 23 * state.vel;
        state.vel += accel * dt;
        state.rot += state.vel * dt;
        const swingTarget = clamp(Math.abs(state.vel) / 600, 0, 1);
        const rate = swingTarget > state.swing ? 6.0 : 2.5;
        state.swing += (swingTarget - state.swing) * Math.min(1, rate * dt);
        if (Math.abs(state.snapTarget - state.rot) < 0.01 && Math.abs(state.vel) < 0.3 && state.swing < 0.004) {
          state.rot = state.snapTarget;
          state.vel = 0;
          state.swing = 0;
          state.phase = 'idle';
          pauseAutoRotateFor(opts.autoRotateResumeDelayMs || 3500);
        }
      } else if (canAutoRotateNow()) {
        // Yavaş, akıcı süzülme (varsayılan autoSpeed=1 -> ~8.5 deg/sn)
        state.rot -= (opts.autoSpeed || 1) * dirSign * 8.5 * dt;
        state.swing += (0 - state.swing) * Math.min(1, 2.5 * dt);
      } else if (state.phase === 'drag') {
        const swingTarget = clamp(Math.abs(state.vel) / 600, 0, 1);
        const rate = swingTarget > state.swing ? 6.0 : 2.5;
        state.swing += (swingTarget - state.swing) * Math.min(1, rate * dt);
      } else if (state.swing > 0.002) {
        state.swing += (0 - state.swing) * Math.min(1, 2.5 * dt);
        if (state.swing <= 0.002) state.swing = 0;
      }

      const nextFront = computeIndexFromRot(state.rot, N);
      if (nextFront !== state.activeIndex) {
        state.activeIndex = nextFront;
        if (typeof opts.onChange === 'function') {
          try {
            opts.onChange(nextFront);
          } catch (_) {}
        }
      }
      return state;
    }

    return {
      state,
      pauseAutoRotateFor,
      markUserInteraction,
      canAutoRotateNow,
      shouldLoopRun,
      handleCardClick,
      stepPhysics,
    };
  }

  // ============================================================================
  // TARAYICI ORTAMI: SUNUCULAR SAYFASI 3D CAROUSEL + CANLI ETag GÜNCELLEME
  // ============================================================================
  function initBrowserServersPage(global) {
    const section = document.getElementById('piyadeServersSection');
    if (!section) return;

    const root = document.getElementById('serversCarouselRoot');
    const stage = document.getElementById('serversCarouselStage');
    const ring = document.getElementById('serversCarouselRing');
    const announcer = document.getElementById('serversLiveAnnouncer');
    const dotsContainer = document.getElementById('serversDotsContainer');
    const refreshBtn = document.getElementById('serversRefreshBtn');
    const refreshBtnText = document.getElementById('serversRefreshBtnText');
    const refreshStatusEl = document.getElementById('serversRefreshStatus');
    const lastUpdatedTimeEl = document.getElementById('serversLastUpdatedTime');

    const reducedMotionQuery =
      typeof global.matchMedia === 'function'
        ? global.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    function prefersReducedMotion() {
      return Boolean(reducedMotionQuery && reducedMotionQuery.matches);
    }

    const cfg = Object.assign(
      {
        radius: null,
        itemWidth: 300,
        itemHeight: 410,
        mobileBreakpoint: 640,
        mobileItemWidth: 252,
        mobileItemHeight: 360,
        edgePadding: 16,
        perspective: 1500,
        autoRotate: true,
        autoSpeed: 1,
        scrollSpeed: 1,
        direction: 'cw',
        autoplay: false,
        autoplayIntervalMs: 2400,
        autoRotateStartDelayMs: 2500,
        autoRotateResumeDelayMs: 3500,
        enableSound: true,
        pollIntervalMs: 60000,
      },
      parseJsonAttr(section, 'data-carousel-config', {})
    );

    const i18n = parseJsonAttr(section, 'data-servers-i18n', {
      lang: 'tr',
      numberLocale: 'tr-TR',
    });

    const csrfToken = section.getAttribute('data-csrf') || '';
    let lastEtag = section.getAttribute('data-initial-etag') || '';
    let cards = ring ? Array.from(ring.querySelectorAll('.srv-card')) : [];
    const dotBtns = dotsContainer ? Array.from(dotsContainer.querySelectorAll('.srv-dot')) : [];
    const N = cards.length;

    // --------------------------------------------------------------------------
    // SİMGE HATA YEDEKLEME, ANİMASYONLU (a_) HOVER VE KOPYALAMA DÜĞMELERİ
    // --------------------------------------------------------------------------
    function bindCardMediaAndActions(cardEl) {
      if (!cardEl || cardEl.dataset.srvBound === 'true') return;
      cardEl.dataset.srvBound = 'true';

      const iconImg = cardEl.querySelector('.srv-icon-img');
      const iconFallback = cardEl.querySelector('.srv-icon-fallback');
      if (iconImg) {
        const showFallback = () => {
          iconImg.hidden = true;
          if (iconFallback) iconFallback.hidden = false;
        };
        if (iconImg.complete && iconImg.naturalWidth === 0) {
          showFallback();
        } else {
          iconImg.addEventListener('error', showFallback);
        }

        const animatedSrc = iconImg.getAttribute('data-animated-src') || '';
        const staticSrc = iconImg.getAttribute('data-static-src') || iconImg.getAttribute('src') || '';
        if (animatedSrc && staticSrc) {
          cardEl.addEventListener('pointerenter', () => {
            if (!prefersReducedMotion() && !iconImg.hidden) {
              iconImg.setAttribute('src', animatedSrc);
            }
          });
          cardEl.addEventListener('pointerleave', () => {
            if (!iconImg.hidden) {
              iconImg.setAttribute('src', staticSrc);
            }
          });
        }
      }

      const bannerImg = cardEl.querySelector('.srv-banner-img');
      if (bannerImg) {
        bannerImg.addEventListener('error', () => {
          bannerImg.hidden = true;
        });
      }

      const copyBtn = cardEl.querySelector('.srv-copy-btn');
      if (copyBtn) {
        let copyTimer = null;
        copyBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const url = copyBtn.getAttribute('data-copy-url');
          if (!url || copyBtn.disabled) return;

          let copied = false;
          try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
              await navigator.clipboard.writeText(url);
              copied = true;
            }
          } catch (_) {}

          if (!copied) {
            try {
              const ta = document.createElement('textarea');
              ta.value = url;
              ta.setAttribute('readonly', 'readonly');
              ta.style.position = 'fixed';
              ta.style.opacity = '0';
              document.body.appendChild(ta);
              ta.select();
              copied = document.execCommand('copy');
              ta.remove();
            } catch (_) {}
          }

          if (copied) {
            copyBtn.classList.add('is-copied');
            const fb = copyBtn.querySelector('.srv-copy-feedback');
            if (fb) fb.hidden = false;
            if (copyTimer) global.clearTimeout(copyTimer);
            copyTimer = global.setTimeout(() => {
              copyBtn.classList.remove('is-copied');
              if (fb) fb.hidden = true;
            }, 1800);
          }
        });
      }
    }

    cards.forEach(bindCardMediaAndActions);

    // --------------------------------------------------------------------------
    // SAYI SAYMA ANİMASYONU & YERİNDE CANLI GÜNCELLEME (ETag 60 sn)
    // --------------------------------------------------------------------------
    function formatNum(val) {
      const n = Number(val);
      return Number.isFinite(n) ? Math.round(n).toLocaleString(i18n.numberLocale || 'tr-TR') : '';
    }

    function animateCountChange(numEl, fromVal, toVal, pulseDotEl) {
      if (!numEl) return;
      numEl.setAttribute('data-count-value', String(toVal));
      if (prefersReducedMotion() || fromVal === toVal || typeof global.requestAnimationFrame !== 'function') {
        numEl.textContent = formatNum(toVal);
        return;
      }

      if (pulseDotEl) {
        pulseDotEl.classList.remove('is-pulsing');
        void pulseDotEl.offsetWidth;
        pulseDotEl.classList.add('is-pulsing');
        global.setTimeout(() => pulseDotEl.classList.remove('is-pulsing'), 900);
      }

      const startTs = performance.now();
      const duration = 450;
      function frame(now) {
        const t = clamp((now - startTs) / duration, 0, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        const cur = Math.round(fromVal + (toVal - fromVal) * eased);
        numEl.textContent = formatNum(cur);
        if (t < 1) {
          global.requestAnimationFrame(frame);
        } else {
          numEl.textContent = formatNum(toVal);
        }
      }
      global.requestAnimationFrame(frame);
    }

    function updateUpdatedTimestamp(isoStr) {
      if (!lastUpdatedTimeEl || !isoStr) return;
      const dt = new Date(isoStr);
      if (Number.isNaN(dt.getTime())) return;
      lastUpdatedTimeEl.setAttribute('datetime', isoStr);
      try {
        lastUpdatedTimeEl.textContent = new Intl.DateTimeFormat(i18n.numberLocale || 'tr-TR', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }).format(dt);
      } catch (_) {}
    }

    function applyLiveCardsInPlace(freshServers, freshUpdatedAt) {
      if (freshUpdatedAt) updateUpdatedTimestamp(freshUpdatedAt);
      if (!Array.isArray(freshServers) || !cards.length) return;

      const byId = new Map();
      const byCode = new Map();
      freshServers.forEach((s) => {
        if (s && s.id) byId.set(s.id, s);
        if (s && s.code) byCode.set(s.code, s);
      });

      cards.forEach((cardEl) => {
        const id = cardEl.getAttribute('data-server-id');
        const code = cardEl.getAttribute('data-server-code');
        const fresh = byId.get(id) || byCode.get(code);
        if (!fresh) return;

        // Ad güncelleme (textContent)
        const nameEl = cardEl.querySelector('.srv-name');
        if (nameEl && fresh.name && nameEl.textContent !== fresh.name) {
          nameEl.textContent = fresh.name;
          nameEl.setAttribute('title', fresh.name);
          cardEl.setAttribute('data-server-name', fresh.name);
        }

        // Durum sınıfları
        cardEl.setAttribute('data-server-status', fresh.status || 'ok');
        cardEl.classList.toggle('is-invalid', fresh.status === 'invalid');
        cardEl.classList.toggle('is-stale', fresh.status === 'stale');

        // Simge URL'si (yalnızca cdn.discordapp.com)
        if (fresh.iconUrl && fresh.iconUrl.startsWith('https://cdn.discordapp.com/')) {
          const img = cardEl.querySelector('.srv-icon-img');
          const fb = cardEl.querySelector('.srv-icon-fallback');
          if (img && img.getAttribute('data-static-src') !== fresh.iconUrl) {
            img.setAttribute('data-static-src', fresh.iconUrl);
            img.setAttribute('data-animated-src', fresh.iconAnimatedUrl || '');
            img.setAttribute('src', fresh.iconUrl);
            img.hidden = false;
            if (fb) fb.hidden = true;
          }
        }

        // Sayılar (yerinde sayma animasyonu + çevrim içi nabız; ilk kez geliyorsa satırı oluştur)
        const hasOnline = typeof fresh.onlineCount === 'number' && Number.isFinite(fresh.onlineCount);
        const hasMember = typeof fresh.memberCount === 'number' && Number.isFinite(fresh.memberCount);
        if (hasOnline || hasMember) {
          let countsWrap = cardEl.querySelector('.srv-counts');
          if (!countsWrap) {
            const bodyEl = cardEl.querySelector('.srv-body');
            if (bodyEl) {
              countsWrap = document.createElement('div');
              countsWrap.className = 'srv-counts';
              bodyEl.appendChild(countsWrap);
            }
          }
          if (countsWrap && hasOnline) {
            let onlineNum = countsWrap.querySelector('[data-count-type="online"]');
            let onlineDot = countsWrap.querySelector('.srv-dot-online');
            if (!onlineNum) {
              const item = document.createElement('span');
              item.className = 'srv-count-item srv-count-online';
              onlineDot = document.createElement('span');
              onlineDot.className = 'srv-dot-online';
              onlineDot.setAttribute('aria-hidden', 'true');
              onlineNum = document.createElement('span');
              onlineNum.className = 'srv-count-num';
              onlineNum.setAttribute('data-count-type', 'online');
              onlineNum.setAttribute('data-count-value', String(fresh.onlineCount));
              onlineNum.textContent = formatNum(fresh.onlineCount);
              const lbl = document.createElement('span');
              lbl.className = 'srv-count-label';
              lbl.textContent = i18n.onlineLabel || 'Çevrim içi';
              item.append(onlineDot, onlineNum, lbl);
              countsWrap.insertBefore(item, countsWrap.firstChild);
            } else {
              const prev = Number(onlineNum.getAttribute('data-count-value') || 0);
              animateCountChange(onlineNum, prev, fresh.onlineCount, onlineDot);
            }
          }
          if (countsWrap && hasMember) {
            let memberNum = countsWrap.querySelector('[data-count-type="member"]');
            if (!memberNum) {
              const item = document.createElement('span');
              item.className = 'srv-count-item srv-count-member';
              const dot = document.createElement('span');
              dot.className = 'srv-dot-member';
              dot.setAttribute('aria-hidden', 'true');
              memberNum = document.createElement('span');
              memberNum.className = 'srv-count-num';
              memberNum.setAttribute('data-count-type', 'member');
              memberNum.setAttribute('data-count-value', String(fresh.memberCount));
              memberNum.textContent = formatNum(fresh.memberCount);
              const lbl = document.createElement('span');
              lbl.className = 'srv-count-label';
              lbl.textContent = i18n.membersLabel || 'Üye';
              item.append(dot, memberNum, lbl);
              countsWrap.appendChild(item);
            } else {
              const prev = Number(memberNum.getAttribute('data-count-value') || 0);
              animateCountChange(memberNum, prev, fresh.memberCount, null);
            }
          }
        }
      });
    }

    // 60 sn'de bir ETag/If-None-Match yoklaması
    let pollTimer = null;
    async function pollServerList() {
      if (document.visibilityState === 'hidden') return;
      try {
        const headers = { Accept: 'application/json' };
        if (lastEtag) headers['If-None-Match'] = lastEtag;
        const resp = await fetch('/sunucular/api/liste', {
          method: 'GET',
          headers,
          credentials: 'same-origin',
        });
        if (resp.status === 304) return;
        if (!resp.ok) return;
        const nextEtag = resp.headers.get('etag');
        if (nextEtag) lastEtag = nextEtag;
        const data = await resp.json();
        if (data && data.ok && Array.isArray(data.servers)) {
          applyLiveCardsInPlace(data.servers, data.updatedAt);
        }
      } catch (_) {}
    }

    if (N > 0 && cfg.pollIntervalMs > 0) {
      pollTimer = global.setInterval(pollServerList, cfg.pollIntervalMs);
    }

    // Üye Yenile Düğmesi (çift tıklama kilidi + 60 sn global bekleme)
    if (refreshBtn) {
      let refreshBusy = false;
      let statusTimer = null;
      const showStatus = (msg, isError) => {
        if (!refreshStatusEl) return;
        refreshStatusEl.textContent = msg;
        refreshStatusEl.classList.toggle('is-error', Boolean(isError));
        refreshStatusEl.hidden = false;
        if (statusTimer) global.clearTimeout(statusTimer);
        statusTimer = global.setTimeout(() => {
          refreshStatusEl.hidden = true;
        }, 4200);
      };

      refreshBtn.addEventListener('click', async () => {
        if (refreshBusy) return;
        refreshBusy = true;
        refreshBtn.disabled = true;
        refreshBtn.classList.add('is-loading');
        if (refreshBtnText) refreshBtnText.textContent = i18n.refreshing || 'Yenileniyor…';

        try {
          const resp = await fetch('/sunucular/api/yenile', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrfToken,
            },
            body: JSON.stringify({}),
          });
          const data = await resp.json().catch(() => null);
          if (resp.status === 429) {
            const sec = (data && data.retryAfterSec) || 60;
            const msg = (data && data.error) || (i18n.errCooldown || '{sec} sn bekleyin.').replace('{sec}', String(sec));
            showStatus(msg, true);
          } else if (resp.ok && data && data.ok) {
            if (data.etag) lastEtag = data.etag;
            applyLiveCardsInPlace(data.servers || [], data.updatedAt);
            showStatus(i18n.refreshedToast || 'Sunucu bilgileri güncellendi.', false);
          } else {
            showStatus((data && data.error) || i18n.errRefreshFailed || 'Yenilenemedi.', true);
          }
        } catch (_) {
          showStatus(i18n.errRefreshFailed || 'Yenilenemedi.', true);
        } finally {
          refreshBusy = false;
          refreshBtn.disabled = false;
          refreshBtn.classList.remove('is-loading');
          if (refreshBtnText) refreshBtnText.textContent = i18n.refreshBtn || 'Yenile';
        }
      });
    }

    if (!root || !stage || !ring || N === 0) return;

    // --------------------------------------------------------------------------
    // 3D CAROUSEL MOTORU (N >= 3 VE REDUCED-MOTION KAPALI İKEN)
    // --------------------------------------------------------------------------
    const initialFeaturedIdx = clamp(
      Number.parseInt(section.getAttribute('data-featured-index') || '0', 10) || 0,
      0,
      Math.max(0, N - 1)
    );

    const soundClient =
      global.NexusSound && typeof global.NexusSound.createClient === 'function'
        ? global.NexusSound.createClient({ soundEnabled: cfg.enableSound !== false })
        : { markUserGesture() {}, playTick() {} };

    const step = 360 / N;
    const dirSign = cfg.direction === 'ccw' ? -1 : 1;

    let itemWidth = cfg.itemWidth || 300;
    let itemHeight = cfg.itemHeight || 410;
    let baseR = 300;
    let layoutMode = computeLayoutMode(N, prefersReducedMotion());

    let rot = -initialFeaturedIdx * step;
    let vel = 0;
    let swing = 0;
    let snapTarget = rot;
    let phase = 'idle'; // 'idle' | 'drag' | 'coast' | 'spring'
    let activeIndex = initialFeaturedIdx;
    let lastSoundIndex = initialFeaturedIdx;
    let interactionActive = false;
    let userHasInteracted = false;

    let isHovered = false;
    let isFocusWithin = false;
    let isInViewport = true;
    let autoRotateResumeAt = Date.now() + (cfg.autoRotateStartDelayMs || 2500);
    let resumeTimer = null;
    let wheelTimer = null;
    let autoplayTimer = null;
    let rafId = null;
    let lastTs = 0;

    function announceActiveCard(idx) {
      if (!announcer || !cards[idx]) return;
      const name = cards[idx].getAttribute('data-server-name') || '';
      const fmt = i18n.announceFormat || '{index} / {count}: {name}';
      announcer.textContent = fmt
        .replace('{index}', String(idx + 1))
        .replace('{count}', String(N))
        .replace('{name}', name);
    }

    function syncCardInteractivity(frontIdx) {
      cards.forEach((card, idx) => {
        const isFront = layoutMode !== 'cylinder' || idx === frontIdx;
        card.classList.toggle('is-front', isFront);
        card.setAttribute('aria-current', isFront ? 'true' : 'false');

        const interactiveEls = card.querySelectorAll('.srv-join-btn, .srv-copy-btn, .srv-report-link');
        interactiveEls.forEach((el) => {
          if (layoutMode === 'cylinder') {
            el.setAttribute('tabindex', isFront ? '0' : '-1');
          } else {
            el.removeAttribute('tabindex');
          }
        });
      });

      dotBtns.forEach((btn, idx) => {
        const isCurrent = idx === frontIdx;
        btn.classList.toggle('is-active', isCurrent);
        if (isCurrent) btn.setAttribute('aria-current', 'true');
        else btn.removeAttribute('aria-current');
      });
    }

    function applyLayoutClasses() {
      layoutMode = computeLayoutMode(N, prefersReducedMotion());
      section.setAttribute('data-layout', layoutMode);
      section.classList.toggle('is-enhanced', layoutMode === 'cylinder');
      section.classList.toggle('is-3d', layoutMode === 'cylinder');
      section.classList.toggle('is-reduced-motion', prefersReducedMotion());

      const vw = global.innerWidth || document.documentElement.clientWidth || 1024;
      const isMobile = vw <= (cfg.mobileBreakpoint || 640);
      itemWidth = isMobile ? cfg.mobileItemWidth || 252 : cfg.itemWidth || 300;
      itemHeight = isMobile ? cfg.mobileItemHeight || 360 : cfg.itemHeight || 410;
      baseR = computeRadius(N, itemWidth, cfg.radius, cfg.edgePadding || 16);

      section.style.setProperty('--item-w', `${itemWidth}px`);
      section.style.setProperty('--item-h', `${itemHeight}px`);
      section.style.setProperty('--step', `${step}deg`);
      section.style.setProperty('--perspective', `${cfg.perspective || 1500}px`);

      if (layoutMode === 'cylinder') {
        section.style.setProperty('--r', `${(baseR * (1 + 0.35 * swing)).toFixed(2)}px`);
      } else {
        ring.style.transform = '';
        cards.forEach((c) => {
          c.style.removeProperty('--dim');
          c.classList.remove('is-back');
        });
      }

      syncCardInteractivity(activeIndex);
    }

    function applyVisualTransforms() {
      if (layoutMode !== 'cylinder') return activeIndex;

      const currentR = baseR * (1 + 0.35 * swing);
      section.style.setProperty('--r', `${currentR.toFixed(2)}px`);
      ring.style.transform = `translateZ(${-currentR.toFixed(2)}px) rotateY(${rot.toFixed(3)}deg)`;

      let bestIdx = 0;
      let bestFacing = -Infinity;

      for (let i = 0; i < N; i += 1) {
        const effectiveDeg = normalizeSignedAngle(i * step + rot);
        const facing = Math.cos((effectiveDeg * Math.PI) / 180);
        const dim = 0.62 * (1 - Math.max(0, facing));
        cards[i].style.setProperty('--dim', dim.toFixed(3));
        cards[i].classList.toggle('is-back', facing <= 0.05);
        if (facing > bestFacing) {
          bestFacing = facing;
          bestIdx = i;
        }
      }

      syncCardInteractivity(bestIdx);
      return bestIdx;
    }

    function notifyFrontChange(newIdx, userTriggered) {
      announceActiveCard(newIdx);
      if (userTriggered && newIdx !== lastSoundIndex) {
        lastSoundIndex = newIdx;
        soundClient.playTick();
      }
      if (typeof cfg.onChange === 'function') {
        try {
          cfg.onChange(newIdx);
        } catch (_) {}
      }
      root.dispatchEvent(
        new CustomEvent('serversCarouselChange', {
          bubbles: true,
          detail: { index: newIdx },
        })
      );
    }

    function scheduleAutoRotateResume(delayMs) {
      const wait = Number.isFinite(delayMs) ? delayMs : cfg.autoRotateResumeDelayMs || 3500;
      autoRotateResumeAt = Math.max(autoRotateResumeAt, Date.now() + wait);
      if (resumeTimer) global.clearTimeout(resumeTimer);
      if (!cfg.autoRotate || layoutMode !== 'cylinder') return;

      resumeTimer = global.setTimeout(() => {
        resumeTimer = null;
        if (canAutoRotateNow()) {
          ensureLoopRunning();
        }
      }, Math.max(50, autoRotateResumeAt - Date.now() + 20));
    }

    function markUserInteraction() {
      userHasInteracted = true;
      soundClient.markUserGesture();
      if (autoplayTimer) {
        global.clearInterval(autoplayTimer);
        autoplayTimer = null;
      }
      scheduleAutoRotateResume(cfg.autoRotateResumeDelayMs || 3500);
    }

    function checkBoundsVisible() {
      const rect = section.getBoundingClientRect();
      const vh = global.innerHeight || document.documentElement.clientHeight || 900;
      return rect.bottom > 0 && rect.top < vh && rect.width > 0 && rect.height > 0;
    }

    function canAutoRotateNow() {
      if (!cfg.autoRotate || layoutMode !== 'cylinder' || prefersReducedMotion()) return false;
      if (document.visibilityState === 'hidden') return false;
      if (!isInViewport) return false;
      if (isHovered || isFocusWithin || dragActive) return false;
      if (phase !== 'idle') return false;
      return Date.now() >= autoRotateResumeAt;
    }

    function shouldLoopRun() {
      if (layoutMode !== 'cylinder' || prefersReducedMotion()) return false;
      if (document.visibilityState === 'hidden') return false;
      if (!isInViewport) {
        if (checkBoundsVisible()) {
          isInViewport = true;
        } else {
          return false;
        }
      }
      if (phase !== 'idle') return true;
      if (swing > 0.002) return true;
      return canAutoRotateNow();
    }

    function snapToAngle(targetAngle, userTriggered) {
      const snappedTarget = Math.round(targetAngle / step) * step;
      const nextIdx = computeIndexFromRot(snappedTarget, N);

      if (layoutMode !== 'cylinder' || prefersReducedMotion() || (!isInViewport && !checkBoundsVisible())) {
        phase = 'idle';
        rot = snappedTarget;
        vel = 0;
        swing = 0;
        applyVisualTransforms();
        if (nextIdx !== activeIndex) {
          activeIndex = nextIdx;
          notifyFrontChange(activeIndex, Boolean(userTriggered));
        }
        stopLoop();
        return;
      }

      interactionActive = Boolean(userTriggered);
      phase = 'spring';
      snapTarget = snappedTarget;
      ensureLoopRunning();
    }

    function goToIndex(targetIdx, userTriggered) {
      const cleanIdx = ((targetIdx % N) + N) % N;
      if (userTriggered) markUserInteraction();
      const desiredMod = -cleanIdx * step;
      const shortestDelta = normalizeSignedAngle(desiredMod - rot);
      snapToAngle(rot + shortestDelta, userTriggered);
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
          scheduleAutoRotateResume(cfg.autoRotateResumeDelayMs || 3500);
        }
      } else if (canAutoRotateNow()) {
        // Sürekli yumuşak süzülme (varsayılan autoSpeed=1, direction='cw')
        rot -= (cfg.autoSpeed || 1) * dirSign * 8.5 * dt;
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
        notifyFrontChange(activeIndex, interactionActive);
      }

      if (shouldLoopRun()) {
        rafId = global.requestAnimationFrame(tick);
      } else {
        rafId = null;
      }
    }

    function ensureLoopRunning() {
      if (layoutMode !== 'cylinder' || prefersReducedMotion()) return;
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
    // POINTER SÜRÜKLEME, ATALET FIRLATMA & ÖN OLMAYAN KART TIKLAMA KURALI
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
      if (layoutMode !== 'cylinder') return;
      if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;

      // Ön karttaki gerçek düğmeye tıklanıyorsa sürüklemeyi zorlama (ancak hareket olursa engelleme de)
      const isActionOnFront = Boolean(
        e.target &&
          typeof e.target.closest === 'function' &&
          e.target.closest('.srv-card.is-front .srv-join-btn, .srv-card.is-front .srv-copy-btn, .srv-card.is-front .srv-report-link')
      );
      if (isActionOnFront) {
        markUserInteraction();
        return;
      }

      markUserInteraction();
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
      if (!dragActive || e.pointerId !== dragPointerId || layoutMode !== 'cylinder') return;
      const dxTotal = e.clientX - dragStartX;
      const dyTotal = e.clientY - dragStartY;
      dragMaxTravel = Math.max(dragMaxTravel, Math.hypot(dxTotal, dyTotal));

      // Dokunmatikte baskın dikey kaydırmayı asla engelleme (touch-action: pan-y)
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

      const degPerPx = (step / (itemWidth * 0.58)) * (cfg.scrollSpeed || 1);
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
        notifyFrontChange(activeIndex, true);
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
        phase = 'idle';
        vel = 0;
        const clickedCard =
          e.target && typeof e.target.closest === 'function' ? e.target.closest('.srv-card') : null;
        if (clickedCard) {
          const idx = Number.parseInt(clickedCard.getAttribute('data-server-index') || '', 10);
          if (Number.isInteger(idx) && idx !== activeIndex) {
            // Ön olmayan karta tıklamak öne getirir ve ASLA bağlantıyı açmaz!
            suppressNextClickUntil = performance.now() + 200;
            goToIndex(idx, true);
            return;
          }
        }
        scheduleAutoRotateResume(cfg.autoRotateResumeDelayMs || 3500);
        return;
      }

      // Sürükleme sonrası olası yanlışlıkla click'i yut
      suppressNextClickUntil = performance.now() + 200;

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

    // Capturing click koruyucusu: ön olmayan kartlarda linkin açılmasını KESİN engelle
    stage.addEventListener(
      'click',
      (e) => {
        if (layoutMode !== 'cylinder') return;
        if (performance.now() < suppressNextClickUntil) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const clickedCard =
          e.target && typeof e.target.closest === 'function' ? e.target.closest('.srv-card') : null;
        if (!clickedCard) return;
        const idx = Number.parseInt(clickedCard.getAttribute('data-server-index') || '', 10);
        if (Number.isInteger(idx) && idx !== activeIndex) {
          e.preventDefault();
          e.stopPropagation();
          goToIndex(idx, true);
        }
      },
      true
    );

    // --------------------------------------------------------------------------
    // ALT NOKTALAR, KLAVYE (ArrowLeft/Right, Home/End, Focus, Enter/Space)
    // --------------------------------------------------------------------------
    dotBtns.forEach((dot, idx) => {
      dot.addEventListener('click', () => {
        goToIndex(idx, true);
      });
    });

    cards.forEach((card, idx) => {
      card.addEventListener('focus', () => {
        if (layoutMode === 'cylinder' && idx !== activeIndex) {
          goToIndex(idx, true);
        }
      });

      card.addEventListener('keydown', (e) => {
        if (e.target !== card) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          markUserInteraction();
          if (layoutMode === 'cylinder' && idx !== activeIndex) {
            goToIndex(idx, true);
            return;
          }
          const joinBtn = card.querySelector('.srv-join-btn');
          if (joinBtn && !joinBtn.disabled && !joinBtn.classList.contains('is-disabled')) {
            joinBtn.click();
          }
        }
      });
    });

    root.addEventListener('keydown', (e) => {
      if (layoutMode !== 'cylinder') return;
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
    // TEKERLEK: YALNIZCA YATAY VEYA SHIFT+TEKERLEK (DİKEY KAYDIRMA ASLA ENGELLENMEZ)
    // --------------------------------------------------------------------------
    stage.addEventListener(
      'wheel',
      (e) => {
        if (layoutMode !== 'cylinder') return;
        const isHorizontalDominant = Math.abs(e.deltaX) > Math.abs(e.deltaY);
        const isShiftWheel = Boolean(e.shiftKey && Math.abs(e.deltaY) > 0);
        if (!isHorizontalDominant && !isShiftWheel) {
          return;
        }

        e.preventDefault();
        markUserInteraction();

        const rawDelta = isHorizontalDominant ? e.deltaX : e.deltaY;
        const degPerPx = (step / (itemWidth * 0.65)) * (cfg.scrollSpeed || 1);
        rot -= rawDelta * degPerPx * 0.45;
        vel = clamp(-rawDelta * 3.2, -900, 900);
        interactionActive = true;
        phase = 'coast';

        const currentFront = applyVisualTransforms();
        if (currentFront !== activeIndex) {
          activeIndex = currentFront;
          notifyFrontChange(activeIndex, true);
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

    // Hover & Focus-Within duraklatma + 3.5 sn sonra devam
    root.addEventListener('pointerenter', () => {
      isHovered = true;
    });

    root.addEventListener('pointerleave', () => {
      isHovered = false;
      scheduleAutoRotateResume(cfg.autoRotateResumeDelayMs || 3500);
    });

    root.addEventListener('focusin', () => {
      isFocusWithin = true;
    });

    root.addEventListener('focusout', (e) => {
      if (!root.contains(e.relatedTarget)) {
        isFocusWithin = false;
        scheduleAutoRotateResume(cfg.autoRotateResumeDelayMs || 3500);
      }
    });

    // --------------------------------------------------------------------------
    // GÖRÜNÜRLÜK (IntersectionObserver + visibilitychange), AUTOPLAY, RESIZE
    // --------------------------------------------------------------------------
    function syncAutoplayTimer() {
      if (autoplayTimer) {
        global.clearInterval(autoplayTimer);
        autoplayTimer = null;
      }
      if (cfg.autoplay && !userHasInteracted && layoutMode === 'cylinder' && !prefersReducedMotion()) {
        autoplayTimer = global.setInterval(() => {
          if (!userHasInteracted && isInViewport && !isHovered && !isFocusWithin && !dragActive && document.visibilityState === 'visible') {
            goToIndex(activeIndex + 1, false);
          }
        }, cfg.autoplayIntervalMs || 2400);
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
          notifyFrontChange(activeIndex, false);
        }
      }
      stopLoop();
    }

    if (typeof global.IntersectionObserver === 'function') {
      const io = new global.IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          isInViewport = Boolean(entry && entry.isIntersecting) || checkBoundsVisible();
          if (isInViewport) {
            if (canAutoRotateNow() || phase !== 'idle') ensureLoopRunning();
            else if (cfg.autoRotate) scheduleAutoRotateResume(Math.max(0, autoRotateResumeAt - Date.now()));
          } else {
            settleAndStopLoop();
          }
        },
        { threshold: 0.05 }
      );
      io.observe(section);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        settleAndStopLoop();
      } else if (isInViewport) {
        if (canAutoRotateNow()) ensureLoopRunning();
        else if (cfg.autoRotate) scheduleAutoRotateResume(Math.max(500, autoRotateResumeAt - Date.now()));
      }
    });

    function handleResize() {
      applyLayoutClasses();
      if (layoutMode === 'cylinder') {
        if (phase === 'idle') {
          rot = Math.round(rot / step) * step;
        }
        applyVisualTransforms();
      }
    }

    if (typeof global.ResizeObserver === 'function') {
      const ro = new global.ResizeObserver(handleResize);
      ro.observe(section);
    } else {
      global.addEventListener('resize', handleResize, { passive: true });
    }

    if (reducedMotionQuery && typeof reducedMotionQuery.addEventListener === 'function') {
      reducedMotionQuery.addEventListener('change', () => {
        applyLayoutClasses();
        syncAutoplayTimer();
        if (prefersReducedMotion()) {
          settleAndStopLoop();
        } else {
          applyVisualTransforms();
          scheduleAutoRotateResume(cfg.autoRotateStartDelayMs || 2500);
        }
      });
    }

    // İlk kare: Öne çıkan sunucu tam önde; autoRotate 2.5 sn sonra başlar
    applyLayoutClasses();
    applyVisualTransforms();
    announceActiveCard(activeIndex);
    syncAutoplayTimer();

    if (cfg.autoRotate && layoutMode === 'cylinder' && !prefersReducedMotion()) {
      scheduleAutoRotateResume(cfg.autoRotateStartDelayMs || 2500);
    }

    // Sayfa kapanırken zamanlayıcıları temizle
    global.addEventListener('pagehide', () => {
      stopLoop();
      if (pollTimer) global.clearInterval(pollTimer);
      if (autoplayTimer) global.clearInterval(autoplayTimer);
      if (resumeTimer) global.clearTimeout(resumeTimer);
      if (wheelTimer) global.clearTimeout(wheelTimer);
    });
  }

  if (typeof document !== 'undefined' && typeof rootScope.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', () => initBrowserServersPage(rootScope));
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      computeLayoutMode,
      computeRadius,
      computeIndexFromRot,
      normalizeSignedAngle,
      shouldPlaySound,
      createCarouselController,
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
