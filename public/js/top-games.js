/**
 * Piyade — Anasayfa "🏆 Sunucuda En Çok Oynanan Oyunlar" Sıralama, Sekme ve Animasyon Mantığı
 */
(function () {
  'use strict';

  const RANK_MEDALS = ['🥇', '🥈', '🥉'];

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDuration(seconds, lang) {
    const isEn = lang === 'en';
    const raw = Number(seconds);
    if (!Number.isFinite(raw) || raw <= 0) {
      return isEn ? '0 min' : '0 dk';
    }
    if (raw < 60) {
      return isEn ? '<1 min' : "1 dk'dan az";
    }
    const totalSec = Math.floor(raw);
    const totalMin = Math.floor(totalSec / 60);
    const hrs = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    const nf = new Intl.NumberFormat(isEn ? 'en-US' : 'tr-TR');
    if (hrs === 0) {
      return isEn ? `${nf.format(mins)} min` : `${nf.format(mins)} dk`;
    }
    if (mins === 0) {
      return isEn ? `${nf.format(hrs)} hr` : `${nf.format(hrs)} sa`;
    }
    return isEn
      ? `${nf.format(hrs)} hr ${nf.format(mins)} min`
      : `${nf.format(hrs)} sa ${nf.format(mins)} dk`;
  }

  function formatRelativeUpdated(isoOrMs, lang) {
    const isEn = lang === 'en';
    let ts = NaN;
    if (typeof isoOrMs === 'number') ts = isoOrMs;
    else if (typeof isoOrMs === 'string' && isoOrMs.trim()) ts = Date.parse(isoOrMs);
    if (!Number.isFinite(ts) || ts <= 0) return '';
    const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (diffSec < 45) return isEn ? 'just now' : 'az önce';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return isEn ? `${diffMin} min ago` : `${diffMin} dk önce`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return isEn ? `${diffHr} hr ago` : `${diffHr} sa önce`;
    const diffDay = Math.floor(diffHr / 24);
    return isEn ? `${diffDay} d ago` : `${diffDay} gün önce`;
  }

  function formatSinceDate(timestampMs, lang) {
    if (!timestampMs || !Number.isFinite(Number(timestampMs))) return '';
    try {
      return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'tr-TR', {
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
    const section = document.getElementById('homeTopGamesSection');
    if (!section) return;

    const lang = section.getAttribute('data-lang') === 'en' ? 'en' : 'tr';
    const i18n = {
      since: section.getAttribute('data-t-since') || '{date}',
      players: section.getAttribute('data-t-players') || '{count} oyuncu',
      playerSingular: section.getAttribute('data-t-player-singular') || '1 oyuncu',
      share: section.getAttribute('data-t-share') || '%{percent} pay',
      tooltip:
        section.getAttribute('data-t-tooltip') ||
        'Toplam: {duration} • Pay: %{percent} • {players} oyuncu',
      empty: section.getAttribute('data-t-empty') || 'Bu ay henüz oyun etkinliği kaydedilmedi.',
      preparing: section.getAttribute('data-t-preparing') || 'Veri hazırlanıyor…',
      error: section.getAttribute('data-t-error') || 'İstatistikler şu an yüklenemedi.',
      updatedPrefix: section.getAttribute('data-t-updated') || (lang === 'en' ? 'Last updated:' : 'Son güncelleme:'),
    };

    const tabMonth = document.getElementById('topGamesTabMonth');
    const tabAll = document.getElementById('topGamesTabAll');
    const tabs = [tabMonth, tabAll].filter(Boolean);
    const panel = document.getElementById('topGamesListPanel');
    const sinceNoteEl = document.getElementById('topGamesSinceNote');
    const staleBannerEl = document.getElementById('topGamesStaleBanner');
    const updatedNoteEl = document.getElementById('topGamesUpdatedNote');
    const initialJsonEl = document.getElementById('initialTopGamesJson');

    const prefersReducedMotion = Boolean(
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );

    const scopeCache = new Map();
    if (initialJsonEl) {
      try {
        const parsed = JSON.parse(initialJsonEl.textContent || '{}');
        if (parsed && typeof parsed === 'object') {
          scopeCache.set(parsed.scope === 'all' ? 'all' : 'month', parsed);
        }
      } catch (_) {}
    }

    let currentScope = 'month';
    let hasAnimatedInitial = false;

    function animateCurrentRows() {
      const container = document.getElementById('topGamesRowsContainer');
      if (!container || prefersReducedMotion) return;

      const rows = Array.from(container.querySelectorAll('.topgames-row'));
      if (rows.length === 0) return;

      // Önce çubukları 0%'a çek, ardından kademeli (stagger) olarak hedef genişliğe doldur
      rows.forEach((row) => {
        const bar = row.querySelector('.topgames-bar-fill');
        if (bar) {
          bar.style.transition = 'none';
          bar.style.width = '0%';
        }
      });

      // Reflow zorla
      void container.offsetWidth;

      rows.forEach((row, idx) => {
        const bar = row.querySelector('.topgames-bar-fill');
        const targetWidth = Number(bar?.getAttribute('data-target-width') || row.getAttribute('data-bar-width') || 0);
        const delayMs = idx * 60;

        if (bar) {
          bar.style.transition = `width 0.72s cubic-bezier(0.22, 1, 0.36, 1) ${delayMs}ms`;
          bar.style.width = `${Math.max(6, Math.min(100, targetWidth))}%`;
        }

        const durEl = row.querySelector('.topgames-stat-duration');
        const targetSec = Number(durEl?.getAttribute('data-target-seconds') || row.getAttribute('data-seconds') || 0);
        if (durEl && targetSec >= 60) {
          const finalText = formatDuration(targetSec, lang);
          const durationMs = 680;
          const startTime = performance.now() + delayMs;

          const tick = (now) => {
            if (now < startTime) {
              requestAnimationFrame(tick);
              return;
            }
            const progress = Math.min(1, (now - startTime) / durationMs);
            const eased = 1 - Math.pow(1 - progress, 3);
            const currentSec = Math.round(targetSec * eased);
            durEl.textContent = progress >= 1 ? finalText : formatDuration(currentSec, lang);
            if (progress < 1) {
              requestAnimationFrame(tick);
            }
          };
          requestAnimationFrame(tick);
        }
      });
    }

    function updateSinceNote(data) {
      if (!sinceNoteEl) return;
      if (currentScope === 'all' && data && data.since) {
        const dateStr = formatSinceDate(data.since, lang);
        if (dateStr) {
          sinceNoteEl.textContent = i18n.since.replace('{date}', dateStr);
          sinceNoteEl.hidden = false;
          return;
        }
      }
      sinceNoteEl.hidden = true;
    }

    function extractNormalizedEntries(data) {
      if (data && Array.isArray(data.families) && data.families.length > 0) {
        return data.families.map((f, idx) => ({
          id: f.key,
          name: f.label,
          emoji: f.emoji || '🎮',
          seconds: Number.isFinite(Number(f.totalSeconds)) ? Math.max(0, Math.floor(Number(f.totalSeconds))) : 0,
          hours: Number.isFinite(Number(f.hours)) ? Number(f.hours) : 0,
          percent: Number.isFinite(Number(f.percent)) ? Math.max(0, Math.min(100, Math.round(Number(f.percent)))) : 0,
          players: Number.isFinite(Number(f.uniquePlayers)) ? Math.max(0, Math.floor(Number(f.uniquePlayers))) : 0,
          rank: Number.isFinite(Number(f.rank)) ? Math.floor(Number(f.rank)) : idx + 1,
          formattedDuration: f.formattedDuration || null,
          breakdown: f.breakdown || null,
        }));
      }
      return Array.isArray(data?.games) ? data.games : [];
    }

    function updateUpdatedNote(data) {
      if (!updatedNoteEl) return;
      const rel = formatRelativeUpdated(data?.computedAt || data?.updatedAt, lang);
      if (rel) {
        updatedNoteEl.textContent = `${i18n.updatedPrefix} ${rel}`;
        updatedNoteEl.hidden = false;
      } else {
        updatedNoteEl.hidden = true;
      }
    }

    function renderPanelData(data, { animate = true } = {}) {
      if (!panel) return;
      updateSinceNote(data);
      updateUpdatedNote(data);

      const games = extractNormalizedEntries(data);
      if (staleBannerEl) {
        staleBannerEl.hidden = !(data && (data.stale || data.refreshFailed) && games.length > 0);
      }

      if (games.length === 0) {
        let icon = '🎮';
        let text = i18n.empty;
        if (data && data.preparing) {
          icon = '⏳';
          text = i18n.preparing;
        } else if (data && data.offline) {
          icon = '📡';
          text = i18n.error;
        }

        panel.innerHTML = `
          <div class="topgames-empty-state" id="topGamesRowsContainer">
            <div class="topgames-empty-icon" aria-hidden="true">${icon}</div>
            <p class="topgames-empty-text">${escapeHtml(text)}</p>
          </div>
        `;
        return;
      }

      const leaderSec = Math.max(1, Number(games[0].seconds) || 1);
      const rowsHtml = games
        .map((g, index) => {
          const rankNum = index + 1;
          const gradIndex = (index % 8) + 1;
          const relativeWidth = Math.max(
            6,
            Math.min(100, Math.round((Number(g.seconds) / leaderSec) * 100))
          );
          const durText = g.formattedDuration || formatDuration(g.seconds, lang);
          const playersNum = Number(g.players) || 0;
          const playersText =
            playersNum === 1
              ? i18n.playerSingular
              : i18n.players.replace('{count}', String(playersNum));
          const shareText = i18n.share.replace('{percent}', String(g.percent || 0));
          const tooltipText = i18n.tooltip
            .replace('{duration}', durText)
            .replace('{percent}', String(g.percent || 0))
            .replace('{players}', String(g.players || 0));
          const rankBadgeClass = rankNum <= 3 ? `topgames-rank-badge--top${rankNum}` : '';
          const rankLabel = rankNum <= 3 ? RANK_MEDALS[index] : `#${rankNum}`;

          return `
            <div
              class="topgames-row"
              style="--row-index: ${index};"
              data-seconds="${escapeHtml(g.seconds)}"
              data-hours="${escapeHtml(g.hours)}"
              data-percent="${escapeHtml(g.percent)}"
              data-bar-width="${relativeWidth}"
              data-tooltip="${escapeHtml(tooltipText)}"
              tabindex="0"
            >
              <div class="topgames-row-top">
                <div class="topgames-game-ident">
                  <span class="topgames-rank-badge ${rankBadgeClass}">${escapeHtml(rankLabel)}</span>
                  <span class="topgames-game-emoji" aria-hidden="true">${escapeHtml(g.emoji)}</span>
                  <span class="topgames-game-name">${escapeHtml(g.name)}</span>
                </div>

                <div class="topgames-game-stats">
                  <strong class="topgames-stat-duration" data-target-seconds="${escapeHtml(g.seconds)}">${escapeHtml(durText)}</strong>
                  <span class="topgames-stat-pill topgames-stat-pill--share">${escapeHtml(shareText)}</span>
                  ${
                    Number(g.players) > 0
                      ? `<span class="topgames-stat-pill topgames-stat-pill--players">👥 ${escapeHtml(playersText)}</span>`
                      : ''
                  }
                </div>
              </div>

              <div class="topgames-bar-track" role="progressbar" aria-valuenow="${escapeHtml(g.percent)}" aria-valuemin="0" aria-valuemax="100">
                <div
                  class="topgames-bar-fill rank-grad-${gradIndex}"
                  style="width: ${relativeWidth}%;"
                  data-target-width="${relativeWidth}"
                ></div>
              </div>
              ${
                g.breakdown && g.breakdown.formattedLine
                  ? `<div class="topgames-breakdown">${escapeHtml(g.breakdown.formattedLine)}</div>`
                  : ''
              }
            </div>
          `;
        })
        .join('');

      panel.innerHTML = `<div class="topgames-list" id="topGamesRowsContainer">${rowsHtml}</div>`;
      if (animate) {
        animateCurrentRows();
      }
    }

    function renderSkeletonPanel() {
      if (!panel) return;
      const skelRows = [1, 2, 3, 4]
        .map(
          () => `
            <div class="topgames-skel-row">
              <div class="topgames-skel-top">
                <span class="topgames-skel-name"></span>
                <span class="topgames-skel-meta"></span>
              </div>
              <div class="topgames-skel-bar"></div>
            </div>
          `
        )
        .join('');
      panel.innerHTML = `<div class="topgames-list">${skelRows}</div>`;
    }

    async function switchScope(nextScope, { focusTab = false } = {}) {
      const cleanScope = nextScope === 'all' ? 'all' : 'month';
      if (cleanScope === currentScope && scopeCache.has(cleanScope)) return;
      currentScope = cleanScope;

      tabs.forEach((tab) => {
        const isMatch = tab.getAttribute('data-scope') === cleanScope;
        tab.classList.toggle('is-active', isMatch);
        tab.setAttribute('aria-selected', isMatch ? 'true' : 'false');
        tab.setAttribute('tabindex', isMatch ? '0' : '-1');
        if (isMatch && panel) {
          panel.setAttribute('aria-labelledby', tab.id);
        }
        if (isMatch && focusTab) {
          tab.focus();
        }
      });

      if (scopeCache.has(cleanScope)) {
        renderPanelData(scopeCache.get(cleanScope), { animate: true });
        return;
      }

      renderSkeletonPanel();

      try {
        const res = await fetch(`/api/stats/top-games?scope=${cleanScope}&group=family&limit=8&lang=${lang}`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload) {
          renderPanelData({ scope: cleanScope, games: [], offline: true }, { animate: false });
          return;
        }
        scopeCache.set(cleanScope, payload);
        if (currentScope === cleanScope) {
          renderPanelData(payload, { animate: true });
        }
      } catch (_) {
        if (currentScope === cleanScope) {
          renderPanelData({ scope: cleanScope, games: [], offline: true }, { animate: false });
        }
      }
    }

    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => {
        const scope = tab.getAttribute('data-scope') || 'month';
        switchScope(scope, { focusTab: false });
      });

      tab.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          const nextIdx =
            e.key === 'ArrowRight'
              ? (index + 1) % tabs.length
              : (index - 1 + tabs.length) % tabs.length;
          const nextTab = tabs[nextIdx];
          if (nextTab) {
            switchScope(nextTab.getAttribute('data-scope') || 'month', { focusTab: true });
          }
        } else if (e.key === 'Home') {
          e.preventDefault();
          if (tabs[0]) switchScope(tabs[0].getAttribute('data-scope') || 'month', { focusTab: true });
        } else if (e.key === 'End') {
          e.preventDefault();
          const last = tabs[tabs.length - 1];
          if (last) switchScope(last.getAttribute('data-scope') || 'all', { focusTab: true });
        }
      });
    });

    // Görüş alanına (Viewport) ilk girdiğinde tek seferlik dolum + sayaç animasyonu
    if (!prefersReducedMotion && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting && !hasAnimatedInitial) {
              hasAnimatedInitial = true;
              animateCurrentRows();
              observer.disconnect();
            }
          });
        },
        { threshold: 0.18 }
      );
      observer.observe(section);
    } else {
      hasAnimatedInitial = true;
    }
  });
})();
