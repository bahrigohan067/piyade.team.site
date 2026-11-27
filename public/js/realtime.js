/**
 * ==============================================================================
 * 📡 PIYADE WORLD — MERKEZİ GERÇEK ZAMANLI BAĞLANTI YÖNETİCİSİ (realtime.js)
 * ==============================================================================
 * - Tüm canlı akış tüketicileri (chat.js, chat-badge.js, warning-notices.js)
 *   bu tek merkezi yönetici üzerinden çalışır.
 * - Tarayıcı genelinde TEK SSE bağlantısı: navigator.locks ile lider sekme seçilir,
 *   olaylar BroadcastChannel ile tüm sekmelere dağıtılır. Desteklenmiyorsa her sekme
 *   kendi bağlantısını kurar (sunucu kullanıcı başına 8 bağlantıya izin verir).
 * - Üstel geri çekilme + tam rastgelelik (jitter): 250ms..15sn; online, visibility,
 *   pageshow ve focus olaylarında anında yeniden dener.
 * - 45 sn bekçi (watchdog): hiç olay/ping gelmezse bağlantıyı sessizce yeniler.
 * - Kopukken 5 sn'de bir hafif GET /health yoklaması ile gerçek ulaşılabilirliği ölçer.
 * - YALNIZCA HTTP 401 (oturum bitti) giriş sayfasına yönlendirir; ağ hataları ve 5xx
 *   ASLA yönlendirme, oturum silme veya hata sayfası üretmez.
 * ==============================================================================
 */
(function (root) {
  'use strict';

  const BACKOFF_SEQUENCE_MS = Object.freeze([250, 500, 1000, 2000, 4000, 8000, 15000]);
  const MAX_BACKOFF_MS = 15000;
  const WATCHDOG_MS = 45000;
  const HEALTH_POLL_MS = 5000;
  const LOCK_NAME = 'piyade_realtime_leader_v1';
  const CHANNEL_NAME = 'piyade_realtime_v1';

  const FORWARDED_SSE_EVENTS = Object.freeze([
    'connected',
    'ping',
    'unread',
    'message',
    'group_message',
    'group_deleted',
    'delivered',
    'read',
    'deleted',
    'typing',
    'profile',
    'settings',
    'sanction',
    'sanction_updated',
    'site_warning',
    'account_suspended',
    'report_update',
    'disconnect',
  ]);

  /**
   * Üstel geri çekilme + tam rastgelelik (full jitter).
   * Tavan dizisi: 250, 500, 1000, 2000, 4000, 8000, 15000 ms.
   */
  function computeBackoffCap(attempt) {
    const idx = Math.max(0, Math.min(BACKOFF_SEQUENCE_MS.length - 1, Number(attempt) || 0));
    return Math.min(MAX_BACKOFF_MS, BACKOFF_SEQUENCE_MS[idx]);
  }

  function computeBackoffDelay(attempt, rng) {
    const cap = computeBackoffCap(attempt);
    const randFn = typeof rng === 'function' ? rng : Math.random;
    const sample = Math.max(0, Math.min(1, Number(randFn()) || 0));
    return Math.floor(sample * cap);
  }

  function createRealtimeClient(deps) {
    const env = Object.assign(
      {
        win: typeof window !== 'undefined' ? window : null,
        doc: typeof document !== 'undefined' ? document : null,
        nav: typeof navigator !== 'undefined' ? navigator : null,
        EventSourceCtor: typeof EventSource !== 'undefined' ? EventSource : null,
        BroadcastChannelCtor: typeof BroadcastChannel !== 'undefined' ? BroadcastChannel : null,
        fetchFn: typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null,
        nowFn: () => Date.now(),
        setTimeoutFn: (fn, ms) => setTimeout(fn, ms),
        clearTimeoutFn: (id) => clearTimeout(id),
        setIntervalFn: (fn, ms) => setInterval(fn, ms),
        clearIntervalFn: (id) => clearInterval(id),
        rng: Math.random,
        loginRedirectUrl: '/giris',
        onRedirect: null,
        healthUrl: '/health',
        watchdogMs: WATCHDOG_MS,
        healthPollMs: HEALTH_POLL_MS,
      },
      deps || {}
    );

    const tabId = `tab_${env.nowFn().toString(36)}_${Math.floor((env.rng() || 0.5) * 1e9).toString(36)}`;
    const listeners = new Map(); // eventType -> Set<fn>

    let started = false;
    let destroyed = false;
    let streamUrl = '/sohbet/akis';
    let authCheckUrl = '/sohbet/api/okunmamis';
    let streamPriority = 0; // 1: warning-only, 2: full chat+warning

    let isLeader = false;
    let lockReleaseResolve = null;
    let channel = null;
    let sse = null;

    let status = 'idle'; // 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'stopped'
    let hasConnectedOnce = false;
    let disconnectedSince = null;
    let lastEventId = 0;
    let attempt = 0;
    let nextReconnectReason = null; // null | 'timeout' | 'other_tab' | 'error'

    let reconnectTimer = null;
    let watchdogTimer = null;
    let healthTimer = null;
    let healthProbeInFlight = false;
    let redirectedOn401 = false;

    function isNavigatorOnline() {
      if (!env.nav || typeof env.nav.onLine !== 'boolean') return true;
      return env.nav.onLine;
    }

    function emit(eventType, payload) {
      const set = listeners.get(eventType);
      if (!set || set.size === 0) return;
      for (const fn of [...set]) {
        try {
          fn(payload);
        } catch (_) {}
      }
    }

    function on(eventType, fn) {
      if (!eventType || typeof fn !== 'function') return () => {};
      let set = listeners.get(eventType);
      if (!set) {
        set = new Set();
        listeners.set(eventType, set);
      }
      set.add(fn);
      return () => off(eventType, fn);
    }

    function off(eventType, fn) {
      const set = listeners.get(eventType);
      if (set) {
        set.delete(fn);
      }
    }

    function postToChannel(msg) {
      if (!channel) return;
      try {
        channel.postMessage(Object.assign({ senderTabId: tabId }, msg));
      } catch (_) {}
    }

    function getStateSnapshot() {
      return {
        status,
        isLeader,
        online: isNavigatorOnline(),
        disconnectedSince,
        lastEventId,
        attempt,
        streamUrl,
        hasConnectedOnce,
      };
    }

    function notifyStatusChange({ reconnected = false, broadcast = true } = {}) {
      const snap = getStateSnapshot();
      snap.reconnected = Boolean(reconnected);
      emit('status', snap);
      if (reconnected) {
        emit('reconnected', snap);
      }
      if (broadcast && isLeader) {
        postToChannel({
          kind: 'status',
          status,
          disconnectedSince,
          lastEventId,
          hasConnectedOnce,
          reconnected: Boolean(reconnected),
        });
      }
    }

    function redirectToLogin() {
      if (redirectedOn401) return;
      redirectedOn401 = true;
      status = 'stopped';
      teardownSse();
      stopHealthPolling();
      clearReconnectTimer();
      emit('auth_expired', { status: 401 });
      if (isLeader) {
        postToChannel({ kind: 'auth_expired' });
      }
      if (typeof env.onRedirect === 'function') {
        env.onRedirect(env.loginRedirectUrl);
      } else if (env.win && env.win.location && typeof env.win.location.assign === 'function') {
        env.win.location.assign(env.loginRedirectUrl);
      }
    }

    /**
     * HTTP durum / ağ hatası sınıflandırması:
     * SADECE HTTP 401 giriş yönlendirmesi tetikler.
     * Ağ hatası (TypeError), zaman aşımı, 5xx, 502/503/504 ASLA yönlendirmez veya oturum silmez.
     */
    function handleHttpFailure(statusCode) {
      const code = Number(statusCode) || 0;
      if (code === 401) {
        redirectToLogin();
        return 'auth_expired';
      }
      if (code === 0 || code >= 500 || code === 408) {
        return 'transient_network';
      }
      return 'client_error';
    }

    function clearReconnectTimer() {
      if (reconnectTimer !== null) {
        env.clearTimeoutFn(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function clearWatchdogTimer() {
      if (watchdogTimer !== null) {
        env.clearTimeoutFn(watchdogTimer);
        watchdogTimer = null;
      }
    }

    function resetWatchdog() {
      clearWatchdogTimer();
      if (destroyed || !isLeader || !sse || status === 'stopped') return;
      watchdogTimer = env.setTimeoutFn(() => {
        if (destroyed || !isLeader || status === 'stopped') return;
        nextReconnectReason = 'timeout';
        markDisconnected('reconnecting');
        teardownSse();
        startHealthPolling();
        scheduleReconnect({ immediate: true });
      }, env.watchdogMs);
    }

    function teardownSse() {
      clearWatchdogTimer();
      if (sse) {
        try {
          sse.close();
        } catch (_) {}
        sse = null;
      }
    }

    function startHealthPolling() {
      if (healthTimer !== null || destroyed || status === 'stopped') return;
      healthTimer = env.setIntervalFn(() => {
        probeHealthAndMaybeReconnect();
      }, env.healthPollMs);
    }

    function stopHealthPolling() {
      if (healthTimer !== null) {
        env.clearIntervalFn(healthTimer);
        healthTimer = null;
      }
    }

    async function probeHealthAndMaybeReconnect() {
      if (destroyed || status === 'stopped' || status === 'connected' || healthProbeInFlight) return false;
      if (!env.fetchFn) return false;
      healthProbeInFlight = true;
      try {
        const resp = await env.fetchFn(env.healthUrl, {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
            'X-Health-Probe': 'light',
          },
        });
        if (resp && resp.ok) {
          // Sunucu gerçekten erişilebilir -> oturum 401 mi yoksa sadece geçici kopma mı kontrol et
          const authOk = await checkAuthNotExpired();
          if (!authOk) {
            return false;
          }
          if (isLeader && status !== 'connected' && status !== 'stopped') {
            clearReconnectTimer();
            connectSseNow();
          } else if (!isLeader) {
            postToChannel({ kind: 'request_reconnect' });
          }
          return true;
        }
        // 5xx veya beklenmedik durum: sessizce yeniden denemeye devam et (ASLA yönlendirme yok)
        return false;
      } catch (_) {
        // Ağ yok / TypeError / zaman aşımı: sessizce bekle
        return false;
      } finally {
        healthProbeInFlight = false;
      }
    }

    async function checkAuthNotExpired() {
      if (!env.fetchFn || !authCheckUrl) return true;
      try {
        const resp = await env.fetchFn(authCheckUrl, {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (resp && resp.status === 401) {
          handleHttpFailure(401);
          return false;
        }
        return true;
      } catch (_) {
        // Ağ hatası: oturum bitmiş sayılmaz!
        return true;
      }
    }

    function markDisconnected(nextStatus) {
      const targetStatus = !isNavigatorOnline() ? 'offline' : nextStatus || 'reconnecting';
      if (disconnectedSince === null) {
        disconnectedSince = env.nowFn();
      }
      if (status !== targetStatus) {
        status = targetStatus;
        notifyStatusChange({ reconnected: false, broadcast: true });
      }
    }

    function scheduleReconnect({ immediate = false } = {}) {
      if (destroyed || !isLeader || status === 'stopped') return;
      clearReconnectTimer();
      if (immediate) {
        connectSseNow();
        return;
      }
      const delay = computeBackoffDelay(attempt, env.rng);
      attempt = Math.min(attempt + 1, BACKOFF_SEQUENCE_MS.length - 1);
      reconnectTimer = env.setTimeoutFn(() => {
        reconnectTimer = null;
        if (!destroyed && isLeader && status !== 'stopped') {
          connectSseNow();
        }
      }, delay);
    }

    function buildSseUrl() {
      const params = [];
      if (lastEventId > 0) {
        params.push(`lastEventId=${encodeURIComponent(String(lastEventId))}`);
      }
      if (nextReconnectReason) {
        params.push(`reason=${encodeURIComponent(nextReconnectReason)}`);
      }
      if (params.length === 0) return streamUrl;
      const sep = streamUrl.includes('?') ? '&' : '?';
      return `${streamUrl}${sep}${params.join('&')}`;
    }

    function dispatchSseEvent(eventType, parsedData, rawLastId, { fromBroadcast = false } = {}) {
      const idNum = Number.parseInt(String(rawLastId || ''), 10);
      if (Number.isFinite(idNum) && idNum > lastEventId) {
        lastEventId = idNum;
      }

      if (!fromBroadcast && isLeader) {
        resetWatchdog();
      }

      if (eventType === 'connected') {
        const wasDisconnected = hasConnectedOnce || disconnectedSince !== null;
        hasConnectedOnce = true;
        disconnectedSince = null;
        attempt = 0;
        nextReconnectReason = null;
        status = 'connected';
        clearReconnectTimer();
        stopHealthPolling();
        emit('connected', parsedData);
        notifyStatusChange({ reconnected: wasDisconnected, broadcast: !fromBroadcast });
        if (!fromBroadcast && isLeader) {
          postToChannel({
            kind: 'sse_event',
            eventType,
            data: parsedData,
            lastEventId,
          });
        }
        return;
      }

      if (eventType === 'ping') {
        emit('ping', parsedData);
        return;
      }

      if (eventType === 'disconnect') {
        const reason = (parsedData && parsedData.reason) || '';
        emit('disconnect', parsedData);
        if (!fromBroadcast && isLeader) {
          postToChannel({ kind: 'sse_event', eventType, data: parsedData, lastEventId });
        }
        if (reason === 'replaced_by_other_tab') {
          // Başka sekme bağlantıyı devraldı -> sıkı döngüye girmeden nazikçe bekle
          teardownSse();
          clearReconnectTimer();
          nextReconnectReason = 'other_tab';
          return;
        }
        if (reason === 'logout' || reason === 'account_banned' || reason === 'account_deleted') {
          status = 'stopped';
          teardownSse();
          stopHealthPolling();
          clearReconnectTimer();
          return;
        }
        return;
      }

      emit(eventType, parsedData);
      if (!fromBroadcast && isLeader) {
        postToChannel({
          kind: 'sse_event',
          eventType,
          data: parsedData,
          lastEventId,
        });
      }
    }

    function connectSseNow() {
      if (destroyed || !isLeader || status === 'stopped') return;
      if (!env.EventSourceCtor) return;

      teardownSse();
      clearReconnectTimer();

      if (!hasConnectedOnce) {
        status = isNavigatorOnline() ? 'connecting' : 'offline';
      }

      const url = buildSseUrl();
      let es;
      try {
        es = new env.EventSourceCtor(url);
      } catch (_) {
        nextReconnectReason = 'error';
        markDisconnected('reconnecting');
        startHealthPolling();
        scheduleReconnect({ immediate: false });
        return;
      }

      sse = es;
      resetWatchdog();

      for (const evtName of FORWARDED_SSE_EVENTS) {
        es.addEventListener(evtName, (ev) => {
          if (sse !== es) return;
          let parsed = {};
          try {
            parsed = ev && ev.data ? JSON.parse(ev.data) : {};
          } catch (_) {
            parsed = {};
          }
          dispatchSseEvent(evtName, parsed, ev && ev.lastEventId, { fromBroadcast: false });
        });
      }

      es.onerror = () => {
        if (sse !== es || destroyed || status === 'stopped') return;
        // EventSource hata verdiğinde gereksiz tight-loop yapmadan kapatıp kontrollü geri çekilme uygula
        teardownSse();
        if (!nextReconnectReason) {
          nextReconnectReason = 'error';
        }
        markDisconnected('reconnecting');
        startHealthPolling();

        // Sunucu ulaşılabilirse oturumun 401'e düşüp düşmediğini sessizce doğrula
        if (isNavigatorOnline()) {
          checkAuthNotExpired().then((stillAuthed) => {
            if (stillAuthed && !destroyed && isLeader && status !== 'connected' && status !== 'stopped') {
              scheduleReconnect({ immediate: false });
            }
          });
        } else {
          scheduleReconnect({ immediate: false });
        }
      };
    }

    function triggerImmediateReconnect(reason) {
      if (destroyed || status === 'stopped') return;
      if (status === 'connected') return;
      if (reason && !nextReconnectReason) {
        nextReconnectReason = reason;
      }
      if (isLeader) {
        attempt = 0;
        clearReconnectTimer();
        connectSseNow();
      } else {
        postToChannel({ kind: 'request_reconnect' });
      }
    }

    function becomeLeader() {
      if (destroyed || isLeader) return;
      isLeader = true;
      emit('leader_change', { isLeader: true, tabId });
      postToChannel({ kind: 'leader_hello', streamUrl, streamPriority });
      connectSseNow();
    }

    function setupChannel() {
      if (!env.BroadcastChannelCtor || channel) return;
      try {
        channel = new env.BroadcastChannelCtor(CHANNEL_NAME);
        channel.onmessage = (ev) => {
          const msg = ev && ev.data;
          if (!msg || msg.senderTabId === tabId || destroyed) return;

          if (msg.kind === 'sse_event' && !isLeader) {
            dispatchSseEvent(msg.eventType, msg.data, msg.lastEventId, { fromBroadcast: true });
            return;
          }

          if (msg.kind === 'status' && !isLeader) {
            status = msg.status || status;
            disconnectedSince = msg.disconnectedSince ?? null;
            if (Number.isFinite(msg.lastEventId) && msg.lastEventId > lastEventId) {
              lastEventId = msg.lastEventId;
            }
            if (msg.hasConnectedOnce) hasConnectedOnce = true;
            notifyStatusChange({ reconnected: Boolean(msg.reconnected), broadcast: false });
            return;
          }

          if (msg.kind === 'auth_expired' && !isLeader) {
            redirectToLogin();
            return;
          }

          if (msg.kind === 'request_status' && isLeader) {
            // Eğer başka sekme daha yüksek öncelikli akış istiyorsa (örn. sohbet sekmesi) lider akışı yükselt
            if (msg.streamUrl && (Number(msg.streamPriority) || 0) > streamPriority) {
              streamUrl = msg.streamUrl;
              streamPriority = Number(msg.streamPriority) || streamPriority;
              if (msg.authCheckUrl) authCheckUrl = msg.authCheckUrl;
              connectSseNow();
            } else {
              notifyStatusChange({ reconnected: false, broadcast: true });
            }
            return;
          }

          if (msg.kind === 'request_reconnect' && isLeader) {
            if (status !== 'connected') {
              attempt = 0;
              clearReconnectTimer();
              connectSseNow();
            }
            return;
          }
        };
      } catch (_) {
        channel = null;
      }
    }

    function startLeaderElection() {
      const hasLocks = Boolean(env.nav && env.nav.locks && typeof env.nav.locks.request === 'function');
      const hasChannel = Boolean(channel);

      if (!hasLocks || !hasChannel) {
        // Destek yoksa her sekme kendi bağlantısını kurar (sunucu 8 bağlantıya kadar destekler)
        becomeLeader();
        return;
      }

      // Lider varsa mevcut durumunu sor
      postToChannel({
        kind: 'request_status',
        streamUrl,
        streamPriority,
        authCheckUrl,
      });

      try {
        env.nav.locks
          .request(LOCK_NAME, { mode: 'exclusive' }, () => {
            if (destroyed) return Promise.resolve();
            becomeLeader();
            return new Promise((resolve) => {
              lockReleaseResolve = resolve;
            });
          })
          .catch(() => {
            if (!destroyed && !isLeader) {
              becomeLeader();
            }
          });
      } catch (_) {
        becomeLeader();
      }
    }

    // Tarayıcı bağlantı / odak olayları
    const boundHandlers = [];
    function attachBrowserEvents() {
      const add = (target, name, fn) => {
        if (!target || typeof target.addEventListener !== 'function') return;
        target.addEventListener(name, fn);
        boundHandlers.push(() => target.removeEventListener(name, fn));
      };

      add(env.win, 'online', () => {
        triggerImmediateReconnect(null);
        probeHealthAndMaybeReconnect();
      });

      add(env.win, 'offline', () => {
        markDisconnected('offline');
        if (isLeader) {
          teardownSse();
          startHealthPolling();
        }
      });

      add(env.doc, 'visibilitychange', () => {
        if (env.doc && env.doc.visibilityState === 'visible') {
          triggerImmediateReconnect(null);
        }
      });

      add(env.win, 'pageshow', () => {
        triggerImmediateReconnect(null);
      });

      add(env.win, 'focus', () => {
        triggerImmediateReconnect(null);
      });

      add(env.win, 'beforeunload', () => {
        destroy();
      });
    }

    function start(options) {
      const opts = options || {};
      const nextPriority = Number(opts.priority) || (opts.url && opts.url.includes('/sohbet/akis') ? 2 : 1);
      if (opts.url && (!started || nextPriority > streamPriority)) {
        streamUrl = opts.url;
        streamPriority = nextPriority;
        if (opts.authCheckUrl) authCheckUrl = opts.authCheckUrl;
        if (started && isLeader) {
          connectSseNow();
        } else if (started && !isLeader) {
          postToChannel({
            kind: 'request_status',
            streamUrl,
            streamPriority,
            authCheckUrl,
          });
        }
      }
      if (opts.loginRedirectUrl) {
        env.loginRedirectUrl = opts.loginRedirectUrl;
      }

      if (started) return api;
      started = true;
      destroyed = false;

      if (!isNavigatorOnline()) {
        markDisconnected('offline');
      }

      setupChannel();
      attachBrowserEvents();
      startLeaderElection();
      return api;
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      teardownSse();
      clearReconnectTimer();
      stopHealthPolling();
      for (const unbind of boundHandlers.splice(0, boundHandlers.length)) {
        try {
          unbind();
        } catch (_) {}
      }
      if (lockReleaseResolve) {
        try {
          lockReleaseResolve();
        } catch (_) {}
        lockReleaseResolve = null;
      }
      if (channel) {
        try {
          channel.close();
        } catch (_) {}
        channel = null;
      }
      isLeader = false;
    }

    const api = {
      start,
      destroy,
      on,
      off,
      getState: getStateSnapshot,
      handleHttpFailure,
      probeHealth: probeHealthAndMaybeReconnect,
      triggerImmediateReconnect,
      computeBackoffCap,
      computeBackoffDelay,
      BACKOFF_SEQUENCE_MS,
      MAX_BACKOFF_MS,
      WATCHDOG_MS,
      HEALTH_POLL_MS,
    };

    return api;
  }

  const exported = {
    createRealtimeClient,
    computeBackoffCap,
    computeBackoffDelay,
    BACKOFF_SEQUENCE_MS,
    MAX_BACKOFF_MS,
    WATCHDOG_MS,
    HEALTH_POLL_MS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  } else if (root) {
    const singleton = createRealtimeClient({});
    singleton.createRealtimeClient = createRealtimeClient;
    root.PiyadeRealtime = singleton;
  }
})(typeof window !== 'undefined' ? window : globalThis);
