const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Gerekli temel env değişkenleri (test izole)
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-32-chars-minimum-ok';
process.env.API_SECRET = 'test-api-secret-key';
process.env.DISCORD_CLIENT_ID = '111111111111111111';
process.env.DISCORD_CLIENT_SECRET = 'test-discord-client-secret';
process.env.BASE_URL = 'http://127.0.0.1:3001';

const chatConfig = require('../config/chat.config');
const { ChatStore, setDefaultChatStore, makeConvId, sanitizeChatText } = require('../services/chatStore');
const { chatSseHub } = require('../services/chatSseHub');
const botApiClient = require('../services/botApiClient');
const { createServerApp } = require('../server');

const USER_A = '100000000000000001';
const USER_B = '100000000000000002';
const USER_C = '100000000000000003';
const USER_UNREG = '100000000000000099';

const DIRECTORY_MEMBERS = [
  {
    id: USER_A,
    displayName: 'Alpha Oyuncu',
    discordAvatarUrl: '/img/brand/icon-192.png',
    robloxId: '501',
    robloxUsername: 'AlphaRbx',
    robloxAvatarUrl: '/img/brand/icon-192.png',
    hasRoblox: true,
  },
  {
    id: USER_B,
    displayName: 'Beta Oyuncu',
    discordAvatarUrl: '/img/brand/icon-192.png',
    robloxId: '502',
    robloxUsername: 'BetaRbx',
    robloxAvatarUrl: '/img/brand/icon-192.png',
    hasRoblox: true,
  },
  {
    id: USER_C,
    displayName: 'Gamma Oyuncu',
    discordAvatarUrl: '/img/brand/icon-192.png',
    robloxId: null,
    robloxUsername: null,
    robloxAvatarUrl: null,
    hasRoblox: false,
  },
];

// 12 ekstra kayıtlı üye (günlük 10 yeni sohbet sınırı testi için)
for (let i = 10; i <= 22; i += 1) {
  DIRECTORY_MEMBERS.push({
    id: `1000000000000001${String(i).padStart(2, '0')}`,
    displayName: `Uye ${i}`,
    discordAvatarUrl: '/img/brand/icon-192.png',
    robloxId: null,
    robloxUsername: null,
    robloxAvatarUrl: null,
    hasRoblox: false,
  });
}

function startFakeBotServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const sendJson = (code, payload) => {
          res.writeHead(code, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(payload));
        };

        if (url.pathname === '/api/health') {
          return sendJson(200, { status: 'ok' });
        }

        if (url.pathname === '/api/stats/summary') {
          return sendJson(200, { activeThisMonth: 15, playingNow: 3, computedAt: new Date().toISOString() });
        }

        if (url.pathname.startsWith('/api/member/') && url.pathname.endsWith('/roles')) {
          const id = url.pathname.split('/')[3];
          const isReg = id !== USER_UNREG;
          return sendJson(200, {
            id,
            displayName: (DIRECTORY_MEMBERS.find((m) => m.id === id) || {}).displayName || id,
            avatarUrl: '/img/brand/icon-192.png',
            roles: isReg ? ['1559604702143062016'] : ['1559604540997636147'],
            level: isReg ? 'registered' : 'unregistered',
            registered: isReg,
            highestRolePosition: 10,
          });
        }

        if (url.pathname === '/api/directory') {
          const q = (url.searchParams.get('query') || '').trim().toLowerCase();
          const excludeSelf = url.searchParams.get('excludeSelf') === '1';
          const actorId = req.headers['x-actor-id'] || '';
          let items = DIRECTORY_MEMBERS.filter((m) => {
            if (excludeSelf && m.id === actorId) return false;
            if (!q) return true;
            return (
              m.displayName.toLowerCase().includes(q) ||
              (m.robloxUsername && m.robloxUsername.toLowerCase().includes(q))
            );
          });
          return sendJson(200, { items, nextCursor: null, hasMore: false, total: items.length });
        }

        if (url.pathname === '/api/directory/lookup' && req.method === 'POST') {
          let parsed = {};
          try {
            parsed = JSON.parse(body || '{}');
          } catch (_) {}
          const ids = Array.isArray(parsed.ids) ? parsed.ids : [];
          const items = DIRECTORY_MEMBERS.filter((m) => ids.includes(m.id));
          return sendJson(200, { items });
        }

        return sendJson(404, { error: 'Not found' });
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function createSignedCookieAndSession(app, userObj) {
  return new Promise((resolve, reject) => {
    const crypto = require('crypto');
    const sid = `test_${crypto.randomBytes(12).toString('hex')}`;
    const csrf = crypto.randomBytes(16).toString('hex');
    const sess = {
      cookie: {
        originalMaxAge: 86400000,
        expires: new Date(Date.now() + 86400000).toISOString(),
        httpOnly: true,
        path: '/',
      },
      csrfToken: csrf,
      user: userObj,
    };
    app.locals.sessionStore.set(sid, sess, (err) => {
      if (err) return reject(err);
      // express-session cookie-signature: s:<sid>.<hmacBase64NoPad>
      const sig = crypto
        .createHmac('sha256', process.env.SESSION_SECRET)
        .update(sid)
        .digest('base64')
        .replace(/=+$/, '');
      const cookieVal = `piyade.sid=${encodeURIComponent(`s:${sid}.${sig}`)}`;
      resolve({ cookie: cookieVal, csrfToken: csrf, sid });
    });
  });
}

async function httpRequest(baseUrl, reqPath, { method = 'GET', cookie = '', csrf = '', body = null, headers = {} } = {}) {
  const hdrs = { Accept: 'application/json', ...headers };
  if (cookie) hdrs.Cookie = cookie;
  if (csrf) hdrs['X-CSRF-Token'] = csrf;
  let payload;
  if (body !== null) {
    hdrs['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const resp = await fetch(`${baseUrl}${reqPath}`, {
    method,
    headers: hdrs,
    body: payload,
    redirect: 'manual',
  });
  const text = await resp.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {}
  return { status: resp.status, headers: resp.headers, text, json };
}

test('Parça 2: Sohbet Çekirdek Kontrat ve Güvenlik Testleri', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piyade-chat-core-'));
  const bot = await startFakeBotServer();
  const appConfig = require('../config/app.config');
  const prevBotUrl = appConfig.BOT_API_URL;
  const prevChatEnabled = process.env.CHAT_ENABLED;

  appConfig.BOT_API_URL = bot.url;
  botApiClient.clearDirectoryCache();

  const store = new ChatStore({ baseDir: tmpDir, silentWarning: true });
  setDefaultChatStore(store);
  chatSseHub.resetForTests();

  const app = createServerApp();
  const siteServer = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const siteUrl = `http://127.0.0.1:${siteServer.address().port}`;

  const sessA = await createSignedCookieAndSession(app, {
    id: USER_A,
    username: 'alpha',
    displayName: 'Alpha Oyuncu',
    avatarUrl: '/img/brand/icon-192.png',
    roles: ['1559604702143062016'],
    level: 'registered',
    registered: true,
    inGuild: true,
    rolesSyncedAt: Date.now(),
  });
  const sessB = await createSignedCookieAndSession(app, {
    id: USER_B,
    username: 'beta',
    displayName: 'Beta Oyuncu',
    avatarUrl: '/img/brand/icon-192.png',
    roles: ['1559604702143062016'],
    level: 'registered',
    registered: true,
    inGuild: true,
    rolesSyncedAt: Date.now(),
  });
  const sessC = await createSignedCookieAndSession(app, {
    id: USER_C,
    username: 'gamma',
    displayName: 'Gamma Oyuncu',
    avatarUrl: '/img/brand/icon-192.png',
    roles: ['1559604702143062016'],
    level: 'registered',
    registered: true,
    inGuild: true,
    rolesSyncedAt: Date.now(),
  });
  const sessUnreg = await createSignedCookieAndSession(app, {
    id: USER_UNREG,
    username: 'newbie',
    displayName: 'Kayitsiz Uye',
    avatarUrl: '/img/brand/icon-192.png',
    roles: ['1559604540997636147'],
    level: 'unregistered',
    registered: false,
    inGuild: true,
    rolesSyncedAt: Date.now(),
  });

  t.after(async () => {
    chatSseHub.resetForTests();
    store.flush();
    appConfig.BOT_API_URL = prevBotUrl;
    if (prevChatEnabled === undefined) delete process.env.CHAT_ENABLED;
    else process.env.CHAT_ENABLED = prevChatEnabled;
    await new Promise((r) => siteServer.close(r));
    await new Promise((r) => bot.server.close(r));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test('1) CHAT_ENABLED kapalıyken /sohbet* 404 döner ve menüde öğe yoktur', async () => {
    delete process.env.CHAT_ENABLED;
    const r1 = await httpRequest(siteUrl, '/sohbet', { cookie: sessA.cookie, headers: { Accept: 'text/html' } });
    assert.equal(r1.status, 404);
    const r2 = await httpRequest(siteUrl, '/sohbet/gizlilik', { headers: { Accept: 'text/html' } });
    assert.equal(r2.status, 404);
    const r3 = await httpRequest(siteUrl, '/sohbet/api/rehber', { cookie: sessA.cookie });
    assert.equal(r3.status, 404);
    const home = await httpRequest(siteUrl, '/', { cookie: sessA.cookie, headers: { Accept: 'text/html' } });
    assert.equal(home.text.includes('href="/sohbet"'), false);
  });

  await t.test('2) CHAT_ENABLED açıkken robots.txt, sitemap.xml, noindex ve data-feedback="off" doğrudur', async () => {
    process.env.CHAT_ENABLED = 'true';
    const robots = await httpRequest(siteUrl, '/robots.txt', { headers: { Accept: 'text/plain' } });
    assert.equal(robots.status, 200);
    assert.match(robots.text, /Disallow:\s*\/sohbet/);

    const sitemap = await httpRequest(siteUrl, '/sitemap.xml', { headers: { Accept: 'application/xml' } });
    assert.equal(sitemap.status, 200);
    assert.equal(sitemap.text.includes('/sohbet'), false);

    const privacy = await httpRequest(siteUrl, '/sohbet/gizlilik', { headers: { Accept: 'text/html' } });
    assert.equal(privacy.status, 200);
    assert.match(privacy.headers.get('x-robots-tag') || '', /noindex/i);
    assert.match(privacy.text, /data-feedback="off"/);
  });

  await t.test('3) Erişim kontrolü: girişsiz ve kayıtsız kullanıcıya 404 değil nazik not-registered ekranı', async () => {
    process.env.CHAT_ENABLED = 'true';
    const guestHtml = await httpRequest(siteUrl, '/sohbet', { headers: { Accept: 'text/html' } });
    assert.equal(guestHtml.status, 403);
    assert.match(guestHtml.text, /\/kayit/);

    const unregHtml = await httpRequest(siteUrl, '/sohbet', {
      cookie: sessUnreg.cookie,
      headers: { Accept: 'text/html' },
    });
    assert.equal(unregHtml.status, 403);
    assert.match(unregHtml.text, /\/kayit/);

    const guestApi = await httpRequest(siteUrl, '/sohbet/api/sohbetler');
    assert.equal(guestApi.status, 401);

    const unregApi = await httpRequest(siteUrl, '/sohbet/api/sohbetler', { cookie: sessUnreg.cookie });
    assert.equal(unregApi.status, 403);
    assert.equal(unregApi.json.code, 'NOT_REGISTERED');
  });

  await t.test('4) İlk kullanım onayı ve politika sürümü değişince yeniden onay', async () => {
    process.env.CHAT_ENABLED = 'true';
    const beforeHtml = await httpRequest(siteUrl, '/sohbet', {
      cookie: sessA.cookie,
      headers: { Accept: 'text/html' },
    });
    assert.equal(beforeHtml.status, 200);
    assert.match(beforeHtml.text, /chatConsentForm/);

    const blockedApi = await httpRequest(siteUrl, '/sohbet/api/rehber', { cookie: sessA.cookie });
    assert.equal(blockedApi.status, 403);
    assert.equal(blockedApi.json.code, 'CONSENT_REQUIRED');

    // Onay kutusu işaretlenmeden reddedilir
    const badConsent = await httpRequest(siteUrl, '/sohbet/api/onay', {
      method: 'POST',
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      body: { accepted: false },
    });
    assert.equal(badConsent.status, 400);

    // Kullanıcı A, B ve C onay verir
    for (const s of [sessA, sessB, sessC]) {
      const ok = await httpRequest(siteUrl, '/sohbet/api/onay', {
        method: 'POST',
        cookie: s.cookie,
        csrf: s.csrfToken,
        body: { accepted: true },
      });
      assert.equal(ok.status, 200);
      assert.equal(ok.json.ok, true);
    }

    // Onay sonrası chatApp görünür
    const afterHtml = await httpRequest(siteUrl, '/sohbet', {
      cookie: sessA.cookie,
      headers: { Accept: 'text/html' },
    });
    assert.equal(afterHtml.status, 200);
    assert.match(afterHtml.text, /id="chatApp"/);
    assert.match(afterHtml.text, /data-feedback="off"/);

    // Politika sürümü artınca yeniden onay gerekir (birim kontrolü)
    assert.equal(store.hasValidConsent(USER_A, chatConfig.POLICY_VERSION), true);
    assert.equal(store.hasValidConsent(USER_A, '99.0'), false);
  });

  await t.test('5) Rehber: kendini hariç tutar, engellenenleri gizler ve halka bilgisiyle zenginleştirir', async () => {
    const dir = await httpRequest(siteUrl, '/sohbet/api/rehber', { cookie: sessA.cookie });
    assert.equal(dir.status, 200);
    assert.equal(dir.json.items.some((x) => x.id === USER_A), false);
    const beta = dir.json.items.find((x) => x.id === USER_B);
    assert.ok(beta);
    assert.ok(beta.ring && Array.isArray(beta.ring.colors));
    assert.equal(beta.robloxUsername, 'BetaRbx');
  });

  await t.test('6) Mesaj gönderme, clientId çift gönderim engeli, temizleme ve IDOR koruması', async () => {
    // Boş / yalnızca sıfır genişlikli metin reddedilir
    const empty = await httpRequest(siteUrl, `/sohbet/api/sohbet/${USER_B}/mesaj`, {
      method: 'POST',
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      body: { text: '   \u200B\u200C  ', clientId: 'cid-empty' },
    });
    assert.equal(empty.status, 400);

    // 4000 karakterden uzun metin reddedilir
    const tooLong = await httpRequest(siteUrl, `/sohbet/api/sohbet/${USER_B}/mesaj`, {
      method: 'POST',
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      body: { text: 'a'.repeat(4600), clientId: 'cid-long' },
    });
    assert.equal(tooLong.status, 400);

    // Geçerli mesaj gönderimi
    const sent1 = await httpRequest(siteUrl, `/sohbet/api/sohbet/${USER_B}/mesaj`, {
      method: 'POST',
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      body: { text: 'Merhaba Beta! https://example.com', clientId: 'cid-unique-1' },
    });
    assert.equal(sent1.status, 201);
    assert.equal(sent1.json.duplicate, false);
    const msgId = sent1.json.message.id;

    // Aynı clientId ile tekrar gönderim çift kayıt oluşturmaz
    const sentDup = await httpRequest(siteUrl, `/sohbet/api/sohbet/${USER_B}/mesaj`, {
      method: 'POST',
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      body: { text: 'Merhaba Beta! https://example.com', clientId: 'cid-unique-1' },
    });
    assert.equal(sentDup.status, 200);
    assert.equal(sentDup.json.duplicate, true);
    assert.equal(sentDup.json.message.id, msgId);

    // IDOR: Kullanıcı C, A ile B'nin sohbetini göremez
    const cReadsB = await httpRequest(siteUrl, `/sohbet/api/sohbet/${USER_B}/mesajlar`, { cookie: sessC.cookie });
    assert.equal(cReadsB.status, 200);
    assert.equal(cReadsB.json.messages.length, 0);

    // Kullanıcı B, A'nın mesajını silemez (403)
    const bDeletesA = await httpRequest(siteUrl, `/sohbet/api/sohbet/${USER_A}/mesaj/${msgId}`, {
      method: 'DELETE',
      cookie: sessB.cookie,
      csrf: sessB.csrfToken,
    });
    assert.equal(bDeletesA.status, 403);

    // Kullanıcı A kendi mesajını siler ve tombstone izi kalır
    const aDeletesA = await httpRequest(siteUrl, `/sohbet/api/sohbet/${USER_B}/mesaj/${msgId}`, {
      method: 'DELETE',
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
    });
    assert.equal(aDeletesA.status, 200);

    const afterDel = await httpRequest(siteUrl, `/sohbet/api/sohbet/${USER_A}/mesajlar`, { cookie: sessB.cookie });
    const tomb = afterDel.json.messages.find((m) => m.id === msgId);
    assert.ok(tomb);
    assert.equal(tomb.deleted, true);
    assert.equal(tomb.text, '');
  });

  await t.test('7) Sayfalama (before / after / limit) ve okundu/görüldü karşılıklı gizlilik', async () => {
    const convId = makeConvId(USER_A, USER_B);
    for (let i = 1; i <= 5; i += 1) {
      store.appendMessage(convId, {
        from: USER_A,
        text: `Mesaj #${i}`,
        ts: Date.now() + i * 10,
      });
    }

    const page1 = await httpRequest(siteUrl, `/sohbet/api/sohbet/${USER_A}/mesajlar?limit=2`, { cookie: sessB.cookie });
    assert.equal(page1.status, 200);
    assert.equal(page1.json.messages.length, 2);
    assert.equal(page1.json.hasMore, true);

    const oldestId = page1.json.messages[0].id;
    const page2 = await httpRequest(
      siteUrl,
      `/sohbet/api/sohbet/${USER_A}/mesajlar?before=${encodeURIComponent(oldestId)}&limit=2`,
      { cookie: sessB.cookie }
    );
    assert.equal(page2.status, 200);
    assert.equal(page2.json.messages.length, 2);
    assert.notEqual(page2.json.messages[0].id, oldestId);

    // B okundu gönderir -> iki taraf da açıkken A görüldü bilgisini görür
    const markRes = await httpRequest(siteUrl, `/sohbet/api/sohbet/${USER_A}/okundu`, {
      method: 'POST',
      cookie: sessB.cookie,
      csrf: sessB.csrfToken,
      body: { upTo: Date.now() + 5000 },
    });
    assert.equal(markRes.status, 200);
    assert.equal(markRes.json.broadcastRead, true);

    const aChecksRead = await httpRequest(siteUrl, `/sohbet/api/sohbet/${USER_B}/mesajlar`, { cookie: sessA.cookie });
    assert.equal(aChecksRead.json.canSeeOtherRead, true);
    assert.ok(aChecksRead.json.state.otherLastRead > 0);

    // A görüldü paylaşımını kapatır -> karşılıklı olarak ikisi de göremez!
    const profOff = await httpRequest(siteUrl, '/sohbet/api/profil', {
      method: 'POST',
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      body: { readReceipts: false },
    });
    assert.equal(profOff.status, 200);

    const aAfterOff = await httpRequest(siteUrl, `/sohbet/api/sohbet/${USER_B}/mesajlar`, { cookie: sessA.cookie });
    assert.equal(aAfterOff.json.canSeeOtherRead, false);
    assert.equal(aAfterOff.json.state.otherLastRead, 0);

    // Geri aç
    await httpRequest(siteUrl, '/sohbet/api/profil', {
      method: 'POST',
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      body: { readReceipts: true },
    });
  });

  await t.test('8) Engelleme, engeli kaldırma ve whoCanMessage: nobody', async () => {
    // A, C'yi engeller
    const blk = await httpRequest(siteUrl, '/sohbet/api/engelle', {
      method: 'POST',
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      body: { targetId: USER_C },
    });
    assert.equal(blk.status, 200);

    // C artık A'nın rehberinde ve A da C'nin rehberinde görünmez
    const dirA = await httpRequest(siteUrl, '/sohbet/api/rehber', { cookie: sessA.cookie });
    assert.equal(dirA.json.items.some((x) => x.id === USER_C), false);
    const dirC = await httpRequest(siteUrl, '/sohbet/api/rehber', { cookie: sessC.cookie });
    assert.equal(dirC.json.items.some((x) => x.id === USER_A), false);

    // C, A'ya mesaj atamaz
    const cToA = await httpRequest(siteUrl, `/sohbet/api/sohbet/${USER_A}/mesaj`, {
      method: 'POST',
      cookie: sessC.cookie,
      csrf: sessC.csrfToken,
      body: { text: 'Engelliyim', clientId: 'cid-blk-1' },
    });
    assert.equal(cToA.status, 403);

    // Engeli kaldır
    await httpRequest(siteUrl, '/sohbet/api/engeli-kaldir', {
      method: 'POST',
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      body: { targetId: USER_C },
    });

    // A "hiç kimse" moduna geçer -> C yazamaz
    await httpRequest(siteUrl, '/sohbet/api/profil', {
      method: 'POST',
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      body: { whoCanMessage: 'nobody' },
    });
    const closedRes = await httpRequest(siteUrl, `/sohbet/api/sohbet/${USER_A}/mesaj`, {
      method: 'POST',
      cookie: sessC.cookie,
      csrf: sessC.csrfToken,
      body: { text: 'Merhaba?', clientId: 'cid-closed-1' },
    });
    assert.equal(closedRes.status, 403);
    assert.equal(closedRes.json.code, 'RECIPIENT_CLOSED_DM');

    // Geri aç
    await httpRequest(siteUrl, '/sohbet/api/profil', {
      method: 'POST',
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      body: { whoCanMessage: 'everyone' },
    });
  });

  await t.test('9) Profil halkası doğrulaması (36+ hazır palet, geçersiz hex reddi, özel halka)', async () => {
    assert.ok(chatConfig.RING_PRESETS.length >= 36);
    for (const p of chatConfig.RING_PRESETS) {
      assert.ok(p.id && p.name && p.name.tr && p.name.en);
      assert.ok(Array.isArray(p.colors) && p.colors.length >= 2 && p.colors.length <= 5);
      for (const hex of p.colors) {
        assert.match(hex, /^#[0-9a-fA-F]{6}$/);
      }
    }

    // CSS enjeksiyonu / geçersiz hex reddedilir
    const badRing = await httpRequest(siteUrl, '/sohbet/api/profil', {
      method: 'POST',
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      body: { ringId: 'custom', ring: { colors: ['#112233', 'red; background:url(x)'], type: 'spin' } },
    });
    assert.equal(badRing.status, 400);

    // Geçerli özel halka kaydedilir
    const goodRing = await httpRequest(siteUrl, '/sohbet/api/profil', {
      method: 'POST',
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      body: { ringId: 'custom', ring: { colors: ['#FF00AA', '#00EEFF', '#7C3AED'], type: 'spin' } },
    });
    assert.equal(goodRing.status, 200);
    assert.equal(goodRing.json.profile.effectiveRing.id, 'custom');
    assert.equal(goodRing.json.profile.effectiveRing.type, 'spin');
  });

  await t.test('10) SSE olay akışı, Last-Event-ID yakalama ve kullanıcı başına 8 bağlantı + en eskiyi düşür', async () => {
    chatSseHub.resetForTests();

    const openSse = (cookie, extraHeaders = {}) =>
      new Promise((resolve, reject) => {
        const req = http.request(
          `${siteUrl}/sohbet/akis`,
          { method: 'GET', headers: { Cookie: cookie, Accept: 'text/event-stream', ...extraHeaders } },
          (res) => {
            let buf = '';
            let closed = false;
            res.on('data', (chunk) => {
              buf += chunk.toString('utf8');
            });
            res.on('end', () => {
              closed = true;
            });
            resolve({ req, res, getBuf: () => buf, isClosed: () => closed });
          }
        );
        req.on('error', reject);
        req.end();
      });

    const conn1 = await openSse(sessB.cookie);
    assert.equal(conn1.res.statusCode, 200);
    assert.equal(conn1.res.headers['x-accel-buffering'], 'no');
    assert.match(conn1.res.headers['content-type'] || '', /text\/event-stream/);
    assert.match(conn1.res.headers['cache-control'] || '', /no-transform/);

    // B'ye bir mesaj gönder -> SSE üzerinden canlı gelmeli
    await httpRequest(siteUrl, `/sohbet/api/sohbet/${USER_B}/mesaj`, {
      method: 'POST',
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      body: { text: 'Canli SSE mesaji', clientId: 'cid-sse-1' },
    });
    await new Promise((r) => setTimeout(r, 80));
    const buf1 = conn1.getBuf();
    assert.match(buf1, /event:\s*message/);
    assert.match(buf1, /Canli SSE mesaji/);

    // Bağlantı koptuğunda Last-Event-ID=1 ile yeniden bağlanınca kaçırılan olaylar yakalanır
    conn1.req.destroy();
    await new Promise((r) => setTimeout(r, 40));
    const connCatchup = await openSse(sessB.cookie, { 'Last-Event-ID': '1' });
    await new Promise((r) => setTimeout(r, 60));
    assert.match(connCatchup.getBuf(), /Canli SSE mesaji/);

    // Toplam 8 eşzamanlı bağlantıya izin verilir; 9. bağlantı 200 döner ve en eski bağlantıyı nazikçe düşürür
    const extraConns = [connCatchup];
    for (let i = 0; i < 7; i += 1) {
      const c = await openSse(sessB.cookie);
      assert.equal(c.res.statusCode, 200);
      extraConns.push(c);
    }
    const ninth = await openSse(sessB.cookie);
    assert.equal(ninth.res.statusCode, 200);
    await new Promise((r) => setTimeout(r, 60));
    assert.match(connCatchup.getBuf(), /replaced_by_other_tab/);
    assert.equal(chatSseHub.getConnectionCount(USER_B), 8);

    extraConns.push(ninth);
    for (const c of extraConns) c.req.destroy();
    await new Promise((r) => setTimeout(r, 40));
  });

  await t.test('11) Günlük 10 yeni sohbet sınırı ve hız sınırı (30/dk)', async () => {
    // Kullanıcı C 10 farklı kişiyle yeni sohbet başlatır, 11. reddedilir
    for (let i = 10; i < 20; i += 1) {
      const tid = `1000000000000001${String(i).padStart(2, '0')}`;
      const r = await httpRequest(siteUrl, `/sohbet/api/sohbet/${tid}/mesaj`, {
        method: 'POST',
        cookie: sessC.cookie,
        csrf: sessC.csrfToken,
        body: { text: `Selam ${i}`, clientId: `cid-new-${i}` },
      });
      assert.equal(r.status, 201);
    }
    const eleventh = await httpRequest(siteUrl, `/sohbet/api/sohbet/100000000000000120/mesaj`, {
      method: 'POST',
      cookie: sessC.cookie,
      csrf: sessC.csrfToken,
      body: { text: '11. yeni sohbet', clientId: 'cid-new-20' },
    });
    assert.equal(eleventh.status, 429);
    assert.equal(eleventh.json.code, 'NEW_CONV_LIMIT');

    // Kullanıcı B dakikada 30 mesaj gönderir, 31. mesaj 429 RATE_LIMITED döner
    let hitRateLimit = false;
    for (let i = 1; i <= 32; i += 1) {
      const r = await httpRequest(siteUrl, `/sohbet/api/sohbet/${USER_A}/mesaj`, {
        method: 'POST',
        cookie: sessB.cookie,
        csrf: sessB.csrfToken,
        body: { text: `Hiz testi ${i}`, clientId: `cid-rl-${i}` },
      });
      if (r.status === 429 && r.json && r.json.code === 'RATE_LIMITED') {
        hitRateLimit = true;
        break;
      }
      assert.equal(r.status, 201);
    }
    assert.equal(hitRateLimit, true, '30 mesaj/dk hız sınırı tetiklenmeli');
  });

  await t.test('12) 30 günlük saklama temizliği (29 gün kalır, 31 gün silinir) ve bozuk JSON toparlama', () => {
    const cleanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piyade-chat-ret-'));
    try {
      const s = new ChatStore({ baseDir: cleanDir, silentWarning: true });
      const now = Date.UTC(2026, 5, 15, 3, 0, 0);
      const dayMs = 86400000;

      const convMixed = makeConvId(USER_A, USER_B);
      s.appendMessage(convMixed, { from: USER_A, text: '31 gun once', ts: now - 31 * dayMs });
      s.appendMessage(convMixed, { from: USER_B, text: '29 gun once', ts: now - 29 * dayMs });

      const convOldOnly = makeConvId(USER_A, USER_C);
      s.appendMessage(convOldOnly, { from: USER_A, text: '35 gun once', ts: now - 35 * dayMs });

      const res = s.runRetentionCleanup({ retentionDays: 30, nowTs: now, silent: true });
      assert.equal(res.expiredMessages, 2);
      assert.equal(res.removedConversations, 1);

      const left = s.getMessages(convMixed);
      assert.equal(left.messages.length, 1);
      assert.equal(left.messages[0].text, '29 gun once');
      assert.equal(s.conversationExists(convOldOnly), false);

      // Bozuk users.json dosyasından .bak yedeğiyle çökmeden toparlanma
      s.setProfile(USER_A, { readReceipts: false });
      s.setProfile(USER_A, { whoCanMessage: 'nobody' }); // .bak dosyasını oluşturur
      fs.writeFileSync(path.join(cleanDir, 'users.json'), '{BOZUK JSON!!!', 'utf8');
      const recovered = new ChatStore({ baseDir: cleanDir, silentWarning: true });
      assert.equal(recovered.getProfile(USER_A).readReceipts, false);
      recovered.flush();
      s.flush();
    } finally {
      fs.rmSync(cleanDir, { recursive: true, force: true });
    }
  });

  await t.test('13) TR/EN locale eşliği, 700+ emoji verisi ve yeni kodda sabit #hex renk yasağı', () => {
    const tr = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', 'tr.json'), 'utf8'));
    const en = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', 'en.json'), 'utf8'));
    const trKeys = Object.keys(tr.chat || {}).sort();
    const enKeys = Object.keys(en.chat || {}).sort();
    assert.deepEqual(trKeys, enKeys);
    assert.ok(trKeys.length >= 90);

    const emojiJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'emoji.json'), 'utf8'));
    assert.equal(emojiJson.categories.length, 9);
    const totalEmojis = emojiJson.categories.reduce((acc, c) => acc + c.items.length, 0);
    assert.ok(totalEmojis >= 700, `Beklenen >= 700 emoji, bulunan: ${totalEmojis}`);

    // Yeni Sohbet CSS bölümünde (bölüm 16) ve chat.js / chat*.ejs dosyalarında sabit #hex renk kodu yok
    const styleCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
    const chatCssIdx = styleCss.indexOf('16. SOHBET (CHAT)');
    assert.ok(chatCssIdx > 0);
    const chatCssSlice = styleCss.slice(chatCssIdx);
    const hexMatchesCss = chatCssSlice.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    assert.equal(hexMatchesCss.length, 0, `Chat CSS sabit renk içeriyor: ${hexMatchesCss.join(', ')}`);

    const chatJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'chat.js'), 'utf8');
    const hexMatchesJs = chatJs.match(/#[0-9a-fA-F]{6}\b/g) || [];
    assert.equal(hexMatchesJs.length, 0, `chat.js sabit renk içeriyor: ${hexMatchesJs.join(', ')}`);

    const chatEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'chat.ejs'), 'utf8');
    const hexMatchesEjs = chatEjs.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    assert.equal(hexMatchesEjs.length, 0, `chat.ejs sabit renk içeriyor: ${hexMatchesEjs.join(', ')}`);

    // sanitizeChatText kontrol karakteri temizliği
    assert.equal(sanitizeChatText('a\u200Bb\u0000c'), 'abc');
  });
});
