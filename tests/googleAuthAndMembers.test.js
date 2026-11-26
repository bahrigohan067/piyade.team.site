const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const appConfig = require('../config/app.config');
const authConfig = require('../config/auth.config');
const botApiClient = require('../services/botApiClient');
const discordAuthService = require('../services/discordAuthService');
const googleAuthService = require('../services/googleAuthService');
const { MemberStore, setDefaultMemberStore, toUnifiedGoogleId } = require('../services/memberStore');
const { ChatStore, setDefaultChatStore } = require('../services/chatStore');
const { ChatModStore, setDefaultChatModStore } = require('../services/chatModStore');
const { createServerApp } = require('../server');

// ============================================================================
// YARDIMCI ARAÇLAR: SAHTE GOOGLE OIDC (GERÇEK RSA + JWKS), SAHTE BOT API & ÇEREZ
// ============================================================================

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function createFakeGoogleOidcServer() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'test-google-key-1';
  const publicJwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid,
    alg: 'RS256',
    use: 'sig',
  };

  let nextTokenOverrides = {};
  let expectedCodeVerifier = null;
  let forceTokenError = false;
  let lastAuthorizeParams = null;

  function signJwt(payload, customKey = privateKey, customKid = kid) {
    const header = { alg: 'RS256', typ: 'JWT', kid: customKid };
    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signingInput);
    signer.end();
    const signature = signer.sign(customKey);
    return `${signingInput}.${base64UrlEncode(signature)}`;
  }

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname === '/jwks') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
      });
      return res.end(JSON.stringify({ keys: [publicJwk] }));
    }

    if (u.pathname === '/token' && req.method === 'POST') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        if (forceTokenError) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'invalid_grant' }));
        }
        const rawBody = Buffer.concat(chunks).toString('utf8');
        const params = new URLSearchParams(rawBody);
        const codeVerifier = params.get('code_verifier') || '';

        if (expectedCodeVerifier && codeVerifier !== expectedCodeVerifier) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'PKCE mismatch' }));
        }

        // Eğer authorization sırasında code_challenge geldiyse PKCE S256 doğrula
        if (lastAuthorizeParams && lastAuthorizeParams.codeChallenge) {
          const computed = base64UrlEncode(crypto.createHash('sha256').update(codeVerifier).digest());
          if (computed !== lastAuthorizeParams.codeChallenge) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'PKCE challenge failed' }));
          }
        }

        const nowSec = Math.floor(Date.now() / 1000);
        const baseClaims = {
          iss: nextTokenOverrides.iss ?? `http://127.0.0.1:${server.address().port}`,
          aud: nextTokenOverrides.aud ?? process.env.GOOGLE_CLIENT_ID,
          sub: nextTokenOverrides.sub ?? 'google-sub-default',
          email: nextTokenOverrides.email ?? 'oyuncu@example.com',
          email_verified: nextTokenOverrides.email_verified ?? true,
          name: nextTokenOverrides.name ?? 'Gizli Google Adi',
          picture: nextTokenOverrides.picture ?? 'https://lh3.googleusercontent.com/should-never-be-saved.jpg',
          nonce: nextTokenOverrides.nonce ?? (lastAuthorizeParams && lastAuthorizeParams.nonce) ?? '',
          iat: nowSec,
          exp: nextTokenOverrides.exp ?? nowSec + 3600,
        };

        const idToken = signJwt(baseClaims, nextTokenOverrides.customKey || privateKey, nextTokenOverrides.customKid || kid);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ access_token: 'fake-access-token', id_token: idToken }));
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return {
    server,
    signJwt,
    setNextToken(overrides = {}) {
      nextTokenOverrides = overrides;
    },
    setLastAuthorize(params) {
      lastAuthorizeParams = params;
    },
    setExpectedCodeVerifier(v) {
      expectedCodeVerifier = v;
    },
    setForceTokenError(flag) {
      forceTokenError = Boolean(flag);
    },
    async start() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address();
      return {
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        authUrl: `http://127.0.0.1:${port}/auth`,
        tokenUrl: `http://127.0.0.1:${port}/token`,
        jwksUrl: `http://127.0.0.1:${port}/jwks`,
        issuer: `http://127.0.0.1:${port}`,
      };
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function createFakeBotServer() {
  let offline = false;
  const siteClaims = new Map(); // robloxId -> ownerRef
  const discordRobloxIds = new Set(['999001']); // Discord'da kayıtlı örnek Roblox ID
  const lookupCalls = [];
  const claimCalls = [];
  const releaseCalls = [];

  const robloxUsers = {
    validuser: { id: '555001', username: 'ValidUser', displayName: 'Valid Display', avatarUrl: 'https://tr.rbxcdn.com/valid.png', profileUrl: 'https://www.roblox.com/users/555001/profile' },
    seconduser: { id: '555002', username: 'SecondUser', displayName: 'Second Display', avatarUrl: 'https://tr.rbxcdn.com/second.png', profileUrl: 'https://www.roblox.com/users/555002/profile' },
    editnewuser: { id: '555003', username: 'EditNewUser', displayName: 'Edit New', avatarUrl: 'https://tr.rbxcdn.com/edit.png', profileUrl: 'https://www.roblox.com/users/555003/profile' },
    conflictclaim: { id: '555099', username: 'ConflictClaim', displayName: 'Conflict', avatarUrl: 'https://tr.rbxcdn.com/conflict.png', profileUrl: 'https://www.roblox.com/users/555099/profile' },
    alreadyreg: { id: '999001', username: 'AlreadyReg', displayName: 'Already Reg', avatarUrl: 'https://tr.rbxcdn.com/already.png', profileUrl: 'https://www.roblox.com/users/999001/profile' },
  };
  let forceConflictRobloxId = null;

  const directoryMembers = [
    {
      id: '200000000000000001',
      displayName: 'DiscordOyuncu',
      discordAvatarUrl: 'https://cdn.discordapp.com/embed/avatars/1.png',
      robloxId: '999001',
      robloxUsername: 'AlreadyReg',
      robloxAvatarUrl: 'https://tr.rbxcdn.com/already.png',
      hasRoblox: true,
    },
  ];

  const server = http.createServer((req, res) => {
    if (offline) {
      res.destroy();
      return;
    }
    const u = new URL(req.url, 'http://127.0.0.1');
    const actorType = req.headers['x-actor-type'] || '';
    const actorId = req.headers['x-actor-id'] || '';

    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = {};
      try {
        if (chunks.length) body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch (_) {}

      const sendJson = (code, data) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };

      if (u.pathname === '/api/health') {
        return sendJson(200, { status: 'ok' });
      }

      if (u.pathname === '/api/games') {
        return sendJson(200, {
          games: [
            { id: 'roblox', emoji: '🧱', name: { tr: 'Roblox', en: 'Roblox' }, validate: { min: 3, max: 100, regex: null }, verifier: 'roblox' },
            { id: 'cs2', emoji: '🔫', name: { tr: 'CS2', en: 'CS2' }, validate: { min: 2, max: 32, regex: null }, verifier: null },
            { id: 'zula', emoji: '🪖', name: { tr: 'Zula', en: 'Zula' }, validate: { min: 2, max: 32, regex: null }, verifier: null },
            { id: 'minecraft', emoji: '⛏️', name: { tr: 'Minecraft', en: 'Minecraft' }, validate: { min: 3, max: 16, regex: '^[A-Za-z0-9_]{3,16}$' }, verifier: null },
          ],
        });
      }

      if (u.pathname === '/api/stats/summary') {
        return sendJson(200, { activeThisMonth: 12, playingNow: 3, computedAt: Date.now(), families: [] });
      }
      if (u.pathname === '/api/stats/top-games') {
        return sendJson(200, { scope: 'month', families: [], games: [], totalSeconds: 0 });
      }

      if (u.pathname.startsWith('/api/member/') && u.pathname.endsWith('/roles')) {
        const id = u.pathname.split('/')[3];
        if (id === '200000000000000001') {
          return sendJson(200, {
            id,
            displayName: 'DiscordOyuncu',
            roles: ['1559604702143062016'],
            level: 'registered',
            registered: true,
            highestRolePosition: 10,
          });
        }
        return sendJson(404, { error: 'Not found' });
      }

      if (u.pathname === '/api/roblox/lookup') {
        const q = String(u.searchParams.get('query') || '').trim().toLowerCase();
        const ignoreOwnerRef = String(u.searchParams.get('ignoreOwnerRef') || '').trim();
        lookupCalls.push({ q, actorType, actorId, ignoreOwnerRef });

        if (q === 'banneduser') return sendJson(200, { status: 'BANNED', user: null, alreadyRegistered: false });
        if (q === 'temperror') return sendJson(200, { status: 'TEMPORARY_ERROR', user: null, alreadyRegistered: false });
        const found = robloxUsers[q];
        if (!found) return sendJson(200, { status: 'NOT_FOUND', user: null, alreadyRegistered: false });

        const existingOwner = siteClaims.get(found.id);
        const already =
          discordRobloxIds.has(found.id) ||
          Boolean(existingOwner && (!ignoreOwnerRef || existingOwner !== ignoreOwnerRef));

        return sendJson(200, { status: 'FOUND', user: found, alreadyRegistered: already });
      }

      if (u.pathname.startsWith('/api/roblox/site-claims/')) {
        const robloxId = u.pathname.split('/').pop();
        if (req.method === 'PUT') {
          const ownerRef = String(body.ownerRef || '');
          claimCalls.push({ robloxId, ownerRef, actorType, actorId });
          if (forceConflictRobloxId === robloxId || (siteClaims.has(robloxId) && siteClaims.get(robloxId) !== ownerRef)) {
            return sendJson(409, { ok: false, code: 'ROBLOX_ALREADY_REGISTERED' });
          }
          siteClaims.set(robloxId, ownerRef);
          return sendJson(200, { ok: true, robloxId, ownerRef });
        }
        if (req.method === 'DELETE') {
          const ownerRef = String(body.ownerRef || '');
          releaseCalls.push({ robloxId, ownerRef, actorType, actorId });
          if (siteClaims.has(robloxId) && siteClaims.get(robloxId) !== ownerRef) {
            return sendJson(403, { ok: false, code: 'CLAIM_OWNER_MISMATCH' });
          }
          siteClaims.delete(robloxId);
          return sendJson(200, { ok: true, released: true });
        }
      }

      if (u.pathname === '/api/directory') {
        return sendJson(200, { items: directoryMembers, nextCursor: null, hasMore: false });
      }

      if (u.pathname === '/api/directory/lookup' && req.method === 'POST') {
        const ids = Array.isArray(body.ids) ? body.ids : [];
        const items = directoryMembers.filter((m) => ids.includes(m.id));
        return sendJson(200, { items });
      }

      return sendJson(404, { error: 'Not found' });
    });
  });

  return {
    server,
    siteClaims,
    lookupCalls,
    claimCalls,
    releaseCalls,
    setOffline(flag) {
      offline = Boolean(flag);
    },
    setForceConflictRobloxId(id) {
      forceConflictRobloxId = id;
    },
    async start() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address();
      return { port, url: `http://127.0.0.1:${port}` };
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

class CookieJar {
  constructor() {
    this.map = new Map();
  }
  updateFromResponse(res) {
    const setCookies = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    for (const raw of setCookies) {
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
  get(name) {
    return this.map.get(name) || '';
  }
  set(name, val) {
    this.map.set(name, val);
  }
  delete(name) {
    this.map.delete(name);
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
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {}
  return { status: res.status, headers: res.headers, location: res.headers.get('location') || '', text, json };
}

function extractHiddenInput(html, name) {
  const re = new RegExp(`name="${name}"[^>]*value="([^"]*)"`, 'i');
  const m = String(html || '').match(re);
  return m ? m[1] : '';
}

async function completeGoogleOAuth(baseUrl, fakeGoogle, jar, tokenOverrides = {}, { query = '', ip = null } = {}) {
  fakeGoogle.setNextToken(tokenOverrides);
  const startRes = await httpReq(baseUrl, `/auth/google${query}`, { jar, ip });
  assert.equal(startRes.status, 302);
  const authLocation = new URL(startRes.location);
  const state = authLocation.searchParams.get('state');
  const nonce = authLocation.searchParams.get('nonce');
  const codeChallenge = authLocation.searchParams.get('code_challenge');
  fakeGoogle.setLastAuthorize({ state, nonce, codeChallenge });

  const cbRes = await httpReq(
    baseUrl,
    `/auth/google/callback?code=fake-code-${Date.now()}&state=${encodeURIComponent(state)}`,
    { jar, ip }
  );
  return { startRes, authLocation, cbRes, state, nonce };
}

async function completeSignupForm(baseUrl, jar, fields = {}, { ip = null } = {}) {
  const pageRes = await httpReq(baseUrl, '/uye-ol', { jar, ip });
  assert.equal(pageRes.status, 200);
  const csrf = extractHiddenInput(pageRes.text, '_csrf');
  const idem = extractHiddenInput(pageRes.text, '_idempotencyKey');

  const form = new URLSearchParams();
  form.set('_csrf', csrf);
  form.set('_idempotencyKey', fields._idempotencyKey !== undefined ? fields._idempotencyKey : idem);
  form.set('ageGroup', fields.ageGroup !== undefined ? fields.ageGroup : '18_plus');
  if (fields.parentConsent) form.set('parentConsent', '1');
  if (fields.consent_kvkk_notice !== false) form.set('consent_kvkk_notice', '1');
  if (fields.consent_international_data_transfer !== false) form.set('consent_international_data_transfer', '1');
  if (fields.consent_general_rules !== false) form.set('consent_general_rules', '1');
  if (fields.consent_chat_moderation_review !== false) form.set('consent_chat_moderation_review', '1');
  if (fields.consent_chat_profile_game_usernames !== false) form.set('consent_chat_profile_game_usernames', '1');
  const games = fields.games || ['cs2'];
  for (const g of games) form.append('games', g);
  form.set('nickname', fields.nickname !== undefined ? fields.nickname : 'PiyadeKartal');
  const usernames = fields.usernames || { cs2: 'KartalCS2' };
  for (const [gid, uname] of Object.entries(usernames)) {
    form.set(`usernames[${gid}]`, uname);
  }

  const postRes = await httpReq(baseUrl, '/uye-ol', {
    method: 'POST',
    jar,
    ip,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  return { csrf, idem, postRes, formBody: form.toString() };
}

// ============================================================================
// ANA TEST PAKETİ
// ============================================================================

test('Google ile Devam Et — Uçtan Uca Güvenlik, Sihirbaz, Profil, Sohbet ve Hesap Silme Testleri', async (t) => {
  const prevEnv = { ...process.env };
  const prevBotUrl = appConfig.BOT_API_URL;
  const prevExchange = discordAuthService.exchangeCodeForToken;
  const prevFetchDiscord = discordAuthService.fetchDiscordUser;

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piyade-google-test-'));
  const memberStore = new MemberStore({ baseDir: path.join(tmpRoot, 'members') });
  const chatStore = new ChatStore({ baseDir: path.join(tmpRoot, 'chat'), silentWarning: true });
  const chatModStore = new ChatModStore({ baseDir: path.join(tmpRoot, 'chat') });
  setDefaultMemberStore(memberStore);
  setDefaultChatStore(chatStore);
  setDefaultChatModStore(chatModStore);

  const fakeGoogle = createFakeGoogleOidcServer();
  const fakeBot = createFakeBotServer();
  const gEndpoints = await fakeGoogle.start();
  const botInfo = await fakeBot.start();

  process.env.NODE_ENV = 'test';
  process.env.CHAT_ENABLED = 'true';
  process.env.BASE_URL = 'http://127.0.0.1:0';
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  process.env.GOOGLE_TEST_AUTH_URL = gEndpoints.authUrl;
  process.env.GOOGLE_TEST_TOKEN_URL = gEndpoints.tokenUrl;
  process.env.GOOGLE_TEST_JWKS_URL = gEndpoints.jwksUrl;
  process.env.GOOGLE_TEST_ISSUER = gEndpoints.issuer;
  process.env.NEW_MEMBER_RESTRICTION_HOURS = '24';
  process.env.SESSION_SECRET = 'test-session-secret-32-chars-minimum-12345';
  appConfig.BOT_API_URL = botInfo.url;
  googleAuthService.clearJwksCache();

  // Sahte Discord OAuth (mevcut akışı etkilemeden bağlama testi için)
  let mockDiscordUser = { id: '200000000000000001', username: 'discordoyuncu', global_name: 'DiscordOyuncu', avatar: null };
  discordAuthService.exchangeCodeForToken = async () => ({ access_token: 'mock-discord-access' });
  discordAuthService.fetchDiscordUser = async () => mockDiscordUser;

  const app = createServerApp();
  const siteServer = http.createServer(app);
  await new Promise((resolve) => siteServer.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${siteServer.address().port}`;
  process.env.BASE_URL = baseUrl;

  t.after(async () => {
    await new Promise((resolve) => siteServer.close(resolve));
    await fakeGoogle.close();
    await fakeBot.close();
    appConfig.BOT_API_URL = prevBotUrl;
    discordAuthService.exchangeCodeForToken = prevExchange;
    discordAuthService.fetchDiscordUser = prevFetchDiscord;
    for (const k of Object.keys(process.env)) {
      if (!(k in prevEnv)) delete process.env[k];
    }
    Object.assign(process.env, prevEnv);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  // 1) id_token doğrulaması & üretim ortamı kilitleri
  // --------------------------------------------------------------------------
  await t.test('1. id_token doğrulama (yanlış aud/iss/nonce/exp, email_verified=false, sahte imza, picture atılır, prod override kilidi)', async () => {
    // Üretim ortamında env geçersiz kılma ASLA çalışmaz
    const prodEndpoints = authConfig.getGoogleEndpoints({
      NODE_ENV: 'production',
      GOOGLE_TEST_TOKEN_URL: 'http://evil.local/token',
      GOOGLE_TEST_JWKS_URL: 'http://evil.local/jwks',
      GOOGLE_TEST_ISSUER: 'http://evil.local',
    });
    assert.equal(prodEndpoints.tokenUrl, 'https://oauth2.googleapis.com/token');
    assert.equal(prodEndpoints.jwksUrl, 'https://www.googleapis.com/oauth2/v3/certs');
    assert.deepEqual(prodEndpoints.issuers, ['https://accounts.google.com', 'accounts.google.com']);

    const nowSec = Math.floor(Date.now() / 1000);
    const validToken = fakeGoogle.signJwt({
      iss: gEndpoints.issuer,
      aud: process.env.GOOGLE_CLIENT_ID,
      sub: 'sub-unit-1',
      email: 'Test@Example.com',
      email_verified: true,
      name: 'Test Name',
      picture: 'https://lh3.googleusercontent.com/secret-pic.png',
      nonce: 'nonce-ok',
      exp: nowSec + 600,
    });
    const verified = await googleAuthService.verifyIdToken(validToken, { expectedNonce: 'nonce-ok' });
    assert.equal(verified.sub, 'sub-unit-1');
    assert.equal(verified.email, 'test@example.com');
    assert.equal('picture' in verified, false);

    // Yanlış aud
    const badAud = fakeGoogle.signJwt({
      iss: gEndpoints.issuer, aud: 'wrong-client', sub: 's1', email: 'a@b.c', email_verified: true, nonce: 'n1', exp: nowSec + 600,
    });
    await assert.rejects(() => googleAuthService.verifyIdToken(badAud, { expectedNonce: 'n1' }), { code: 'INVALID_AUDIENCE' });

    // Yanlış iss
    const badIss = fakeGoogle.signJwt({
      iss: 'https://evil.example', aud: process.env.GOOGLE_CLIENT_ID, sub: 's1', email: 'a@b.c', email_verified: true, nonce: 'n1', exp: nowSec + 600,
    });
    await assert.rejects(() => googleAuthService.verifyIdToken(badIss, { expectedNonce: 'n1' }), { code: 'INVALID_ISSUER' });

    // Yanlış nonce
    const badNonce = fakeGoogle.signJwt({
      iss: gEndpoints.issuer, aud: process.env.GOOGLE_CLIENT_ID, sub: 's1', email: 'a@b.c', email_verified: true, nonce: 'other', exp: nowSec + 600,
    });
    await assert.rejects(() => googleAuthService.verifyIdToken(badNonce, { expectedNonce: 'expected' }), { code: 'INVALID_NONCE' });

    // Süresi dolmuş exp
    const expiredTok = fakeGoogle.signJwt({
      iss: gEndpoints.issuer, aud: process.env.GOOGLE_CLIENT_ID, sub: 's1', email: 'a@b.c', email_verified: true, nonce: 'n1', exp: nowSec - 120,
    });
    await assert.rejects(() => googleAuthService.verifyIdToken(expiredTok, { expectedNonce: 'n1' }), { code: 'TOKEN_EXPIRED' });

    // email_verified: false
    const unverifiedEmail = fakeGoogle.signJwt({
      iss: gEndpoints.issuer, aud: process.env.GOOGLE_CLIENT_ID, sub: 's1', email: 'a@b.c', email_verified: false, nonce: 'n1', exp: nowSec + 600,
    });
    await assert.rejects(() => googleAuthService.verifyIdToken(unverifiedEmail, { expectedNonce: 'n1' }), { code: 'EMAIL_NOT_VERIFIED' });

    // Sahte RSA anahtarıyla imzalanmış JWT
    const { privateKey: attackerKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const badSig = fakeGoogle.signJwt({
      iss: gEndpoints.issuer, aud: process.env.GOOGLE_CLIENT_ID, sub: 's1', email: 'a@b.c', email_verified: true, nonce: 'n1', exp: nowSec + 600,
    }, attackerKey);
    await assert.rejects(() => googleAuthService.verifyIdToken(badSig, { expectedNonce: 'n1' }), { code: 'INVALID_SIGNATURE' });
  });

  // --------------------------------------------------------------------------
  // 2) OAuth state/PKCE ihlalleri, iptal, env eksikliği ve SEO noindex
  // --------------------------------------------------------------------------
  await t.test('2. State/PKCE ihlalleri, email_verified=false, env yoksa düğme gizlenmesi ve noindex/robots', async () => {
    const jar = new CookieJar();
    const loginPage = await httpReq(baseUrl, '/giris', { jar });
    assert.equal(loginPage.status, 200);
    assert.match(loginPage.headers.get('x-robots-tag') || '', /noindex/i);
    assert.match(loginPage.text, /\/auth\/google/);
    assert.match(loginPage.text, /\/auth\/discord/);

    // robots.txt Disallow kontrolü
    const robotsRes = await httpReq(baseUrl, '/robots.txt');
    assert.match(robotsRes.text, /Disallow:\s*\/giris/);
    assert.match(robotsRes.text, /Disallow:\s*\/uye-ol/);

    // State uyuşmazlığı -> 403
    const startRes = await httpReq(baseUrl, '/auth/google', { jar });
    assert.equal(startRes.status, 302);
    const authUrl = new URL(startRes.location);
    assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authUrl.searchParams.get('prompt'), 'select_account');
    assert.equal(authUrl.searchParams.get('scope'), 'openid email profile');

    const badStateRes = await httpReq(baseUrl, '/auth/google/callback?code=abc&state=wrong-state', { jar });
    assert.equal(badStateRes.status, 403);

    // PKCE ihlali -> 400 nazik sayfa
    fakeGoogle.setExpectedCodeVerifier('non-matching-verifier');
    const pkceFail = await completeGoogleOAuth(baseUrl, fakeGoogle, jar, { sub: 'sub-pkce' });
    assert.equal(pkceFail.cbRes.status, 400);
    fakeGoogle.setExpectedCodeVerifier(null);

    // email_verified: false -> 403 nazik sayfa
    const unv = await completeGoogleOAuth(baseUrl, fakeGoogle, jar, { sub: 'sub-unv', email_verified: false });
    assert.equal(unv.cbRes.status, 403);

    // GOOGLE_CLIENT_ID yokken düğme gizlenir ve /auth/google 404 verir
    const savedId = process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;
    const disabledGiris = await httpReq(baseUrl, '/giris');
    assert.equal(disabledGiris.status, 200);
    assert.equal(disabledGiris.text.includes('/auth/google'), false);
    const disabledAuth = await httpReq(baseUrl, '/auth/google');
    assert.equal(disabledAuth.status, 404);
    process.env.GOOGLE_CLIENT_ID = savedId;
  });

  // --------------------------------------------------------------------------
  // 3) Discord-var-mı akışı, kalıcı bağ kurma, çakışma (409) ve (b) dalı
  // --------------------------------------------------------------------------
  await t.test('3. Yeni kişi -> /giris/discord-var-mi, Discord bağlama, çakışma (409) ve otomatik Discord yönlendirme', async () => {
    const jar1 = new CookieJar();
    const { cbRes } = await completeGoogleOAuth(baseUrl, fakeGoogle, jar1, {
      sub: 'google-sub-discord-owner',
      email: 'discordowner@example.com',
      name: 'Discord Owner Google',
    });
    assert.equal(cbRes.status, 302);
    assert.equal(cbRes.location, '/giris/discord-var-mi');
    // Henüz kalıcı kayıt OLMAMALI
    assert.equal(memberStore.findByGoogleSub('google-sub-discord-owner'), null);

    // /giris/discord-var-mi sayfasını aç ve "Evet, Discord hesabım var" gönder
    const askPage = await httpReq(baseUrl, '/giris/discord-var-mi', { jar: jar1 });
    assert.equal(askPage.status, 200);
    const csrf = extractHiddenInput(askPage.text, '_csrf');

    const linkStart = await httpReq(baseUrl, '/giris/discord-var-mi/bagla', {
      method: 'POST',
      jar: jar1,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf }).toString(),
    });
    assert.equal(linkStart.status, 302);
    assert.equal(linkStart.location, '/auth/discord');

    // Discord OAuth tamamla
    const dStart = await httpReq(baseUrl, '/auth/discord', { jar: jar1 });
    assert.equal(dStart.status, 302);
    const dState = new URL(dStart.location).searchParams.get('state');
    const dCb = await httpReq(baseUrl, `/auth/discord/callback?code=dc-ok&state=${encodeURIComponent(dState)}`, { jar: jar1 });
    assert.equal(dCb.status, 302);
    assert.equal(memberStore.findLinkedDiscordByGoogleSub('google-sub-discord-owner'), '200000000000000001');

    // Sonraki Google girişinde (b) dalı otomatik /auth/discord'a yönlendirir
    const jarAgain = new CookieJar();
    const again = await completeGoogleOAuth(baseUrl, fakeGoogle, jarAgain, {
      sub: 'google-sub-discord-owner',
      email: 'discordowner@example.com',
    });
    assert.equal(again.cbRes.status, 302);
    assert.equal(again.cbRes.location, '/auth/discord');

    // ÇAKIŞMA: İkinci bir googleSub aynı Discord ID'ye bağlanmaya çalışırsa 409
    const jarConflict = new CookieJar();
    await completeGoogleOAuth(baseUrl, fakeGoogle, jarConflict, {
      sub: 'google-sub-second-attempt',
      email: 'second@example.com',
    });
    const ask2 = await httpReq(baseUrl, '/giris/discord-var-mi', { jar: jarConflict });
    const csrf2 = extractHiddenInput(ask2.text, '_csrf');
    await httpReq(baseUrl, '/giris/discord-var-mi/bagla', {
      method: 'POST',
      jar: jarConflict,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf2 }).toString(),
    });
    const dStart2 = await httpReq(baseUrl, '/auth/discord', { jar: jarConflict });
    const dState2 = new URL(dStart2.location).searchParams.get('state');
    const dCbConflict = await httpReq(baseUrl, `/auth/discord/callback?code=dc-conflict&state=${encodeURIComponent(dState2)}`, { jar: jarConflict });
    assert.equal(dCbConflict.status, 409);
  });

  // --------------------------------------------------------------------------
  // 4) /uye-ol sihirbaz doğrulamaları, Roblox durumları, claim çakışması, bot kapalı & oluşturma
  // --------------------------------------------------------------------------
  await t.test('4. /uye-ol sihirbazı: yaş engeli, veli kutusu, ayrı rızalar, küfür/link reddi, Roblox durumları, claim çakışması, bot kapalı, idempotency', async () => {
    // Bekleyen Google olmadan /uye-ol -> /giris
    const noPending = await httpReq(baseUrl, '/uye-ol');
    assert.equal(noPending.status, 302);
    assert.equal(noPending.location, '/giris');

    const jar = new CookieJar();
    await completeGoogleOAuth(baseUrl, fakeGoogle, jar, {
      sub: 'google-sub-wizard-1',
      email: 'wizard1@example.com',
      name: 'Wizard Secret Name',
      picture: 'https://lh3.googleusercontent.com/must-not-save.png',
    }, { ip: '10.10.1.1' });

    // (a) 13 yaş altı engellenir
    let res = await completeSignupForm(baseUrl, jar, { ageGroup: 'under_13' }, { ip: '10.10.1.1' });
    assert.equal(res.postRes.status, 400);

    // (b) 13-17 veli kutusu olmadan engellenir
    res = await completeSignupForm(baseUrl, jar, { ageGroup: '13_17', parentConsent: false }, { ip: '10.10.1.2' });
    assert.equal(res.postRes.status, 400);

    // (c) Zorunlu ayrı onaylardan biri (Madde C) eksikse engellenir
    res = await completeSignupForm(baseUrl, jar, { consent_international_data_transfer: false }, { ip: '10.10.1.3' });
    assert.equal(res.postRes.status, 400);

    // (d) Takma ad küfür / link / mention reddedilir
    for (const badNick of ['@everyone', 'gel https://test.com', 'discord.gg/davet', 'siktirgit']) {
      res = await completeSignupForm(baseUrl, jar, { nickname: badNick }, { ip: '10.10.1.4' });
      assert.equal(res.postRes.status, 400, `Bad nickname should fail: ${badNick}`);
    }

    // (e) Roblox lookup proxy (site-guest + HMAC actorId)
    const uyePage = await httpReq(baseUrl, '/uye-ol', { jar, ip: '10.10.1.5' });
    const csrf = extractHiddenInput(uyePage.text, '_csrf');
    for (const [q, expectedStatus, expectedAlready] of [
      ['ValidUser', 'FOUND', false],
      ['NoSuchPlayer', 'NOT_FOUND', false],
      ['BannedUser', 'BANNED', false],
      ['AlreadyReg', 'FOUND', true],
      ['TempError', 'TEMPORARY_ERROR', false],
    ]) {
      const r = await httpReq(baseUrl, `/uye-ol/roblox-kontrol?query=${encodeURIComponent(q)}`, {
        jar,
        ip: '10.10.1.5',
        headers: { Accept: 'application/json', 'X-CSRF-Token': csrf },
      });
      assert.equal(r.status, 200);
      assert.equal(r.json.status, expectedStatus);
      assert.equal(r.json.alreadyRegistered, expectedAlready);
    }
    const lastGuestCall = fakeBot.lookupCalls[fakeBot.lookupCalls.length - 1];
    assert.equal(lastGuestCall.actorType, 'site-guest');
    assert.match(lastGuestCall.actorId, /^g_[0-9a-f]{32}$/);

    // (f) Bot kapalıyken üyelik oluşturma ENGELLENİR (503)
    fakeBot.setOffline(true);
    res = await completeSignupForm(baseUrl, jar, { games: ['cs2', 'minecraft'], usernames: { cs2: 'CsNick', minecraft: 'Steve_06' } }, { ip: '10.10.1.6' });
    assert.equal(res.postRes.status, 503);
    assert.equal(memberStore.findByGoogleSub('google-sub-wizard-1'), null);
    fakeBot.setOffline(false);

    // (g) Roblox site-claims 409 çakışmasında üye OLUŞMAZ
    fakeBot.setForceConflictRobloxId('555099');
    res = await completeSignupForm(baseUrl, jar, {
      games: ['roblox'],
      usernames: { roblox: 'ConflictClaim' },
    }, { ip: '10.10.1.7' });
    assert.equal(res.postRes.status, 409);
    assert.equal(memberStore.findByGoogleSub('google-sub-wizard-1'), null);
    fakeBot.setForceConflictRobloxId(null);

    // (h) Geçerli 13-17 + veli izni + Roblox + Minecraft oluşturma başarılı
    const okRes = await completeSignupForm(baseUrl, jar, {
      ageGroup: '13_17',
      parentConsent: true,
      nickname: 'Kartal',
      games: ['roblox', 'minecraft'],
      usernames: { roblox: 'ValidUser', minecraft: 'Kartal_07' },
    }, { ip: '10.10.1.8' });
    assert.equal(okRes.postRes.status, 303);
    assert.equal(okRes.postRes.location, '/');
    assert.ok(jar.get('pw_remember'), 'pw_remember cookie should be set');

    const created = memberStore.findByGoogleSub('google-sub-wizard-1');
    assert.ok(created);
    assert.equal(created.displayName, 'Kartal | ValidUser');
    assert.equal('picture' in created, false);
    assert.equal(fakeBot.siteClaims.get('555001'), created.id);

    // (i) Çift gönderim (aynı idempotency anahtarı) testi yeni kullanıcıda
    const jarDup = new CookieJar();
    await completeGoogleOAuth(baseUrl, fakeGoogle, jarDup, { sub: 'google-sub-dup', email: 'dup@example.com' }, { ip: '10.10.2.1' });
    const first = await completeSignupForm(baseUrl, jarDup, {
      nickname: 'Yildiz',
      games: ['zula', 'cs2'],
      usernames: { zula: 'YildizZula', cs2: 'YildizCS' },
    }, { ip: '10.10.2.1' });
    assert.equal(first.postRes.status, 303);
    const createdNoRb = memberStore.findByGoogleSub('google-sub-dup');
    assert.equal(createdNoRb.displayName, 'Yildiz');

    // Yeni pending ile eski tüketilmiş idempotency anahtarını yeniden gönder -> 409
    const jarDup2 = new CookieJar();
    await completeGoogleOAuth(baseUrl, fakeGoogle, jarDup2, { sub: 'google-sub-dup2', email: 'dup2@example.com' }, { ip: '10.10.2.2' });
    const dupFail = await completeSignupForm(baseUrl, jarDup2, {
      _idempotencyKey: 'invalid-or-reused-key',
      nickname: 'Yildiz2',
      games: ['cs2'],
      usernames: { cs2: 'Y2CS' },
    }, { ip: '10.10.2.2' });
    assert.equal(dupFail.postRes.status, 409);
  });

  // --------------------------------------------------------------------------
  // 5) Hatırlama çerezi (pw_remember): otomatik giriş, döndürme, 5 cihaz, çalınma tespiti & çıkış
  // --------------------------------------------------------------------------
  await t.test('5. pw_remember çerezi: otomatik giriş, döndürme, 5 cihaz sınırı, çalınma tespiti ve çıkış iptali', async () => {
    const member = memberStore.findByGoogleSub('google-sub-wizard-1');
    assert.ok(member);

    // 6 cihaz oluştur -> en fazla 5 kalır
    for (let i = 0; i < 6; i += 1) {
      memberStore.createRememberToken(member.id, { userAgent: `Chrome/${100 + i} Windows` });
    }
    const sessions = memberStore.listRememberSessions(member.id);
    assert.equal(sessions.length, 5);

    // (a) Mevcut Google üye girişi -> pw_remember verir
    const jar = new CookieJar();
    const login = await completeGoogleOAuth(baseUrl, fakeGoogle, jar, {
      sub: 'google-sub-wizard-1',
      email: 'wizard1@example.com',
    }, { ip: '10.10.5.1' });
    assert.equal(login.cbRes.status, 302);
    assert.equal(login.cbRes.location, '/');
    const firstRemember = jar.get('pw_remember');
    assert.ok(firstRemember.includes('.'));

    // piyade.sid sil, yalnızca pw_remember gönder -> otomatik giriş + döndürme
    jar.delete('piyade.sid');
    const autoRes = await httpReq(baseUrl, '/profil', { jar });
    assert.equal(autoRes.status, 200);
    assert.match(autoRes.text, /Kartal \| ValidUser/);
    const rotatedRemember = jar.get('pw_remember');
    assert.ok(rotatedRemember && rotatedRemember !== firstRemember, 'pw_remember must rotate on use');

    // ÇALINMA TESPİTİ: geçerli selector + yanlış validator -> o üyenin TÜM cihazları iptal edilir!
    const [validSelector] = rotatedRemember.split('.');
    const theftJar = new CookieJar();
    theftJar.set('pw_remember', `${validSelector}.${'f'.repeat(64)}`);
    await httpReq(baseUrl, '/', { jar: theftJar });
    assert.equal(memberStore.listRememberSessions(member.id).length, 0, 'All devices must be revoked on theft detection');

    // Çıkışta hatırlama çerezi iptal edilir
    const tokLogout = memberStore.createRememberToken(member.id, { userAgent: 'Firefox/120 Linux' });
    const outJar = new CookieJar();
    outJar.set('pw_remember', tokLogout.cookieValue);
    await httpReq(baseUrl, '/auth/logout', { jar: outJar });
    assert.equal(memberStore.listRememberSessions(member.id).length, 0);
  });

  // --------------------------------------------------------------------------
  // 6) Yetkisiz erişim yalıtımı (Google üyesi yönetim/moderasyon/Etkinliğim'e erişemez)
  // --------------------------------------------------------------------------
  await t.test('6. Yetkisiz erişim: Google oturumu /yonetim, /sohbet/moderasyon ve /api/me/activity engelli + Etkinliğim gizli', async () => {
    const jar = new CookieJar();
    await completeGoogleOAuth(baseUrl, fakeGoogle, jar, { sub: 'google-sub-wizard-1', email: 'wizard1@example.com' }, { ip: '10.10.6.1' });

    const homeHtml = await httpReq(baseUrl, '/', { jar });
    assert.equal(homeHtml.status, 200);
    assert.match(homeHtml.text, /Site Üyesi|Site Member/);
    assert.equal(homeHtml.text.includes('id="sidebarActivityBox"'), false);
    assert.equal(homeHtml.text.includes('activity-panel.js'), false);

    assert.equal((await httpReq(baseUrl, '/yonetim/uyeler', { jar })).status, 403);
    assert.equal((await httpReq(baseUrl, '/yonetim/uyari', { jar })).status, 403);
    assert.equal((await httpReq(baseUrl, '/yonetim/kvkk', { jar })).status, 404);
    assert.equal((await httpReq(baseUrl, '/yonetim/bildirimler', { jar })).status, 404);
    assert.equal((await httpReq(baseUrl, '/sohbet/moderasyon', { jar })).status, 404);
    assert.equal((await httpReq(baseUrl, '/sohbet/moderasyon/denetim', { jar })).status, 404);

    const actRes = await httpReq(baseUrl, '/api/me/activity', { jar, headers: { Accept: 'application/json' } });
    assert.equal(actRes.status, 403);
    assert.equal(actRes.json.code, 'DISCORD_ONLY');
  });

  // --------------------------------------------------------------------------
  // 7) Yeni üye 24 saat sınırları, sohbet rehber gizliliği & profil düzenleme
  // --------------------------------------------------------------------------
  await t.test('7. Yeni üye 24 saat sohbet sınırları (dosya/bağlantı), rehberde e-posta sızmaması, gizlilik ve profil düzenleme', async () => {
    const jar = new CookieJar();
    await completeGoogleOAuth(baseUrl, fakeGoogle, jar, { sub: 'google-sub-wizard-1', email: 'wizard1@example.com' }, { ip: '10.10.7.1' });

    const profRes = await httpReq(baseUrl, '/profil', { jar });
    assert.equal(profRes.status, 200);
    // Google profilinde Discord ID ve Disiplin kartı GÖSTERİLMEZ
    assert.equal(profRes.text.includes('Discord ID:'), false);
    assert.equal(profRes.text.includes('cardDisciplineTitle'), false);
    assert.equal(profRes.text.includes('Disiplin'), false);
    const csrf = extractHiddenInput(profRes.text, '_csrf');

    // Sohbet rehberinde e-posta ve Google adı ASLA görünmez
    const dirRes = await httpReq(baseUrl, '/sohbet/api/rehber', { jar, headers: { Accept: 'application/json' } });
    assert.equal(dirRes.status, 200);
    assert.equal(dirRes.text.includes('dup@example.com'), false);
    assert.equal(dirRes.text.includes('Gizli Google Adi'), false);

    // İlk 24 saat: dosya yükleme 403 NEW_MEMBER_NO_FILES
    const upRes = await httpReq(baseUrl, '/sohbet/api/yukle', {
      method: 'POST',
      jar,
      headers: { Accept: 'application/json', 'X-CSRF-Token': csrf },
    });
    assert.equal(upRes.status, 403);
    assert.equal(upRes.json.code, 'NEW_MEMBER_NO_FILES');

    // İlk 24 saat: bağlantı içeren mesaj 403 NEW_MEMBER_NO_LINKS
    const linkMsgRes = await httpReq(baseUrl, '/sohbet/api/sohbet/200000000000000001/mesaj', {
      method: 'POST',
      jar,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ text: 'Bak şuraya https://example.com' }),
    });
    assert.equal(linkMsgRes.status, 403);
    assert.equal(linkMsgRes.json.code, 'NEW_MEMBER_NO_LINKS');

    // Bağlantısız düz mesaj -> 201 OK
    const plainMsgRes = await httpReq(baseUrl, '/sohbet/api/sohbet/200000000000000001/mesaj', {
      method: 'POST',
      jar,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ text: 'Merhaba takım!' }),
    });
    assert.equal(plainMsgRes.status, 201);

    // 25 saat sonrasına al -> link içeren mesaj artık serbest
    const m = memberStore.findByGoogleSub('google-sub-wizard-1');
    memberStore._loadState().members[m.id].createdAt = Date.now() - 25 * 60 * 60 * 1000;
    memberStore._saveState();
    const after24Res = await httpReq(baseUrl, '/sohbet/api/sohbet/200000000000000001/mesaj', {
      method: 'POST',
      jar,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ text: '24 saat sonrası https://example.com' }),
    });
    assert.equal(after24Res.status, 201);

    // Gizlilik anahtarı kapatılınca rehberde oyunlar boş döner
    const privRes = await httpReq(baseUrl, '/profil/gizlilik', {
      method: 'POST',
      jar,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf }).toString(), // showGamesInChat kapalı
    });
    assert.equal(privRes.status, 303);
    const pubItem = memberStore.toPublicChatDirectoryItem(memberStore.findById(m.id));
    assert.deepEqual(pubItem.games, []);

    // Profil düzenleme: Roblox değiştirildiğinde yeni claim alınır, eski bırakılır
    const editForm = new URLSearchParams();
    editForm.set('_csrf', csrf);
    editForm.set('nickname', 'KartalYeni');
    editForm.append('games', 'roblox');
    editForm.set('usernames[roblox]', 'EditNewUser');
    const editRes = await httpReq(baseUrl, '/profil/duzenle', {
      method: 'POST',
      jar,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: editForm.toString(),
    });
    assert.equal(editRes.status, 303);
    assert.equal(fakeBot.siteClaims.has('555001'), false, 'Old Roblox claim must be released');
    assert.equal(fakeBot.siteClaims.get('555003'), m.id, 'New Roblox claim must be acquired');
    assert.equal(memberStore.findById(m.id).displayName, 'KartalYeni | EditNewUser');
  });

  // --------------------------------------------------------------------------
  // 8) Hesabımı Sil: yeniden doğrulama + ad eşleşmesi + tüm izlerin temizlenmesi + vaka istisnası
  // --------------------------------------------------------------------------
  await t.test('8. Hesabımı Sil: yeniden Google doğrulaması, tüm izlerin silinmesi, Roblox claim bırakma ve moderasyon vakasının korunması', async () => {
    const jar = new CookieJar();
    await completeGoogleOAuth(baseUrl, fakeGoogle, jar, { sub: 'google-sub-wizard-1', email: 'wizard1@example.com' }, { ip: '10.10.8.1' });
    const member = memberStore.findByGoogleSub('google-sub-wizard-1');
    const unifiedId = toUnifiedGoogleId(member.id);

    // Karşı taraf bu kullanıcıyı engellemiş olsun & bir moderasyon vaka anlık görüntüsü bulunsun
    chatStore.blockUser('200000000000000001', unifiedId);
    const { makeConvId } = require('../services/chatStore');
    const convId = makeConvId(unifiedId, '200000000000000001');
    const snapshot = chatStore.getContextWindow(convId, null, { totalCount: 10 });
    const modCase = chatModStore.createReportCase({
      convId,
      reporterId: '200000000000000001',
      reportedUserId: unifiedId,
      category: 'other',
      note: 'test snapshot preservation',
      snapshotMessages: snapshot,
      chatStore,
    });

    const profRes = await httpReq(baseUrl, '/profil', { jar });
    const csrf = extractHiddenInput(profRes.text, '_csrf');

    // (a) Yeniden doğrulama olmadan silme -> 403
    const noReauth = await httpReq(baseUrl, '/profil/hesap-sil', {
      method: 'POST',
      jar,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ _csrf: csrf, confirmDisplayName: member.displayName }).toString(),
    });
    assert.equal(noReauth.status, 403);

    // (b) Google yeniden doğrulama (?purpose=reauth_delete)
    const reauth = await completeGoogleOAuth(
      baseUrl,
      fakeGoogle,
      jar,
      { sub: 'google-sub-wizard-1', email: 'wizard1@example.com' },
      { query: '?purpose=reauth_delete', ip: '10.10.8.2' }
    );
    assert.equal(reauth.cbRes.status, 302);
    assert.equal(reauth.cbRes.location, '/profil#hesap-sil');

    // (c) Yanlış hesap adı -> 400
    const badName = await httpReq(baseUrl, '/profil/hesap-sil', {
      method: 'POST',
      jar,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ _csrf: csrf, confirmDisplayName: 'Yanlis Ad' }).toString(),
    });
    assert.equal(badName.status, 400);

    // (d) Doğru hesap adı + taze reauth -> tam temizlik
    const delOk = await httpReq(baseUrl, '/profil/hesap-sil', {
      method: 'POST',
      jar,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, confirmDisplayName: member.displayName }).toString(),
    });
    assert.equal(delOk.status, 303);
    assert.equal(delOk.location, '/?notice=account_deleted');

    // Kontroller: üye silindi, remember token silindi, Roblox claim bırakıldı, sohbet profili/mesajları/engelleme listesi silindi
    assert.equal(memberStore.findById(member.id), null);
    assert.equal(memberStore.listRememberSessions(member.id).length, 0);
    assert.equal(fakeBot.siteClaims.has('555003'), false);
    assert.equal(chatStore.users.has(unifiedId), false);
    assert.equal(chatStore.getProfile('200000000000000001').blocked.includes(unifiedId), false);
    assert.equal(chatStore.getMessages(convId).messages.filter((msg) => msg.from === unifiedId).length, 0);

    // Moderasyon vaka anlık görüntüsü KORUNUR
    const preservedSnap = chatModStore._readCaseSnapshot(modCase.id);
    assert.ok(preservedSnap && Array.isArray(preservedSnap.messages) && preservedSnap.messages.length > 0);

    // Denetim dosyasında son satır kimliksiz account_deleted
    const auditLines = fs.readFileSync(memberStore.auditFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const lastAudit = auditLines[auditLines.length - 1];
    assert.equal(lastAudit.action, 'account_deleted');
    assert.equal(JSON.stringify(lastAudit).includes(member.id), false);
    assert.equal(JSON.stringify(lastAudit).includes('wizard1@example.com'), false);
    assert.equal(JSON.stringify(lastAudit).includes('Kartal'), false);
  });

  // --------------------------------------------------------------------------
  // 9) Askıda / yasaklı üye & IP saatlik üyelik hız sınırı (4. deneme 429)
  // --------------------------------------------------------------------------
  await t.test('9. Askıda/yasaklı üye sayfası ve IP başına saatte en çok 3 üyelik sınırı (429)', async () => {
    // Askıya alınmış üye girişi -> /giris/askida
    const dupMember = memberStore.findByGoogleSub('google-sub-dup');
    memberStore.updateMember(dupMember.id, { status: 'suspended', statusReason: 'Kural ihlali testi' });
    const jarSusp = new CookieJar();
    const suspLogin = await completeGoogleOAuth(baseUrl, fakeGoogle, jarSusp, {
      sub: 'google-sub-dup',
      email: 'dup@example.com',
    }, { ip: '10.10.9.1' });
    assert.equal(suspLogin.cbRes.status, 302);
    assert.equal(suspLogin.cbRes.location, '/giris/askida');
    const suspPage = await httpReq(baseUrl, '/giris/askida', { jar: jarSusp });
    assert.equal(suspPage.status, 403);
    assert.match(suspPage.text, /\/yasal\/kvkk-basvuru/);

    // IP saatlik 3 üyelik sınırı -> 4. POST /uye-ol isteği 429
    const sharedIp = '198.51.100.77';
    for (let i = 1; i <= 4; i += 1) {
      const j = new CookieJar();
      await completeGoogleOAuth(baseUrl, fakeGoogle, j, {
        sub: `google-sub-rate-${i}`,
        email: `rate${i}@example.com`,
      }, { ip: sharedIp });
      const r = await completeSignupForm(baseUrl, j, {
        nickname: `RateUser${i}`,
        games: ['cs2'],
        usernames: { cs2: `RateCS${i}` },
      }, { ip: sharedIp });
      if (i <= 3) {
        assert.equal(r.postRes.status, 303, `Attempt ${i} should succeed`);
      } else {
        assert.equal(r.postRes.status, 429, '4th signup from same IP in 1 hour must be 429');
      }
    }
  });
});
