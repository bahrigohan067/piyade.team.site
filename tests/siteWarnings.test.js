const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const appConfig = require('../config/app.config');
const authConfig = require('../config/auth.config');
const chatConfig = require('../config/chat.config');
const warningsConfig = require('../config/warnings.config');
const { ROLES } = require('../config/roles.config');
const botApiClient = require('../services/botApiClient');
const discordAuthService = require('../services/discordAuthService');
const googleAuthService = require('../services/googleAuthService');
const { MemberStore, setDefaultMemberStore, toUnifiedGoogleId } = require('../services/memberStore');
const { ChatStore, setDefaultChatStore, makeConvId } = require('../services/chatStore');
const { ChatModStore, setDefaultChatModStore } = require('../services/chatModStore');
const {
  SiteWarningStore,
  setDefaultSiteWarningStore,
  EVIDENCE_FILENAME_RE,
} = require('../services/siteWarningStore');
const { createServerApp } = require('../server');

const DAY_MS = 24 * 60 * 60 * 1000;

// Geçerli minimum 1x1 PNG (magic bytes + IHDR + IDAT + IEND)
const VALID_PNG_BUF = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex'
);
// Geçerli minimum JPEG magic bytes (FF D8 FF E0)
const VALID_JPG_BUF = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);
// Geçerli minimum WEBP magic bytes (RIFF....WEBP)
const VALID_WEBP_BUF = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x14, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
  0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

// ============================================================================
// YARDIMCILAR: SAHTE GOOGLE OIDC, SAHTE BOT API, ÇEREZ KAVANOZU VE MULTIPART
// ============================================================================

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function createFakeGoogleOidcServer() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'sw-test-key-1';
  const publicJwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid,
    alg: 'RS256',
    use: 'sig',
  };
  let nextTokenOverrides = {};
  let lastAuthorizeParams = null;

  function signJwt(payload) {
    const header = { alg: 'RS256', typ: 'JWT', kid };
    const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signingInput);
    signer.end();
    return `${signingInput}.${base64UrlEncode(signer.sign(privateKey))}`;
  }

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname === '/jwks') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ keys: [publicJwk] }));
    }
    if (u.pathname === '/token' && req.method === 'POST') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const nowSec = Math.floor(Date.now() / 1000);
        const claims = {
          iss: `http://127.0.0.1:${server.address().port}`,
          aud: process.env.GOOGLE_CLIENT_ID,
          sub: nextTokenOverrides.sub || 'sub-default',
          email: nextTokenOverrides.email || 'gizli.uye@example.com',
          email_verified: true,
          name: nextTokenOverrides.name || 'Gizli Ad Soyad',
          nonce: (lastAuthorizeParams && lastAuthorizeParams.nonce) || '',
          iat: nowSec,
          exp: nowSec + 3600,
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ access_token: 'tok', id_token: signJwt(claims) }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  return {
    setNextToken(o = {}) {
      nextTokenOverrides = o;
    },
    setLastAuthorize(p) {
      lastAuthorizeParams = p;
    },
    async start() {
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const { port } = server.address();
      return {
        authUrl: `http://127.0.0.1:${port}/auth`,
        tokenUrl: `http://127.0.0.1:${port}/token`,
        jwksUrl: `http://127.0.0.1:${port}/jwks`,
        issuer: `http://127.0.0.1:${port}`,
      };
    },
    async close() {
      await new Promise((r) => server.close(r));
    },
  };
}

const DEV_ID = '910000000000000001';
const YONETMEN_ID = '910000000000000002';
const COMM_OFFICIAL_ID = '910000000000000003';
const NORMAL_DISCORD_ID = '910000000000000004';
const REVOKABLE_STAFF_ID = '910000000000000005';

function createFakeBotServer() {
  const memberRolesMap = new Map([
    [
      DEV_ID,
      {
        id: DEV_ID,
        displayName: 'DevKurucu',
        roles: [ROLES.DEVELOPER, ROLES.REGISTERED],
        level: 'developer',
        registered: true,
        highestRolePosition: 99,
      },
    ],
    [
      YONETMEN_ID,
      {
        id: YONETMEN_ID,
        displayName: 'YonetmenAli',
        roles: [ROLES.YONETMENLIK, ROLES.REGISTERED],
        level: 'yonetmenlik',
        registered: true,
        highestRolePosition: 60,
      },
    ],
    [
      COMM_OFFICIAL_ID,
      {
        id: COMM_OFFICIAL_ID,
        displayName: 'ModVeli',
        roles: [ROLES.COMMUNITY_OFFICIAL, ROLES.REGISTERED],
        level: 'registered',
        registered: true,
        highestRolePosition: 40,
      },
    ],
    [
      NORMAL_DISCORD_ID,
      {
        id: NORMAL_DISCORD_ID,
        displayName: 'NormalDiscordUye',
        roles: [ROLES.REGISTERED],
        level: 'registered',
        registered: true,
        highestRolePosition: 10,
      },
    ],
    [
      REVOKABLE_STAFF_ID,
      {
        id: REVOKABLE_STAFF_ID,
        displayName: 'GeciciYonetmen',
        roles: [ROLES.YONETMENLIK, ROLES.REGISTERED],
        level: 'yonetmenlik',
        registered: true,
        highestRolePosition: 55,
      },
    ],
  ]);

  const discordWarnCalls = [];
  const releasedRobloxIds = [];

  const directoryMembers = [
    {
      id: NORMAL_DISCORD_ID,
      displayName: 'NormalDiscordUye',
      discordAvatarUrl: null,
      robloxId: '777001',
      robloxUsername: 'NormalRBX',
      robloxAvatarUrl: null,
      hasRoblox: true,
      games: [{ id: 'roblox', username: 'NormalRBX', robloxId: '777001' }],
    },
  ];

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = {};
      try {
        if (chunks.length) body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch (_) {}

      const send = (code, data) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };

      if (u.pathname === '/api/health') return send(200, { status: 'ok' });
      if (u.pathname === '/api/stats/summary') {
        return send(200, { activeThisMonth: 15, playingNow: 4, computedAt: Date.now(), families: [] });
      }
      if (u.pathname === '/api/stats/top-games') {
        return send(200, { scope: 'month', families: [], games: [], totalSeconds: 0 });
      }
      if (u.pathname === '/api/games') {
        return send(200, {
          games: [
            { id: 'roblox', emoji: '🧱', name: { tr: 'Roblox', en: 'Roblox' }, validate: { min: 3, max: 100, regex: null }, verifier: 'roblox' },
            { id: 'cs2', emoji: '🔫', name: { tr: 'CS2', en: 'CS2' }, validate: { min: 2, max: 32, regex: null }, verifier: null },
          ],
        });
      }
      if (u.pathname.startsWith('/api/member/') && u.pathname.endsWith('/roles')) {
        const id = u.pathname.split('/')[3];
        const found = memberRolesMap.get(id);
        if (!found) return send(404, { error: 'Not found' });
        return send(200, found);
      }
      if (u.pathname === '/api/directory') {
        return send(200, { items: directoryMembers, nextCursor: null, hasMore: false });
      }
      if (u.pathname === '/api/directory/lookup' && req.method === 'POST') {
        const ids = Array.isArray(body.ids) ? body.ids : [];
        return send(200, { items: directoryMembers.filter((m) => ids.includes(m.id)) });
      }
      if (u.pathname === '/api/roblox/avatars') {
        return send(200, {});
      }
      if (u.pathname.startsWith('/api/roblox/site-claims/') && req.method === 'DELETE') {
        releasedRobloxIds.push(u.pathname.split('/').pop());
        return send(200, { ok: true, released: true });
      }
      if (u.pathname === '/api/admin/warn' && req.method === 'POST') {
        discordWarnCalls.push(body);
        return send(200, {
          success: true,
          warnId: `DW-${discordWarnCalls.length}`,
          type: body.type,
          ruleCode: body.ruleCode || null,
          ruleDescription: 'Discord kuralı',
          actionTaken: '+2 Puan',
          newStats: { points: 2, tier: 0 },
        });
      }
      return send(404, { error: 'Not found' });
    });
  });

  return {
    memberRolesMap,
    discordWarnCalls,
    releasedRobloxIds,
    async start() {
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      return `http://127.0.0.1:${server.address().port}`;
    },
    async close() {
      await new Promise((r) => server.close(r));
    },
  };
}

class CookieJar {
  constructor() {
    this.map = new Map();
  }
  updateFromResponse(res) {
    const list =
      typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : res.headers.get('set-cookie')
          ? [res.headers.get('set-cookie')]
          : [];
    for (const raw of list) {
      if (!raw) continue;
      const first = raw.split(';')[0];
      const eq = first.indexOf('=');
      if (eq <= 0) continue;
      const name = first.slice(0, eq).trim();
      const val = first.slice(eq + 1).trim();
      if (!val || /max-age=0/i.test(raw) || /expires=Thu, 01 Jan 1970/i.test(raw)) {
        this.map.delete(name);
      } else {
        this.map.set(name, val);
      }
    }
  }
  header() {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

async function httpReq(baseUrl, reqPath, { method = 'GET', jar = null, headers = {}, body = null, ip = null } = {}) {
  const reqHeaders = { ...headers };
  if (jar && jar.header()) reqHeaders.Cookie = jar.header();
  if (ip) reqHeaders['X-Forwarded-For'] = ip;
  const res = await fetch(`${baseUrl}${reqPath}`, {
    method,
    headers: reqHeaders,
    body,
    redirect: 'manual',
  });
  if (jar) jar.updateFromResponse(res);
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString('utf8');
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {}
  return { status: res.status, headers: res.headers, location: res.headers.get('location') || '', text, buf, json };
}

function buildMultipart(fields = {}, file = null) {
  const boundary = `----PiyadeSW${crypto.randomBytes(6).toString('hex')}`;
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field || 'evidenceFile'}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`
      )
    );
    parts.push(file.buffer);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat(parts),
  };
}

function extractInputVal(html, idOrName) {
  const reId = new RegExp(`id="${idOrName}"[^>]*value="([^"]*)"`, 'i');
  const m1 = String(html || '').match(reId);
  if (m1) return m1[1];
  const reName = new RegExp(`name="${idOrName}"[^>]*value="([^"]*)"`, 'i');
  const m2 = String(html || '').match(reName);
  return m2 ? m2[1] : '';
}

function extractFormIdemKey(html, formId) {
  const re = new RegExp(`id="${formId}"[\\s\\S]*?name="_idempotencyKey"[^>]*value="([^"]*)"`, 'i');
  const m = String(html || '').match(re);
  return m ? m[1] : '';
}

async function loginAsDiscord(baseUrl, jar, discordUserId, displayName, ip = '10.10.0.1') {
  discordAuthService.exchangeCodeForToken = async () => ({ access_token: `tok-${discordUserId}` });
  discordAuthService.fetchDiscordUser = async () => ({
    id: discordUserId,
    username: displayName,
    global_name: displayName,
    avatar: null,
  });
  const start = await httpReq(baseUrl, '/auth/discord', { jar, ip });
  const u = new URL(start.location);
  const state = u.searchParams.get('state');
  const cb = await httpReq(baseUrl, `/auth/discord/callback?code=ok&state=${encodeURIComponent(state)}`, { jar, ip });
  assert.equal(cb.status, 302);
  return jar;
}

async function loginAsGoogle(baseUrl, fakeGoogle, jar, sub, { query = '', ip = '10.20.0.1' } = {}) {
  fakeGoogle.setNextToken({ sub, email: `${sub}@example.com`, name: `Secret ${sub}` });
  const start = await httpReq(baseUrl, `/auth/google${query}`, { jar, ip });
  assert.equal(start.status, 302);
  const u = new URL(start.location);
  fakeGoogle.setLastAuthorize({
    state: u.searchParams.get('state'),
    nonce: u.searchParams.get('nonce'),
    codeChallenge: u.searchParams.get('code_challenge'),
  });
  return httpReq(
    baseUrl,
    `/auth/google/callback?code=gcode-${Date.now()}&state=${encodeURIComponent(u.searchParams.get('state'))}`,
    { jar, ip }
  );
}

// ============================================================================
// ANA TEST PAKETİ — SİTE (GOOGLE) ÜYELERİ UYARI & YAPTIRIM SİSTEMİ
// ============================================================================

test('Site (Google) Üyeleri Uyarı & Yaptırım Sistemi — Uçtan Uca ve Kural Motoru Testleri', async (t) => {
  const prevEnv = { ...process.env };
  const prevBotUrl = appConfig.BOT_API_URL;
  const prevExchange = discordAuthService.exchangeCodeForToken;
  const prevFetchDiscord = discordAuthService.fetchDiscordUser;

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piyade-sitewarn-test-'));
  const memberStore = new MemberStore({ baseDir: path.join(tmpRoot, 'members') });
  const chatStore = new ChatStore({ baseDir: path.join(tmpRoot, 'chat'), silentWarning: true });
  const chatModStore = new ChatModStore({ baseDir: path.join(tmpRoot, 'chat') });
  const warningStore = new SiteWarningStore({ baseDir: path.join(tmpRoot, 'warnings') });

  setDefaultMemberStore(memberStore);
  setDefaultChatStore(chatStore);
  setDefaultChatModStore(chatModStore);
  setDefaultSiteWarningStore(warningStore);

  const fakeGoogle = createFakeGoogleOidcServer();
  const fakeBot = createFakeBotServer();
  const gEndpoints = await fakeGoogle.start();
  const botUrl = await fakeBot.start();

  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = 'sitewarn-test-secret-key-0123456789';
  process.env.API_SECRET = 'sitewarn-test-api-secret';
  process.env.DISCORD_CLIENT_ID = '111111111111111111';
  process.env.DISCORD_CLIENT_SECRET = 'test-discord-secret';
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  process.env.GOOGLE_TEST_AUTH_URL = gEndpoints.authUrl;
  process.env.GOOGLE_TEST_TOKEN_URL = gEndpoints.tokenUrl;
  process.env.GOOGLE_TEST_JWKS_URL = gEndpoints.jwksUrl;
  process.env.GOOGLE_TEST_ISSUER = gEndpoints.issuer;
  process.env.CHAT_ENABLED = 'true';
  process.env.CHAT_GOOGLE_MEMBERS_ENABLED = 'true';
  process.env.NEW_MEMBER_CHAT_RESTRICTION_HOURS = '0';

  googleAuthService.clearJwksCache();
  appConfig.BOT_API_URL = botUrl;

  const app = createServerApp();
  const siteServer = http.createServer(app);
  await new Promise((r) => siteServer.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${siteServer.address().port}`;
  process.env.BASE_URL = baseUrl;

  t.after(async () => {
    warningStore.stopMaintenanceScheduler();
    await new Promise((r) => siteServer.close(r));
    await fakeBot.close();
    await fakeGoogle.close();
    appConfig.BOT_API_URL = prevBotUrl;
    discordAuthService.exchangeCodeForToken = prevExchange;
    discordAuthService.fetchDiscordUser = prevFetchDiscord;
    for (const k of Object.keys(process.env)) {
      if (!(k in prevEnv)) delete process.env[k];
    }
    Object.assign(process.env, prevEnv);
    setDefaultMemberStore(null);
    setDefaultChatStore(null);
    setDefaultChatModStore(null);
    setDefaultSiteWarningStore(null);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  // Yardımcı Google üye oluşturucu
  let memberSeq = 0;
  function createTestGoogleMember(overrides = {}) {
    memberSeq += 1;
    const sub = overrides.googleSub || `gsub-${memberSeq}`;
    const nick = overrides.nickname || `SiteOyuncu${memberSeq}`;
    const created = memberStore.createMember({
      googleSub: sub,
      email: overrides.email || `secret_${memberSeq}@example.com`,
      googleName: overrides.googleName || `Gizli Isim ${memberSeq}`,
      nickname: nick,
      ageGroup: '18_plus',
      games: overrides.games || [
        { id: 'roblox', username: `RbxOyuncu${memberSeq}`, robloxId: String(880000 + memberSeq) },
        { id: 'cs2', username: `CsOyuncu${memberSeq}` },
      ],
      consents: [
        { id: 'kvkk_notice', version: '1.2', at: Date.now() - 5 * DAY_MS },
        { id: 'international_data_transfer', version: '1.1', at: Date.now() - 5 * DAY_MS },
        { id: 'general_rules', version: '1.0', at: Date.now() - 5 * DAY_MS },
        { id: 'chat_moderation_review', version: '1.0', at: Date.now() - 5 * DAY_MS },
        { id: 'chat_profile_game_usernames', version: '1.1', at: Date.now() - 5 * DAY_MS },
      ],
      nowMs: overrides.nowMs || Date.now() - 5 * DAY_MS,
    });
    assert.equal(created.ok, true);
    const uid = toUnifiedGoogleId(created.member.id);
    chatStore.recordConsent(uid, chatConfig.POLICY_VERSION);
    return { member: created.member, unifiedId: uid, sub };
  }

  const mAlpha = createTestGoogleMember({ nickname: 'AlphaKartal', googleName: 'Gizli Alpha Ad' });
  const mBeta = createTestGoogleMember({ nickname: 'BetaSahin', googleName: 'Gizli Beta Ad' });

  // Oturumlar
  const devJar = await loginAsDiscord(baseUrl, new CookieJar(), DEV_ID, 'DevKurucu', '10.1.0.1');
  const yonJar = await loginAsDiscord(baseUrl, new CookieJar(), YONETMEN_ID, 'YonetmenAli', '10.1.0.2');
  const modJar = await loginAsDiscord(baseUrl, new CookieJar(), COMM_OFFICIAL_ID, 'ModVeli', '10.1.0.3');
  const normalJar = await loginAsDiscord(baseUrl, new CookieJar(), NORMAL_DISCORD_ID, 'NormalDiscordUye', '10.1.0.4');
  const revokableJar = await loginAsDiscord(baseUrl, new CookieJar(), REVOKABLE_STAFF_ID, 'GeciciYonetmen', '10.1.0.5');
  const alphaJar = new CookieJar();
  const alphaLogin = await loginAsGoogle(baseUrl, fakeGoogle, alphaJar, mAlpha.sub, { ip: '10.2.0.1' });
  assert.equal(alphaLogin.status, 302);
  assert.equal(alphaLogin.location, '/');

  // --------------------------------------------------------------------------
  // 1) YETKİ & TAZE ROL DOĞRULAMASI
  // --------------------------------------------------------------------------
  await t.test('1) Yetki: Developer ve Yönetmenlik izinli; Community Official, normal üye, Google üye, girişsiz ve rolü alınan yetkili engelli', async () => {
    // Developer & Yönetmenlik izinli
    const devRes = await httpReq(baseUrl, '/yonetim/site-uyari/api/uyeler', {
      jar: devJar,
      headers: { Accept: 'application/json' },
      ip: '10.1.0.1',
    });
    assert.equal(devRes.status, 200);
    assert.equal(devRes.json.ok, true);

    const yonRes = await httpReq(baseUrl, '/yonetim/site-uyari/api/uyeler', {
      jar: yonJar,
      headers: { Accept: 'application/json' },
      ip: '10.1.0.2',
    });
    assert.equal(yonRes.status, 200);
    assert.equal(yonRes.json.ok, true);

    // Girişsiz -> 401
    const guestRes = await httpReq(baseUrl, '/yonetim/site-uyari/api/uyeler', {
      headers: { Accept: 'application/json' },
      ip: '10.1.0.99',
    });
    assert.equal(guestRes.status, 401);

    // Community Official -> 403
    const modRes = await httpReq(baseUrl, '/yonetim/site-uyari/api/uyeler', {
      jar: modJar,
      headers: { Accept: 'application/json' },
      ip: '10.1.0.3',
    });
    assert.equal(modRes.status, 403);

    // Normal kayıtlı Discord üyesi -> 403
    const normRes = await httpReq(baseUrl, '/yonetim/site-uyari/api/uyeler', {
      jar: normalJar,
      headers: { Accept: 'application/json' },
      ip: '10.1.0.4',
    });
    assert.equal(normRes.status, 403);

    // Google üye -> 403 (hem GET /yonetim/uyari hem tüm site-uyari uçları)
    const gPage = await httpReq(baseUrl, '/yonetim/uyari', { jar: alphaJar, ip: '10.2.0.1' });
    assert.equal(gPage.status, 403);
    const gApi = await httpReq(baseUrl, '/yonetim/site-uyari/api/uyeler', {
      jar: alphaJar,
      headers: { Accept: 'application/json' },
      ip: '10.2.0.1',
    });
    assert.equal(gApi.status, 403);
    const gPost = await httpReq(baseUrl, '/yonetim/site-uyari', {
      method: 'POST',
      jar: alphaJar,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteTargetMemberId: mBeta.member.id, siteWarnType: 'verbal', siteWarnReason: 'deneme' }),
      ip: '10.2.0.1',
    });
    assert.equal(gPost.status, 403);

    // Taze rol doğrulama: Yönetmenlik rolü Bot API'den alınınca bir sonraki istek ANINDA 403 + oturum iptali!
    const okBefore = await httpReq(baseUrl, '/yonetim/site-uyari/api/uyeler', {
      jar: revokableJar,
      headers: { Accept: 'application/json' },
      ip: '10.1.0.5',
    });
    assert.equal(okBefore.status, 200);

    fakeBot.memberRolesMap.set(REVOKABLE_STAFF_ID, {
      id: REVOKABLE_STAFF_ID,
      displayName: 'GeciciYonetmen',
      roles: [ROLES.REGISTERED],
      level: 'registered',
      registered: true,
      highestRolePosition: 10,
    });
    const blockedAfter = await httpReq(baseUrl, '/yonetim/site-uyari/api/uyeler', {
      jar: revokableJar,
      headers: { Accept: 'application/json' },
      ip: '10.1.0.5',
    });
    assert.equal(blockedAfter.status, 403);
    assert.equal(blockedAfter.json.sessionRevoked, true);
  });

  // --------------------------------------------------------------------------
  // 2) SADECE GOOGLE ÜYE SEÇİCİ, Y1–Y5 ENGELİ, SÖZLÜ UYARI & DISCORD PANELİ DOKUNULMAMIŞ
  // --------------------------------------------------------------------------
  await t.test('2) Google-only seçici, Y1–Y5 reddi, sözlü uyarı gerekçesi ve mevcut Discord panelinin korunması', async () => {
    // Mevcut /yonetim/uyari iki paneli de barındırır; Discord panelinde Y1 var, Site panelinde Y1 YOK!
    const warnPage = await httpReq(baseUrl, '/yonetim/uyari', { jar: devJar, ip: '10.1.0.1' });
    assert.equal(warnPage.status, 200);
    assert.match(warnPage.text, /id="adminWarnForm"/);
    assert.match(warnPage.text, /id="siteAdminWarnForm"/);
    assert.match(warnPage.text, /Site \(Google\) Üyelerine Uyarı Ver/);

    const discordSelectMatch = warnPage.text.match(/id="ruleCodeSelect"[\s\S]*?<\/select>/);
    const siteSelectMatch = warnPage.text.match(/id="siteRuleCodeSelect"[\s\S]*?<\/select>/);
    assert.ok(discordSelectMatch && siteSelectMatch);
    assert.match(discordSelectMatch[0], /value="Y1"/, 'Discord panelinde Y1 korunmalı');
    assert.doesNotMatch(siteSelectMatch[0], /value="Y[1-5]"/, 'Site panelinde Y1–Y5 ASLA bulunmamalı');
    assert.match(siteSelectMatch[0], /value="M1"/);
    assert.match(siteSelectMatch[0], /value="D3"/);

    // Üye seçici yalnızca memberStore Google üyelerini arar (Roblox / oyun adı / takma ad / googleName); Discord üyesi ÇIKMAZ
    const searchAll = await httpReq(baseUrl, '/yonetim/site-uyari/api/uyeler', {
      jar: devJar,
      headers: { Accept: 'application/json' },
      ip: '10.1.0.1',
    });
    assert.equal(searchAll.status, 200);
    assert.ok(searchAll.json.members.some((m) => m.id === mAlpha.member.id));
    assert.ok(!searchAll.json.members.some((m) => m.id === NORMAL_DISCORD_ID));

    const searchByRoblox = await httpReq(baseUrl, '/yonetim/site-uyari/api/uyeler?q=RbxOyuncu1', {
      jar: devJar,
      headers: { Accept: 'application/json' },
      ip: '10.1.0.1',
    });
    assert.equal(searchByRoblox.json.members.length, 1);
    assert.equal(searchByRoblox.json.members[0].id, mAlpha.member.id);

    const searchDiscord = await httpReq(baseUrl, '/yonetim/site-uyari/api/uyeler?q=NormalDiscordUye', {
      jar: devJar,
      headers: { Accept: 'application/json' },
      ip: '10.1.0.1',
    });
    assert.equal(searchDiscord.json.members.length, 0);

    // Y1 kuralı ve Discord ID reddi + sözlü uyarıda boş gerekçe reddi
    const csrf = extractInputVal(warnPage.text, '_csrf');
    const siteIdem1 = extractFormIdemKey(warnPage.text, 'siteAdminWarnForm');
    const discordIdem = extractFormIdemKey(warnPage.text, 'adminWarnForm');

    const yRuleRes = await httpReq(
      baseUrl,
      `/yonetim/site-uyari?_csrf=${encodeURIComponent(csrf)}&_idempotencyKey=${encodeURIComponent(siteIdem1)}`,
      {
        method: 'POST',
        jar: devJar,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteTargetMemberId: mAlpha.member.id, siteWarnType: 'official', siteRuleCode: 'Y1' }),
        ip: '10.1.0.1',
      }
    );
    assert.equal(yRuleRes.status, 400);
    assert.ok(yRuleRes.json.nextIdempotencyKey);

    const discordTargetRes = await httpReq(
      baseUrl,
      `/yonetim/site-uyari?_csrf=${encodeURIComponent(csrf)}&_idempotencyKey=${encodeURIComponent(yRuleRes.json.nextIdempotencyKey)}`,
      {
        method: 'POST',
        jar: devJar,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteTargetMemberId: NORMAL_DISCORD_ID, siteWarnType: 'official', siteRuleCode: 'M1' }),
        ip: '10.1.0.1',
      }
    );
    assert.equal(discordTargetRes.status, 404);

    const verbalEmptyRes = await httpReq(
      baseUrl,
      `/yonetim/site-uyari?_csrf=${encodeURIComponent(csrf)}&_idempotencyKey=${encodeURIComponent(discordTargetRes.json.nextIdempotencyKey)}`,
      {
        method: 'POST',
        jar: devJar,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteTargetMemberId: mAlpha.member.id, siteWarnType: 'verbal', siteWarnReason: 'a' }),
        ip: '10.1.0.1',
      }
    );
    assert.equal(verbalEmptyRes.status, 400);

    // Geçerli sözlü uyarı -> 0 puan + sicile işlenir
    const verbalOkRes = await httpReq(
      baseUrl,
      `/yonetim/site-uyari?_csrf=${encodeURIComponent(csrf)}&_idempotencyKey=${encodeURIComponent(verbalEmptyRes.json.nextIdempotencyKey)}`,
      {
        method: 'POST',
        jar: devJar,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteTargetMemberId: mAlpha.member.id,
          siteWarnType: 'verbal',
          siteWarnReason: 'Genel sohbette üsluba dikkat edilmesi hatirlatildi.',
        }),
        ip: '10.1.0.1',
      }
    );
    assert.equal(verbalOkRes.status, 200);
    assert.equal(verbalOkRes.json.ok, true);
    assert.equal(verbalOkRes.json.summary.totalPoints, 0);
    assert.equal(verbalOkRes.json.summary.tier, 0);

    // Mevcut Discord uyarı paneli POST /yonetim/uyari hala Bot API'ye dokunulmadan iletilir
    const discordPost = await httpReq(
      baseUrl,
      `/yonetim/uyari?_csrf=${encodeURIComponent(csrf)}&_idempotencyKey=${encodeURIComponent(discordIdem)}`,
      {
        method: 'POST',
        jar: devJar,
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          _csrf: csrf,
          _idempotencyKey: discordIdem,
          targetUserId: NORMAL_DISCORD_ID,
          type: 'official',
          ruleCode: 'M1',
          reason: 'Discord testi',
        }).toString(),
        ip: '10.1.0.1',
      }
    );
    assert.equal(discordPost.status, 200);
    assert.equal(discordPost.json.ok, true);
    assert.equal(fakeBot.discordWarnCalls.length, 1);
    assert.equal(fakeBot.discordWarnCalls[0].targetUserId, NORMAL_DISCORD_ID);
    assert.equal(fakeBot.discordWarnCalls[0].ruleCode, 'M1');
  });

  // --------------------------------------------------------------------------
  // 3) PUAN HESAPLAMA, KADEMELER (0–5) VE İDEMPOTENT EŞİK GEÇİŞLERİ (10 -> 3G MUTE, 15+ -> 7G ASKI)
  // --------------------------------------------------------------------------
  await t.test('3) Puan kademeleri (0–5) ve idempotent eşik geçişleri (10 puan 3g susturma, 15+ puan 7g askı)', async () => {
    assert.equal(warningsConfig.calculateTierFromPoints(0), 0);
    assert.equal(warningsConfig.calculateTierFromPoints(2), 0);
    assert.equal(warningsConfig.calculateTierFromPoints(3), 1);
    assert.equal(warningsConfig.calculateTierFromPoints(5), 1);
    assert.equal(warningsConfig.calculateTierFromPoints(6), 2);
    assert.equal(warningsConfig.calculateTierFromPoints(8), 2);
    assert.equal(warningsConfig.calculateTierFromPoints(9), 3);
    assert.equal(warningsConfig.calculateTierFromPoints(11), 3);
    assert.equal(warningsConfig.calculateTierFromPoints(12), 4);
    assert.equal(warningsConfig.calculateTierFromPoints(14), 4);
    assert.equal(warningsConfig.calculateTierFromPoints(15), 5);
    assert.equal(warningsConfig.calculateTierFromPoints(25), 5);

    const mPts = createTestGoogleMember({ nickname: 'PuanTestUye' });
    const t0 = Date.now();

    // 1. Uyarı: M8 (+5) -> 5 puan, Kademe 1, yaptırım yok
    const w1 = warningStore.issueWarning({
      memberId: mPts.member.id,
      type: 'official',
      ruleCode: 'M8',
      reason: 'Ilk M8',
      actorId: DEV_ID,
      actorName: 'DevKurucu',
      nowTs: t0,
      memberStore,
      chatModStore,
    });
    assert.equal(w1.summary.totalPoints, 5);
    assert.equal(w1.summary.tier, 1);
    assert.equal(w1.record.sanctionKind, 'none');
    assert.equal(chatModStore.getActiveSanction(mPts.unifiedId, t0), null);

    // 2. Uyarı: M8 (+5) -> 10 puan, Kademe 3 -> İLK KEZ 10'a ulaştı -> 3 gün sohbet susturma!
    const w2 = warningStore.issueWarning({
      memberId: mPts.member.id,
      type: 'official',
      ruleCode: 'M8',
      reason: 'Ikinci M8',
      actorId: DEV_ID,
      actorName: 'DevKurucu',
      nowTs: t0 + 1000,
      memberStore,
      chatModStore,
    });
    assert.equal(w2.summary.totalPoints, 10);
    assert.equal(w2.summary.tier, 3);
    assert.equal(w2.record.triggeredThreshold10, true);
    assert.equal(w2.record.sanctionKind, 'chat_mute');
    assert.equal(w2.record.sanctionDurationDays, 3);
    const muteAfter10 = chatModStore.getActiveSanction(mPts.unifiedId, t0 + 2000);
    assert.ok(muteAfter10 && muteAfter10.type === 'mute');
    assert.equal(muteAfter10.expiresAt, t0 + 1000 + 3 * DAY_MS);

    // 3. Uyarı: M1 (+2) -> 12 puan, Kademe 4 -> İKİNCİ KEZ 10 eşiği TETİKLENMEZ!
    const w3 = warningStore.issueWarning({
      memberId: mPts.member.id,
      type: 'official',
      ruleCode: 'M1',
      reason: '12 puan testi',
      actorId: DEV_ID,
      actorName: 'DevKurucu',
      nowTs: t0 + 5000,
      memberStore,
      chatModStore,
    });
    assert.equal(w3.summary.totalPoints, 12);
    assert.equal(w3.summary.tier, 4);
    assert.equal(w3.record.triggeredThreshold10, false);
    assert.equal(w3.record.sanctionKind, 'none');
    assert.equal(w3.record.linkedSanctionId, null);

    // 4. Uyarı: M5 (+3) -> 15 puan, Kademe 5 -> İLK KEZ 15+ eşiği -> 7 gün Hesap Askıya Alma!
    const w4 = warningStore.issueWarning({
      memberId: mPts.member.id,
      type: 'official',
      ruleCode: 'M5',
      reason: '15 puan esigi',
      actorId: DEV_ID,
      actorName: 'DevKurucu',
      nowTs: t0 + 10000,
      memberStore,
      chatModStore,
    });
    assert.equal(w4.summary.totalPoints, 15);
    assert.equal(w4.summary.tier, 5);
    assert.equal(w4.record.triggeredThreshold15, true);
    assert.equal(w4.record.sanctionKind, 'account_suspend');
    assert.equal(w4.record.sanctionDurationDays, 7);
    const after15Member = memberStore.findById(mPts.member.id);
    assert.equal(after15Member.status, 'suspended');
    assert.equal(after15Member.statusExpiresAt, t0 + 10000 + 7 * DAY_MS);

    // 5. Uyarı: M1 (+2) -> 17 puan -> İKİNCİ KEZ 15+ askısı TETİKLENMEZ / uzamaz!
    const w5 = warningStore.issueWarning({
      memberId: mPts.member.id,
      type: 'official',
      ruleCode: 'M1',
      reason: '17 puan testi',
      actorId: DEV_ID,
      actorName: 'DevKurucu',
      nowTs: t0 + 60000,
      memberStore,
      chatModStore,
    });
    assert.equal(w5.summary.totalPoints, 17);
    assert.equal(w5.record.triggeredThreshold15, false);
    assert.equal(w5.record.sanctionKind, 'none');
    assert.equal(memberStore.findById(mPts.member.id).statusExpiresAt, t0 + 10000 + 7 * DAY_MS);
  });

  // --------------------------------------------------------------------------
  // 4) ÖZEL YAPTIRIMLI KURALLAR: M2/M9 KALICI YASAK, M4 (2g), M10/M11/M13 (1g)
  // --------------------------------------------------------------------------
  await t.test('4) Özel kurallar: M2/M9 kalıcı yasak + yeniden kayıt engeli; M4 (2g) ve M10/M11/M13 (1g) susturma', async () => {
    const now = Date.now();
    const mSpec = createTestGoogleMember({ nickname: 'OzelKuralUye' });

    // M4 -> 2 gün susturma
    const wM4 = warningStore.issueWarning({
      memberId: mSpec.member.id,
      type: 'official',
      ruleCode: 'M4',
      reason: 'M4 testi',
      actorId: DEV_ID,
      nowTs: now,
      memberStore,
      chatModStore,
    });
    assert.equal(wM4.record.sanctionKind, 'chat_mute');
    assert.equal(wM4.record.sanctionDurationDays, 2);
    assert.equal(wM4.record.pointsAdded, 0);
    assert.equal(chatModStore.getActiveSanction(mSpec.unifiedId, now + 1000).expiresAt, now + 2 * DAY_MS);

    // M10, M11, M13 -> 1 gün susturma
    for (const code of ['M10', 'M11', 'M13']) {
      const mOne = createTestGoogleMember({ nickname: `Mute${code}Uye` });
      const res = warningStore.issueWarning({
        memberId: mOne.member.id,
        type: 'official',
        ruleCode: code,
        reason: `${code} testi`,
        actorId: DEV_ID,
        nowTs: now,
        memberStore,
        chatModStore,
      });
      assert.equal(res.record.sanctionKind, 'chat_mute');
      assert.equal(res.record.sanctionDurationDays, 1);
      assert.equal(chatModStore.getActiveSanction(mOne.unifiedId, now + 1000).expiresAt, now + 1 * DAY_MS);
    }

    // M2 -> Kalıcı yasak + bannedSubHashes + yeniden kayıt reddi + girişte /giris/askida (403)
    const mBanM2 = createTestGoogleMember({ nickname: 'BanM2Uye' });
    const wM2 = warningStore.issueWarning({
      memberId: mBanM2.member.id,
      type: 'official',
      ruleCode: 'M2',
      reason: 'Dolandiricilik linki',
      actorId: DEV_ID,
      nowTs: now,
      memberStore,
      chatModStore,
    });
    assert.equal(wM2.record.sanctionKind, 'permanent_ban');
    assert.equal(memberStore.findById(mBanM2.member.id).status, 'banned');
    assert.equal(memberStore.isGoogleSubBanned(mBanM2.sub), true);

    // Aynı googleSub ile yeniden kayıt engellenir
    const reReg = memberStore.createMember({
      googleSub: mBanM2.sub,
      email: 'new@example.com',
      nickname: 'YeniDeneme',
      ageGroup: '18_plus',
      games: [{ id: 'cs2', username: 'YeniCS' }],
      consents: [],
    });
    assert.equal(reReg.ok, false);
    assert.equal(reReg.code, 'GOOGLE_SUB_BANNED');

    // Yasaklı üye Google girişi yapınca /giris/askida'ya gider, 403 görür ve oturumu AÇILMAZ
    const bannedJar = new CookieJar();
    const banCb = await loginAsGoogle(baseUrl, fakeGoogle, bannedJar, mBanM2.sub, { ip: '10.2.0.55' });
    assert.equal(banCb.status, 302);
    assert.equal(banCb.location, '/giris/askida');

    const banPage = await httpReq(baseUrl, '/giris/askida', { jar: bannedJar, ip: '10.2.0.55' });
    assert.equal(banPage.status, 403);
    assert.match(banPage.text, /M2/);
    assert.match(banPage.text, /\/yasal\/kvkk-basvuru/);
    assert.match(banPage.text, /\/bildir/);
    assert.match(banPage.text, /\/yasal\/gizlilik-politikasi/);

    // Yasaklı üyenin oturumu kurulmadığı için /api/uyari-bildirimleri 401 döner
    const banApi = await httpReq(baseUrl, '/api/uyari-bildirimleri', { jar: bannedJar, ip: '10.2.0.55' });
    assert.equal(banApi.status, 401);

    // M9 -> Kalıcı yasak
    const mBanM9 = createTestGoogleMember({ nickname: 'BanM9Uye' });
    const wM9 = warningStore.issueWarning({
      memberId: mBanM9.member.id,
      type: 'official',
      ruleCode: 'M9',
      reason: 'Guvenlik ihlali',
      actorId: YONETMEN_ID,
      nowTs: now,
      memberStore,
      chatModStore,
    });
    assert.equal(wM9.record.sanctionKind, 'permanent_ban');
    assert.equal(memberStore.findById(mBanM9.member.id).status, 'banned');
    assert.equal(memberStore.isGoogleSubBanned(mBanM9.sub), true);
  });

  // --------------------------------------------------------------------------
  // 5) OTOMATİK AF (SAHTE SAAT: 29G KALIR, 31G SIFIRLANIR) VE SÜRE SONU
  // --------------------------------------------------------------------------
  await t.test('5) Otomatik af (29 gün kalır, 31 gün sıfırlanır), askı/susturma süre sonu ve kalıcı yasağın kalıcılığı', async () => {
    const t0 = Date.now() - 40 * DAY_MS;
    const mAmn = createTestGoogleMember({ nickname: 'AfTestUye', nowMs: t0 - DAY_MS });
    const mPerm = createTestGoogleMember({ nickname: 'KaliciTestUye', nowMs: t0 - DAY_MS });

    // t0'da 15 puan (3 x M8 -> 10p mute + 15p 7g suspend)
    warningStore.issueWarning({ memberId: mAmn.member.id, type: 'official', ruleCode: 'M8', reason: 'r1', actorId: DEV_ID, nowTs: t0, memberStore, chatModStore });
    warningStore.issueWarning({ memberId: mAmn.member.id, type: 'official', ruleCode: 'M8', reason: 'r2', actorId: DEV_ID, nowTs: t0 + 1000, memberStore, chatModStore });
    warningStore.issueWarning({ memberId: mAmn.member.id, type: 'official', ruleCode: 'M8', reason: 'r3', actorId: DEV_ID, nowTs: t0 + 2000, memberStore, chatModStore });

    // Kalıcı yasaklı üye
    warningStore.issueWarning({ memberId: mPerm.member.id, type: 'official', ruleCode: 'M2', reason: 'kalici', actorId: DEV_ID, nowTs: t0, memberStore, chatModStore });

    // t0 + 6 gün: askı hala aktif, puanlar 15
    const s6 = warningStore.getMemberSummary(mAmn.member.id, { nowTs: t0 + 6 * DAY_MS, memberStore, chatModStore });
    assert.equal(s6.status, 'suspended');
    assert.equal(s6.totalPoints, 15);
    assert.equal(s6.tier, 5);

    // t0 + 8 gün: 7 günlük askı ve 3 günlük susturma kendiliğinden KALKMIŞ, ama puanlar hala 15!
    const s8 = warningStore.getMemberSummary(mAmn.member.id, { nowTs: t0 + 8 * DAY_MS, memberStore, chatModStore });
    assert.equal(s8.status, 'active');
    assert.equal(chatModStore.getActiveSanction(mAmn.unifiedId, t0 + 8 * DAY_MS), null);
    assert.equal(s8.totalPoints, 15);

    // t0 + 29 gün: 30 gün dolmadı -> puan ve kademe HALA duruyor!
    const s29 = warningStore.getMemberSummary(mAmn.member.id, { nowTs: t0 + 29 * DAY_MS, memberStore, chatModStore });
    assert.equal(s29.totalPoints, 15);
    assert.equal(s29.tier, 5);

    // t0 + 31 gün: otomatik af tetiklenir -> puan ve kademe 0'a sıfırlanır!
    const maint = warningStore.runMaintenance({ nowTs: t0 + 31 * DAY_MS, memberStore, chatModStore });
    assert.ok(maint.pardonedMembers >= 1);
    const s31 = warningStore.getMemberSummary(mAmn.member.id, { nowTs: t0 + 31 * DAY_MS, memberStore, chatModStore });
    assert.equal(s31.totalPoints, 0);
    assert.equal(s31.tier, 0);
    assert.equal(s31.triggered10, false);

    // Yeni döngüde 10 puan tekrar 3g susturma tetikleyebilir
    const wNew1 = warningStore.issueWarning({ memberId: mAmn.member.id, type: 'official', ruleCode: 'M8', reason: 'yeni1', actorId: DEV_ID, nowTs: t0 + 32 * DAY_MS, memberStore, chatModStore });
    const wNew2 = warningStore.issueWarning({ memberId: mAmn.member.id, type: 'official', ruleCode: 'M8', reason: 'yeni2', actorId: DEV_ID, nowTs: t0 + 32 * DAY_MS + 1000, memberStore, chatModStore });
    assert.equal(wNew1.summary.totalPoints, 5);
    assert.equal(wNew2.summary.totalPoints, 10);
    assert.equal(wNew2.record.triggeredThreshold10, true);
    assert.equal(wNew2.record.sanctionKind, 'chat_mute');

    // Kalıcı yasak 400 gün sonra bile kendiliğinden KALKMAZ!
    warningStore.runMaintenance({ nowTs: t0 + 400 * DAY_MS, memberStore, chatModStore });
    assert.equal(memberStore.findById(mPerm.member.id).status, 'banned');
    assert.equal(memberStore.isGoogleSubBanned(mPerm.sub), true);
  });

  // --------------------------------------------------------------------------
  // 6) İPTAL ETME & YENİDEN HESAPLAMA
  // --------------------------------------------------------------------------
  await t.test('6) İptal: gerekçe zorunlu, puan/kademe güncellemesi ve desteklenmeyen yaptırımların kalkması', async () => {
    const now = Date.now();
    const mCan = createTestGoogleMember({ nickname: 'IptalTestUye' });

    const w1 = warningStore.issueWarning({ memberId: mCan.member.id, type: 'official', ruleCode: 'M8', reason: 'p1', actorId: DEV_ID, nowTs: now, memberStore, chatModStore });
    const w2 = warningStore.issueWarning({ memberId: mCan.member.id, type: 'official', ruleCode: 'M8', reason: 'p2', actorId: DEV_ID, nowTs: now + 100, memberStore, chatModStore });
    const w3 = warningStore.issueWarning({ memberId: mCan.member.id, type: 'official', ruleCode: 'M8', reason: 'p3', actorId: DEV_ID, nowTs: now + 200, memberStore, chatModStore });
    assert.equal(memberStore.findById(mCan.member.id).status, 'suspended');
    assert.ok(chatModStore.getActiveSanction(mCan.unifiedId, now + 300));

    // Boş iptal gerekçesi reddedilir
    assert.throws(
      () => warningStore.cancelWarning(w3.record.id, { actorId: DEV_ID, cancelReason: 'x', nowTs: now + 400, memberStore, chatModStore }),
      (e) => e.code === 'CANCEL_REASON_REQUIRED' && e.statusCode === 400
    );

    // w1'i iptal et -> puan 15 -> 10 (<15, >=10) -> 7 günlük askı KALKAR, 3 günlük susturma HALA DESTEKLENİR (kalır!)
    const c1 = warningStore.cancelWarning(w1.record.id, {
      actorId: DEV_ID,
      actorName: 'DevKurucu',
      cancelReason: 'Hatali kayit, ilk madde geri cekildi.',
      nowTs: now + 500,
      memberStore,
      chatModStore,
    });
    assert.equal(c1.summary.totalPoints, 10);
    assert.equal(c1.summary.tier, 3);
    assert.equal(memberStore.findById(mCan.member.id).status, 'active');
    assert.ok(chatModStore.getActiveSanction(mCan.unifiedId, now + 600), 'Puan hala 10 oldugundan susturma kalmali');

    // Şimdi w2'yi iptal et -> puan 10 -> 5 (<10) -> 3 günlük susturma da KALKAR!
    const c2 = warningStore.cancelWarning(w2.record.id, {
      actorId: DEV_ID,
      actorName: 'DevKurucu',
      cancelReason: 'Ikinci madde de iptal edildi.',
      nowTs: now + 700,
      memberStore,
      chatModStore,
    });
    assert.equal(c2.summary.totalPoints, 5);
    assert.equal(c2.summary.tier, 1);
    assert.equal(chatModStore.getActiveSanction(mCan.unifiedId, now + 800), null);

    // İki ayrı kalıcı yasak (M2 + M9): birincisi iptal edilince yasak kalır, ikincisi iptal edilince yasak + bannedSub kalkar!
    const mDoubleBan = createTestGoogleMember({ nickname: 'CiftYasakUye' });
    const b1 = warningStore.issueWarning({ memberId: mDoubleBan.member.id, type: 'official', ruleCode: 'M2', reason: 'ban1', actorId: DEV_ID, nowTs: now, memberStore, chatModStore });
    const b2 = warningStore.issueWarning({ memberId: mDoubleBan.member.id, type: 'official', ruleCode: 'M9', reason: 'ban2', actorId: DEV_ID, nowTs: now + 50, memberStore, chatModStore });

    warningStore.cancelWarning(b1.record.id, { actorId: DEV_ID, cancelReason: 'Ilk yasak iptal', nowTs: now + 100, memberStore, chatModStore });
    assert.equal(memberStore.findById(mDoubleBan.member.id).status, 'banned', 'Diger aktif M9 yasagi destekledigi icin yasak kalmali');
    assert.equal(memberStore.isGoogleSubBanned(mDoubleBan.sub), true);

    warningStore.cancelWarning(b2.record.id, { actorId: DEV_ID, cancelReason: 'Ikinci yasak da iptal', nowTs: now + 150, memberStore, chatModStore });
    assert.equal(memberStore.findById(mDoubleBan.member.id).status, 'active');
    assert.equal(memberStore.isGoogleSubBanned(mDoubleBan.sub), false);

    // M4 + M10 aynı anda: M4 iptal edilince M10 hala aktif kalır
    const mDoubleMute = createTestGoogleMember({ nickname: 'CiftMuteUye' });
    const mu1 = warningStore.issueWarning({ memberId: mDoubleMute.member.id, type: 'official', ruleCode: 'M4', reason: 'm4', actorId: DEV_ID, nowTs: now, memberStore, chatModStore });
    warningStore.issueWarning({ memberId: mDoubleMute.member.id, type: 'official', ruleCode: 'M10', reason: 'm10', actorId: DEV_ID, nowTs: now + 20, memberStore, chatModStore });
    warningStore.cancelWarning(mu1.record.id, { actorId: DEV_ID, cancelReason: 'M4 iptal', nowTs: now + 50, memberStore, chatModStore });
    const stillMuted = chatModStore.getActiveSanction(mDoubleMute.unifiedId, now + 60);
    assert.ok(stillMuted && stillMuted.type === 'mute' && stillMuted.ruleCode === 'M10');
  });

  // --------------------------------------------------------------------------
  // 7) SOHBET YAPTIRIMI (DM + GENEL SOHBET) VE ASKIYA ALINMIŞ KISITLI OTURUM
  // --------------------------------------------------------------------------
  await t.test('7) Susturma DM ve Genel Sohbette yazmayı engeller (okuma açık); askı yalnız askı ekranı + /kurallar + bildirimlere izin verir', async () => {
    const mChat = createTestGoogleMember({ nickname: 'SohbetTestUye' });
    const chatJar = new CookieJar();
    const gCb = await loginAsGoogle(baseUrl, fakeGoogle, chatJar, mChat.sub, { ip: '10.2.0.70' });
    assert.equal(gCb.status, 302);
    assert.equal(gCb.location, '/');

    // Önce CSRF al (sohbet sayfasından)
    const chatPage = await httpReq(baseUrl, '/sohbet', { jar: chatJar, ip: '10.2.0.70' });
    assert.equal(chatPage.status, 200);
    const csrfMatch = chatPage.text.match(/data-csrf="([^"]+)"/i);
    const chatCsrf = csrfMatch ? csrfMatch[1] : '';
    assert.ok(chatCsrf);

    // Bir DM oluştur ve sohbet öncesi bir mesaj ekle
    const dmConvId = makeConvId(mChat.unifiedId, NORMAL_DISCORD_ID);
    chatStore.appendMessage(dmConvId, { from: NORMAL_DISCORD_ID, text: 'Selam okunabilir mesaj' });
    chatStore.appendMessage('group:genel', { from: NORMAL_DISCORD_ID, text: 'Genel sohbet okunabilir mesaj' });

    // M4 ile 2 gün sohbet susturma uygula
    warningStore.issueWarning({
      memberId: mChat.member.id,
      type: 'official',
      ruleCode: 'M4',
      reason: 'Hakaret sebebiyle susturuldu',
      actorId: DEV_ID,
      nowTs: Date.now(),
      memberStore,
      chatModStore,
    });

    // DM yazma -> 403 USER_MUTED (sanction.ruleCode ve sanction.reasonText döner)
    const dmSend = await httpReq(baseUrl, `/sohbet/api/sohbet/${encodeURIComponent(NORMAL_DISCORD_ID)}/mesaj`, {
      method: 'POST',
      jar: chatJar,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': chatCsrf },
      body: JSON.stringify({ text: 'DM yazmaya calisiyorum' }),
      ip: '10.2.0.70',
    });
    assert.equal(dmSend.status, 403);
    assert.equal(dmSend.json.code, 'USER_MUTED');
    assert.equal(dmSend.json.sanction.ruleCode, 'M4');
    assert.match(dmSend.json.sanction.reasonText, /Hakaret sebebiyle/);

    // Genel Sohbet yazma -> 403 USER_MUTED
    const grpSend = await httpReq(baseUrl, '/sohbet/api/grup/genel/mesaj', {
      method: 'POST',
      jar: chatJar,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': chatCsrf },
      body: JSON.stringify({ text: 'Gruba yazmaya calisiyorum' }),
      ip: '10.2.0.70',
    });
    assert.equal(grpSend.status, 403);
    assert.equal(grpSend.json.code, 'USER_MUTED');
    assert.equal(grpSend.json.sanction.ruleCode, 'M4');

    // Okuma İZİNLİ (DM + Genel Sohbet)
    const dmRead = await httpReq(baseUrl, `/sohbet/api/sohbet/${encodeURIComponent(NORMAL_DISCORD_ID)}/mesajlar`, {
      jar: chatJar,
      headers: { Accept: 'application/json' },
      ip: '10.2.0.70',
    });
    assert.equal(dmRead.status, 200);
    const grpRead = await httpReq(baseUrl, '/sohbet/api/grup/genel/mesajlar', {
      jar: chatJar,
      headers: { Accept: 'application/json' },
      ip: '10.2.0.70',
    });
    assert.equal(grpRead.status, 200);

    // Şimdi 15 puan ver -> 7 gün Hesap Askıya Alma!
    for (let i = 0; i < 3; i += 1) {
      warningStore.issueWarning({
        memberId: mChat.member.id,
        type: 'official',
        ruleCode: 'M8',
        reason: `Aski esigi ${i + 1}`,
        actorId: DEV_ID,
        nowTs: Date.now() + i * 10,
        memberStore,
        chatModStore,
      });
    }
    assert.equal(memberStore.findById(mChat.member.id).status, 'suspended');

    // Askıdaki üye yeni bir tarayıcıdan giriş yapabilir -> /giris/askida
    const suspJar = new CookieJar();
    const suspCb = await loginAsGoogle(baseUrl, fakeGoogle, suspJar, mChat.sub, { ip: '10.2.0.71' });
    assert.equal(suspCb.status, 302);
    assert.equal(suspCb.location, '/giris/askida');

    // Askı ekranı (403) + Genel Kurallar linki + kendi bildirim kartı görünür
    const askiPage = await httpReq(baseUrl, '/giris/askida', { jar: suspJar, ip: '10.2.0.71' });
    assert.equal(askiPage.status, 403);
    assert.match(askiPage.text, /\/kurallar/);
    assert.match(askiPage.text, /\/yasal\/kvkk-basvuru/);
    assert.match(askiPage.text, /id="siteWarningNoticesContainer"/);

    // Askıdaki üye /kurallar ve /api/uyari-bildirimleri'ne ERİŞEBİLİR!
    const rulesRes = await httpReq(baseUrl, '/kurallar', { jar: suspJar, ip: '10.2.0.71' });
    assert.equal(rulesRes.status, 200);
    const notifsRes = await httpReq(baseUrl, '/api/uyari-bildirimleri', {
      jar: suspJar,
      headers: { Accept: 'application/json' },
      ip: '10.2.0.71',
    });
    assert.equal(notifsRes.status, 200);
    assert.ok(notifsRes.json.notices.length >= 1);

    // Askıdaki üye /sohbet, /profil ve / adreslerine ERİŞEMEZ (/giris/askida'ya yönlenir; JSON'da 403 ACCOUNT_SUSPENDED)
    const blkChat = await httpReq(baseUrl, '/sohbet', { jar: suspJar, ip: '10.2.0.71' });
    assert.equal(blkChat.status, 302);
    assert.equal(blkChat.location, '/giris/askida');
    const blkProfile = await httpReq(baseUrl, '/profil', { jar: suspJar, ip: '10.2.0.71' });
    assert.equal(blkProfile.status, 302);
    assert.equal(blkProfile.location, '/giris/askida');
    const blkHome = await httpReq(baseUrl, '/', { jar: suspJar, ip: '10.2.0.71' });
    assert.equal(blkHome.status, 302);
    assert.equal(blkHome.location, '/giris/askida');
    const blkJson = await httpReq(baseUrl, '/sohbet/api/sohbetler', {
      jar: suspJar,
      headers: { Accept: 'application/json' },
      ip: '10.2.0.71',
    });
    assert.equal(blkJson.status, 403);
    assert.equal(blkJson.json.code, 'ACCOUNT_SUSPENDED');
  });

  // --------------------------------------------------------------------------
  // 8) BİLDİRİM KARTI (SSR + CANLI SSE + KAPATMA), KANIT GİZLİLİĞİ VE PROFİLDE KART YOK
  // --------------------------------------------------------------------------
  await t.test('8) Bildirim kartı (SSR + canlı SSE + tek seferlik kapatma), kanıt asla sızmaz ve profilde disiplin kartı yok', async () => {
    const mNotif = createTestGoogleMember({ nickname: 'BildirimUye' });
    const notifJar = new CookieJar();
    const cb = await loginAsGoogle(baseUrl, fakeGoogle, notifJar, mNotif.sub, { ip: '10.2.0.80' });
    assert.equal(cb.status, 302);

    // Profilde "Disiplin & Güvenlik Durumu" kartı GÖSTERİLMEZ!
    const profRes = await httpReq(baseUrl, '/profil', { jar: notifJar, ip: '10.2.0.80' });
    assert.equal(profRes.status, 200);
    assert.doesNotMatch(profRes.text, /Disiplin &amp; Güvenlik Durumu|Disiplin & Güvenlik Durumu/i);
    const notifCsrf = (profRes.text.match(/data-csrf="([^"]+)"/i) || [])[1];
    assert.ok(notifCsrf);

    // Canlı SSE bağlantısı aç (/api/uyari-bildirimleri/akis)
    const ssePromise = new Promise((resolve, reject) => {
      const req = http.get(
        `${baseUrl}/api/uyari-bildirimleri/akis`,
        {
          headers: { Cookie: notifJar.header(), 'X-Forwarded-For': '10.2.0.80' },
        },
        (res) => {
          assert.equal(res.statusCode, 200);
          let buf = '';
          res.on('data', (chunk) => {
            buf += chunk.toString('utf8');
            if (buf.includes('event: site_warning')) {
              req.destroy();
              resolve(buf);
            }
          });
        }
      );
      req.on('error', (e) => {
        if (e.code !== 'ECONNRESET') reject(e);
      });
      setTimeout(() => {
        req.destroy();
        reject(new Error('SSE site_warning timeout'));
      }, 4000);
    });

    // SSE bağlansın diye kısa bekleme, ardından Developer kanıt görselli + URL'li resmi uyarı versin
    await new Promise((r) => setTimeout(r, 120));
    const warnPage = await httpReq(baseUrl, '/yonetim/uyari', { jar: devJar, ip: '10.1.0.1' });
    const devCsrf = extractInputVal(warnPage.text, '_csrf');
    const siteIdem = extractFormIdemKey(warnPage.text, 'siteAdminWarnForm');

    const mp = buildMultipart(
      {
        _csrf: devCsrf,
        _idempotencyKey: siteIdem,
        siteTargetMemberId: mNotif.member.id,
        siteWarnType: 'official',
        siteRuleCode: 'M1',
        siteWarnReason: 'Canli SSE uyari sebebi',
        siteEvidenceUrlInput: 'https://example.com/secret-staff-proof.png',
      },
      { field: 'evidenceFile', filename: 'kanit.png', contentType: 'image/png', buffer: VALID_PNG_BUF }
    );
    const issueRes = await httpReq(
      baseUrl,
      `/yonetim/site-uyari?_csrf=${encodeURIComponent(devCsrf)}&_idempotencyKey=${encodeURIComponent(siteIdem)}`,
      {
        method: 'POST',
        jar: devJar,
        headers: { Accept: 'application/json', 'Content-Type': mp.contentType },
        body: mp.body,
        ip: '10.1.0.1',
      }
    );
    assert.equal(issueRes.status, 200);
    assert.equal(issueRes.json.ok, true);
    const evidenceFileUrl = issueRes.json.record.evidenceFileUrl;
    assert.ok(evidenceFileUrl && evidenceFileUrl.startsWith('/yonetim/site-uyari/kanit/warn_ev_'));

    // Canlı SSE olayı geldi ve KANIT BİLGİSİ İÇERMİYOR!
    const sseChunk = await ssePromise;
    assert.match(sseChunk, /event: site_warning/);
    assert.match(sseChunk, /Canli SSE uyari sebebi/);
    assert.doesNotMatch(sseChunk, /warn_ev_/);
    assert.doesNotMatch(sseChunk, /secret-staff-proof/);

    // Üye /kurallar'ı açtığında SSR bildirim kartı görünür ve kanıt içermez
    const memberHtml = await httpReq(baseUrl, '/kurallar', { jar: notifJar, ip: '10.2.0.80' });
    assert.equal(memberHtml.status, 200);
    assert.match(memberHtml.text, /id="siteWarningNoticesContainer"/);
    assert.match(memberHtml.text, /Canli SSE uyari sebebi/);
    assert.doesNotMatch(memberHtml.text, /warn_ev_/);
    assert.doesNotMatch(memberHtml.text, /secret-staff-proof/);

    // Bildirim API'sinde de kanıt alanları yok; kapatınca bir daha gelmez
    const apiList1 = await httpReq(baseUrl, '/api/uyari-bildirimleri', { jar: notifJar, ip: '10.2.0.80' });
    assert.equal(apiList1.json.notices.length, 1);
    const n = apiList1.json.notices[0];
    assert.equal(n.ruleCode, 'M1');
    assert.equal(n.reason, 'Canli SSE uyari sebebi');
    assert.equal(n.evidence, undefined);
    assert.equal(n.evidenceUrl, undefined);

    const dismissRes = await httpReq(baseUrl, `/api/uyari-bildirimleri/${encodeURIComponent(n.id)}/kapat`, {
      method: 'POST',
      jar: notifJar,
      headers: { Accept: 'application/json', 'X-CSRF-Token': notifCsrf },
      ip: '10.2.0.80',
    });
    assert.equal(dismissRes.status, 200);
    assert.equal(dismissRes.json.dismissed, true);

    const apiList2 = await httpReq(baseUrl, '/api/uyari-bildirimleri', { jar: notifJar, ip: '10.2.0.80' });
    assert.equal(apiList2.json.notices.length, 0);
  });

  // --------------------------------------------------------------------------
  // 9) KANIT DOĞRULAMA/ERİŞİM, ÇİFT GÖNDERİM (409), SAKLAMA SÜRESİ, HESAP SİLME & İÇERİKSİZ DENETİM
  // --------------------------------------------------------------------------
  await t.test('9) Kanıt magic-byte/yetki, çift gönderim (409), 6/12 ay saklama temizliği, hesap silme ve içeriksiz denetim kaydı', async () => {
    const warnPage = await httpReq(baseUrl, '/yonetim/uyari', { jar: devJar, ip: '10.1.0.1' });
    const devCsrf = extractInputVal(warnPage.text, '_csrf');
    let idem = extractFormIdemKey(warnPage.text, 'siteAdminWarnForm');

    // Geçerli JPG ve WEBP kabul; sahte PNG / SVG dosya / SVG URL / >5 MB red!
    const badFakePng = buildMultipart(
      { _csrf: devCsrf, _idempotencyKey: idem, siteTargetMemberId: mBeta.member.id, siteWarnType: 'official', siteRuleCode: 'M1', siteWarnReason: 'sahte' },
      { field: 'evidenceFile', filename: 'evil.png', contentType: 'image/png', buffer: Buffer.from('<script>alert(1)</script>') }
    );
    const rBadPng = await httpReq(baseUrl, `/yonetim/site-uyari?_csrf=${encodeURIComponent(devCsrf)}&_idempotencyKey=${encodeURIComponent(idem)}`, {
      method: 'POST',
      jar: devJar,
      headers: { Accept: 'application/json', 'Content-Type': badFakePng.contentType },
      body: badFakePng.body,
      ip: '10.1.0.1',
    });
    assert.equal(rBadPng.status, 400);
    idem = rBadPng.json.nextIdempotencyKey;

    const badSvgUrl = await httpReq(baseUrl, `/yonetim/site-uyari?_csrf=${encodeURIComponent(devCsrf)}&_idempotencyKey=${encodeURIComponent(idem)}`, {
      method: 'POST',
      jar: devJar,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteTargetMemberId: mBeta.member.id, siteWarnType: 'official', siteRuleCode: 'M1', siteEvidenceUrlInput: 'https://evil.test/x.svg' }),
      ip: '10.1.0.1',
    });
    assert.equal(badSvgUrl.status, 400);
    idem = badSvgUrl.json.nextIdempotencyKey;

    // 5 MB üstü dosya reddedilir
    const bigBuf = Buffer.concat([VALID_PNG_BUF, Buffer.alloc(5 * 1024 * 1024 + 64)]);
    const bigMp = buildMultipart(
      { _csrf: devCsrf, _idempotencyKey: idem, siteTargetMemberId: mBeta.member.id, siteWarnType: 'official', siteRuleCode: 'M1' },
      { field: 'evidenceFile', filename: 'huge.png', contentType: 'image/png', buffer: bigBuf }
    );
    const rBig = await httpReq(baseUrl, `/yonetim/site-uyari?_csrf=${encodeURIComponent(devCsrf)}&_idempotencyKey=${encodeURIComponent(idem)}`, {
      method: 'POST',
      jar: devJar,
      headers: { Accept: 'application/json', 'Content-Type': bigMp.contentType },
      body: bigMp.body,
      ip: '10.1.0.1',
    });
    assert.equal(rBig.status, 400);
    idem = rBig.json.nextIdempotencyKey;

    // Geçerli JPG + çift gönderim (aynı idempotency key -> 409!)
    const goodJpgMp = buildMultipart(
      { _csrf: devCsrf, _idempotencyKey: idem, siteTargetMemberId: mBeta.member.id, siteWarnType: 'official', siteRuleCode: 'D1', siteWarnReason: 'OzelGizliGerekceMetni999' },
      { field: 'evidenceFile', filename: 'ok.jpg', contentType: 'image/jpeg', buffer: VALID_JPG_BUF }
    );
    const rOkJpg = await httpReq(baseUrl, `/yonetim/site-uyari?_csrf=${encodeURIComponent(devCsrf)}&_idempotencyKey=${encodeURIComponent(idem)}`, {
      method: 'POST',
      jar: devJar,
      headers: { Accept: 'application/json', 'Content-Type': goodJpgMp.contentType },
      body: goodJpgMp.body,
      ip: '10.1.0.1',
    });
    assert.equal(rOkJpg.status, 200);
    const evUrl = rOkJpg.json.record.evidenceFileUrl;
    const evName = evUrl.split('/').pop();
    assert.match(evName, EVIDENCE_FILENAME_RE);

    // Aynı idempotency anahtarıyla tekrar gönderim -> 409!
    const rDup = await httpReq(baseUrl, `/yonetim/site-uyari?_csrf=${encodeURIComponent(devCsrf)}&_idempotencyKey=${encodeURIComponent(idem)}`, {
      method: 'POST',
      jar: devJar,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteTargetMemberId: mBeta.member.id, siteWarnType: 'official', siteRuleCode: 'D1' }),
      ip: '10.1.0.1',
    });
    assert.equal(rDup.status, 409);

    // WEBP doğrudan birim doğrulama
    const savedWebp = warningStore.saveEvidenceFile(VALID_WEBP_BUF, 'image/webp', 'proof.webp');
    assert.ok(savedWebp.fileName.endsWith('.webp'));

    // Kanıt indirme yetkisi: Developer & Yönetmenlik -> 200 + private/nosniff; diğer herkes -> 401/403!
    const evDev = await httpReq(baseUrl, evUrl, { jar: devJar, ip: '10.1.0.1' });
    assert.equal(evDev.status, 200);
    assert.equal(evDev.headers.get('x-content-type-options'), 'nosniff');
    assert.match(evDev.headers.get('cache-control') || '', /private, no-store/i);

    const evYon = await httpReq(baseUrl, evUrl, { jar: yonJar, ip: '10.1.0.2' });
    assert.equal(evYon.status, 200);

    // Taze Community Official ve normal üye oturumlarıyla kanıt dosyasına 403 doğrulaması
    const freshModJar = await loginAsDiscord(baseUrl, new CookieJar(), COMM_OFFICIAL_ID, 'ModVeli', '10.1.0.33');
    const freshNormJar = await loginAsDiscord(baseUrl, new CookieJar(), NORMAL_DISCORD_ID, 'NormalDiscordUye', '10.1.0.34');
    assert.equal((await httpReq(baseUrl, evUrl, { ip: '10.1.0.99' })).status, 401);
    assert.equal((await httpReq(baseUrl, evUrl, { jar: alphaJar, ip: '10.2.0.1' })).status, 403);
    assert.equal((await httpReq(baseUrl, evUrl, { jar: freshModJar, ip: '10.1.0.33' })).status, 403);
    assert.equal((await httpReq(baseUrl, evUrl, { jar: freshNormJar, ip: '10.1.0.34' })).status, 403);

    // 6 ay (180g) kanıt silme + 12 ay (365g) kayıt & denetim temizliği (izole depo + sahte saat)
    const retStore = new SiteWarningStore({ baseDir: path.join(tmpRoot, 'warnings-ret') });
    const tStart = Date.now() - 500 * DAY_MS;
    const mRet = createTestGoogleMember({ nickname: 'SaklamaUye', nowMs: tStart - DAY_MS });
    const wRet = retStore.issueWarning({
      memberId: mRet.member.id,
      type: 'official',
      ruleCode: 'D1',
      reason: 'SaklamaGizliMetin',
      evidenceBuffer: VALID_PNG_BUF,
      evidenceMime: 'image/png',
      evidenceOrigName: 'ret.png',
      actorId: DEV_ID,
      nowTs: tStart,
      memberStore,
      chatModStore,
    });
    const retEvFile = path.join(retStore.evidenceDir, wRet.record.evidence.fileName);
    assert.equal(fs.existsSync(retEvFile), true);

    // +181 gün -> kanıt fiziksel olarak silinir, kayıt (af olmuş) 12 ay daha tutulur
    const st181 = retStore.runMaintenance({ nowTs: tStart + 181 * DAY_MS, memberStore, chatModStore });
    assert.equal(st181.purgedEvidenceFiles, 1);
    assert.equal(fs.existsSync(retEvFile), false);
    assert.equal(retStore.getMemberSummary(mRet.member.id, { nowTs: tStart + 181 * DAY_MS, memberStore }).totalRecordsCount, 1);

    // +366 gün (af sonrası 365+ gün) -> kayıt ve eski denetim satırları silinir!
    const st550 = retStore.runMaintenance({ nowTs: tStart + 550 * DAY_MS, memberStore, chatModStore });
    assert.ok(st550.purgedRecords >= 1);
    assert.ok(st550.purgedAuditEntries >= 1);
    assert.equal(retStore.getMemberSummary(mRet.member.id, { nowTs: tStart + 550 * DAY_MS, memberStore }).totalRecordsCount, 0);

    // Hesap silme (POST /profil/hesap-sil): uyarı kayıtları + kanıt dosyası silinir, denetim kaydı kimliksizleşir!
    const mDel = createTestGoogleMember({ nickname: 'SilinecekUye' });
    const delJar = new CookieJar();
    await loginAsGoogle(baseUrl, fakeGoogle, delJar, mDel.sub, { ip: '10.2.0.88' });
    const wDel = warningStore.issueWarning({
      memberId: mDel.member.id,
      type: 'official',
      ruleCode: 'M1',
      reason: 'SilinecekUyeGerekceXYZ',
      evidenceBuffer: VALID_PNG_BUF,
      evidenceMime: 'image/png',
      evidenceOrigName: 'del.png',
      actorId: DEV_ID,
      nowTs: Date.now(),
      memberStore,
      chatModStore,
    });
    const delEvPath = path.join(warningStore.evidenceDir, wDel.record.evidence.fileName);
    assert.equal(fs.existsSync(delEvPath), true);

    // Hesap silme öncesi yeniden Google doğrulaması (?purpose=reauth_delete)
    const reauthCb = await loginAsGoogle(baseUrl, fakeGoogle, delJar, mDel.sub, {
      query: '?purpose=reauth_delete',
      ip: '10.2.0.88',
    });
    assert.equal(reauthCb.status, 302);
    const delProf = await httpReq(baseUrl, '/profil', { jar: delJar, ip: '10.2.0.88' });
    const delCsrf = extractInputVal(delProf.text, '_csrf');
    const delRes = await httpReq(baseUrl, '/profil/hesap-sil', {
      method: 'POST',
      jar: delJar,
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        _csrf: delCsrf,
        confirmDisplayName: mDel.member.displayName,
      }).toString(),
      ip: '10.2.0.88',
    });
    assert.equal(delRes.status, 200);
    assert.equal(delRes.json.deleted, true);
    assert.equal(fs.existsSync(delEvPath), false, 'Hesap silinince uyari kanit dosyasi da silinmeli');
    assert.equal(warningStore.getMemberSummary(mDel.member.id, { memberStore }).totalRecordsCount, 0);
    assert.equal(warningStore.getUnreadNotifications(mDel.member.id).length, 0);

    // Denetim kaydı (audit.jsonl): gerekçe, iptal gerekçesi, kanıt dosya adı, e-posta, googleName ve silinen üyenin ID'si ASLA bulunmamalı!
    const rawAudit = fs.readFileSync(warningStore.auditFile, 'utf8');
    assert.match(rawAudit, /member_warning_links_purged/);
    assert.doesNotMatch(rawAudit, /OzelGizliGerekceMetni999/);
    assert.doesNotMatch(rawAudit, /Hatali kayit, ilk madde geri cekildi/);
    assert.doesNotMatch(rawAudit, /SilinecekUyeGerekceXYZ/);
    assert.doesNotMatch(rawAudit, /warn_ev_/);
    assert.doesNotMatch(rawAudit, /secret-staff-proof/);
    assert.doesNotMatch(rawAudit, /@example\.com/);
    assert.doesNotMatch(rawAudit, /Gizli Alpha Ad/);
    assert.ok(!rawAudit.includes(mDel.member.id), 'Silinen uyenin IDsi denetim kaydindan temizlenmis olmali');
  });

  // --------------------------------------------------------------------------
  // 10) TR/EN LOCALE EŞLİĞİ VE YENİ KODDA SABİT #HEX RENK YASAĞI
  // --------------------------------------------------------------------------
  await t.test('10) TR/EN siteWarn locale eşliği ve yeni dosyalarda sabit #hex renk yasağı', () => {
    const tr = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', 'tr.json'), 'utf8'));
    const en = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', 'en.json'), 'utf8'));
    const trKeys = Object.keys(tr.siteWarn || {}).sort();
    const enKeys = Object.keys(en.siteWarn || {}).sort();
    assert.deepEqual(trKeys, enKeys);
    assert.ok(trKeys.length >= 60);

    const filesToCheck = [
      path.join(__dirname, '..', 'public', 'js', 'admin-site-warn.js'),
      path.join(__dirname, '..', 'public', 'js', 'warning-notices.js'),
      path.join(__dirname, '..', 'views', 'partials', 'warning-notices.ejs'),
    ];
    const hexRe = /#[0-9a-fA-F]{3,8}\b/g;
    for (const f of filesToCheck) {
      const content = fs.readFileSync(f, 'utf8');
      const matches = content.match(hexRe) || [];
      assert.deepEqual(matches, [], `Sabit #hex renk bulunmamalı: ${path.basename(f)}`);
    }

    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
    const sec23Idx = css.indexOf('23. SİTE (GOOGLE) ÜYELERİ UYARI');
    assert.ok(sec23Idx > 0, 'style.css Bölüm 23 bulunmalı');
    assert.deepEqual(css.slice(sec23Idx).match(hexRe) || [], [], 'style.css Bölüm 23 sabit #hex içermemeli');
  });
});
