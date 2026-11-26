const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const session = require('express-session');

const chatConfig = require('../config/chat.config');
const menuConfig = require('../config/menu.config');
const rolesConfig = require('../config/roles.config');
const appConfig = require('../config/app.config');
const botApiClient = require('../services/botApiClient');
const {
  ChatStore,
  setDefaultChatStore,
  makeConvId,
  parseConvId,
  makeGroupConvId,
} = require('../services/chatStore');
const { ChatModStore, setDefaultChatModStore } = require('../services/chatModStore');
const { MemberStore, setDefaultMemberStore, toUnifiedGoogleId } = require('../services/memberStore');
const { chatSseHub } = require('../services/chatSseHub');
const { i18nMiddleware } = require('../middlewares/i18n');
const { csrfProtection } = require('../middlewares/csrf');
const { syncRolesMiddleware } = require('../middlewares/auth');
const chatRoutes = require('../routes/chat');
const chatModRoutes = require('../routes/chatMod');

const DISCORD_USER_A = '777777777777777701';
const DISCORD_USER_B = '777777777777777702';
const DISCORD_ADMIN = '777777777777777799';
const DISCORD_MOD = '777777777777777788';

const PNG_1X1_BUF = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000020001e221bc330000000049454e44ae426082',
  'hex'
);

function createMockBotServer() {
  let lookupWithGamesCalls = 0;
  let avatarRefreshCalls = 0;
  let lastLookupActorType = '';

  const directoryMembers = [
    {
      id: DISCORD_USER_A,
      displayName: 'DiscordAlpha',
      discordAvatarUrl: 'https://cdn.discordapp.com/embed/avatars/1.png',
      robloxId: '100101',
      robloxUsername: 'AlphaBlox',
      robloxAvatarUrl: 'https://tr.rbxcdn.com/alpha-avatar.png',
      hasRoblox: true,
      games: [
        { id: 'roblox', username: 'AlphaBlox', robloxId: '100101' },
        { id: 'cs2', username: 'AlphaCS2' },
        { id: 'minecraft', username: 'Alpha_MC' },
      ],
    },
    {
      id: DISCORD_USER_B,
      displayName: 'DiscordBeta',
      discordAvatarUrl: 'https://cdn.discordapp.com/embed/avatars/2.png',
      robloxId: '200202',
      robloxUsername: 'BetaBlox',
      robloxAvatarUrl: 'https://tr.rbxcdn.com/beta-avatar.png',
      hasRoblox: true,
      games: [
        { id: 'roblox', username: 'BetaBlox', robloxId: '200202' },
        { id: 'zula', username: 'BetaZula' },
      ],
    },
    {
      id: DISCORD_ADMIN,
      displayName: 'GrupYoneticisi',
      discordAvatarUrl: 'https://cdn.discordapp.com/embed/avatars/3.png',
      robloxId: '300303',
      robloxUsername: 'AdminBlox',
      robloxAvatarUrl: 'https://tr.rbxcdn.com/admin-avatar.png',
      hasRoblox: true,
      games: [{ id: 'roblox', username: 'AdminBlox', robloxId: '300303' }],
    },
  ];

  const server = http.createServer((req, res) => {
    let rawBody = '';
    req.on('data', (chunk) => {
      rawBody += chunk;
    });
    req.on('end', () => {
      const urlObj = new URL(req.url, 'http://127.0.0.1');
      const sendJson = (status, obj) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };

      if (urlObj.pathname === '/api/directory') {
        const q = (urlObj.searchParams.get('query') || '').toLowerCase();
        const actor = req.headers['x-actor-id'] || '';
        const excl = urlObj.searchParams.get('excludeSelf') === '1';
        let list = directoryMembers.map(({ games, ...rest }) => rest);
        if (excl) list = list.filter((m) => m.id !== actor);
        if (q) {
          list = list.filter((m) =>
            `${m.displayName} ${m.robloxUsername || ''}`.toLowerCase().includes(q)
          );
        }
        return sendJson(200, { items: list, nextCursor: null, hasMore: false, total: list.length });
      }

      if (urlObj.pathname === '/api/directory/lookup' && req.method === 'POST') {
        let parsed = {};
        try {
          parsed = JSON.parse(rawBody || '{}');
        } catch (_) {}
        const ids = Array.isArray(parsed.ids) ? parsed.ids.map(String) : [];
        const includeGames = Boolean(parsed.includeGames);
        lastLookupActorType = String(req.headers['x-actor-type'] || '');
        if (includeGames) lookupWithGamesCalls += 1;
        const items = directoryMembers
          .filter((m) => ids.includes(m.id))
          .map((m) => (includeGames ? { ...m } : { ...m, games: undefined }));
        return sendJson(200, { items });
      }

      if (urlObj.pathname === '/api/roblox/avatars' && req.method === 'POST') {
        let parsed = {};
        try {
          parsed = JSON.parse(rawBody || '{}');
        } catch (_) {}
        avatarRefreshCalls += 1;
        const ids = Array.isArray(parsed.ids) ? parsed.ids : Array.isArray(parsed.robloxIds) ? parsed.robloxIds : [];
        const avatars = {};
        for (const rid of ids) {
          avatars[String(rid)] = `https://tr.rbxcdn.com/refreshed-${rid}.png`;
        }
        return sendJson(200, avatars);
      }

      const rolesMatch = /^\/api\/member\/(\d+)\/roles$/.exec(urlObj.pathname);
      if (rolesMatch) {
        const uid = rolesMatch[1];
        if (uid === DISCORD_MOD) {
          return sendJson(200, {
            id: uid,
            displayName: 'CommunityMod',
            level: 'registered',
            registered: true,
            roles: [
              { id: rolesConfig.ROLES.KAYITLI_UYE, name: 'Kayıtlı Üye', position: 10 },
              { id: rolesConfig.ROLES.COMMUNITY_OFFICIAL, name: 'Community Official', position: 35 },
            ],
          });
        }
        return sendJson(200, {
          id: uid,
          displayName: `User_${uid.slice(-2)}`,
          level: 'registered',
          registered: true,
          roles: [{ id: rolesConfig.ROLES.KAYITLI_UYE, name: 'Kayıtlı Üye', position: 10 }],
        });
      }

      return sendJson(404, { error: 'Not found' });
    });
  });

  return {
    server,
    getStats: () => ({ lookupWithGamesCalls, avatarRefreshCalls, lastLookupActorType }),
    resetStats: () => {
      lookupWithGamesCalls = 0;
      avatarRefreshCalls = 0;
      lastLookupActorType = '';
    },
  };
}

function createTestApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(
    session({
      secret: 'test-group-card-secret-1234567890',
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use(i18nMiddleware);
  app.use((req, res, next) => {
    res.locals.seo = { assetVersion: 'test', noindex: true };
    next();
  });

  app.post('/__test/login-discord', (req, res) => {
    const { id, displayName, roles = [], registered = true } = req.body || {};
    req.session.identity = { kind: 'discord', discordId: String(id) };
    req.session.user = {
      id: String(id),
      kind: 'discord',
      username: displayName || String(id),
      displayName: displayName || String(id),
      avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
      roles: roles.length > 0 ? roles : [{ id: rolesConfig.ROLES.KAYITLI_UYE, name: 'Kayıtlı Üye', position: 10 }],
      level: 'registered',
      registered: Boolean(registered),
      inGuild: true,
      rolesSyncedAt: Date.now(),
    };
    const crypto = require('node:crypto');
    if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString('hex');
    res.json({ ok: true, csrfToken: req.session.csrfToken });
  });

  app.post('/__test/login-google', (req, res) => {
    const { memberId } = req.body || {};
    req.session.identity = { kind: 'google', memberId: String(memberId) };
    req.session.user = {
      id: toUnifiedGoogleId(memberId),
      memberId: String(memberId),
      kind: 'google',
    };
    const crypto = require('node:crypto');
    if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString('hex');
    res.json({ ok: true, csrfToken: req.session.csrfToken });
  });

  app.use(csrfProtection);
  app.use(syncRolesMiddleware);
  app.use('/sohbet/moderasyon', chatModRoutes);
  app.use('/sohbet', chatRoutes);
  app.use((req, res) => res.status(404).json({ ok: false, code: 'NOT_FOUND' }));
  return app;
}

async function reqJson(baseUrl, urlPath, { method = 'GET', cookie = '', csrf = '', body = null } = {}) {
  const headers = { Accept: 'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  const opts = { method, headers };
  if (body !== null) {
    headers['Content-Type'] = 'application/json';
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
    json,
    text,
    cookie: setCookie ? setCookie.split(';')[0] : cookie,
    headers: resp.headers,
  };
}

async function loginDiscord(baseUrl, userObj) {
  const r = await reqJson(baseUrl, '/__test/login-discord', { method: 'POST', body: userObj });
  assert.equal(r.status, 200);
  return { cookie: r.cookie, csrfToken: r.json.csrfToken };
}

async function loginGoogle(baseUrl, memberId) {
  const r = await reqJson(baseUrl, '/__test/login-google', { method: 'POST', body: { memberId } });
  assert.equal(r.status, 200);
  return { cookie: r.cookie, csrfToken: r.json.csrfToken };
}

async function uploadPng(baseUrl, cookie, csrfToken, filename = 'shot.png') {
  const form = new FormData();
  form.append('file', new Blob([PNG_1X1_BUF], { type: 'image/png' }), filename);
  const resp = await fetch(`${baseUrl}/sohbet/api/yukle`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'X-CSRF-Token': csrfToken,
      Accept: 'application/json',
    },
    body: form,
  });
  const json = await resp.json().catch(() => null);
  return { status: resp.status, json };
}

function openSseClient(baseUrl, cookie) {
  return new Promise((resolve, reject) => {
    const u = new URL('/sohbet/akis', baseUrl);
    const events = [];
    let buffer = '';
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'GET',
        headers: { Cookie: cookie, Accept: 'text/event-stream' },
      },
      (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buffer += chunk;
          const frames = buffer.split('\n\n');
          buffer = frames.pop();
          for (const frame of frames) {
            if (!frame.trim() || frame.startsWith(':')) continue;
            const lines = frame.split('\n');
            let evType = 'message';
            let dataStr = '';
            for (const ln of lines) {
              if (ln.startsWith('event:')) evType = ln.slice(6).trim();
              else if (ln.startsWith('data:')) dataStr += ln.slice(5).trim();
            }
            if (dataStr) {
              try {
                events.push({ type: evType, data: JSON.parse(dataStr) });
              } catch (_) {}
            }
          }
        });
        resolve({
          events,
          close: () => {
            try {
              req.destroy();
            } catch (_) {}
          },
          waitForEvent: (predicate, timeoutMs = 2500) =>
            new Promise((resWait, rejWait) => {
              const start = Date.now();
              const check = () => {
                const found = events.find(predicate);
                if (found) return resWait(found);
                if (Date.now() - start > timeoutMs) {
                  return rejWait(new Error('SSE event timeout'));
                }
                setTimeout(check, 25);
              };
              check();
            }),
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

test('Sohbet Genişletme: Kimlik Geçişi, Google+Discord, Genel Sohbet Grubu, Yönetici Silme ve Nebula Profil Kartı', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piyade-chat-group-'));
  const chatDir = path.join(tmpRoot, 'chat');
  const membersDir = path.join(tmpRoot, 'members');

  const prevBotUrl = appConfig.BOT_API_URL;
  const prevChatEnabled = process.env.CHAT_ENABLED;
  const prevGoogleChat = process.env.CHAT_GOOGLE_MEMBERS_ENABLED;
  const prevGroupAdmins = process.env.CHAT_GROUP_ADMIN_DISCORD_IDS;

  const mockBot = createMockBotServer();
  await new Promise((r) => mockBot.server.listen(0, '127.0.0.1', r));
  const botPort = mockBot.server.address().port;
  appConfig.BOT_API_URL = `http://127.0.0.1:${botPort}`;
  process.env.CHAT_ENABLED = 'true';
  process.env.CHAT_GOOGLE_MEMBERS_ENABLED = 'true';
  process.env.CHAT_GROUP_ADMIN_DISCORD_IDS = DISCORD_ADMIN;

  botApiClient.clearDirectoryCache();
  chatRoutes.clearProfileCardCache();
  chatRoutes.clearGroupDuplicateTracker();
  chatRoutes.clearAvatarRefreshBackoff();
  chatSseHub.resetForTests();

  const chatStore = new ChatStore({ baseDir: chatDir, silentWarning: true });
  setDefaultChatStore(chatStore);
  const modStore = new ChatModStore({ baseDir: chatDir });
  setDefaultChatModStore(modStore);
  const memberStore = new MemberStore({ baseDir: membersDir });
  setDefaultMemberStore(memberStore);

  // 2 Google üyesi oluştur: biri eski (>48 saat -> dosya/link açık), biri yeni (<1 saat -> 24 saat sınırında)
  const oldTime = Date.now() - 48 * 60 * 60 * 1000;
  const createdOldG = memberStore.createMember({
    googleSub: 'sub-google-old-1',
    email: 'secret-old@example.com',
    googleName: 'Gizli Google Adi',
    nickname: 'SiteOyuncu',
    ageGroup: '18_plus',
    games: [
      { id: 'roblox', username: 'SiteRobloxPro', robloxId: '998877', robloxAvatarUrl: 'https://tr.rbxcdn.com/old-998877.png' },
      { id: 'minecraft', username: 'SiteMC_01' },
    ],
    consents: [
      { id: 'international_data_transfer', version: '1.1', at: oldTime },
      { id: 'chat_moderation_review', version: '1.0', at: oldTime },
      { id: 'chat_profile_game_usernames', version: '1.1', at: oldTime },
    ],
    privacy: { showGamesInChat: true },
    nowMs: oldTime,
  });
  assert.equal(createdOldG.ok, true);
  const googleOldMember = createdOldG.member;
  const googleOldUid = toUnifiedGoogleId(googleOldMember.id);

  const createdNewG = memberStore.createMember({
    googleSub: 'sub-google-new-2',
    email: 'secret-new@example.com',
    googleName: 'Gizli Yeni Google',
    nickname: 'YeniUye',
    ageGroup: '18_plus',
    games: [{ id: 'cs2', username: 'YeniCS2' }],
    consents: [
      { id: 'international_data_transfer', version: '1.1', at: Date.now() },
      { id: 'chat_moderation_review', version: '1.0', at: Date.now() },
      { id: 'chat_profile_game_usernames', version: '1.1', at: Date.now() },
    ],
    privacy: { showGamesInChat: true },
    nowMs: Date.now(),
  });
  assert.equal(createdNewG.ok, true);
  const googleNewMember = createdNewG.member;
  const googleNewUid = toUnifiedGoogleId(googleNewMember.id);

  for (const uid of [DISCORD_USER_A, DISCORD_USER_B, DISCORD_ADMIN, DISCORD_MOD, googleOldUid, googleNewUid]) {
    chatStore.recordConsent(uid, chatConfig.POLICY_VERSION);
  }

  const app = createTestApp();
  const siteServer = http.createServer(app);
  await new Promise((r) => siteServer.listen(0, '127.0.0.1', r));
  const siteUrl = `http://127.0.0.1:${siteServer.address().port}`;

  const sessA = await loginDiscord(siteUrl, { id: DISCORD_USER_A, displayName: 'DiscordAlpha' });
  const sessB = await loginDiscord(siteUrl, { id: DISCORD_USER_B, displayName: 'DiscordBeta' });
  const sessAdmin = await loginDiscord(siteUrl, { id: DISCORD_ADMIN, displayName: 'GrupYoneticisi' });
  const sessMod = await loginDiscord(siteUrl, {
    id: DISCORD_MOD,
    displayName: 'CommunityMod',
    roles: [
      { id: rolesConfig.ROLES.KAYITLI_UYE, name: 'Kayıtlı Üye', position: 10 },
      { id: rolesConfig.ROLES.COMMUNITY_OFFICIAL, name: 'Community Official', position: 35 },
    ],
  });
  const sessGold = await loginGoogle(siteUrl, googleOldMember.id);
  const sessGnew = await loginGoogle(siteUrl, googleNewMember.id);

  t.after(async () => {
    chatSseHub.resetForTests();
    chatStore.flush();
    modStore.flush();
    memberStore.flush();
    await new Promise((r) => siteServer.close(r));
    await new Promise((r) => mockBot.server.close(r));
    appConfig.BOT_API_URL = prevBotUrl;
    if (prevChatEnabled === undefined) delete process.env.CHAT_ENABLED;
    else process.env.CHAT_ENABLED = prevChatEnabled;
    if (prevGoogleChat === undefined) delete process.env.CHAT_GOOGLE_MEMBERS_ENABLED;
    else process.env.CHAT_GOOGLE_MEMBERS_ENABLED = prevGoogleChat;
    if (prevGroupAdmins === undefined) delete process.env.CHAT_GROUP_ADMIN_DISCORD_IDS;
    else process.env.CHAT_GROUP_ADMIN_DISCORD_IDS = prevGroupAdmins;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  await t.test('1) Kayıpsız ve geri alınabilir convId geçişi ("_" -> "~") ve çakışmasız kimlik biçimleri', () => {
    // Çakışmasız "~" ayracı doğrulaması
    const dd = makeConvId(DISCORD_USER_A, DISCORD_USER_B);
    const dg = makeConvId(DISCORD_USER_A, googleOldUid);
    const gg = makeConvId(googleOldUid, googleNewUid);
    assert.ok(dd.includes('~'));
    assert.ok(dg.includes('~'));
    assert.ok(gg.includes('~'));
    assert.deepEqual(parseConvId(dg).sort(), [DISCORD_USER_A, googleOldUid].sort());
    assert.deepEqual(parseConvId(gg).sort(), [googleOldUid, googleNewUid].sort());

    // İzole dizinde eski "_" ayraçlı sohbet, state, dosya meta ve moderasyon vakası oluştur
    const migDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piyade-mig-'));
    try {
      const convsDir = path.join(migDir, 'conversations');
      const filesDir = path.join(migDir, 'files');
      const modCasesDir = path.join(migDir, 'moderation', 'cases');
      fs.mkdirSync(convsDir, { recursive: true });
      fs.mkdirSync(filesDir, { recursive: true });
      fs.mkdirSync(modCasesDir, { recursive: true });

      const oldConvId = `${DISCORD_USER_A}_${DISCORD_USER_B}`;
      const newConvId = makeConvId(DISCORD_USER_A, DISCORD_USER_B);
      const line1 = JSON.stringify({ kind: 'msg', id: 'm_legacy_1', from: DISCORD_USER_A, ts: 1700000001000, text: 'Eski mesaj 1', attachments: [] });
      const line2 = JSON.stringify({ kind: 'msg', id: 'm_legacy_2', from: DISCORD_USER_B, ts: 1700000002000, text: 'Eski mesaj 2', attachments: [] });
      fs.writeFileSync(path.join(convsDir, `${oldConvId}.jsonl`), `${line1}\n${line2}\n`, 'utf8');
      fs.writeFileSync(
        path.join(convsDir, `${oldConvId}.state.json`),
        JSON.stringify({ convId: oldConvId, lastRead: { [DISCORD_USER_A]: 1700000001000 }, lastDelivered: {}, createdAt: 1700000001000 }),
        'utf8'
      );
      fs.writeFileSync(
        path.join(filesDir, 'meta.json'),
        JSON.stringify({
          f1: { id: 'f1', convId: oldConvId, msgId: 'm_legacy_1', uploaderId: DISCORD_USER_A, storedName: 'f1.png' },
        }),
        'utf8'
      );
      fs.writeFileSync(
        path.join(migDir, 'moderation', 'cases.json'),
        JSON.stringify({ case_old: { id: 'case_old', convId: oldConvId, participants: [DISCORD_USER_A, DISCORD_USER_B] } }),
        'utf8'
      );
      fs.writeFileSync(
        path.join(modCasesDir, 'case_old.json'),
        JSON.stringify({ caseId: 'case_old', convId: oldConvId, messages: [] }),
        'utf8'
      );

      // ChatStore açılışında geçiş otomatik çalışır
      const migratedStore = new ChatStore({ baseDir: migDir, silentWarning: true });
      assert.equal(fs.existsSync(path.join(convsDir, `${oldConvId}.jsonl`)), false);
      assert.equal(fs.existsSync(path.join(convsDir, `${newConvId}.jsonl`)), true);

      const msgs = migratedStore.getMessages(newConvId);
      assert.equal(msgs.messages.length, 2);
      assert.equal(msgs.messages[0].text, 'Eski mesaj 1');
      assert.equal(msgs.messages[1].text, 'Eski mesaj 2');
      assert.equal(msgs.state.convId, newConvId);
      assert.equal(migratedStore.getFileMeta('f1').convId, newConvId);

      const migratedCases = JSON.parse(fs.readFileSync(path.join(migDir, 'moderation', 'cases.json'), 'utf8'));
      assert.equal(migratedCases.case_old.convId, newConvId);

      // Yedek klasörü ve manifest var; geri alma (rollback) birebir eski durumu döndürür
      assert.ok(migratedStore.meta.lastMigrationBackup);
      const backupAbs = path.join(migDir, migratedStore.meta.lastMigrationBackup);
      assert.equal(fs.existsSync(path.join(backupAbs, 'manifest.json')), true);

      const rb = migratedStore.rollbackLegacyConvIdMigration(backupAbs);
      assert.equal(rb.ok, true);
      assert.equal(fs.existsSync(path.join(convsDir, `${oldConvId}.jsonl`)), true);
      assert.equal(fs.existsSync(path.join(convsDir, `${newConvId}.jsonl`)), false);
      const restoredCases = JSON.parse(fs.readFileSync(path.join(migDir, 'moderation', 'cases.json'), 'utf8'));
      assert.equal(restoredCases.case_old.convId, oldConvId);
      migratedStore.flush();
    } finally {
      fs.rmSync(migDir, { recursive: true, force: true });
    }
  });

  await t.test('2) Karışık Discord-Google DM, birleşik rehber, kimlik rozetleri, 6 saatlik avatar yenileme ve CHAT_GOOGLE_MEMBERS_ENABLED', async () => {
    // Rehber: Discord + Google üyeleri birleşik, rozetler doğru, e-posta ve Google adı sızmaz
    const dirRes = await reqJson(siteUrl, '/sohbet/api/rehber?q=SiteRobloxPro', { cookie: sessA.cookie });
    assert.equal(dirRes.status, 200);
    const foundGoogle = dirRes.json.items.find((x) => x.id === googleOldUid);
    assert.ok(foundGoogle, 'Google üyesi Roblox adıyla rehberde bulunmalı');
    assert.equal(foundGoogle.kind, 'google');
    assert.equal(foundGoogle.badgeKind, 'site_member');
    assert.equal(dirRes.text.includes('secret-old@example.com'), false);
    assert.equal(dirRes.text.includes('Gizli Google Adi'), false);
    // 48 saat eski Google üyesinin Roblox avatarı POST /api/roblox/avatars ile tazelenmiş olmalı
    assert.ok(mockBot.getStats().avatarRefreshCalls >= 1);
    assert.equal(foundGoogle.robloxAvatarUrl, 'https://tr.rbxcdn.com/refreshed-998877.png');

    // Google üyesi rehberde Discord üyesini arar (site-service ile)
    const dirFromG = await reqJson(siteUrl, '/sohbet/api/rehber?q=DiscordAlpha', { cookie: sessGold.cookie });
    assert.equal(dirFromG.status, 200);
    const foundDisc = dirFromG.json.items.find((x) => x.id === DISCORD_USER_A);
    assert.ok(foundDisc);
    assert.equal(foundDisc.kind, 'discord');
    assert.equal(foundDisc.badgeKind, 'discord_member');

    // Karışık Discord <-> Google DM
    const dmSend = await reqJson(siteUrl, `/sohbet/api/sohbet/${googleOldUid}/mesaj`, {
      method: 'POST',
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      body: { text: 'Selam site uyesi!', clientId: 'mix-dm-1' },
    });
    assert.equal(dmSend.status, 201);
    assert.ok(dmSend.json.convId.includes('~'));

    const dmRead = await reqJson(siteUrl, `/sohbet/api/sohbet/${DISCORD_USER_A}/mesajlar`, { cookie: sessGold.cookie });
    assert.equal(dmRead.status, 200);
    assert.equal(dmRead.json.messages[0].text, 'Selam site uyesi!');

    // CHAT_GOOGLE_MEMBERS_ENABLED=false olunca Google üye sohbete giremez ve menüde gizlenir
    process.env.CHAT_GOOGLE_MEMBERS_ENABLED = 'false';
    const deniedG = await reqJson(siteUrl, '/sohbet/api/sohbetler', { cookie: sessGold.cookie });
    assert.equal(deniedG.status, 403);
    assert.equal(deniedG.json.code, 'GOOGLE_CHAT_DISABLED');

    const googleMenus = menuConfig.getVisibleMenuItems({ id: googleOldUid, kind: 'google', registered: true }, 'tr');
    assert.equal(googleMenus.some((m) => m.id === 'chat'), false);

    // Tekrar aç
    process.env.CHAT_GOOGLE_MEMBERS_ENABLED = 'true';
    const googleMenusOn = menuConfig.getVisibleMenuItems({ id: googleOldUid, kind: 'google', registered: true }, 'tr');
    assert.equal(googleMenusOn.some((m) => m.id === 'chat'), true);
  });

  await t.test('3) Zorunlu "Genel Sohbet" grubu: sabit liste, SSE yayını, okundu yok, sessize alma, yeni üye sınırı, ek dosya ve hız sınırı', async () => {
    // Sohbet listesinde "Genel Sohbet" en üstte sabit gelir
    const listRes = await reqJson(siteUrl, '/sohbet/api/sohbetler', { cookie: sessGold.cookie });
    assert.equal(listRes.status, 200);
    assert.ok(Array.isArray(listRes.json.groups));
    assert.equal(listRes.json.groups[0].id, 'genel');
    assert.equal(listRes.json.groups[0].convId, 'group:genel');
    assert.ok(listRes.json.groups[0].avatarUrl.includes('/img/brand/'));

    // Hem Discord B hem Google üyesi SSE bağlanır
    const sseB = await openSseClient(siteUrl, sessB.cookie);
    const sseG = await openSseClient(siteUrl, sessGold.cookie);
    await sseB.waitForEvent((e) => e.type === 'connected');
    await sseG.waitForEvent((e) => e.type === 'connected');

    try {
      // Discord A gruba mesaj + ek dosya gönderir
      const up = await uploadPng(siteUrl, sessA.cookie, sessA.csrfToken, 'grup-resim.png');
      assert.equal(up.status, 201);
      const fileId = up.json.file.id;

      const sendGrp = await reqJson(siteUrl, '/sohbet/api/grup/genel/mesaj', {
        method: 'POST',
        cookie: sessA.cookie,
        csrf: sessA.csrfToken,
        body: { text: 'Herkese merhaba Genel Sohbet!', attachmentIds: [fileId], clientId: 'grp-1' },
      });
      assert.equal(sendGrp.status, 201);
      assert.equal(sendGrp.json.convId, 'group:genel');

      // SSE yayını hem Discord B hem Google üyesine ulaşır
      const evB = await sseB.waitForEvent((e) => e.type === 'group_message' && e.data.message.id === sendGrp.json.message.id);
      const evG = await sseG.waitForEvent((e) => e.type === 'group_message' && e.data.message.id === sendGrp.json.message.id);
      assert.equal(evB.data.message.text, 'Herkese merhaba Genel Sohbet!');
      assert.equal(evG.data.sender.kind, 'discord');

      // Gruptaki ek dosyaya hem Discord B hem Google üyesi erişebilir; girişsiz 404 alır
      const fileByG = await fetch(`${siteUrl}/sohbet/dosya/${fileId}`, { headers: { Cookie: sessGold.cookie } });
      assert.equal(fileByG.status, 200);
      const fileAnon = await fetch(`${siteUrl}/sohbet/dosya/${fileId}`);
      assert.equal(fileAnon.status, 404);

      // Grupta "Görüldü" YOKTUR; okunmamış ve myLastRead (Yeni mesajlar ayırıcısı için) vardır
      const grpPageBefore = await reqJson(siteUrl, '/sohbet/api/grup/genel/mesajlar', { cookie: sessB.cookie });
      assert.equal(grpPageBefore.status, 200);
      assert.equal(grpPageBefore.json.state.otherLastRead, undefined);
      assert.equal(grpPageBefore.json.canSeeOtherRead, undefined);
      assert.equal(grpPageBefore.json.state.myLastRead, 0);

      const markR = await reqJson(siteUrl, '/sohbet/api/grup/genel/okundu', {
        method: 'POST',
        cookie: sessB.cookie,
        csrf: sessB.csrfToken,
        body: { upTo: sendGrp.json.message.ts },
      });
      assert.equal(markR.status, 200);

      // Bildirimleri sessize alma ayarı
      const muteOn = await reqJson(siteUrl, '/sohbet/api/grup/genel/sessize-al', {
        method: 'POST',
        cookie: sessGold.cookie,
        csrf: sessGold.csrfToken,
        body: { muted: true },
      });
      assert.equal(muteOn.status, 200);
      assert.equal(muteOn.json.muted, true);

      // Yeni Google üyesi (<24 saat) grupta link ve dosya gönderemez
      const newLinkBlock = await reqJson(siteUrl, '/sohbet/api/grup/genel/mesaj', {
        method: 'POST',
        cookie: sessGnew.cookie,
        csrf: sessGnew.csrfToken,
        body: { text: 'Bak https://example.com' },
      });
      assert.equal(newLinkBlock.status, 403);
      assert.equal(newLinkBlock.json.code, 'NEW_MEMBER_NO_LINKS');

      const newFileBlock = await uploadPng(siteUrl, sessGnew.cookie, sessGnew.csrfToken);
      assert.equal(newFileBlock.status, 403);
      assert.equal(newFileBlock.json.code, 'NEW_MEMBER_NO_FILES');

      // Aynı mesajı art arda tekrar gönderme engeli
      const dup1 = await reqJson(siteUrl, '/sohbet/api/grup/genel/mesaj', {
        method: 'POST',
        cookie: sessB.cookie,
        csrf: sessB.csrfToken,
        body: { text: 'Tekrarlanan grup mesaji', clientId: 'dup-1' },
      });
      assert.equal(dup1.status, 201);
      const dup2 = await reqJson(siteUrl, '/sohbet/api/grup/genel/mesaj', {
        method: 'POST',
        cookie: sessB.cookie,
        csrf: sessB.csrfToken,
        body: { text: 'Tekrarlanan grup mesaji', clientId: 'dup-2' },
      });
      assert.equal(dup2.status, 429);
      assert.equal(dup2.json.code, 'DUPLICATE_GROUP_MESSAGE');

      // Dakikada en çok 12 grup mesajı hız sınırı (sessGold ile 12 farklı mesaj -> 13. 429)
      for (let i = 1; i <= 12; i += 1) {
        const r = await reqJson(siteUrl, '/sohbet/api/grup/genel/mesaj', {
          method: 'POST',
          cookie: sessGold.cookie,
          csrf: sessGold.csrfToken,
          body: { text: `Grup hiz testi mesaji #${i}`, clientId: `rl-grp-${i}` },
        });
        assert.equal(r.status, 201, `Mesaj ${i} kabul edilmeli`);
      }
      const thirteenth = await reqJson(siteUrl, '/sohbet/api/grup/genel/mesaj', {
        method: 'POST',
        cookie: sessGold.cookie,
        csrf: sessGold.csrfToken,
        body: { text: 'Grup hiz testi mesaji #13', clientId: 'rl-grp-13' },
      });
      assert.equal(thirteenth.status, 429);
      assert.equal(thirteenth.json.code, 'GROUP_RATE_LIMITED');
    } finally {
      sseB.close();
      sseG.close();
    }
  });

  await t.test('4) Grup yöneticisi silme, içeriksiz denetim kaydı, ek silme, yetkisiz 403 ve DM yalıtımı', async () => {
    // Repoda/kodda sabit yönetici ID'si (1133815339898122320) bulunmamalı!
    for (const rel of ['config/chat.config.js', 'routes/chat.js', 'services/chatStore.js', 'public/js/chat.js']) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      assert.equal(src.includes('1133815339898122320'), false, `${rel} içinde sabit Discord ID olmamalı`);
    }

    // Discord A gruba ekli bir mesaj atsın
    const up = await uploadPng(siteUrl, sessA.cookie, sessA.csrfToken, 'silinecek.png');
    assert.equal(up.status, 201);
    const attId = up.json.file.id;
    const storedName = chatStore.getFileMeta(attId).storedName;
    const diskPath = path.join(chatStore.filesDir, storedName);
    assert.equal(fs.existsSync(diskPath), true);

    const secretText = 'Yonetici tarafindan silinecek gizli metin XYZ987';
    const posted = await reqJson(siteUrl, '/sohbet/api/grup/genel/mesaj', {
      method: 'POST',
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      body: { text: secretText, attachmentIds: [attId], clientId: 'adm-del-target' },
    });
    assert.equal(posted.status, 201);
    const msgId = posted.json.message.id;

    // 1) Normal Discord B başkasının mesajını silemez -> 403
    const byB = await reqJson(siteUrl, `/sohbet/api/grup/genel/mesaj/${msgId}`, {
      method: 'DELETE',
      cookie: sessB.cookie,
      csrf: sessB.csrfToken,
    });
    assert.equal(byB.status, 403);

    // 2) Google üyesi başkasının mesajını silemez -> 403
    const byG = await reqJson(siteUrl, `/sohbet/api/grup/genel/mesaj/${msgId}`, {
      method: 'DELETE',
      cookie: sessGold.cookie,
      csrf: sessGold.csrfToken,
    });
    assert.equal(byG.status, 403);

    // 3) Env'deki grup yöneticisi (Discord oturumu) silebilir
    const byAdmin = await reqJson(siteUrl, `/sohbet/api/grup/genel/mesaj/${msgId}`, {
      method: 'DELETE',
      cookie: sessAdmin.cookie,
      csrf: sessAdmin.csrfToken,
    });
    assert.equal(byAdmin.status, 200);
    assert.equal(byAdmin.json.adminRemoved, true);

    // Mesaj izi bırakılır ve ek dosya diskten silinir
    const msgAfter = chatStore.getMessageById(makeGroupConvId('genel'), msgId);
    assert.equal(msgAfter.deleted, true);
    assert.equal(msgAfter.adminRemoved, true);
    assert.equal(msgAfter.text, '');
    assert.equal(fs.existsSync(diskPath), false, 'Yönetici tarafından silinen mesajın eki diskten silinmeli');

    // Denetim kaydına (modlog.jsonl) içeriksiz olarak yazılmış olmalı
    const modlogRaw = fs.readFileSync(modStore.modlogFile, 'utf8');
    assert.equal(modlogRaw.includes('group_admin_delete'), true);
    assert.equal(modlogRaw.includes(secretText), false, 'Denetim kaydında mesaj içeriği ASLA bulunmamalı');

    // Grup yöneticisi başka iki kişinin (A <-> Google) DM dosyasına özel erişim KAZANMAZ
    const dmUp = await uploadPng(siteUrl, sessA.cookie, sessA.csrfToken, 'ozel-dm.png');
    assert.equal(dmUp.status, 201);
    const dmAttId = dmUp.json.file.id;
    const dmPost = await reqJson(siteUrl, `/sohbet/api/sohbet/${googleOldUid}/mesaj`, {
      method: 'POST',
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      body: { text: 'Ozel DM eki', attachmentIds: [dmAttId], clientId: 'dm-priv-1' },
    });
    assert.equal(dmPost.status, 201);

    const adminSteal = await fetch(`${siteUrl}/sohbet/dosya/${dmAttId}`, {
      headers: { Cookie: sessAdmin.cookie },
    });
    assert.equal(adminSteal.status, 404, 'Grup yöneticisi başkalarının DM dosyasına erişememeli');
  });

  await t.test('5) Susturma yaptırımı gruba yazmayı engeller (okumak serbest) ve grup mesajı raporlama moderasyonda açılır', async () => {
    // Discord B'nin grup mesajını Discord A raporlar -> Community Official vaka açabilir
    const bMsg = await reqJson(siteUrl, '/sohbet/api/grup/genel/mesaj', {
      method: 'POST',
      cookie: sessB.cookie,
      csrf: sessB.csrfToken,
      body: { text: 'Raporlanacak grup mesaji', clientId: 'grp-rep-1' },
    });
    assert.equal(bMsg.status, 201);

    const repRes = await reqJson(siteUrl, '/sohbet/api/raporla', {
      method: 'POST',
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      body: { groupId: 'genel', msgId: bMsg.json.message.id, category: 'harassment', note: 'Grup içi ihlal' },
    });
    assert.equal(repRes.status, 201);
    const caseId = repRes.json.caseId;

    const modCase = await reqJson(siteUrl, `/sohbet/moderasyon/api/vaka/${caseId}`, { cookie: sessMod.cookie });
    assert.equal(modCase.status, 200);
    assert.equal(modCase.json.case.convId, 'group:genel');
    assert.equal(modCase.json.case.reportedUserId, DISCORD_USER_B);

    // Discord B'ye susturma uygula -> gruba yazamaz (403 USER_MUTED), ama grubu okuyabilir (200)
    const sanc = modStore.applySanction({
      userId: DISCORD_USER_B,
      type: 'mute',
      durationKey: '1h',
      reasonCategory: 'harassment',
      note: 'Grup susturma testi',
      modId: DISCORD_MOD,
    });
    const writeWhileMuted = await reqJson(siteUrl, '/sohbet/api/grup/genel/mesaj', {
      method: 'POST',
      cookie: sessB.cookie,
      csrf: sessB.csrfToken,
      body: { text: 'Susturulmusken yazmaya calisma' },
    });
    assert.equal(writeWhileMuted.status, 403);
    assert.equal(writeWhileMuted.json.code, 'USER_MUTED');

    const readWhileMuted = await reqJson(siteUrl, '/sohbet/api/grup/genel/mesajlar', { cookie: sessB.cookie });
    assert.equal(readWhileMuted.status, 200);

    // Susturmayı kaldır
    modStore.liftSanction(sanc.id, { modId: DISCORD_MOD, note: 'Test bitti' });
  });

  await t.test('6) Profil Bilgi Kartı (Nebula Glass Card): sunucu tarafı gizlilik, 60sn önbellek, engelle/kendi kartı, halka renkleri ve erişilebilirlik', async () => {
    mockBot.resetStats();
    chatRoutes.clearProfileCardCache();
    botApiClient.clearDirectoryCache();

    // Discord A'nın kartı (varsayılan showGamesInChat: true) -> site-service includeGames: true ile çekilir
    const cardA1 = await reqJson(siteUrl, `/sohbet/api/uye-karti/${DISCORD_USER_A}`, { cookie: sessGold.cookie });
    assert.equal(cardA1.status, 200);
    assert.equal(cardA1.json.cached, false);
    assert.equal(cardA1.json.card.kind, 'discord');
    assert.equal(cardA1.json.card.isSelf, false);
    assert.equal(cardA1.json.card.gamesHidden, false);
    assert.equal(cardA1.json.card.games.length, 3);
    assert.equal(cardA1.json.card.games[0].profileUrl, 'https://www.roblox.com/users/100101/profile');
    assert.equal(mockBot.getStats().lookupWithGamesCalls, 1);
    assert.equal(mockBot.getStats().lastLookupActorType, 'site-service');

    // İkinci çağrı 60sn önbellekten gelir (Bot API tekrar çağrılmaz!)
    const cardA2 = await reqJson(siteUrl, `/sohbet/api/uye-karti/${DISCORD_USER_A}`, { cookie: sessB.cookie });
    assert.equal(cardA2.status, 200);
    assert.equal(cardA2.json.cached, true);
    assert.equal(mockBot.getStats().lookupWithGamesCalls, 1);

    // Discord A "Oyun kullanıcı adlarımı profilimde göster" ayarını KAPATIR -> önbellek olsa bile gizlilik SUNUCUDA anında uygulanır ve veri HİÇ gitmez!
    const hideGames = await reqJson(siteUrl, '/sohbet/api/profil', {
      method: 'POST',
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      body: { showGamesInChat: false },
    });
    assert.equal(hideGames.status, 200);
    assert.equal(hideGames.json.profile.showGamesInChat, false);

    const cardAHidden = await reqJson(siteUrl, `/sohbet/api/uye-karti/${DISCORD_USER_A}`, { cookie: sessGold.cookie });
    assert.equal(cardAHidden.status, 200);
    assert.equal(cardAHidden.json.card.gamesHidden, true);
    assert.deepEqual(cardAHidden.json.card.games, []);
    assert.equal(cardAHidden.text.includes('AlphaBlox'), false, 'Gizli oyun kullanıcı adı sunucudan ASLA gönderilmemeli');
    assert.equal(cardAHidden.text.includes('AlphaCS2'), false);
    assert.equal(cardAHidden.text.includes('Alpha_MC'), false);

    // Kendi kartı (isSelf: true)
    const ownCard = await reqJson(siteUrl, `/sohbet/api/uye-karti/${DISCORD_USER_A}`, { cookie: sessA.cookie });
    assert.equal(ownCard.status, 200);
    assert.equal(ownCard.json.card.isSelf, true);

    // Google üyesinin kartı -> memberStore'dan, e-posta/googleName sızmaz, gizlilik kapatılınca oyunlar gitmez
    const cardG = await reqJson(siteUrl, `/sohbet/api/uye-karti/${googleOldUid}`, { cookie: sessA.cookie });
    assert.equal(cardG.status, 200);
    assert.equal(cardG.json.card.kind, 'google');
    assert.equal(cardG.json.card.gamesHidden, false);
    assert.equal(cardG.json.card.games.length, 2);
    assert.equal(cardG.text.includes('secret-old@example.com'), false);
    assert.equal(cardG.text.includes('Gizli Google Adi'), false);

    const hideG = await reqJson(siteUrl, '/sohbet/api/profil', {
      method: 'POST',
      cookie: sessGold.cookie,
      csrf: sessGold.csrfToken,
      body: { showGamesInChat: false },
    });
    assert.equal(hideG.status, 200);
    const cardGHidden = await reqJson(siteUrl, `/sohbet/api/uye-karti/${googleOldUid}`, { cookie: sessA.cookie });
    assert.equal(cardGHidden.json.card.gamesHidden, true);
    assert.deepEqual(cardGHidden.json.card.games, []);
    assert.equal(cardGHidden.text.includes('SiteRobloxPro'), false);

    // Halka renklerinden 3 Nebula rengi türetme (3+ renkli preset & <3 renkli halka yedek tamamlama)
    const hues4 = chatConfig.extractNebulaHuesFromRing({ colors: ['#4285F4', '#EA4335', '#FBBC05', '#34A853'] });
    assert.deepEqual(hues4, ['#4285F4', '#EA4335', '#FBBC05']);
    const hues1 = chatConfig.extractNebulaHuesFromRing({ colors: ['#112233'] });
    assert.equal(hues1.length, 3);
    assert.equal(hues1[0], '#112233');
    assert.equal(hues1[1], 'var(--color-accent)');
    assert.equal(hues1[2], 'var(--color-primary)');

    // Mesaj isteği kod/env/şablon kalıntısı kontrolü
    assert.equal(chatConfig.isFirstContactRequestEnabled, undefined);
    assert.equal(appConfig.OPTIONAL_ENV_KEYS.includes('CHAT_FIRST_CONTACT_REQUEST'), false);
    const chatEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'chat.ejs'), 'utf8');
    assert.equal(chatEjs.includes('chatRequestBar'), false);
    assert.equal(chatEjs.includes('chatSetRequireRequest'), false);

    // Nebula Glass Card klavye, odak yakalama, mobil bottom sheet, reduced-motion ve sıfır sabit #hex kontrolü
    const cardJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'chat-profile-card.js'), 'utf8');
    assert.equal(cardJs.includes("ev.key === 'Escape'"), true);
    assert.equal(cardJs.includes("ev.key === 'Tab'"), true);
    assert.equal(cardJs.includes('is-mobile-sheet'), true);
    assert.equal(cardJs.includes('prefers-reduced-motion: reduce'), true);
    assert.equal((cardJs.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length, 0);

    const styleCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
    const sec22 = styleCss.slice(styleCss.indexOf('22. GENEL SOHBET'));
    assert.equal((sec22.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length, 0);
    assert.equal(sec22.includes('@media (max-width: 767px)'), true);
    assert.equal(sec22.includes('@media (prefers-reduced-motion: reduce)'), true);
  });
});
