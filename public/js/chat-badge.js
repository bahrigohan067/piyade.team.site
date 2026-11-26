/**
 * Global Sohbet Okunmamış Rozeti ve Sekme Başlığı Senkronizasyonu
 * - Sohbet sayfasındayken kendi SSE akışını açmaz (chat.js'in yayınladığı olayı dinler).
 * - Diğer sayfalarda SSE (/sohbet/akis) kullanır; SSE yoksa veya koparsa 30 sn'de bir yoklama yedeğine düşer.
 */
(function () {
  'use strict';

  const badgeEl = document.getElementById('sidebarChatUnreadBadge');
  const isChatPage = Boolean(document.getElementById('chatApp'));
  const baseTitle = document.title.replace(/^\(\d+\+?\)\s*/, '');
  let sse = null;
  let pollTimer = null;
  let retryMs = 2000;
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
      if (!resp.ok) return null;
      const data = await resp.json();
      if (data && data.ok) {
        applyUnreadCount(data.unread || 0);
        return data;
      }
    } catch (_) {}
    return null;
  }

  function startPollingFallback() {
    if (pollTimer || stopped) return;
    pollTimer = setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        pollOnce();
      }
    }, 30000);
  }

  function connectSse() {
    if (stopped || isChatPage || typeof window.EventSource !== 'function') {
      if (!isChatPage) startPollingFallback();
      return;
    }
    try {
      sse = new EventSource('/sohbet/akis');
      sse.addEventListener('connected', (ev) => {
        retryMs = 2000;
        try {
          const d = JSON.parse(ev.data || '{}');
          if (typeof d.unread === 'number') applyUnreadCount(d.unread);
        } catch (_) {}
      });
      sse.addEventListener('unread', (ev) => {
        try {
          const d = JSON.parse(ev.data || '{}');
          if (typeof d.unread === 'number') applyUnreadCount(d.unread);
        } catch (_) {}
      });
      sse.addEventListener('site_warning', (ev) => {
        try {
          window.dispatchEvent(new CustomEvent('piyade:site-warning', { detail: JSON.parse(ev.data || '{}') }));
        } catch (_) {}
      });
      sse.addEventListener('account_suspended', (ev) => {
        try {
          window.dispatchEvent(new CustomEvent('piyade:account-suspended', { detail: JSON.parse(ev.data || '{}') }));
        } catch (_) {}
      });
      sse.addEventListener('disconnect', () => {
        stopped = true;
        if (sse) sse.close();
      });
      sse.onerror = () => {
        if (sse) {
          sse.close();
          sse = null;
        }
        startPollingFallback();
        if (!stopped) {
          const wait = retryMs;
          retryMs = Math.min(30000, retryMs * 2);
          setTimeout(() => {
            if (!stopped) connectSse();
          }, wait);
        }
      };
    } catch (_) {
      startPollingFallback();
    }
  }

  // Sohbet sayfasında değilsek önce okunmamış durumunu öğren; onaylıysa SSE'ye bağlan
  if (!isChatPage) {
    pollOnce().then((res) => {
      if (res && !res.needsConsent) {
        connectSse();
      }
    });
  }

  window.addEventListener('beforeunload', () => {
    stopped = true;
    if (sse) sse.close();
    if (pollTimer) clearInterval(pollTimer);
  });
})();
