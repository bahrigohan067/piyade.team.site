const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-32-chars-minimum-ok';
process.env.API_SECRET = 'test-api-secret-key';
process.env.DISCORD_CLIENT_ID = '111111111111111111';
process.env.DISCORD_CLIENT_SECRET = 'test-discord-client-secret';
process.env.BASE_URL = 'http://127.0.0.1:3001';

const { ROLES } = require('../config/roles.config');
const chatConfig = require('../config/chat.config');
const { ChatStore, setDefaultChatStore, makeConvId } = require('../services/chatStore');
const { ChatModStore, setDefaultChatModStore } = require('../services/chatModStore');
const { chatSseHub } = require('../services/chatSseHub');
const chatAutoFilter = require('../services/chatAutoFilter');
const botApiClient = require('../services/botApiClient');
const chatModRoutes = require('../routes/chatMod');
const { createServerApp } = require('../server');

const USER_A = '300000000000000001';
const USER_B = '300000000000000002';
const USER_C = '300000000000000003';
const MOD_1 = '300000000000000011';
const MOD_2 = '300000000000000012';
const DEV_USER = '300000000000000020';
const MGMT_USER = '300000000000000021';

function startFakeBotServer(roleStateMap) {
  const members = [
    { id: USER_A, displayName: 'Uye A', discordAvatarUrl: '/img/brand/icon-192.png', hasRoblox: false },
    { id: USER_B, displayName: 'Uye B', discordAvatarUrl: '/img/brand/icon-192.png', hasRoblox: false },
    { id: USER_C, displayName: 'Uye C', discordAvatarUrl: '/img/brand/icon-192.png', hasRoblox: false },
    { id: MOD_1, displayName: 'Mod Bir', discordAvatarUrl: '/img/brand/icon-192.png', hasRoblox: false },
    { id: MOD_2, displayName: 'Mod Iki', discordAvatarUrl: '/img/brand/icon-192.png', hasRoblox: false },
    { id: DEV_USER, displayName: 'Dev Uye', discordAvatarUrl: '/img/brand/icon-192.png', hasRoblox: false },
    { id: MGMT_USER, displayName: 'Yonetmen', discordAvatarUrl: '/img/brand/icon-192.png', hasRoblox: false },
  ];

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const sendJson = (code, data) => {
          res.writeHead(code, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        };
        if (url.pathname.startsWith('/api/member/') && url.pathname.endsWith('/roles')) {
          const id = url.pathname.split('/')[3];
          const state = roleStateMap.get(id) || { roles: [ROLES.REGISTERED], level: 'registered', registered: true };
          const found = members.find((m) => m.id === id);
          return sendJson(200, {
            id,
            displayName: (found && found.displayName) || id,
            avatarUrl: '/img/brand/icon-192.png',
            roles: state.roles,
            level: state.level,
            registered: state.registered,
            highestRolePosition: 20,
          });
        }
        if (url.pathname === '/api/directory/lookup' && req.method === 'POST') {
          let parsed = {};
          try {
            parsed = JSON.parse(body || '{}');
          } catch (_) {}
          const ids = Array.isArray(parsed.ids) ? parsed.ids : [];
          return sendJson(200, { items: members.filter((m) => ids.includes(m.id)) });
        }
        return sendJson(200, { status: 'ok', items: members });
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function createSignedSession(app, userObj) {
  return new Promise((resolve, reject) => {
    const sid = `mtest_${crypto.randomBytes(12).toString('hex')}`;
    const csrf = crypto.randomBytes(16).toString('hex');
    const sess = {
      cookie: { originalMaxAge: 86400000, expires: new Date(Date.now() + 86400000).toISOString(), httpOnly: true, path: '/' },
      csrfToken: csrf,
      user: userObj,
    };
    app.locals.sessionStore.set(sid, sess, (err) => {
      if (err) return reject(err);
      const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(sid).digest('base64').replace(/=+$/, '');
      resolve({ cookie: `piyade.sid=${encodeURIComponent(`s:${sid}.${sig}`)}`, csrfToken: csrf });
    });
  });
}

async function reqJson(baseUrl, p, { method = 'GET', cookie = '', csrf = '', body = null, accept = 'application/json' } = {}) {
  const headers = { Accept: accept };
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  let payload;
  if (body !== null) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const resp = await fetch(`${baseUrl}${p}`, { method, headers, body: payload, redirect: 'manual' });
  const text = await resp.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {}
  return { status: resp.status, text, json, headers: resp.headers };
}

test('Parça 4: Sohbet Güvenlik, Raporlama, Otomatik İşaret ve Moderasyon Testleri', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piyade-chat-mod-'));
  const roleStateMap = new Map([
    [USER_A, { roles: [ROLES.REGISTERED], level: 'registered', registered: true }],
    [USER_B, { roles: [ROLES.REGISTERED], level: 'registered', registered: true }],
    [USER_C, { roles: [ROLES.REGISTERED], level: 'registered', registered: true }],
    [MOD_1, { roles: [ROLES.REGISTERED, ROLES.COMMUNITY_OFFICIAL], level: 'registered', registered: true }],
    [MOD_2, { roles: [ROLES.REGISTERED, ROLES.COMMUNITY_OFFICIAL], level: 'registered', registered: true }],
    [DEV_USER, { roles: [ROLES.REGISTERED, ROLES.DEVELOPER], level: 'developer', registered: true }],
    [MGMT_USER, { roles: [ROLES.REGISTERED, ROLES.YONETMENLIK], level: 'yonetmenlik', registered: true }],
  ]);

  const bot = await startFakeBotServer(roleStateMap);
  const appConfig = require('../config/app.config');
  const prevBotUrl = appConfig.BOT_API_URL;
  const prevChatEnabled = process.env.CHAT_ENABLED;
  const prevModDev = process.env.MOD_PANEL_ALSO_DEVELOPER;

  process.env.CHAT_ENABLED = 'true';
  delete process.env.MOD_PANEL_ALSO_DEVELOPER;
  appConfig.BOT_API_URL = bot.url;
  botApiClient.clearDirectoryCache();

  const chatStore = new ChatStore({ baseDir: tmpDir, silentWarning: true });
  setDefaultChatStore(chatStore);
  const modStore = new ChatModStore({ baseDir: tmpDir });
  setDefaultChatModStore(modStore);
  chatSseHub.resetForTests();

  const app = createServerApp();
  const server = await new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  const siteUrl = `http://127.0.0.1:${server.address().port}`;

  const mkSession = (id, name, roles, level = 'registered') =>
    createSignedSession(app, {
      id,
      username: name.toLowerCase(),
      displayName: name,
      avatarUrl: '/img/brand/icon-192.png',
      roles,
      level,
      registered: true,
      inGuild: true,
      rolesSyncedAt: Date.now(),
    });

  const sessA = await mkSession(USER_A, 'Uye A', [ROLES.REGISTERED]);
  const sessB = await mkSession(USER_B, 'Uye B', [ROLES.REGISTERED]);
  const sessC = await mkSession(USER_C, 'Uye C', [ROLES.REGISTERED]);
  const sessMod1 = await mkSession(MOD_1, 'Mod Bir', [ROLES.REGISTERED, ROLES.COMMUNITY_OFFICIAL]);
  const sessMod2 = await mkSession(MOD_2, 'Mod Iki', [ROLES.REGISTERED, ROLES.COMMUNITY_OFFICIAL]);
  const sessDev = await mkSession(DEV_USER, 'Dev Uye', [ROLES.REGISTERED, ROLES.DEVELOPER], 'developer');
  const sessMgmt = await mkSession(MGMT_USER, 'Yonetmen', [ROLES.REGISTERED, ROLES.YONETMENLIK], 'yonetmenlik');

  for (const uid of [USER_A, USER_B, USER_C, MOD_1, MOD_2]) {
    chatStore.recordConsent(uid, chatConfig.POLICY_VERSION);
  }

  t.after(async () => {
    chatSseHub.resetForTests();
    chatStore.flush();
    modStore.flush();
    appConfig.BOT_API_URL = prevBotUrl;
    if (prevChatEnabled === undefined) delete process.env.CHAT_ENABLED;
    else process.env.CHAT_ENABLED = prevChatEnabled;
    if (prevModDev === undefined) delete process.env.MOD_PANEL_ALSO_DEVELOPER;
    else process.env.MOD_PANEL_ALSO_DEVELOPER = prevModDev;
    await new Promise((r) => server.close(r));
    await new Promise((r) => bot.server.close(r));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test('1) Rotalar envanteri: moderasyon router içinde sohbet gezme/arama uç noktası YOKTUR', () => {
    const allowedPaths = new Set([
      '/',
      '/denetim',
      '/api/vakalar',
      '/api/vaka/:caseId',
      '/api/vaka/:caseId/eylem',
      '/api/yaptirimlar',
      '/api/yaptirim/:sanctionId/kaldir',
      '/api/site-bildirimleri',
      '/api/site-bildirim/:code',
      '/api/site-bildirim/:code/durum',
      '/api/bildirim-dosya/:fileId',
      '/api/denetim',
    ]);
    const routePaths = chatModRoutes.stack
      .filter((layer) => layer.route && layer.route.path)
      .map((layer) => layer.route.path);

    assert.ok(routePaths.length >= 6);
    for (const rp of routePaths) {
      assert.ok(allowedPaths.has(rp), `Beklenmeyen moderasyon rotası tespit edildi: ${rp}`);
      assert.equal(/sohbetler|mesajlar|ara|search|browse|watch/i.test(rp), false);
    }
  });

  await t.test('2) Yetki & tazelik: Community Official olmayan herkese 404; rol alınınca erişim anında biter; Developer sadece denetim görür', async () => {
    // Normal üye, Yönetmenlik ve Developer -> /sohbet/moderasyon ve /api/vakalar 404 alır!
    for (const sess of [sessA, sessMgmt, sessDev]) {
      const htmlR = await reqJson(siteUrl, '/sohbet/moderasyon', { cookie: sess.cookie, accept: 'text/html' });
      assert.equal(htmlR.status, 404);
      const apiR = await reqJson(siteUrl, '/sohbet/moderasyon/api/vakalar', { cookie: sess.cookie });
      assert.equal(apiR.status, 404);
    }

    // Developer yalnızca salt okunur denetim sekmesini görebilir
    const devAuditHtml = await reqJson(siteUrl, '/sohbet/moderasyon/denetim', {
      cookie: sessDev.cookie,
      accept: 'text/html',
    });
    assert.equal(devAuditHtml.status, 200);
    const devAuditApi = await reqJson(siteUrl, '/sohbet/moderasyon/api/denetim', { cookie: sessDev.cookie });
    assert.equal(devAuditApi.status, 200);
    assert.equal(devAuditApi.json.readOnly, true);

    // Yönetmenlik denetim sekmesini de göremez (404)
    const mgmtAudit = await reqJson(siteUrl, '/sohbet/moderasyon/api/denetim', { cookie: sessMgmt.cookie });
    assert.equal(mgmtAudit.status, 404);

    // Community Official erişir (200)
    const modOk = await reqJson(siteUrl, '/sohbet/moderasyon/api/vakalar', { cookie: sessMod1.cookie });
    assert.equal(modOk.status, 200);

    // Tazelik testi: Bot API'de Mod 2'nin COMMUNITY_OFFICIAL rolü kaldırılınca önbellek olmadan ANINDA 404 alır!
    roleStateMap.set(MOD_2, { roles: [ROLES.REGISTERED], level: 'registered', registered: true });
    const revoked = await reqJson(siteUrl, '/sohbet/moderasyon/api/vakalar', { cookie: sessMod2.cookie });
    assert.equal(revoked.status, 404);
    // Rolü geri ver
    roleStateMap.set(MOD_2, {
      roles: [ROLES.REGISTERED, ROLES.COMMUNITY_OFFICIAL],
      level: 'registered',
      registered: true,
    });
  });

  await t.test('3) Yerel otomatik işaretleyici: mesajı engellemez, atlatma biçimlerini yakalar ve art arda işaretleri tek vakada birleştirir', async () => {
    // Birim test: leetspeak, boşluklu yazım, tekrarlı harf, tehdit, Discord davet, şüpheli link, telefon/eposta
    assert.equal(chatAutoFilter.scanMessageText('s.i.k.t.i.r git').primaryCategory, 'profanity');
    assert.equal(chatAutoFilter.scanMessageText('4 m k siiiiiiktir').primaryCategory, 'profanity');
    assert.equal(chatAutoFilter.scanMessageText('seni oldurecegim adresini bul').priority, 'high');
    assert.equal(chatAutoFilter.scanMessageText('gel discord.gg/test123').primaryCategory, 'discord_invite');
    assert.equal(chatAutoFilter.scanMessageText('tikla https://bit.ly/bedava').primaryCategory, 'suspicious_link');
    assert.equal(chatAutoFilter.scanMessageText('mailim test@example.com').priority, 'low');
    assert.equal(chatAutoFilter.scanMessageText('Merhaba nasilsin kanka').flagged, false);

    // Canlı gönderimde mesaj ENGELLENMEZ (201) ama otomatik vaka açılır ve 2. işaret aynı vakada birleşir!
    const m1 = await reqJson(siteUrl, `/sohbet/api/sohbet/${USER_B}/mesaj`, {
      method: 'POST',
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      body: { text: 'Sunucuma gel discord.gg/ornekdavet', clientId: 'auto-1' },
    });
    assert.equal(m1.status, 201);

    const m2 = await reqJson(siteUrl, `/sohbet/api/sohbet/${USER_B}/mesaj`, {
      method: 'POST',
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      body: { text: 'Bir de https://bit.ly/supheli linki var', clientId: 'auto-2' },
    });
    assert.equal(m2.status, 201);

    const autoCases = modStore.listCases({ source: 'auto' });
    assert.equal(autoCases.total, 1, 'Ardışık otomatik işaretler tek vakada birleştirilmeli');
    assert.equal(autoCases.items[0].flagCount, 2);
  });

  let reportedCaseId = null;
  let reportedMsgId = null;
  const SECRET_EVIDENCE_TEXT = 'GIZLI_KANIT_METNI_ASLA_MODLOGA_YAZILMAZ_9981';

  await t.test('4) Rapor akışı: anlık görüntü silinmeye rağmen korunur, tekrarlı rapor ve günlük 10 sınırı engellenir', async () => {
    const sent = await reqJson(siteUrl, `/sohbet/api/sohbet/${USER_B}/mesaj`, {
      method: 'POST',
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      body: { text: SECRET_EVIDENCE_TEXT, clientId: 'rep-target-1' },
    });
    assert.equal(sent.status, 201);
    reportedMsgId = sent.json.message.id;

    // B bu mesajı raporlar
    const rep = await reqJson(siteUrl, '/sohbet/api/raporla', {
      method: 'POST',
      cookie: sessB.cookie,
      csrf: sessB.csrfToken,
      body: { otherId: USER_A, msgId: reportedMsgId, category: 'child_safety', note: 'Acil inceleme' },
    });
    assert.equal(rep.status, 201);
    reportedCaseId = rep.json.caseId;

    // Aynı mesajı tekrar raporlamak engellenir (409)
    const dupRep = await reqJson(siteUrl, '/sohbet/api/raporla', {
      method: 'POST',
      cookie: sessB.cookie,
      csrf: sessB.csrfToken,
      body: { otherId: USER_A, msgId: reportedMsgId, category: 'harassment', note: 'Tekrar' },
    });
    assert.equal(dupRep.status, 409);
    assert.equal(dupRep.json.code, 'DUPLICATE_REPORT');

    // Gönderen A mesajını sonradan SİLSE BİLE vaka anlık görüntüsünde kanıt korunur!
    const delA = await reqJson(siteUrl, `/sohbet/api/sohbet/${USER_B}/mesaj/${reportedMsgId}`, {
      method: 'DELETE',
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
    });
    assert.equal(delA.status, 200);

    const caseDetail = await reqJson(siteUrl, `/sohbet/moderasyon/api/vaka/${reportedCaseId}`, {
      cookie: sessMod1.cookie,
    });
    assert.equal(caseDetail.status, 200);
    assert.equal(caseDetail.json.case.priority, 'critical');
    const snapMsg = caseDetail.json.messages.find((m) => m.id === reportedMsgId);
    assert.ok(snapMsg);
    assert.equal(snapMsg.text, SECRET_EVIDENCE_TEXT);

    // İnceleme kilidi (10 dk): Mod 1 açtığı için Mod 2 aynı anda açamaz (409 CASE_LOCKED)
    const mod2Locked = await reqJson(siteUrl, `/sohbet/moderasyon/api/vaka/${reportedCaseId}`, {
      cookie: sessMod2.cookie,
    });
    assert.equal(mod2Locked.status, 409);
    assert.equal(mod2Locked.json.code, 'CASE_LOCKED');

    // Günlük 10 rapor sınırı kontrolü
    for (let i = 0; i < 10; i += 1) chatStore.recordReportSubmission(USER_C);
    const limitRes = await reqJson(siteUrl, '/sohbet/api/raporla', {
      method: 'POST',
      cookie: sessC.cookie,
      csrf: sessC.csrfToken,
      body: { otherId: USER_A, category: 'other', note: 'Sinir asimi' },
    });
    assert.equal(limitRes.status, 429);
    assert.equal(limitRes.json.code, 'REPORT_DAILY_LIMIT');
  });

  await t.test('5) Çıkar çatışması ve Community Official yaptırım koruması', async () => {
    // Mod 1 ile User A arasında mesaj olsun ve User A, Mod 1'i raporlasın
    const m = await reqJson(siteUrl, `/sohbet/api/sohbet/${MOD_1}/mesaj`, {
      method: 'POST',
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      body: { text: 'Mod 1 ile konusma', clientId: 'coi-1' },
    });
    assert.equal(m.status, 201);
    const repMod = await reqJson(siteUrl, '/sohbet/api/raporla', {
      method: 'POST',
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      body: { otherId: MOD_1, msgId: m.json.message.id, category: 'other', note: 'Cikar catismasi testi' },
    });
    assert.equal(repMod.status, 201);
    const coiCaseId = repMod.json.caseId;

    // Mod 1 kendi tarafı olduğu vakayı AÇAMAZ (403 CONFLICT_OF_INTEREST)
    const coiRes = await reqJson(siteUrl, `/sohbet/moderasyon/api/vaka/${coiCaseId}`, {
      cookie: sessMod1.cookie,
    });
    assert.equal(coiRes.status, 403);
    assert.equal(coiRes.json.code, 'CONFLICT_OF_INTEREST');

    // Mod 2 açabilir ama başka bir Community Official olan Mod 1'e yaptırım uygulayamaz (403)
    const mod2Open = await reqJson(siteUrl, `/sohbet/moderasyon/api/vaka/${coiCaseId}`, {
      cookie: sessMod2.cookie,
    });
    assert.equal(mod2Open.status, 200);
    const trySanctionOfficial = await reqJson(siteUrl, `/sohbet/moderasyon/api/vaka/${coiCaseId}/eylem`, {
      method: 'POST',
      cookie: sessMod2.cookie,
      csrf: sessMod2.csrfToken,
      body: { action: 'mute', duration: '1h', note: 'Resmi yetkiliye susturma denemesi' },
    });
    assert.equal(trySanctionOfficial.status, 403);
    assert.equal(trySanctionOfficial.json.code, 'CANNOT_SANCTION_OFFICIAL');
  });

  await t.test('6) Eylemler: kaldır/sustur/yasakla/uyar/kapat, yaptırım uygulanması ve süre dolunca kalkması', async () => {
    // Zorunlu not eksikse 400
    const noNote = await reqJson(siteUrl, `/sohbet/moderasyon/api/vaka/${reportedCaseId}/eylem`, {
      method: 'POST',
      cookie: sessMod1.cookie,
      csrf: sessMod1.csrfToken,
      body: { action: 'warn_note', note: 'a' },
    });
    assert.equal(noNote.status, 400);

    // 1) Hedef mesajı moderatör kaldırır (modRemoved: true)
    const rem = await reqJson(siteUrl, `/sohbet/moderasyon/api/vaka/${reportedCaseId}/eylem`, {
      method: 'POST',
      cookie: sessMod1.cookie,
      csrf: sessMod1.csrfToken,
      body: { action: 'remove_message', note: 'Kural ihlali nedeniyle kaldirildi', actionKey: 'k-rem-1' },
    });
    assert.equal(rem.status, 200);
    const checkTomb = chatStore.getMessageById(makeConvId(USER_A, USER_B), reportedMsgId);
    assert.equal(checkTomb.modRemoved, true);

    // 2) Uyarı notu gönder
    const warn = await reqJson(siteUrl, `/sohbet/moderasyon/api/vaka/${reportedCaseId}/eylem`, {
      method: 'POST',
      cookie: sessMod1.cookie,
      csrf: sessMod1.csrfToken,
      body: { action: 'warn_note', note: 'Ilk sozlu sistem notu' },
    });
    assert.equal(warn.status, 200);

    // 3) Sustur (1 saat) -> Kullanıcı A artık mesaj gönderemez (403 USER_MUTED)
    const mute = await reqJson(siteUrl, `/sohbet/moderasyon/api/vaka/${reportedCaseId}/eylem`, {
      method: 'POST',
      cookie: sessMod1.cookie,
      csrf: sessMod1.csrfToken,
      body: { action: 'mute', duration: '1h', note: '1 saat susturma uygulandi' },
    });
    assert.equal(mute.status, 200);
    const mutedSend = await reqJson(siteUrl, `/sohbet/api/sohbet/${USER_B}/mesaj`, {
      method: 'POST',
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      body: { text: 'Susturulmusken yazma', clientId: 'muted-try' },
    });
    assert.equal(mutedSend.status, 403);
    assert.equal(mutedSend.json.code, 'USER_MUTED');

    // Susturma süresi dolunca yaptırım otomatik kalkar (sahte saat kontrolü)
    const futureTs = Date.now() + 2 * 3600 * 1000;
    assert.equal(modStore.getActiveSanction(USER_A, futureTs), null);

    // 4) Yasakla -> /sohbet HTML yasak açıklama ekranını gösterir, API 403 USER_BANNED döner
    const ban = await reqJson(siteUrl, `/sohbet/moderasyon/api/vaka/${reportedCaseId}/eylem`, {
      method: 'POST',
      cookie: sessMod1.cookie,
      csrf: sessMod1.csrfToken,
      body: { action: 'ban', note: 'Sohbetten yasaklandi' },
    });
    assert.equal(ban.status, 200);
    const banSanctionId = ban.json.sanction.id;

    const banPage = await reqJson(siteUrl, '/sohbet', { cookie: sessA.cookie, accept: 'text/html' });
    assert.equal(banPage.status, 200);
    assert.match(banPage.text, /chatBanTitle/);

    const banApi = await reqJson(siteUrl, '/sohbet/api/sohbetler', { cookie: sessA.cookie });
    assert.equal(banApi.status, 403);
    assert.equal(banApi.json.code, 'USER_BANNED');

    // Yasağı kaldır
    const lift = await reqJson(siteUrl, `/sohbet/moderasyon/api/yaptirim/${banSanctionId}/kaldir`, {
      method: 'POST',
      cookie: sessMod1.cookie,
      csrf: sessMod1.csrfToken,
      body: { note: 'Itiraz sonrasi yasak kaldirildi' },
    });
    assert.equal(lift.status, 200);

    // 5) Vakayı kapat -> raporlayan B'ye sade sonuç bildirimi düşer
    const close = await reqJson(siteUrl, `/sohbet/moderasyon/api/vaka/${reportedCaseId}/eylem`, {
      method: 'POST',
      cookie: sessMod1.cookie,
      csrf: sessMod1.csrfToken,
      body: { action: 'close', resolution: 'action_taken', note: 'Gerekli yaptirim uygulandi' },
    });
    assert.equal(close.status, 200);
    const bNotices = modStore.getUnreadNotices(USER_B);
    assert.ok(bNotices.some((n) => n.type === 'report_resolved' && n.outcome === 'action_taken'));
  });

  await t.test('7) Denetim kaydı (modlog.jsonl): içerik sızdırmaz ve >30 görüntüleme yoğun erişim olarak işaretlenir', () => {
    const rawLog = fs.readFileSync(modStore.modlogFile, 'utf8');
    assert.ok(rawLog.trim().length > 0);
    assert.equal(rawLog.includes(SECRET_EVIDENCE_TEXT), false, 'Mesaj içeriği ASLA modlog.jsonl içine yazılmamalı');

    // 31 kez vaka görüntüleme -> 31. kayıtta highVolumeAccess: true
    let sawHighVol = false;
    for (let i = 0; i < 32; i += 1) {
      const ev = modStore.appendAuditLog({
        modId: MOD_2,
        modName: 'Mod Iki',
        caseId: reportedCaseId,
        action: 'view_case',
        countAsView: true,
      });
      if (ev.highVolumeAccess) sawHighVol = true;
    }
    assert.equal(sawHighVol, true, '1 saatte 30+ görüntüleme yoğun erişim olarak işaretlenmeli');
  });

  await t.test('8) Vaka saklama süreleri (kapanış+7 gün ve açık 90 gün otomatik temizlik)', () => {
    const retDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piyade-mod-ret-'));
    try {
      const cs = new ChatStore({ baseDir: retDir, silentWarning: true });
      const ms = new ChatModStore({ baseDir: retDir });
      const t0 = Date.UTC(2026, 0, 1, 12, 0, 0);
      const day = 86400000;
      const convId = makeConvId(USER_A, USER_B);

      const cClosed = ms.createReportCase({
        convId,
        reporterId: USER_B,
        reportedUserId: USER_A,
        targetMsgId: 'm_1',
        category: 'other',
        snapshotMessages: [{ id: 'm_1', from: USER_A, ts: t0, text: 'Kapanacak kanit' }],
        chatStore: cs,
        nowTs: t0,
      });
      ms.closeCase(cClosed.id, { modId: MOD_1, resolution: 'no_violation', note: 'Kapandi', nowTs: t0 + day });

      const cOldOpen = ms.createReportCase({
        convId,
        reporterId: USER_B,
        reportedUserId: USER_A,
        targetMsgId: 'm_2',
        category: 'harassment',
        snapshotMessages: [{ id: 'm_2', from: USER_A, ts: t0, text: '90 gun acik kalan' }],
        chatStore: cs,
        nowTs: t0,
      });

      // 8. günde kapanmış vaka temizlenir, açık olan kalır
      ms.runModRetentionCleanup({ nowTs: t0 + 9 * day, chatStore: cs });
      assert.equal(ms.getCaseMeta(cClosed.id).snapshotPurged, true);
      assert.equal(ms.getCaseMeta(cOldOpen.id).snapshotPurged, false);

      // 91. günde açık vaka otomatik kapatılıp temizlenir
      ms.runModRetentionCleanup({ nowTs: t0 + 91 * day, chatStore: cs });
      assert.equal(ms.getCaseMeta(cOldOpen.id).status, 'closed');
      assert.equal(ms.getCaseMeta(cOldOpen.id).snapshotPurged, true);
      cs.flush();
      ms.flush();
    } finally {
      fs.rmSync(retDir, { recursive: true, force: true });
    }
  });

  await t.test('9) Mesaj isteği tamamen kaldırıldı ve politika v3.0 yeniden onay gerektirir', async () => {
    // Politika sürümü 3.0'a yükseltildi: 1.0 veya 2.0 onaylayan kullanıcı yeniden onay vermeli
    assert.equal(chatConfig.POLICY_VERSION, '3.0');
    chatStore.recordConsent(USER_C, '2.0');
    assert.equal(chatStore.hasValidConsent(USER_C, chatConfig.POLICY_VERSION), false);
    chatStore.recordConsent(USER_C, chatConfig.POLICY_VERSION);
    assert.equal(chatStore.hasValidConsent(USER_C, chatConfig.POLICY_VERSION), true);

    // Yabancıdan gelen ilk mesaj istek olmadan doğrudan normal sohbet olarak düşer
    const firstMsg = await reqJson(siteUrl, `/sohbet/api/sohbet/${USER_B}/mesaj`, {
      method: 'POST',
      cookie: sessC.cookie,
      csrf: sessC.csrfToken,
      body: { text: 'Ilk temas dogrudan mesaj', clientId: 'direct-first-1' },
    });
    assert.equal(firstMsg.status, 201);

    const bMsgs = await reqJson(siteUrl, `/sohbet/api/sohbet/${USER_C}/mesajlar`, { cookie: sessB.cookie });
    assert.equal(bMsgs.status, 200);
    assert.equal(bMsgs.json.messages[0].text, 'Ilk temas dogrudan mesaj');
    assert.equal(bMsgs.json.messages[0].maskedRequest, undefined);
    assert.equal(bMsgs.json.state.requestStatus, undefined);

    // Eski /istek uç noktası artık yok (404)
    const oldReq = await reqJson(siteUrl, `/sohbet/api/sohbet/${USER_C}/istek`, {
      method: 'POST',
      cookie: sessB.cookie,
      csrf: sessB.csrfToken,
      body: { action: 'accept' },
    });
    assert.equal(oldReq.status, 404);
  });

  await t.test('10) TR/EN chatMod locale eşliği ve Parça 4 kodunda sabit #hex renk yasağı', () => {
    const tr = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', 'tr.json'), 'utf8'));
    const en = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', 'en.json'), 'utf8'));
    assert.deepEqual(Object.keys(tr.chatMod).sort(), Object.keys(en.chatMod).sort());
    assert.deepEqual(Object.keys(tr.chat).sort(), Object.keys(en.chat).sort());

    const modJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'chat-mod.js'), 'utf8');
    assert.equal((modJs.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length, 0);
    const modEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'pages', 'chat-mod.ejs'), 'utf8');
    assert.equal((modEjs.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length, 0);
    const styleCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
    const sec18 = styleCss.slice(styleCss.indexOf('18. SOHBET GÜVENLİK'));
    assert.equal((sec18.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length, 0);
  });
});
