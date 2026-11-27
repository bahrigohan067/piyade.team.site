const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-chat-improvements-secret-1234567890';
process.env.API_SECRET = 'test-api-secret-improvements';
process.env.DISCORD_CLIENT_ID = '111111111111111111';
process.env.DISCORD_CLIENT_SECRET = 'test-discord-secret';
process.env.BASE_URL = 'http://127.0.0.1:3001';
process.env.CHAT_ENABLED = 'true';
process.env.CHAT_GOOGLE_MEMBERS_ENABLED = 'true';

const chatConfig = require('../config/chat.config');
const appConfig = require('../config/app.config');
const { ROLES } = require('../config/roles.config');
const botApiClient = require('../services/botApiClient');
const { ChatStore, setDefaultChatStore } = require('../services/chatStore');
const { ChatModStore, setDefaultChatModStore } = require('../services/chatModStore');
const { MemberStore, setDefaultMemberStore, toUnifiedGoogleId } = require('../services/memberStore');
const { chatSseHub } = require('../services/chatSseHub');
const { createServerApp } = require('../server');
const realtimeMod = require('../public/js/realtime');
const offlineIndicatorMod = require('../public/js/offline-indicator');

// > 2^53 (9007199254740991) gerçek 19 haneli Discord snowflake ID'leri
const ADMIN_SNOWFLAKE = '1133815339898122999';
const DEV_ADMIN_ID = '1133815339898122999';
const REGULAR_DISCORD_ID = '1244926440909233888';
const MOD_ONLY_ID = '1355037551010344777';
const REVOKED_DEV_ID = '1466148662121455666';

function createFakeClock() {
  let now = 1_700_000_000_000;
  let nextId = 1;
  const timers = new Map();

  const setTimeoutFn = (fn, ms) => {
    const id = nextId++;
    timers.set(id, { fn, at: now + Math.max(0, Number(ms) || 0), interval: null });
    return id;
  };
  const clearTimeoutFn = (id) => {
    timers.delete(id);
  };
  const setIntervalFn = (fn, ms) => {
    const id = nextId++;
    const period = Math.max(1, Number(ms) || 1);
    timers.set(id, { fn, at: now + period, interval: period });
    return id;
  };
  const clearIntervalFn = (id) => {
    timers.delete(id);
  };
  const advance = async (ms) => {
    const target = now + ms;
    while (true) {
      let earliestId = null;
      let earliest = null;
      for (const [id, entry] of timers.entries()) {
        if (entry.at <= target && (!earliest || entry.at < earliest.at)) {
          earliest = entry;
          earliestId = id;
        }
      }
      if (!earliest) break;
      now = earliest.at;
      if (earliest.interval !== null) {
        earliest.at = now + earliest.interval;
      } else {
        timers.delete(earliestId);
      }
      earliest.fn();
      await Promise.resolve();
    }
    now = target;
  };

  return {
    nowFn: () => now,
    setTimeoutFn,
    clearTimeoutFn,
    setIntervalFn,
    clearIntervalFn,
    advance,
  };
}

function createFakeEventTarget() {
  const map = new Map();
  return {
    addEventListener(name, fn) {
      if (!map.has(name)) map.set(name, new Set());
      map.get(name).add(fn);
    },
    removeEventListener(name, fn) {
      if (map.has(name)) map.get(name).delete(fn);
    },
    dispatch(name, ev = {}) {
      for (const fn of [...(map.get(name) || [])]) fn(ev);
    },
  };
}

function createFakeDom() {
  class FakeEl {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.className = '';
      this.children = [];
      this.parentNode = null;
      this.attrs = {};
      this.style = {};
      this.hidden = false;
      this.textContent = '';
      this.classList = {
        add: (...cls) => {
          const set = new Set(this.className.split(/\s+/).filter(Boolean));
          for (const c of cls) set.add(c);
          this.className = [...set].join(' ');
        },
        remove: (...cls) => {
          const set = new Set(this.className.split(/\s+/).filter(Boolean));
          for (const c of cls) set.delete(c);
          this.className = [...set].join(' ');
        },
        toggle: (c, force) => {
          const has = this.classList.contains(c);
          const next = force !== undefined ? Boolean(force) : !has;
          if (next) this.classList.add(c);
          else this.classList.remove(c);
        },
        contains: (c) => this.className.split(/\s+/).filter(Boolean).includes(c),
      };
    }
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k === 'class') this.className = String(v);
    }
    getAttribute(k) {
      return k in this.attrs ? this.attrs[k] : null;
    }
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    }
    append(...nodes) {
      for (const n of nodes) this.appendChild(n);
    }
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) this.children.splice(idx, 1);
      child.parentNode = null;
    }
    replaceChildren(...nodes) {
      this.children = [];
      for (const n of nodes) this.appendChild(n);
    }
  }

  const body = new FakeEl('body');
  const mount = new FakeEl('div');
  body.appendChild(mount);

  return {
    mount,
    doc: {
      body,
      createElement: (tag) => new FakeEl(tag),
      createElementNS: (_ns, tag) => new FakeEl(tag),
    },
  };
}

function createFakeBroadcastBus() {
  const channels = new Map();
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      this.closed = false;
      if (!channels.has(name)) channels.set(name, new Set());
      channels.get(name).add(this);
    }
    postMessage(data) {
      if (this.closed) return;
      for (const peer of [...(channels.get(this.name) || [])]) {
        if (peer !== this && !peer.closed && typeof peer.onmessage === 'function') {
          peer.onmessage({ data: JSON.parse(JSON.stringify(data)) });
        }
      }
    }
    close() {
      this.closed = true;
      const set = channels.get(this.name);
      if (set) set.delete(this);
    }
  }
  return FakeBroadcastChannel;
}

function createFakeLocksManager() {
  const held = new Map();
  const queues = new Map();

  function runNext(name) {
    if (held.get(name)) return;
    const q = queues.get(name);
    if (!q || q.length === 0) return;
    const next = q.shift();
    held.set(name, true);
    Promise.resolve()
      .then(() => next.cb({ name }))
      .then(
        (res) => {
          held.set(name, false);
          next.resolve(res);
          runNext(name);
        },
        (err) => {
          held.set(name, false);
          next.reject(err);
          runNext(name);
        }
      );
  }

  return {
    request(name, _opts, cb) {
      const fn = typeof _opts === 'function' ? _opts : cb;
      return new Promise((resolve, reject) => {
        if (!queues.has(name)) queues.set(name, []);
        queues.get(name).push({ cb: fn, resolve, reject });
        runNext(name);
      });
    },
  };
}

function createMockEventSourceClass() {
  const instances = [];
  class MockEventSource {
    constructor(url) {
      this.url = url;
      this.closed = false;
      this.listeners = new Map();
      this.onerror = null;
      instances.push(this);
    }
    addEventListener(name, fn) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(fn);
    }
    emit(name, dataObj, lastEventId = '') {
      if (this.closed) return;
      const ev = { data: JSON.stringify(dataObj || {}), lastEventId: String(lastEventId || '') };
      for (const fn of [...(this.listeners.get(name) || [])]) fn(ev);
    }
    triggerError() {
      if (this.closed) return;
      if (typeof this.onerror === 'function') this.onerror(new Error('sse error'));
    }
    close() {
      this.closed = true;
    }
  }
  return { MockEventSource, instances };
}

test('Grup yöneticisi > 2^53 string kimlik ayrıştırma ve teşhis durumları', async (t) => {
  await t.test('1) Virgul, noktali virgul, bosluk, satir sonu, tirnak, BOM ve gorunmez bosluk temizlenir', () => {
    // 2^53 üstü hassasiyet kaybı kontrolü: Number() bozar, string birebir korur
    assert.notEqual(String(Number(ADMIN_SNOWFLAKE)), ADMIN_SNOWFLAKE);

    const messyRaw = `\uFEFF "${ADMIN_SNOWFLAKE}" ;\u200B '224466880011223344'\n\t335577991122334455\u00A0 gecersiz_id 123`;
    const parsed = chatConfig.parseChatGroupAdminDiscordIds({ CHAT_GROUP_ADMIN_DISCORD_IDS: messyRaw });

    assert.equal(parsed.envEmpty, false);
    assert.deepEqual([...parsed.ids], [ADMIN_SNOWFLAKE, '224466880011223344', '335577991122334455']);

    const envMock = { CHAT_GROUP_ADMIN_DISCORD_IDS: messyRaw };
    assert.equal(chatConfig.isDiscordIdGroupAdmin(ADMIN_SNOWFLAKE, envMock), true);
    assert.equal(chatConfig.isDiscordIdGroupAdmin('g_m_abc123', envMock), false);
  });

  await t.test('2) Teşhis kodları (MATCH / ENV_EMPTY / ENV_PARSE_EMPTY / NOT_IN_LIST / NOT_DISCORD_SESSION) ve sıfır tam ID sızıntısı', () => {
    const discordReq = (id) => ({
      session: { identity: { kind: 'discord', discordId: id }, user: { kind: 'discord', id } },
    });
    const googleReq = {
      session: { identity: { kind: 'google', memberId: 'm_xyz999' }, user: { kind: 'google', id: 'g_m_xyz999' } },
    };

    // ENV_EMPTY
    const dEmpty = chatConfig.evaluateChatGroupAdminDiagnostics(discordReq(ADMIN_SNOWFLAKE), {});
    assert.equal(dEmpty.code, 'ENV_EMPTY');
    assert.equal(dEmpty.isMatch, false);
    assert.equal(JSON.stringify(dEmpty).includes(ADMIN_SNOWFLAKE), false);

    // ENV_PARSE_EMPTY
    const dParseEmpty = chatConfig.evaluateChatGroupAdminDiagnostics(discordReq(ADMIN_SNOWFLAKE), {
      CHAT_GROUP_ADMIN_DISCORD_IDS: '  "abc", not-a-snowflake  ',
    });
    assert.equal(dParseEmpty.code, 'ENV_PARSE_EMPTY');
    assert.equal(dParseEmpty.configuredCount, 0);

    // MATCH
    const matchEnv = { CHAT_GROUP_ADMIN_DISCORD_IDS: `"${ADMIN_SNOWFLAKE}", 224466880011223344` };
    const dMatch = chatConfig.evaluateChatGroupAdminDiagnostics(discordReq(ADMIN_SNOWFLAKE), matchEnv);
    assert.equal(dMatch.code, 'MATCH');
    assert.equal(dMatch.isMatch, true);
    assert.equal(dMatch.configuredCount, 2);
    assert.equal(dMatch.sessionLast4, '2999');
    assert.deepEqual(dMatch.configuredLast4List, ['2999', '3344']);
    assert.equal(JSON.stringify(dMatch).includes(ADMIN_SNOWFLAKE), false);

    // NOT_IN_LIST
    const dNotIn = chatConfig.evaluateChatGroupAdminDiagnostics(discordReq(REGULAR_DISCORD_ID), matchEnv);
    assert.equal(dNotIn.code, 'NOT_IN_LIST');
    assert.equal(dNotIn.isMatch, false);
    assert.equal(dNotIn.sessionLast4, '3888');

    // NOT_DISCORD_SESSION (Google üyesi asla yönetici olamaz)
    const dGoogle = chatConfig.evaluateChatGroupAdminDiagnostics(googleReq, matchEnv);
    assert.equal(dGoogle.code, 'NOT_DISCORD_SESSION');
    assert.equal(dGoogle.isMatch, false);
  });
});

test('realtime.js: üstel geri çekilme, bekçi, çoklu sekme lideri ve 401 vs 5xx/ağ ayrımı', async (t) => {
  await t.test('1) Backoff tavanı (250..15000 ms) ve full jitter aralığı', () => {
    assert.deepEqual([...realtimeMod.BACKOFF_SEQUENCE_MS], [250, 500, 1000, 2000, 4000, 8000, 15000]);
    assert.equal(realtimeMod.computeBackoffCap(0), 250);
    assert.equal(realtimeMod.computeBackoffCap(3), 2000);
    assert.equal(realtimeMod.computeBackoffCap(6), 15000);
    assert.equal(realtimeMod.computeBackoffCap(99), 15000);

    for (let attempt = 0; attempt <= 10; attempt += 1) {
      const cap = realtimeMod.computeBackoffCap(attempt);
      const low = realtimeMod.computeBackoffDelay(attempt, () => 0);
      const mid = realtimeMod.computeBackoffDelay(attempt, () => 0.5);
      const high = realtimeMod.computeBackoffDelay(attempt, () => 0.9999);
      assert.equal(low, 0);
      assert.ok(mid >= 0 && mid <= cap);
      assert.ok(high >= 0 && high <= cap);
    }
  });

  await t.test('2) 45 sn bekçi (watchdog) yeniden bağlanır, online/visibility/pageshow/focus anında tetikler', async () => {
    const clock = createFakeClock();
    const win = createFakeEventTarget();
    const doc = createFakeEventTarget();
    doc.visibilityState = 'visible';
    const { MockEventSource, instances } = createMockEventSourceClass();
    let healthCalls = 0;
    const fetchFn = async (url) => {
      if (String(url).includes('/health')) {
        healthCalls += 1;
        return { ok: false, status: 503 };
      }
      return { ok: true, status: 200 };
    };

    const rt = realtimeMod.createRealtimeClient({
      win,
      doc,
      nav: { onLine: true },
      EventSourceCtor: MockEventSource,
      BroadcastChannelCtor: null,
      fetchFn,
      ...clock,
      rng: () => 0.5,
    });

    rt.start({ url: '/sohbet/akis', priority: 2 });
    assert.equal(instances.length, 1);
    instances[0].emit('connected', { unread: 0 }, '1');
    assert.equal(rt.getState().status, 'connected');

    // 45 sn boyunca olay/ping gelmezse bekçi ?reason=timeout ile yeni bağlantı açar
    await clock.advance(45000);
    assert.equal(instances.length, 2);
    assert.match(instances[1].url, /reason=timeout/);
    assert.equal(instances[0].closed, true);

    // 2. bağlantıda hata olsun -> health poll 5 sn sonra çalışır
    instances[1].triggerError();
    await Promise.resolve();
    await clock.advance(5000);
    assert.ok(healthCalls >= 1);

    // visibilitychange (visible) / focus / pageshow / online anında yeni bağlantı açar
    const countBeforeEvents = instances.length;
    win.dispatch('online');
    assert.ok(instances.length > countBeforeEvents);

    rt.destroy();
  });

  await t.test('3) Çoklu sekme: 3 sekme navigator.locks + BroadcastChannel ile TEK SSE paylaşır ve lider kapanınca devralır', async () => {
    const clock = createFakeClock();
    const Bus = createFakeBroadcastBus();
    const locks = createFakeLocksManager();
    const { MockEventSource, instances } = createMockEventSourceClass();

    const makeTab = () =>
      realtimeMod.createRealtimeClient({
        win: createFakeEventTarget(),
        doc: Object.assign(createFakeEventTarget(), { visibilityState: 'visible' }),
        nav: { onLine: true, locks },
        EventSourceCtor: MockEventSource,
        BroadcastChannelCtor: Bus,
        fetchFn: async () => ({ ok: true, status: 200 }),
        ...clock,
      });

    const tab1 = makeTab();
    const tab2 = makeTab();
    const tab3 = makeTab();

    const tab2Msgs = [];
    const tab3Msgs = [];
    tab2.on('group_message', (d) => tab2Msgs.push(d));
    tab3.on('group_message', (d) => tab3Msgs.push(d));

    tab1.start({ url: '/sohbet/akis', priority: 2 });
    tab2.start({ url: '/sohbet/akis', priority: 2 });
    tab3.start({ url: '/sohbet/akis', priority: 2 });
    await Promise.resolve();
    await Promise.resolve();

    // 3 sekme açık ama tarayıcı genelinde YALNIZCA 1 EventSource açıldı!
    assert.equal(instances.length, 1);
    assert.equal(tab1.getState().isLeader, true);
    assert.equal(tab2.getState().isLeader, false);
    assert.equal(tab3.getState().isLeader, false);

    // Liderden gelen olay BroadcastChannel ile diğer iki sekmeye ulaşır
    instances[0].emit('connected', { unread: 0 }, '10');
    instances[0].emit('group_message', { groupId: 'genel', message: { id: 'm1', text: 'Merhaba' } }, '11');
    assert.equal(tab2Msgs.length, 1);
    assert.equal(tab3Msgs.length, 1);
    assert.equal(tab2Msgs[0].message.text, 'Merhaba');

    // Lider sekme kapanınca kilit serbest kalır ve tab2 liderliği devralıp yeni SSE açar
    tab1.destroy();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(tab2.getState().isLeader, true);
    assert.equal(instances.length, 2);

    tab2.destroy();
    tab3.destroy();
  });

  await t.test('4) YALNIZCA 401 girişe yönlendirir; ağ hatası (TypeError) ve 500/502/503/504 ASLA yönlendirmez', async () => {
    const clock = createFakeClock();
    const redirects = [];
    const { MockEventSource, instances } = createMockEventSourceClass();
    let authStatus = 503;
    let throwNetwork = false;

    const rt = realtimeMod.createRealtimeClient({
      win: createFakeEventTarget(),
      doc: Object.assign(createFakeEventTarget(), { visibilityState: 'visible' }),
      nav: { onLine: true },
      EventSourceCtor: MockEventSource,
      BroadcastChannelCtor: null,
      fetchFn: async () => {
        if (throwNetwork) throw new TypeError('Failed to fetch');
        return { ok: authStatus === 200, status: authStatus };
      },
      onRedirect: (url) => redirects.push(url),
      ...clock,
    });

    rt.start({ url: '/sohbet/akis', authCheckUrl: '/sohbet/api/okunmamis', priority: 2 });

    // 500, 502, 503, 504 ve ağ hatası ASLA yönlendirme yapmaz
    assert.equal(rt.handleHttpFailure(0), 'transient_network');
    assert.equal(rt.handleHttpFailure(500), 'transient_network');
    assert.equal(rt.handleHttpFailure(502), 'transient_network');
    assert.equal(rt.handleHttpFailure(503), 'transient_network');
    assert.equal(rt.handleHttpFailure(504), 'transient_network');
    assert.equal(redirects.length, 0);

    // SSE hatası sırasında 503 veya TypeError gelirse de yönlendirme olmaz
    throwNetwork = true;
    instances[0].triggerError();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(redirects.length, 0);
    assert.notEqual(rt.getState().status, 'stopped');

    // Sunucu 401 (oturum bitti) dönerse HEMEN /giris yönlendirmesi tetiklenir
    throwNetwork = false;
    authStatus = 401;
    await rt.probeHealth();
    // /health 401 değil ama direct handleHttpFailure(401) ve checkAuthNotExpired testi:
    assert.equal(rt.handleHttpFailure(401), 'auth_expired');
    assert.deepEqual(redirects, ['/giris']);
    assert.equal(rt.getState().status, 'stopped');

    rt.destroy();
  });
});

test('offline-indicator.js: 3sn hap, 12sn bulanık katman, kuyruk sayacı, Bağlandı ve reduced-motion', async () => {
  const clock = createFakeClock();
  const { mount, doc } = createFakeDom();
  let reducedMotion = false;

  const ind = offlineIndicatorMod.createOfflineIndicator({
    mountEl: mount,
    doc,
    win: {
      matchMedia: () => ({ matches: reducedMotion }),
    },
    ...clock,
  });

  // 1) Kısa kopuş (< 3 sn): hiçbir şey görünmez, bağlanınca "Bağlandı" da yanıp sönmez
  ind.setDisconnected({ offline: false });
  await clock.advance(2900);
  assert.equal(ind.getPhase(), 'hidden');
  ind.setConnected();
  assert.equal(ind.getPhase(), 'hidden');

  // 2) Uzun kopuş: 3 sn'de hap, 12 sn'de katman + kuyruk sayısı
  ind.setQueuedCount(3);
  ind.setDisconnected({ offline: false });
  await clock.advance(3000);
  assert.equal(ind.getPhase(), 'pill');
  assert.equal(ind.getElements().pillEl.hidden, false);
  assert.equal(ind.getElements().overlayEl.hidden, true);

  await clock.advance(9000);
  assert.equal(ind.getPhase(), 'overlay');
  assert.equal(ind.getElements().overlayEl.hidden, false);
  assert.equal(ind.getElements().overlayQueueEl.hidden, false);
  assert.equal(ind.getElements().overlayQueueEl.textContent, '3 mesaj sırada');

  // 3) Bağlantı gelince "Bağlandı" (~900 ms) ve sonra gizlenme
  ind.setConnected();
  assert.equal(ind.getPhase(), 'connected');
  assert.equal(ind.getElements().pillEl.classList.contains('is-connected'), true);
  await clock.advance(900);
  assert.equal(ind.getPhase(), 'hidden');

  // 4) navigator.onLine === false (offline: true) + prefers-reduced-motion anında hap gösterir
  reducedMotion = true;
  ind.setDisconnected({ offline: true });
  assert.equal(ind.getPhase(), 'pill');
  assert.equal(ind.getElements().rootEl.classList.contains('is-reduced-motion'), true);

  ind.destroy();
});

test('Tam entegrasyon: SSE gzip dışlama + gerçek heartbeat, sunucu isAdmin, Developer teşhis ve tam ekran HTML', async (t) => {
  const prevAdminEnv = process.env.CHAT_GROUP_ADMIN_DISCORD_IDS;
  const SECOND_ADMIN_SNOWFLAKE = '224466880011223344';
  process.env.CHAT_GROUP_ADMIN_DISCORD_IDS = `"${ADMIN_SNOWFLAKE}", ${SECOND_ADMIN_SNOWFLAKE}`;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piyade-chat-imp-'));
  const chatDir = path.join(tmpDir, 'chat');
  const membersDir = path.join(tmpDir, 'members');

  const directoryMembers = [
    { id: DEV_ADMIN_ID, displayName: 'KurucuAdmin', discordAvatarUrl: null, hasRoblox: false, games: [] },
    { id: REGULAR_DISCORD_ID, displayName: 'NormalUye', discordAvatarUrl: null, hasRoblox: false, games: [] },
    { id: MOD_ONLY_ID, displayName: 'SadeceMod', discordAvatarUrl: null, hasRoblox: false, games: [] },
    { id: REVOKED_DEV_ID, displayName: 'EskiDev', discordAvatarUrl: null, hasRoblox: false, games: [] },
  ];

  const botServer = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const u = new URL(req.url, 'http://127.0.0.1');
      const send = (st, obj) => {
        res.writeHead(st, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (u.pathname === '/api/stats/summary') {
        return send(200, { activeThisMonth: 12, playingNow: 3, computedAt: new Date().toISOString() });
      }
      if (u.pathname === '/api/directory') {
        return send(200, { items: directoryMembers, nextCursor: null, hasMore: false, total: directoryMembers.length });
      }
      if (u.pathname === '/api/directory/lookup') {
        const body = JSON.parse(raw || '{}');
        const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
        return send(200, { items: directoryMembers.filter((m) => ids.includes(m.id)) });
      }
      const m = /^\/api\/member\/(\d+)\/roles$/.exec(u.pathname);
      if (m) {
        const uid = m[1];
        if (uid === DEV_ADMIN_ID) {
          return send(200, {
            id: uid,
            displayName: 'KurucuAdmin',
            level: 'registered',
            registered: true,
            roles: [
              { id: ROLES.KAYITLI_UYE, name: 'Kayıtlı Üye', position: 10 },
              { id: ROLES.DEVELOPER, name: 'Developer', position: 100 },
            ],
          });
        }
        if (uid === MOD_ONLY_ID) {
          return send(200, {
            id: uid,
            displayName: 'SadeceMod',
            level: 'registered',
            registered: true,
            roles: [
              { id: ROLES.KAYITLI_UYE, name: 'Kayıtlı Üye', position: 10 },
              { id: ROLES.COMMUNITY_OFFICIAL, name: 'Community Official', position: 35 },
            ],
          });
        }
        // REVOKED_DEV_ID artık Bot API'de Developer DEĞİL!
        return send(200, {
          id: uid,
          displayName: uid === REVOKED_DEV_ID ? 'EskiDev' : 'NormalUye',
          level: 'registered',
          registered: true,
          roles: [{ id: ROLES.KAYITLI_UYE, name: 'Kayıtlı Üye', position: 10 }],
        });
      }
      return send(200, { ok: true });
    });
  });

  await new Promise((r) => botServer.listen(0, '127.0.0.1', r));
  const prevBotUrl = appConfig.BOT_API_URL;
  appConfig.BOT_API_URL = `http://127.0.0.1:${botServer.address().port}`;
  botApiClient.clearDirectoryCache();

  const chatStore = new ChatStore({ baseDir: chatDir, silentWarning: true });
  setDefaultChatStore(chatStore);
  const modStore = new ChatModStore({ baseDir: chatDir });
  setDefaultChatModStore(modStore);
  const memberStore = new MemberStore({ baseDir: membersDir });
  setDefaultMemberStore(memberStore);

  const gmCreated = memberStore.createMember({
    googleSub: 'imp-google-sub-1',
    email: 'google@example.com',
    googleName: 'Google Real',
    nickname: 'SiteUyesi',
    ageGroup: '18_plus',
    games: [],
    consents: [
      { id: 'international_data_transfer', version: '1.1', at: Date.now() - 86400000 * 3 },
      { id: 'chat_moderation_review', version: '1.0', at: Date.now() - 86400000 * 3 },
      { id: 'chat_profile_game_usernames', version: '1.1', at: Date.now() - 86400000 * 3 },
    ],
    privacy: { showGamesInChat: true },
    nowMs: Date.now() - 86400000 * 3,
  });
  const GOOGLE_UID = toUnifiedGoogleId(gmCreated.member.id);

  for (const uid of [DEV_ADMIN_ID, REGULAR_DISCORD_ID, MOD_ONLY_ID, REVOKED_DEV_ID, GOOGLE_UID]) {
    chatStore.recordConsent(uid, chatConfig.POLICY_VERSION);
  }

  const app = createServerApp();
  app.get('/__imp_login', (req, res) => {
    const parsed = JSON.parse(String(req.query.payload || '{}'));
    const { kind, id, memberId, displayName, roles = [] } = parsed;
    if (kind === 'google') {
      req.session.identity = { kind: 'google', memberId: String(memberId) };
      req.session.user = { id: toUnifiedGoogleId(memberId), memberId: String(memberId), kind: 'google' };
    } else {
      req.session.identity = { kind: 'discord', discordId: String(id) };
      req.session.user = {
        id: String(id),
        kind: 'discord',
        username: displayName || String(id),
        displayName: displayName || String(id),
        avatarUrl: null,
        roles: roles.length > 0 ? roles : [{ id: ROLES.KAYITLI_UYE, name: 'Kayıtlı Üye', position: 10 }],
        level: 'registered',
        registered: true,
        inGuild: true,
        rolesSyncedAt: Date.now(),
      };
    }
    res.json({ ok: true, csrfToken: req.session.csrfToken || '' });
  });
  // notFoundHandler'dan önce taşı
  const stack = app.router ? app.router.stack : app._router.stack;
  const loginLayer = stack.pop();
  const nfIdx = stack.findIndex((l) => l.name === 'notFoundHandler');
  if (nfIdx >= 0) stack.splice(nfIdx, 0, loginLayer);
  else stack.push(loginLayer);

  const siteServer = http.createServer(app);
  await new Promise((r) => siteServer.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${siteServer.address().port}`;

  async function reqHttp(urlPath, { method = 'GET', cookie = '', csrf = '', body = null, headers = {} } = {}) {
    const h = { Accept: 'application/json', ...headers };
    if (cookie) h.Cookie = cookie;
    if (csrf) h['X-CSRF-Token'] = csrf;
    const opts = { method, headers: h };
    if (body !== null) {
      h['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const resp = await fetch(`${baseUrl}${urlPath}`, opts);
    const setCookie = resp.headers.get('set-cookie');
    const text = await resp.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_) {}
    return {
      status: resp.status,
      text,
      json,
      cookie: setCookie ? setCookie.split(';')[0] : cookie,
      headers: resp.headers,
    };
  }

  async function loginAs(payload) {
    const r = await reqHttp(`/__imp_login?payload=${encodeURIComponent(JSON.stringify(payload))}`, { method: 'GET' });
    assert.equal(r.status, 200);
    // CSRF token'ı /sohbet HTML'den çek
    const page = await reqHttp('/sohbet', { cookie: r.cookie, headers: { Accept: 'text/html' } });
    const m = /"csrfToken":"([^"]+)"/.exec(page.text);
    return { cookie: r.cookie, csrfToken: m ? m[1] : r.json.csrfToken, html: page.text, status: page.status };
  }

  try {
    const devSess = await loginAs({
      kind: 'discord',
      id: DEV_ADMIN_ID,
      displayName: 'KurucuAdmin',
      roles: [
        { id: ROLES.KAYITLI_UYE, name: 'Kayıtlı Üye', position: 10 },
        { id: ROLES.DEVELOPER, name: 'Developer', position: 100 },
      ],
    });
    const regSess = await loginAs({ kind: 'discord', id: REGULAR_DISCORD_ID, displayName: 'NormalUye' });
    const modSess = await loginAs({
      kind: 'discord',
      id: MOD_ONLY_ID,
      displayName: 'SadeceMod',
      roles: [
        { id: ROLES.KAYITLI_UYE, name: 'Kayıtlı Üye', position: 10 },
        { id: ROLES.COMMUNITY_OFFICIAL, name: 'Community Official', position: 35 },
      ],
    });
    const revokedDevSess = await loginAs({
      kind: 'discord',
      id: REVOKED_DEV_ID,
      displayName: 'EskiDev',
      // Eski oturumda Developer varmış gibi görünse bile Bot API'de artık yok!
      roles: [
        { id: ROLES.KAYITLI_UYE, name: 'Kayıtlı Üye', position: 10 },
        { id: ROLES.DEVELOPER, name: 'Developer', position: 100 },
      ],
    });
    const googleSess = await loginAs({ kind: 'google', memberId: gmCreated.member.id });

    await t.test('1) Accept-Encoding: gzip, br ile SSE sıkıştırılmaz, tamponlanmaz; connected + ping anında gelir', async () => {
      chatSseHub.resetForTests();
      const origHb = chatSseHub.heartbeatMsOverride;
      chatSseHub.heartbeatMsOverride = 120;
      try {
        const res = await new Promise((resolve, reject) => {
          const startedAt = Date.now();
          let buf = '';
          let sawConnectedAt = null;
          let sawPingAt = null;

          const req = http.request(
            `${baseUrl}/sohbet/akis`,
            {
              method: 'GET',
              headers: {
                Cookie: devSess.cookie,
                Accept: 'text/event-stream',
                'Accept-Encoding': 'gzip, br',
              },
            },
            (r) => {
              r.on('data', (chunk) => {
                buf += chunk.toString('utf8');
                if (!sawConnectedAt && buf.includes('event: connected')) {
                  sawConnectedAt = Date.now() - startedAt;
                }
                if (!sawPingAt && buf.includes(': ping') && buf.includes('event: ping')) {
                  sawPingAt = Date.now() - startedAt;
                  req.destroy();
                  resolve({ statusCode: r.statusCode, headers: r.headers, buf, sawConnectedAt, sawPingAt });
                }
              });
            }
          );
          req.on('error', (err) => {
            if (!sawPingAt) reject(err);
          });
          setTimeout(() => {
            if (!sawPingAt) {
              req.destroy();
              reject(new Error(`SSE ping timeout! Received: ${buf}`));
            }
          }, 1500);
          req.end();
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.headers['content-encoding'], undefined);
        assert.match(res.headers['content-type'] || '', /text\/event-stream/);
        assert.match(res.headers['cache-control'] || '', /no-transform/);
        assert.equal(res.headers['x-accel-buffering'], 'no');
        assert.ok(res.sawConnectedAt < 500, `connected too slow: ${res.sawConnectedAt}ms`);
        assert.ok(res.sawPingAt < 1000, `ping too slow: ${res.sawPingAt}ms`);
        assert.match(res.buf, /retry:\s*3000/);
      } finally {
        chatSseHub.heartbeatMsOverride = origHb;
      }
    });

    await t.test('2) Sunucu tarafı isAdmin her uçta döner; Google asla admin değil; admin silme 200/403', async () => {
      // Admin mesaj atar
      const postAdmin = await reqHttp('/sohbet/api/grup/genel/mesaj', {
        method: 'POST',
        cookie: devSess.cookie,
        csrf: devSess.csrfToken,
        body: { text: 'Yonetici duyurusu', clientId: 'cid-admin-1' },
      });
      assert.equal(postAdmin.status, 201);
      assert.equal(postAdmin.json.message.isAdmin, true);
      assert.equal(postAdmin.json.sender.isAdmin, true);

      // Normal Discord üyesi mesaj atar
      const postReg = await reqHttp('/sohbet/api/grup/genel/mesaj', {
        method: 'POST',
        cookie: regSess.cookie,
        csrf: regSess.csrfToken,
        body: { text: 'Normal mesaj', clientId: 'cid-reg-1' },
      });
      assert.equal(postReg.status, 201);
      assert.equal(postReg.json.message.isAdmin, false);

      // Google üyesi mesaj atar (asla yönetici değil)
      const postGoogle = await reqHttp('/sohbet/api/grup/genel/mesaj', {
        method: 'POST',
        cookie: googleSess.cookie,
        csrf: googleSess.csrfToken,
        body: { text: 'Google uye mesaji', clientId: 'cid-google-1' },
      });
      assert.equal(postGoogle.status, 201);
      assert.equal(postGoogle.json.message.isAdmin, false);

      // GET mesaj listesi her mesajda sunucu hesaplı isAdmin içerir
      const listRes = await reqHttp('/sohbet/api/grup/genel/mesajlar?limit=20', { cookie: regSess.cookie });
      assert.equal(listRes.status, 200);
      const adminMsg = listRes.json.messages.find((m) => m.id === postAdmin.json.message.id);
      const regMsg = listRes.json.messages.find((m) => m.id === postReg.json.message.id);
      const gMsg = listRes.json.messages.find((m) => m.id === postGoogle.json.message.id);
      assert.equal(adminMsg.isAdmin, true);
      assert.equal(regMsg.isAdmin, false);
      assert.equal(gMsg.isAdmin, false);

      // Normal üye ve Google üyesi başkasının mesajını silemez (403)
      const forbiddenReg = await reqHttp(`/sohbet/api/grup/genel/mesaj/${encodeURIComponent(postAdmin.json.message.id)}`, {
        method: 'DELETE',
        cookie: regSess.cookie,
        csrf: regSess.csrfToken,
      });
      assert.equal(forbiddenReg.status, 403);

      const forbiddenGoogle = await reqHttp(`/sohbet/api/grup/genel/mesaj/${encodeURIComponent(postReg.json.message.id)}`, {
        method: 'DELETE',
        cookie: googleSess.cookie,
        csrf: googleSess.csrfToken,
      });
      assert.equal(forbiddenGoogle.status, 403);

      // Grup yöneticisi başkasının mesajını silebilir (200, adminRemoved: true)
      const adminDel = await reqHttp(`/sohbet/api/grup/genel/mesaj/${encodeURIComponent(postReg.json.message.id)}`, {
        method: 'DELETE',
        cookie: devSess.cookie,
        csrf: devSess.csrfToken,
      });
      assert.equal(adminDel.status, 200);
      assert.equal(adminDel.json.adminRemoved, true);
    });

    await t.test('3) Developer teşhis kutusu ve /sohbet/api/diagnostik SADECE taze doğrulanmış Discord Developer içindir; tam ID sızdırmaz', async () => {
      // Fresh Developer: HTML'de kutu var, son 4 haneler var, teşhis kutusu ve tüm HTML diğer yönetici ID'lerini sızdırmaz!
      const diagStart = devSess.html.indexOf('id="chatDevDiagBox"');
      assert.ok(diagStart > 0, 'Developer teşhis kutusu HTML içinde olmalı');
      const diagSlice = devSess.html.slice(diagStart, devSess.html.indexOf('</section>', diagStart));
      assert.equal(diagSlice.includes('…2999'), true);
      assert.equal(diagSlice.includes('…3344'), true);
      assert.equal(diagSlice.includes(DEV_ADMIN_ID), false, 'Tam Discord ID teşhis kutusuna sızmamalı!');
      assert.equal(devSess.html.includes(SECOND_ADMIN_SNOWFLAKE), false, 'Diğer yönetici tam ID HTML çıktısına sızmamalı!');

      const diagDev = await reqHttp('/sohbet/api/diagnostik', { cookie: devSess.cookie });
      assert.equal(diagDev.status, 200);
      assert.equal(diagDev.json.diagnostics.code, 'MATCH');
      assert.equal(diagDev.json.diagnostics.configuredCount, 2);
      assert.equal(diagDev.json.diagnostics.sessionLast4, '2999');
      assert.deepEqual(diagDev.json.diagnostics.configuredLast4List, ['2999', '3344']);
      assert.equal(diagDev.text.includes(DEV_ADMIN_ID), false, 'Tam Discord ID diagnostik JSON çıktısına sızmamalı!');
      assert.equal(diagDev.text.includes(SECOND_ADMIN_SNOWFLAKE), false, 'Diğer yönetici tam ID diagnostik JSON çıktısına sızmamalı!');

      // Normal üye, sadece mod, yetkisi alınmış eski Developer ve Google üyesi: kutu HTML'de YOK ve API 404!
      for (const s of [regSess, modSess, revokedDevSess, googleSess]) {
        assert.equal(s.html.includes('id="chatDevDiagBox"'), false);
        const r = await reqHttp('/sohbet/api/diagnostik', { cookie: s.cookie });
        assert.equal(r.status, 404);
      }
    });

    await t.test('4) Eski kopma şeridi tamamen yok, tam ekran sınıfı ve hafif /health çalışıyor', async () => {
      assert.equal(devSess.html.includes('is-chat-fullscreen'), true);
      assert.equal(devSess.html.includes('chatOfflineIndicatorSlot'), true);
      assert.equal(devSess.html.includes('chatJumpToBottomBtn'), true);
      assert.equal(devSess.html.includes('chatReconnectBanner'), false);
      assert.equal(devSess.html.includes('Bağlantı koptu'), false);

      // Sohbet dışı sayfa tam ekran sınıfını ALMAZ
      const rulesPage = await reqHttp('/kurallar', { cookie: devSess.cookie, headers: { Accept: 'text/html' } });
      assert.equal(rulesPage.status, 200);
      assert.equal(rulesPage.text.includes('is-chat-fullscreen'), false);

      // Hafif /health ucu anında 200 döner
      const lightHealth = await reqHttp('/health', { headers: { 'X-Health-Probe': 'light' } });
      assert.equal(lightHealth.status, 200);
      assert.equal(lightHealth.json.ok, true);
      assert.equal(lightHealth.json.light, true);
    });
  } finally {
    chatSseHub.resetForTests();
    await new Promise((r) => siteServer.close(r));
    await new Promise((r) => botServer.close(r));
    appConfig.BOT_API_URL = prevBotUrl;
    chatStore.flush();
    modStore.flush();
    memberStore.flush();
    if (prevAdminEnv === undefined) delete process.env.CHAT_GROUP_ADMIN_DISCORD_IDS;
    else process.env.CHAT_GROUP_ADMIN_DISCORD_IDS = prevAdminEnv;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
});
