/**
 * Piyade — Kişisel "🎮 Etkinliğim • Bu Ay" Paneli İstemci Mantığı
 * Sol kenar çubuğu (Sidebar) akordeon kartı + Yandan kayarak açılan detay çekmecesi (Drawer)
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'piyade_activity_panel_state';
  const REFRESH_COOLDOWN_MS = 10 * 1000;
  const AUTO_REFRESH_INTERVAL_MS = 60 * 1000;

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDurationClient(seconds, lang) {
    const isEn = lang === 'en';
    const raw = Number(seconds);
    if (!Number.isFinite(raw) || raw <= 0) {
      return isEn ? '0 min' : '0 dk';
    }
    if (raw < 60) {
      return isEn ? '<1 min' : "1 dk'dan az";
    }
    const sec = Math.floor(raw);
    const totalMinutes = Math.floor(sec / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours === 0) {
      return isEn ? `${minutes} min` : `${minutes} dk`;
    }
    if (minutes === 0) {
      return isEn ? `${hours} hr` : `${hours} sa`;
    }
    return isEn ? `${hours} hr ${minutes} min` : `${hours} sa ${minutes} dk`;
  }

  function formatResetDate(timestampMs, lang) {
    if (!timestampMs || !Number.isFinite(Number(timestampMs))) return '1';
    try {
      const locale = lang === 'en' ? 'en-US' : 'tr-TR';
      return new Intl.DateTimeFormat(locale, {
        timeZone: 'Europe/Istanbul',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(new Date(Number(timestampMs)));
    } catch (_) {
      return new Date(Number(timestampMs)).toLocaleDateString();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const box = document.getElementById('sidebarActivityBox');
    if (!box) return;

    const isRegistered = box.getAttribute('data-registered') === 'true';
    const lang = box.getAttribute('data-lang') === 'en' ? 'en' : 'tr';

    const i18n = {
      title: box.getAttribute('data-t-title') || 'Etkinliğim',
      subtitle: box.getAttribute('data-t-subtitle') || 'Bu Ay',
      liveNow: box.getAttribute('data-t-live-now') || 'Şu an oynuyor:',
      gamesPlayed: box.getAttribute('data-t-games-played') || 'Oynadığın Oyunlar',
      total: box.getAttribute('data-t-total') || 'Bu Ay Toplam',
      empty: box.getAttribute('data-t-empty') || 'Bu ay henüz kaydedilmiş oyun süren yok.',
      emptyHint: box.getAttribute('data-t-empty-hint') || '',
      trackingOff: box.getAttribute('data-t-tracking-off') || 'Etkinlik takibin kapalı.',
      resetNote: box.getAttribute('data-t-reset-note') || '📅 Sıradaki: {date}',
      error: box.getAttribute('data-t-error') || 'Etkinlik bilgisi şu an alınamadı.',
      retry: box.getAttribute('data-t-retry') || 'Tekrar Dene',
      refresh: box.getAttribute('data-t-refresh') || 'Yenile',
      refreshing: box.getAttribute('data-t-refreshing') || 'Yenileniyor…',
      rateLimited: box.getAttribute('data-t-rate-limited') || 'Lütfen birkaç saniye bekle.',
    };

    const accordionToggle = document.getElementById('activityAccordionToggle');
    const accordionBody = document.getElementById('activityAccordionBody');
    const refreshBtn = document.getElementById('activityRefreshBtn');
    const drawerOpenBtn = document.getElementById('activityDrawerOpenBtn');
    const collapsedTrigger = document.getElementById('activityCollapsedTrigger');
    const mobileQuickBtn = document.getElementById('mobileActivityQuickBtn');

    const drawer = document.getElementById('activityDetailDrawer');
    const drawerBackdrop = document.getElementById('activityDrawerBackdrop');
    const drawerCloseBtn = document.getElementById('activityDrawerCloseBtn');
    const drawerRefreshBtn = document.getElementById('drawerActivityRefreshBtn');
    const drawerRefreshBtnLabel = document.getElementById('drawerRefreshBtnLabel');

    const sidebarSkeleton = document.getElementById('sidebarActivitySkeleton');
    const sidebarContent = document.getElementById('sidebarActivityContent');
    const drawerSkeleton = document.getElementById('drawerActivitySkeleton');
    const drawerContent = document.getElementById('drawerActivityContent');

    const liveDots = [
      document.getElementById('sidebarActivityLiveDot'),
      document.getElementById('dockActivityLiveDot'),
      document.getElementById('mobileActivityLiveDot'),
    ].filter(Boolean);

    // 1. Akordeon Aç/Kapa ve localStorage Hafızası
    function applyAccordionState(state) {
      if (!accordionToggle || !accordionBody) return;
      const isOpen = state !== 'collapsed';
      accordionToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      accordionBody.hidden = !isOpen;
      box.classList.toggle('is-collapsed', !isOpen);
    }

    if (accordionToggle && accordionBody) {
      let savedState = 'open';
      try {
        savedState = localStorage.getItem(STORAGE_KEY) || 'open';
      } catch (_) {}
      applyAccordionState(savedState);

      accordionToggle.addEventListener('click', () => {
        const currentlyOpen = accordionToggle.getAttribute('aria-expanded') === 'true';
        const nextState = currentlyOpen ? 'collapsed' : 'open';
        applyAccordionState(nextState);
        try {
          localStorage.setItem(STORAGE_KEY, nextState);
        } catch (_) {}
      });
    }

    // 2. Detay Çekmecesi (Slide-Out Drawer) Aç/Kapa
    let lastTriggerEl = null;

    function openDrawer(triggerEl) {
      if (!drawer) return;
      lastTriggerEl = triggerEl || document.activeElement;
      drawer.hidden = false;
      drawer.setAttribute('aria-hidden', 'false');
      if (drawerBackdrop) {
        drawerBackdrop.hidden = false;
      }
      requestAnimationFrame(() => {
        drawer.classList.add('is-open');
        if (drawerBackdrop) drawerBackdrop.classList.add('is-open');
      });
      if (drawerCloseBtn) {
        drawerCloseBtn.focus();
      }
    }

    function closeDrawer() {
      if (!drawer || drawer.hidden) return;
      drawer.classList.remove('is-open');
      if (drawerBackdrop) drawerBackdrop.classList.remove('is-open');
      drawer.setAttribute('aria-hidden', 'true');
      setTimeout(() => {
        drawer.hidden = true;
        if (drawerBackdrop) drawerBackdrop.hidden = true;
      }, 220);
      if (lastTriggerEl && typeof lastTriggerEl.focus === 'function') {
        lastTriggerEl.focus();
      }
    }

    if (drawerOpenBtn) {
      drawerOpenBtn.addEventListener('click', () => openDrawer(drawerOpenBtn));
    }
    if (collapsedTrigger) {
      collapsedTrigger.addEventListener('click', () => openDrawer(collapsedTrigger));
    }
    if (mobileQuickBtn) {
      mobileQuickBtn.addEventListener('click', () => openDrawer(mobileQuickBtn));
    }
    if (drawerCloseBtn) {
      drawerCloseBtn.addEventListener('click', closeDrawer);
    }
    if (drawerBackdrop) {
      drawerBackdrop.addEventListener('click', closeDrawer);
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer && !drawer.hidden) {
        e.preventDefault();
        closeDrawer();
      }
    });

    // Kayıtsız kullanıcı için API çağrısı yapma
    if (!isRegistered) return;

    // 3. Veri Çekme, Render ve 10 Sn Yenileme Cooldown / 60 Sn Otomatik Yenileme
    let isFetching = false;
    let lastFetchedAt = 0;
    let lastGoodPayload = null;
    let cooldownUntil = 0;
    let cooldownTimer = null;

    function setLiveIndicator(isLive) {
      liveDots.forEach((dot) => {
        dot.hidden = !isLive;
      });
    }

    function updateRefreshButtonsState() {
      const now = Date.now();
      const inCooldown = now < cooldownUntil;
      const disabled = isFetching || inCooldown;

      if (refreshBtn) {
        refreshBtn.disabled = disabled;
        refreshBtn.classList.toggle('is-spinning', isFetching);
      }
      if (drawerRefreshBtn) {
        drawerRefreshBtn.disabled = disabled;
        if (drawerRefreshBtnLabel) {
          drawerRefreshBtnLabel.textContent = isFetching ? i18n.refreshing : i18n.refresh;
        }
      }
    }

    function startCooldown() {
      cooldownUntil = Date.now() + REFRESH_COOLDOWN_MS;
      updateRefreshButtonsState();
      if (cooldownTimer) clearTimeout(cooldownTimer);
      cooldownTimer = setTimeout(() => {
        updateRefreshButtonsState();
      }, REFRESH_COOLDOWN_MS + 50);
    }

    function buildActivityHtml(data, { isCompact = false } = {}) {
      const resetDateStr = formatResetDate(data.nextResetAt, lang);
      const resetText = escapeHtml(i18n.resetNote.replace('{date}', resetDateStr));

      // Durum A: Takip Kapalı
      if (data.tracking === false) {
        return `
          <div class="activity-state-card activity-state-card--muted">
            <div class="activity-state-icon" aria-hidden="true">🔒</div>
            <p class="activity-state-text">${escapeHtml(i18n.trackingOff)}</p>
          </div>
          <div class="activity-reset-note">${resetText}</div>
        `;
      }

      const parts = [];

      // Canlı Oynuyor Rozeti
      if (data.live && data.live.gameId) {
        const liveDur =
          data.live.formattedDuration || formatDurationClient(data.live.sessionElapsedSec, lang);
        parts.push(`
          <div class="activity-live-banner">
            <span class="activity-live-pulse" aria-hidden="true"></span>
            <div class="activity-live-info">
              <span class="activity-live-label">${escapeHtml(i18n.liveNow)}</span>
              <strong class="activity-live-game">${escapeHtml(data.live.emoji)} ${escapeHtml(data.live.name)}</strong>
              <span class="activity-live-time">(${escapeHtml(liveDur)})</span>
            </div>
          </div>
        `);
      }

      const games = Array.isArray(data.games) ? data.games : [];

      // Durum B: Bu Ay Henüz Oyun Kaydı Yok
      if (games.length === 0) {
        parts.push(`
          <div class="activity-state-card">
            <p class="activity-state-text">${escapeHtml(i18n.empty)}</p>
            ${
              !isCompact && i18n.emptyHint
                ? `<p class="activity-state-hint">💡 ${escapeHtml(i18n.emptyHint)}</p>`
                : ''
            }
          </div>
          <div class="activity-reset-note">${resetText}</div>
        `);
        return parts.join('');
      }

      // Durum C: Oyun Listesi ve Oransal Çubuklar
      const maxGames = isCompact ? 4 : 10;
      const visibleGames = games.slice(0, maxGames);
      const totalFormatted = formatDurationClient(data.totalSeconds, lang);

      const rowsHtml = visibleGames
        .map((g, idx) => {
          const rankIdx = (idx % 8) + 1;
          const durStr = g.formattedDuration || formatDurationClient(g.seconds, lang);
          const pct = Math.min(100, Math.max(0, Number(g.percent) || 0));
          const barWidth = Math.max(pct, 4);
          return `
            <div class="activity-game-item">
              <div class="activity-game-top">
                <span class="activity-game-name" title="${escapeHtml(g.name)}">
                  <span class="activity-game-emoji" aria-hidden="true">${escapeHtml(g.emoji)}</span>
                  <span class="activity-game-label">${escapeHtml(g.name)}</span>
                </span>
                <span class="activity-game-meta">
                  <strong class="activity-game-duration">${escapeHtml(durStr)}</strong>
                  <span class="activity-game-pct">%${escapeHtml(pct)}</span>
                </span>
              </div>
              <div class="activity-bar-track" role="progressbar" aria-valuenow="${escapeHtml(pct)}" aria-valuemin="0" aria-valuemax="100">
                <div class="activity-bar-fill rank-grad-${rankIdx}" style="width: ${barWidth}%;"></div>
              </div>
              ${
                g.breakdown && g.breakdown.formattedLine
                  ? `<div class="activity-game-breakdown">${escapeHtml(g.breakdown.formattedLine)}</div>`
                  : ''
              }
            </div>
          `;
        })
        .join('');

      parts.push(`
        <div class="activity-games-list">
          ${rowsHtml}
        </div>
        <div class="activity-total-row">
          <span class="activity-total-label">⏳ ${escapeHtml(i18n.total)}</span>
          <strong class="activity-total-val">${escapeHtml(totalFormatted)}</strong>
        </div>
        <div class="activity-reset-note">${resetText}</div>
      `);

      return parts.join('');
    }

    function renderErrorState(errMsg) {
      const safeMsg = escapeHtml(errMsg || i18n.error);
      const html = `
        <div class="activity-state-card activity-state-card--error">
          <p class="activity-state-text">⚠️ ${safeMsg}</p>
          <button type="button" class="btn btn-secondary btn-xs activity-retry-btn" data-action="retry-activity">
            🔄 ${escapeHtml(i18n.retry)}
          </button>
        </div>
      `;

      if (sidebarSkeleton) sidebarSkeleton.hidden = true;
      if (sidebarContent) {
        sidebarContent.innerHTML = html;
        sidebarContent.hidden = false;
      }
      if (drawerSkeleton) drawerSkeleton.hidden = true;
      if (drawerContent) {
        drawerContent.innerHTML = html;
        drawerContent.hidden = false;
      }
    }

    function renderActivityData(data) {
      setLiveIndicator(Boolean(data && data.live && data.live.gameId && data.tracking !== false));

      if (sidebarSkeleton) sidebarSkeleton.hidden = true;
      if (sidebarContent) {
        sidebarContent.innerHTML = buildActivityHtml(data, { isCompact: true });
        sidebarContent.hidden = false;
      }

      if (drawerSkeleton) drawerSkeleton.hidden = true;
      if (drawerContent) {
        drawerContent.innerHTML = buildActivityHtml(data, { isCompact: false });
        drawerContent.hidden = false;
      }
    }

    async function fetchActivity({ manual = false } = {}) {
      if (isFetching) return;
      if (manual && Date.now() < cooldownUntil) return;

      isFetching = true;
      updateRefreshButtonsState();

      try {
        const res = await fetch('/api/me/activity', {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
          credentials: 'same-origin',
        });

        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload || payload.ok === false) {
          // Son bilinen veri varsa çevrimdışı/geçici hatada üzerine hata kutusu yazma; sessizce koru
          if (!lastGoodPayload && manual) {
            const msg =
              res.status === 429
                ? i18n.rateLimited
                : (payload && payload.error) || i18n.error;
            renderErrorState(msg);
          }
        } else {
          lastFetchedAt = Date.now();
          lastGoodPayload = payload;
          renderActivityData(payload);
        }
      } catch (_) {
        // Ağ hatası / çevrimdışı: son bilinen veriyi koru, gürültülü hata kutusu çıkarma
        if (!lastGoodPayload && manual) {
          renderErrorState(i18n.error);
        }
      } finally {
        isFetching = false;
        if (manual) {
          startCooldown();
        } else {
          updateRefreshButtonsState();
        }
      }
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => fetchActivity({ manual: true }));
    }
    if (drawerRefreshBtn) {
      drawerRefreshBtn.addEventListener('click', () => fetchActivity({ manual: true }));
    }

    // Hata durumunda "Tekrar Dene" butonları için event delegation
    document.addEventListener('click', (e) => {
      const retryBtn = e.target.closest('[data-action="retry-activity"]');
      if (retryBtn) {
        fetchActivity({ manual: true });
      }
    });

    // İlk yükleme
    fetchActivity({ manual: false });

    // Sekme görünürken en fazla 60 saniyede bir otomatik tazele
    setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetchedAt >= AUTO_REFRESH_INTERVAL_MS) {
        fetchActivity({ manual: false });
      }
    }, AUTO_REFRESH_INTERVAL_MS);

    document.addEventListener('visibilitychange', () => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - lastFetchedAt >= AUTO_REFRESH_INTERVAL_MS
      ) {
        fetchActivity({ manual: false });
      }
    });

    window.addEventListener('online', () => {
      fetchActivity({ manual: false });
    });
  });
})();
