/**
 * Global Sohbet Okunmamış Rozeti ve Sekme Başlığı Senkronizasyonu
 * - Merkezi window.PiyadeRealtime yöneticisini kullanır (çift/çoklu SSE bağlantısı açmaz).
 * - Çevrimdışıyken hata kutusu çıkarmaz; son bilinen sayıyı korur ve sessizce yeniden dener.
 */
(function () {
  'use strict';

  const badgeEl = document.getElementById('sidebarChatUnreadBadge');
  const isChatPage = Boolean(document.getElementById('chatApp'));
  const baseTitle = document.title.replace(/^\(\d+\+?\)\s*/, '');
  let pollTimer = null;
  let stopped = false;

  function applyUnreadCount(count) {
    const n = Math.max(0, Number(count) || 0);
    if (badgeEl) {
      if (n > 0) {
        badgeEl.textContent = n > 99 ? '99+' : String(n);
        badgeEl.hidden = false;
      } else {
        badgeEl.textContent = '';
        badgeEl.hidden = true;
      }
    }
    document.title = n > 0 ? `(${n > 99 ? '99+' : n}) ${baseTitle}` : baseTitle;
  }

  // chat.js tarafından tetiklenen anlık sayaç güncellemeleri
  window.addEventListener('piyade:chat-unread', (ev) => {
    if (ev && ev.detail && typeof ev.detail.unread === 'number') {
      applyUnreadCount(ev.detail.unread);
    }
  });

  async function pollOnce() {
    if (stopped) return null;
    try {
      const resp = await fetch('/sohbet/api/okunmamis', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (resp.status === 401 && window.PiyadeRealtime) {
        window.PiyadeRealtime.handleHttpFailure(401);
        return null;
      }
      if (!resp.ok) return null;
      const data = await resp.json().catch(() => null);
      if (data && data.ok) {
        applyUnreadCount(data.unread || 0);
        return data;
      }
    } catch (_) {
      // Çevrimdışı: son bilinen rozet korunur, hata gösterilmez
    }
    return null;
  }

  function startQuietPollFallback() {
    if (pollTimer || stopped) return;
    pollTimer = setInterval(() => {
      if (document.visibilityState !== 'hidden' && navigator.onLine !== false) {
        pollOnce();
      }
    }, 30000);
  }

  if (!isChatPage) {
    pollOnce().then((res) => {
      if (stopped) return;
      if (res && !res.needsConsent && window.PiyadeRealtime) {
        const rt = window.PiyadeRealtime;
        rt.on('connected', (d) => {
          if (d && typeof d.unread === 'number') applyUnreadCount(d.unread);
        });
        rt.on('unread', (d) => {
          if (d && typeof d.unread === 'number') applyUnreadCount(d.unread);
        });
        rt.on('site_warning', (d) => {
          window.dispatchEvent(new CustomEvent('piyade:site-warning', { detail: d || {} }));
        });
        rt.on('account_suspended', (d) => {
          window.dispatchEvent(new CustomEvent('piyade:account-suspended', { detail: d || {} }));
        });
        rt.on('reconnected', () => {
          pollOnce();
        });
        rt.start({
          url: '/sohbet/akis',
          authCheckUrl: '/sohbet/api/okunmamis',
          priority: 2,
        });
      } else if (!res || !res.needsConsent) {
        startQuietPollFallback();
      }
    });
  }

  window.addEventListener('beforeunload', () => {
    stopped = true;
    if (pollTimer) clearInterval(pollTimer);
  });
})();
