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

const appConfig = require('../config/app.config');
const { ROLES } = require('../config/roles.config');
const legalConfig = require('../config/legal.config');
const { renderMarkdown, sanitizeUrl } = require('../utils/markdownRenderer');
const { runLegalCheck, formatLegalCheckReport } = require('../scripts/legal-check');
const { LegalStore, setDefaultLegalStore, createFormStartToken } = require('../services/legalStore');
const { ReportStore, setDefaultReportStore } = require('../services/reportStore');
const { ChatStore, setDefaultChatStore } = require('../services/chatStore');
const { ChatModStore, setDefaultChatModStore } = require('../services/chatModStore');
const { createServerApp } = require('../server');

const USER_REG = '400000000000000001';
const USER_MOD = '400000000000000011';
const USER_MGMT = '400000000000000021';
const USER_DEV = '400000000000000031';

// Geçerli 1x1 PNG baytları
const VALID_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000020001e221bc330000000049454e44ae426082',
  'hex'
);

// APP1 EXIF segmentli geçerli minimal JPEG
function makeJpegWithExif() {
  const soi = Buffer.from([0xff, 0xd8]);
  const exifPayload = Buffer.from('Exif\0\0FAKE_GPS_COORD_41_29', 'ascii');
  const app1Len = Buffer.alloc(2);
  app1Len.writeUInt16BE(exifPayload.length + 2, 0);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), app1Len, exifPayload]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x00, 0x3f, 0xff, 0xd9]);
  return Buffer.concat([soi, app1, sos]);
}

function startFakeBotServer(roleStateMap) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const sendJson = (code, data) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (url.pathname.startsWith('/api/member/') && url.pathname.endsWith('/roles')) {
        const id = url.pathname.split('/')[3];
        const st = roleStateMap.get(id) || { roles: [ROLES.REGISTERED], level: 'registered', registered: true };
        return sendJson(200, {
          id,
          displayName: `User_${id.slice(-2)}`,
          avatarUrl: '/img/brand/icon-192.png',
          roles: st.roles,
          level: st.level,
          registered: st.registered,
          highestRolePosition: 20,
        });
      }
      return sendJson(200, { status: 'ok', activeThisMonth: 5, playingNow: 1, families: [], games: [] });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function createSignedSession(app, userObj = null) {
  return new Promise((resolve, reject) => {
    const sid = `ltest_${crypto.randomBytes(12).toString('hex')}`;
    const csrf = crypto.randomBytes(16).toString('hex');
    const sess = {
      cookie: { originalMaxAge: 86400000, expires: new Date(Date.now() + 86400000).toISOString(), httpOnly: true, path: '/' },
      csrfToken: csrf,
    };
    if (userObj) sess.user = userObj;
    app.locals.sessionStore.set(sid, sess, (err) => {
      if (err) return reject(err);
      const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(sid).digest('base64').replace(/=+$/, '');
      resolve({ cookie: `piyade.sid=${encodeURIComponent(`s:${sid}.${sig}`)}`, csrfToken: csrf });
    });
  });
}

function makeMultipartBody(fields, files = []) {
  const boundary = `----PiyadeBoundary${crypto.randomBytes(8).toString('hex')}`;
  const chunks = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`, 'utf8'));
  }
  for (const f of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.filename}"\r\nContent-Type: ${f.contentType}\r\n\r\n`,
        'utf8'
      )
    );
    chunks.push(f.buffer);
    chunks.push(Buffer.from('\r\n', 'utf8'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat(chunks),
  };
}

function flattenKeys(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v, full));
    } else {
      keys.push(full);
    }
  }
  return keys.sort();
}

test('Markdown dönüştürücü: XSS saldırılarını etkisizleştirir ve güvenli biçimlendirme/tablo/TOC üretir', () => {
  const xssMd = [
    '---',
    'title: Güvenlik Testi',
    'version: 1.2',
    'lastUpdated: 2026-11-26',
    '---',
    '',
    '## 1. Bölüm Başlığı',
    '',
    'Normal **kalın** ve [güvenli](/yasal/kunye) ve [dış](https://example.com) ve [eposta](mailto:test@example.com).',
    '',
    '<script>alert(1)</script>',
    '<iframe src="https://evil.test"></iframe>',
    '<img src=x onerror=alert(2)>',
    '<svg onload="alert(3)"></svg>',
    '[kötü1](javascript:alert(4))',
    '[kötü2](data:text/html,<script>alert(5)</script>)',
    '[kötü3](//evil.test/phish)',
    '',
    '| Ad | Değer |',
    '| --- | --- |',
    '| `piyade.sid` | 24 saat |',
  ].join('\n');

  const res = renderMarkdown(xssMd);
  assert.equal(res.meta.title, 'Güvenlik Testi');
  assert.equal(res.meta.version, '1.2');
  assert.equal(res.meta.lastUpdated, '2026-11-26');
  assert.equal(res.toc.length, 1);
  assert.equal(res.toc[0].id, '1-bolum-basligi');

  // Ham tehlikeli HTML etiketleri ve javascript:/data: bağlantıları ASLA çıkamaz
  assert.ok(!res.html.includes('<script>'));
  assert.ok(!res.html.includes('<iframe'));
  assert.ok(!res.html.includes('<img '));
  assert.ok(!res.html.includes('<svg'));
  assert.ok(!/href="javascript:/i.test(res.html));
  assert.ok(!/href="data:/i.test(res.html));
  assert.ok(!/href="\/\//i.test(res.html));
  assert.ok(res.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(res.html.includes('<a href="/yasal/kunye">güvenli</a>'));
  assert.ok(res.html.includes('<a href="https://example.com/" target="_blank" rel="noopener noreferrer">dış</a>'));
  assert.ok(res.html.includes('<table class="legal-table">'));

  assert.equal(sanitizeUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeUrl('vbscript:msgbox(1)'), null);
  assert.equal(sanitizeUrl('data:text/html,foo'), null);
  assert.equal(sanitizeUrl('//evil.com'), null);
  assert.equal(sanitizeUrl('/yasal/kvkk-aydinlatma'), '/yasal/kvkk-aydinlatma');
});

test('TR/EN locale anahtarları %100 eşit ve yeni CSS/JS/EJS dosyalarında sabit #hex renk yok', () => {
  const tr = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', 'tr.json'), 'utf8'));
  const en = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', 'en.json'), 'utf8'));
  const trKeys = flattenKeys(tr);
  const enKeys = flattenKeys(en);
  assert.deepEqual(trKeys, enKeys, 'TR ve EN sözlük anahtarları birebir eşit olmalıdır');

  const filesToScan = [
    'public/js/cookie-notice.js',
    'public/js/report-form.js',
    'public/js/admin-legal.js',
    'views/pages/legal-doc.ejs',
    'views/pages/kvkk-form.ejs',
    'views/pages/kvkk-status.ejs',
    'views/pages/report-form.ejs',
    'views/pages/report-status.ejs',
    'views/pages/admin-kvkk.ejs',
    'views/pages/admin-reports.ejs',
  ];
  const hexRegex = /#[0-9a-fA-F]{3,8}\b/g;
  for (const rel of filesToScan) {
    const content = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    const matches = content.match(hexRegex);
    assert.equal(matches, null, `${rel} içinde sabit #hex renk bulunmamalı: ${matches}`);
  }

  // style.css içine yeni eklenen yasal bölümde de sabit #hex olmamalı
  const cssAll = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
  const markerIdx = cssAll.indexOf('⚖️ YASAL SAYFALAR');
  assert.ok(markerIdx > 0, 'Yeni yasal CSS bölümü bulunamadı');
  const newCss = cssAll.slice(markerIdx).replace(/#reportFormError/g, '');
  assert.equal(newCss.match(hexRegex), null, 'Yeni yasal CSS bloğunda sabit #hex renk olmamalı');
});

test('scripts/legal-check.js boş alanları, LEGAL_REVIEWED durumunu ve tüm belgeleri raporlar', () => {
  const report = runLegalCheck({});
  assert.equal(report.reviewed, false);
  assert.equal(report.missingRequired.length, 4);
  assert.equal(report.missingFiles.length, 0);
  assert.equal(report.docs.length, 16);
  const text = formatLegalCheckReport(report);
  assert.ok(text.includes('LEGAL_CONTROLLER_NAME'));
  assert.ok(text.includes('TASLAK'));
  assert.ok(text.includes('kvkk-aydinlatma'));
});

test('Uçtan uca: Yasal sayfalar, alt bilgi, çerez çubuğu, KVKK formu, /bildir yönlendirme ve yetki kontrolleri', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piyade-legal-e2e-'));
  const prevChatEnabled = process.env.CHAT_ENABLED;
  const prevModAlsoDev = process.env.MOD_PANEL_ALSO_DEVELOPER;
  const prevReviewed = process.env.LEGAL_REVIEWED;
  const prevController = process.env.LEGAL_CONTROLLER_NAME;

  process.env.CHAT_ENABLED = 'true';
  process.env.MOD_PANEL_ALSO_DEVELOPER = 'false';
  delete process.env.LEGAL_REVIEWED;
  delete process.env.LEGAL_CONTROLLER_NAME;

  const roleMap = new Map([
    [USER_REG, { roles: [ROLES.REGISTERED], level: 'registered', registered: true }],
    [USER_MOD, { roles: [ROLES.REGISTERED, ROLES.COMMUNITY_OFFICIAL], level: 'registered', registered: true }],
    [USER_MGMT, { roles: [ROLES.REGISTERED, ROLES.YONETMENLIK], level: 'yonetmenlik', registered: true }],
    [USER_DEV, { roles: [ROLES.REGISTERED, ROLES.DEVELOPER], level: 'developer', registered: true }],
  ]);

  const botSrv = await startFakeBotServer(roleMap);
  const origBaseUrl = appConfig.BOT_API_URL;
  appConfig.BOT_API_URL = botSrv.url;

  const legalStore = new LegalStore({ baseDir: path.join(tmpDir, 'legal') });
  const reportStore = new ReportStore({ baseDir: path.join(tmpDir, 'reports') });
  const chatStore = new ChatStore({ baseDir: path.join(tmpDir, 'chat'), silentWarning: true });
  const chatModStore = new ChatModStore({ baseDir: path.join(tmpDir, 'chat') });

  setDefaultLegalStore(legalStore);
  setDefaultReportStore(reportStore);
  setDefaultChatStore(chatStore);
  setDefaultChatModStore(chatModStore);

  const app = createServerApp();
  const webSrv = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve({ server: s, url: `http://127.0.0.1:${s.address().port}` }));
  });

  t.after(async () => {
    await new Promise((r) => webSrv.server.close(r));
    await new Promise((r) => botSrv.server.close(r));
    appConfig.BOT_API_URL = origBaseUrl;
    setDefaultLegalStore(null);
    setDefaultReportStore(null);
    setDefaultChatStore(null);
    setDefaultChatModStore(null);
    if (prevChatEnabled === undefined) delete process.env.CHAT_ENABLED;
    else process.env.CHAT_ENABLED = prevChatEnabled;
    if (prevModAlsoDev === undefined) delete process.env.MOD_PANEL_ALSO_DEVELOPER;
    else process.env.MOD_PANEL_ALSO_DEVELOPER = prevModAlsoDev;
    if (prevReviewed === undefined) delete process.env.LEGAL_REVIEWED;
    else process.env.LEGAL_REVIEWED = prevReviewed;
    if (prevController === undefined) delete process.env.LEGAL_CONTROLLER_NAME;
    else process.env.LEGAL_CONTROLLER_NAME = prevController;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const guestSess = await createSignedSession(app, null);
  const regSess = await createSignedSession(app, { id: USER_REG, username: 'uye1', displayName: 'Uye Bir', roles: [ROLES.REGISTERED], level: 'registered', registered: true, inGuild: true, rolesSyncedAt: Date.now() });
  const modSess = await createSignedSession(app, { id: USER_MOD, username: 'mod1', displayName: 'Mod Bir', roles: [ROLES.REGISTERED, ROLES.COMMUNITY_OFFICIAL], level: 'registered', registered: true, inGuild: true, rolesSyncedAt: Date.now() });
  const mgmtSess = await createSignedSession(app, { id: USER_MGMT, username: 'mgmt1', displayName: 'Yonetmen', roles: [ROLES.REGISTERED, ROLES.YONETMENLIK], level: 'yonetmenlik', registered: true, inGuild: true, rolesSyncedAt: Date.now() });
  const devSess = await createSignedSession(app, { id: USER_DEV, username: 'dev1', displayName: 'Developer', roles: [ROLES.REGISTERED, ROLES.DEVELOPER], level: 'developer', registered: true, inGuild: true, rolesSyncedAt: Date.now() });

  // 1) Alt bilgi bağlantıları (TR & EN) ve çerez bilgi çubuğu
  const homeTr = await fetch(`${webSrv.url}/`);
  assert.equal(homeTr.status, 200);
  const homeTrHtml = await homeTr.text();
  for (const label of [
    'KVKK Aydınlatma Metni',
    'Açık Rıza Metni',
    'Gizlilik Politikası',
    'Çerez Politikası',
    'KVKK Başvuru Formu',
    'Künye',
    'Telif Hakkı / DMCA',
    'İhlal Bildir',
  ]) {
    assert.ok(homeTrHtml.includes(label), `TR alt bilgide "${label}" görünmeli`);
  }
  assert.ok(homeTrHtml.includes('id="cookieNoticeBar"'));
  assert.ok(homeTrHtml.includes('Sitede yalnızca zorunlu çerezler kullanılır'));

  const homeEn = await fetch(`${webSrv.url}/en`);
  assert.equal(homeEn.status, 200);
  const homeEnHtml = await homeEn.text();
  assert.ok(homeEnHtml.includes('KVKK Privacy Notice'));
  assert.ok(homeEnHtml.includes('Report Abuse'));
  assert.ok(homeEnHtml.includes('strictly necessary cookies only'));

  // 2) Tüm yasal rotalar, taslak uyarısı, boş alan işaretleri, sürüm/son güncelleme, TOC
  for (const doc of legalConfig.LEGAL_DOCS) {
    const rTr = await fetch(`${webSrv.url}/yasal/${doc.slug}`);
    assert.equal(rTr.status, 200, `TR /yasal/${doc.slug} 200 dönmeli`);
    const htmlTr = await rTr.text();
    assert.ok(htmlTr.includes('data-draft-banner="true"'), 'LEGAL_REVIEWED=false iken taslak uyarısı görünmeli');
    assert.ok(htmlTr.includes('Bu metin taslaktır ve yayına alınmadan önce hukuki incelemeden geçirilmelidir.'));
    assert.ok(!htmlTr.includes('hukuk görüşü değildir'), 'Kullanıcı metninde hukuk görüşü notu olmamalı');
    assert.ok(htmlTr.includes('index, follow'), `Yasal sayfa indekslenebilir olmalı: ${doc.slug}`);

    const rEn = await fetch(`${webSrv.url}/en/yasal/${doc.slug}`);
    assert.equal(rEn.status, 200, `EN /en/yasal/${doc.slug} 200 dönmeli`);
    const htmlEn = await rEn.text();
    assert.ok(htmlEn.includes('This document is a draft and must undergo legal review before going live.'));
  }

  // Boş alan işaretleri ve LEGAL_REVIEWED=true geçişi
  const kvkkDraftHtml = await (await fetch(`${webSrv.url}/yasal/kvkk-aydinlatma`)).text();
  assert.ok(kvkkDraftHtml.includes('[Doldurulacak: Veri Sorumlusu Adı / Unvanı]'));
  assert.ok(kvkkDraftHtml.includes('class="legal-toc-list"'));

  const acikRizaHtml = await (await fetch(`${webSrv.url}/yasal/acik-riza`)).text();
  assert.ok(acikRizaHtml.includes('data-consent-id="chat_moderation_review"'));
  assert.ok(acikRizaHtml.includes('data-consent-id="chat_profile_game_usernames"'));
  assert.ok(acikRizaHtml.includes('data-consent-id="international_data_transfer"'));

  process.env.LEGAL_REVIEWED = 'true';
  process.env.LEGAL_CONTROLLER_NAME = 'Piyade Ornek Veri Sorumlusu';
  const kvkkReviewedHtml = await (await fetch(`${webSrv.url}/yasal/kvkk-aydinlatma`)).text();
  assert.ok(!kvkkReviewedHtml.includes('data-draft-banner="true"'), 'LEGAL_REVIEWED=true iken taslak uyarısı kalkmalı');
  assert.ok(kvkkReviewedHtml.includes('Piyade Ornek Veri Sorumlusu'));
  delete process.env.LEGAL_REVIEWED;
  delete process.env.LEGAL_CONTROLLER_NAME;

  // 3) sitemap.xml & robots.txt
  const robotsTxt = await (await fetch(`${webSrv.url}/robots.txt`)).text();
  assert.ok(robotsTxt.includes('Allow: /yasal'));
  assert.ok(robotsTxt.includes('Allow: /bildir'));
  assert.ok(robotsTxt.includes('Disallow: /yasal/kvkk-basvuru/sorgula'));
  assert.ok(robotsTxt.includes('Disallow: /bildir/sorgula'));

  const sitemapXml = await (await fetch(`${webSrv.url}/sitemap.xml`)).text();
  assert.ok(sitemapXml.includes('/yasal/kvkk-aydinlatma'));
  assert.ok(sitemapXml.includes('/en/yasal/cerez-politikasi'));
  assert.ok(sitemapXml.includes('/bildir'));

  // 4) KVKK Başvuru Formu: doğrulama, honeypot, min 3sn, hız sınırı (3/gün), takip kodu, sadece durum sorgulama
  const tooFastToken = createFormStartToken(Date.now());
  const validStartToken = createFormStartToken(Date.now() - 5000);
  const kvkkIp = '198.51.100.10';

  // Honeypot
  const hpRes = await fetch(`${webSrv.url}/yasal/kvkk-basvuru`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Cookie: guestSess.cookie,
      'X-CSRF-Token': guestSess.csrfToken,
      'X-Forwarded-For': '198.51.100.11',
    },
    body: JSON.stringify({
      _formStartedAt: validStartToken,
      website_url: 'http://spam.bot',
      fullName: 'Bot User',
      email: 'bot@example.com',
      relation: 'visitor',
      requestTypes: ['info'],
      description: 'Bu bir spam testi aciklamasidir.',
    }),
  });
  assert.equal(hpRes.status, 400);

  // Çok hızlı (<3 sn)
  const fastRes = await fetch(`${webSrv.url}/yasal/kvkk-basvuru`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Cookie: guestSess.cookie,
      'X-CSRF-Token': guestSess.csrfToken,
      'X-Forwarded-For': '198.51.100.12',
    },
    body: JSON.stringify({
      _formStartedAt: tooFastToken,
      fullName: 'Hizli Kullanici',
      email: 'fast@example.com',
      relation: 'visitor',
      requestTypes: ['info'],
      description: 'Bu cok hizli gonderim testidir.',
    }),
  });
  assert.equal(fastRes.status, 400);

  // Geçerli 3 başvuru (aynı IP) + 4. başvuruda 429
  let firstKvkkCode = '';
  for (let i = 1; i <= 3; i += 1) {
    const r = await fetch(`${webSrv.url}/yasal/kvkk-basvuru`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Cookie: guestSess.cookie,
        'X-CSRF-Token': guestSess.csrfToken,
        'X-Forwarded-For': kvkkIp,
      },
      body: JSON.stringify({
        _formStartedAt: validStartToken,
        fullName: `Ahmet Test ${i}`,
        email: 'ahmet.kvkk@example.com',
        relation: 'member',
        accountIdentifier: 'Discord: ahmet#1234',
        requestTypes: ['info', 'erasure'],
        description: `Kisisel verilerim hakkinda gizli basvuru icerigi numara ${i}.`,
      }),
    });
    assert.equal(r.status, 201, `KVKK #${i} başarılı olmalı`);
    const j = await r.json();
    assert.match(j.trackingCode, /^KVKK-\d{4}-[A-Z0-9]{5}$/);
    if (i === 1) firstKvkkCode = j.trackingCode;
  }

  const kvkk4th = await fetch(`${webSrv.url}/yasal/kvkk-basvuru`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Cookie: guestSess.cookie,
      'X-CSRF-Token': guestSess.csrfToken,
      'X-Forwarded-For': kvkkIp,
    },
    body: JSON.stringify({
      _formStartedAt: validStartToken,
      fullName: 'Ahmet Test 4',
      email: 'ahmet.kvkk@example.com',
      relation: 'visitor',
      requestTypes: ['info'],
      description: 'Dorduncu basvuru hiz sinirina takilmali.',
    }),
  });
  assert.equal(kvkk4th.status, 429, 'IP başına günde 3 KVKK başvurusu sınırı çalışmalı');

  // Sorgulama: yanlış e-posta 404; doğru kod+e-posta SADECE DURUM döndürür
  const wrongLookup = await fetch(`${webSrv.url}/yasal/kvkk-basvuru/sorgula`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Cookie: guestSess.cookie,
      'X-CSRF-Token': guestSess.csrfToken,
    },
    body: JSON.stringify({ trackingCode: firstKvkkCode, email: 'baska@example.com' }),
  });
  assert.equal(wrongLookup.status, 404);

  const okLookup = await fetch(`${webSrv.url}/yasal/kvkk-basvuru/sorgula`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Cookie: guestSess.cookie,
      'X-CSRF-Token': guestSess.csrfToken,
    },
    body: JSON.stringify({ trackingCode: firstKvkkCode, email: 'ahmet.kvkk@example.com' }),
  });
  assert.equal(okLookup.status, 200);
  const lookupText = await okLookup.text();
  assert.ok(!lookupText.includes('Ahmet Test'), 'Sorgulama ad soyad sızdırmamalı');
  assert.ok(!lookupText.includes('gizli basvuru icerigi'), 'Sorgulama talep içeriği sızdırmamalı');
  assert.ok(!lookupText.includes('ahmet.kvkk@example.com'), 'Sorgulama e-posta sızdırmamalı');
  const lookupJson = JSON.parse(lookupText);
  assert.equal(lookupJson.result.status, 'received');

  // 30 gün gecikme vurgusu doğrulaması
  const overdueRec = legalStore.createKvkkRequest({
    fullName: 'Geciken Basvuru',
    email: 'geciken@example.com',
    relation: 'visitor',
    requestTypes: ['access'],
    description: 'Otuz gunu gecen basvuru testi.',
    nowMs: Date.now() - 35 * 24 * 60 * 60 * 1000,
  });

  // Yetki kontrolü: /yonetim/kvkk YALNIZCA Developer -> diğer herkese 404
  for (const [label, sess] of [
    ['Ziyaretçi', guestSess],
    ['Kayıtlı Üye', regSess],
    ['Community Official', modSess],
    ['Yönetmenlik', mgmtSess],
  ]) {
    const r = await fetch(`${webSrv.url}/yonetim/kvkk`, { headers: { Cookie: sess.cookie } });
    assert.equal(r.status, 404, `${label} /yonetim/kvkk için 404 almalı`);
  }

  const devKvkkPage = await fetch(`${webSrv.url}/yonetim/kvkk`, { headers: { Cookie: devSess.cookie } });
  assert.equal(devKvkkPage.status, 200);
  const devKvkkList = await (await fetch(`${webSrv.url}/yonetim/kvkk/api/basvurular`, { headers: { Cookie: devSess.cookie } })).json();
  assert.equal(devKvkkList.ok, true);
  assert.ok(devKvkkList.overdueCount >= 1, '30 günü geçen başvuru geciken sayısına yansımalı');
  const overdueItem = devKvkkList.items.find((x) => x.trackingCode === overdueRec.trackingCode);
  assert.equal(overdueItem.isOverdue, true, '35 günlük açık KVKK başvurusu isOverdue=true olmalı');

  const devUpdate = await fetch(`${webSrv.url}/yonetim/kvkk/api/basvuru/${firstKvkkCode}/durum`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Cookie: devSess.cookie, 'X-CSRF-Token': devSess.csrfToken },
    body: JSON.stringify({ status: 'answered', note: 'Basvuru e-posta ile yanitlandi.' }),
  });
  assert.equal(devUpdate.status, 200);

  const kvkkAudit = await (await fetch(`${webSrv.url}/yonetim/kvkk/api/denetim`, { headers: { Cookie: devSess.cookie } })).text();
  assert.ok(kvkkAudit.includes('kvkk_status_update'));
  assert.ok(!kvkkAudit.includes('ahmet.kvkk@example.com'), 'KVKK denetim kaydı kişisel veri içermemeli');

  // 5) /bildir: 10 kategori, HTML engeli, magic-byte dosya doğrulama, EXIF temizliği, yönlendirme ve yetki
  const reportPageHtml = await (await fetch(`${webSrv.url}/bildir`)).text();
  for (const cat of legalConfig.REPORT_CATEGORIES) {
    assert.ok(reportPageHtml.includes(`data-report-cat="${cat.id}"`), `Tuş takımında ${cat.id} olmalı`);
  }

  // HTML etiketi reddi
  const htmlReject = await fetch(`${webSrv.url}/bildir`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Cookie: guestSess.cookie,
      'X-CSRF-Token': guestSess.csrfToken,
      'X-Forwarded-For': '198.51.100.30',
    },
    body: JSON.stringify({
      _formStartedAt: validStartToken,
      category: 'harassment',
      location: 'site',
      description: 'Bu aciklamada <script>alert(1)</script> etiketi var.',
    }),
  });
  assert.equal(htmlReject.status, 400);

  // Sahte SVG dosya yüklemesi magic-byte ile reddedilmeli
  const svgMp = makeMultipartBody(
    {
      _formStartedAt: validStartToken,
      category: 'harassment',
      location: 'chat',
      description: 'Sahte SVG yukleme testi aciklamasi.',
    },
    [{ field: 'evidenceFiles', filename: 'evil.png', contentType: 'image/png', buffer: Buffer.from('<svg onload="alert(1)"></svg>') }]
  );
  const svgRes = await fetch(`${webSrv.url}/bildir`, {
    method: 'POST',
    headers: {
      'Content-Type': svgMp.contentType,
      Accept: 'application/json',
      Cookie: guestSess.cookie,
      'X-CSRF-Token': guestSess.csrfToken,
      'X-Forwarded-For': '198.51.100.31',
    },
    body: svgMp.body,
  });
  assert.equal(svgRes.status, 400, 'SVG/sahte görsel magic-byte tarafından reddedilmeli');

  // Geçerli Topluluk Güvenliği bildirimi (PNG + EXIF'li JPEG) -> Community Official sekmesine düşmeli
  const commMp = makeMultipartBody(
    {
      _formStartedAt: validStartToken,
      category: 'child_safety',
      location: 'chat',
      targetRef: 'https://piyade-team-tsb.up.railway.app/sohbet',
      description: 'Cocuk guvenligi acil bildirim testi (kanitli).',
    },
    [
      { field: 'evidenceFiles', filename: 'kanit1.png', contentType: 'image/png', buffer: VALID_PNG },
      { field: 'evidenceFiles', filename: 'kanit2.jpg', contentType: 'image/jpeg', buffer: makeJpegWithExif() },
    ]
  );
  const commRes = await fetch(`${webSrv.url}/bildir`, {
    method: 'POST',
    headers: {
      'Content-Type': commMp.contentType,
      Accept: 'application/json',
      Cookie: guestSess.cookie,
      'X-CSRF-Token': guestSess.csrfToken,
      'X-Forwarded-For': '198.51.100.32',
    },
    body: commMp.body,
  });
  assert.equal(commRes.status, 201);
  const commJson = await commRes.json();
  assert.match(commJson.trackingCode, /^RPT-\d{4}-[A-Z0-9]{5}$/);
  assert.equal(commJson.audience, 'community');
  assert.equal(commJson.evidenceCount, 2);

  // JPEG EXIF temizlenmiş mi?
  const commDetailRaw = reportStore.getReportDetail(commJson.trackingCode, { expectedAudience: 'community' });
  const jpgMeta = commDetailRaw.report.evidence.find((e) => e.ext === 'jpg');
  const savedJpgBuf = fs.readFileSync(path.join(reportStore.filesDir, jpgMeta.storedName));
  assert.ok(!savedJpgBuf.includes(Buffer.from('FAKE_GPS_COORD')), 'Yüklenen JPEG EXIF bilgisi temizlenmiş olmalı');

  // Telif / DMCA bildirimi (eksik beyan -> 400; eksiksiz -> 201 ve /yonetim/bildirimler'e düşmeli)
  const dmcaBad = await fetch(`${webSrv.url}/bildir`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Cookie: guestSess.cookie,
      'X-CSRF-Token': guestSess.csrfToken,
      'X-Forwarded-For': '198.51.100.33',
    },
    body: JSON.stringify({
      _formStartedAt: validStartToken,
      category: 'copyright_dmca',
      location: 'site',
      description: 'Eksik DMCA alanlariyla telif bildirimi denemesi.',
    }),
  });
  assert.equal(dmcaBad.status, 400);

  const dmcaMp = makeMultipartBody(
    {
      _formStartedAt: validStartToken,
      category: 'copyright_dmca',
      location: 'site',
      contactEmail: 'rights@studio.test',
      dmcaRightsHolder: 'Ornek Telif Sahibi Ltd.',
      dmcaWorkDescription: 'Orijinal 3D sanat eseri ve karakter tasarimi.',
      dmcaInfringingUrl: 'https://piyade-team-tsb.up.railway.app/ornek-sayfa',
      dmcaGoodFaith: 'on',
      description: 'Izinsiz kullanilan gorselin kaldirilmasini talep ediyoruz.',
    },
    [{ field: 'evidenceFiles', filename: 'dmca.png', contentType: 'image/png', buffer: VALID_PNG }]
  );
  const dmcaRes = await fetch(`${webSrv.url}/bildir`, {
    method: 'POST',
    headers: {
      'Content-Type': dmcaMp.contentType,
      Accept: 'application/json',
      Cookie: guestSess.cookie,
      'X-CSRF-Token': guestSess.csrfToken,
      'X-Forwarded-For': '198.51.100.34',
    },
    body: dmcaMp.body,
  });
  assert.equal(dmcaRes.status, 201);
  const dmcaJson = await dmcaRes.json();
  assert.equal(dmcaJson.audience, 'management');

  // Durum sorgulama (SADECE DURUM)
  const rptLookup = await fetch(`${webSrv.url}/bildir/sorgula`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Cookie: guestSess.cookie,
      'X-CSRF-Token': guestSess.csrfToken,
    },
    body: JSON.stringify({ trackingCode: dmcaJson.trackingCode }),
  });
  assert.equal(rptLookup.status, 200);
  const rptLookupTxt = await rptLookup.text();
  assert.ok(!rptLookupTxt.includes('rights@studio.test'));
  assert.ok(!rptLookupTxt.includes('Izinsiz kullanilan'));

  // Yönlendirme & Yetki Kontrolleri:
  // A) Community Official (/sohbet/moderasyon/api/site-bildirimleri)
  for (const [label, sess] of [
    ['Ziyaretçi', guestSess],
    ['Kayıtlı Üye', regSess],
    ['Yönetmenlik', mgmtSess],
    ['Developer (MOD_PANEL_ALSO_DEVELOPER=false)', devSess],
  ]) {
    const r = await fetch(`${webSrv.url}/sohbet/moderasyon/api/site-bildirimleri`, { headers: { Cookie: sess.cookie } });
    assert.equal(r.status, 404, `${label} Community Official site bildirimlerinden 404 almalı`);
  }

  const coList = await (await fetch(`${webSrv.url}/sohbet/moderasyon/api/site-bildirimleri`, { headers: { Cookie: modSess.cookie } })).json();
  assert.ok(coList.items.some((x) => x.trackingCode === commJson.trackingCode), 'child_safety CO sekmesine düşmeli');
  assert.ok(!coList.items.some((x) => x.trackingCode === dmcaJson.trackingCode), 'DMCA CO sekmesine düşmemeli');

  const coDetail = await (await fetch(`${webSrv.url}/sohbet/moderasyon/api/site-bildirim/${commJson.trackingCode}`, { headers: { Cookie: modSess.cookie } })).json();
  assert.equal(coDetail.ok, true);
  const coEvUrl = coDetail.report.evidence[0].previewUrl;
  const coEvOk = await fetch(`${webSrv.url}${coEvUrl}`, { headers: { Cookie: modSess.cookie } });
  assert.equal(coEvOk.status, 200);
  assert.equal(coEvOk.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(coEvOk.headers.get('content-security-policy').includes('sandbox'));
  const coEvForbidden = await fetch(`${webSrv.url}${coEvUrl}`, { headers: { Cookie: guestSess.cookie } });
  assert.equal(coEvForbidden.status, 404, 'Yetkisiz kişi kanıt dosyasını görememeli');

  // B) Yönetim (/yonetim/bildirimler — Developer + Yönetmenlik; diğerlerine 404)
  for (const [label, sess] of [
    ['Ziyaretçi', guestSess],
    ['Kayıtlı Üye', regSess],
    ['Community Official', modSess],
  ]) {
    const r = await fetch(`${webSrv.url}/yonetim/bildirimler`, { headers: { Cookie: sess.cookie } });
    assert.equal(r.status, 404, `${label} /yonetim/bildirimler için 404 almalı`);
  }

  const mgmtList = await (await fetch(`${webSrv.url}/yonetim/bildirimler/api/liste`, { headers: { Cookie: mgmtSess.cookie } })).json();
  assert.ok(mgmtList.items.some((x) => x.trackingCode === dmcaJson.trackingCode), 'DMCA yönetim paneline düşmeli');
  assert.ok(!mgmtList.items.some((x) => x.trackingCode === commJson.trackingCode), 'child_safety yönetim paneline düşmemeli');

  const mgmtDetail = await (await fetch(`${webSrv.url}/yonetim/bildirimler/api/detay/${dmcaJson.trackingCode}`, { headers: { Cookie: mgmtSess.cookie } })).json();
  assert.equal(mgmtDetail.ok, true);
  const mgmtEvUrl = mgmtDetail.report.evidence[0].previewUrl;
  assert.equal((await fetch(`${webSrv.url}${mgmtEvUrl}`, { headers: { Cookie: mgmtSess.cookie } })).status, 200);
  assert.equal((await fetch(`${webSrv.url}${mgmtEvUrl}`, { headers: { Cookie: regSess.cookie } })).status, 404);

  // Çıkar çatışması: kendi gönderdiği bildirimi yetkili açamaz
  const selfConflict = reportStore.createReport({
    category: 'illegal',
    location: 'site',
    description: 'Yoneticinin kendisinin gonderdigi test bildirimi.',
    reporterUserId: USER_MGMT,
    reporterName: 'Yonetmen',
  });
  const conflictRes = await fetch(`${webSrv.url}/yonetim/bildirimler/api/detay/${selfConflict.trackingCode}`, {
    headers: { Cookie: mgmtSess.cookie },
  });
  assert.equal(conflictRes.status, 403, 'Çıkar çatışması olan bildirim 403 dönmeli');

  // Saatte 5 bildirim hız sınırı (6. bildirim 429)
  const rlIp = '198.51.100.99';
  for (let i = 1; i <= 5; i += 1) {
    const r = await fetch(`${webSrv.url}/bildir`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Cookie: guestSess.cookie,
        'X-CSRF-Token': guestSess.csrfToken,
        'X-Forwarded-For': rlIp,
      },
      body: JSON.stringify({
        _formStartedAt: validStartToken,
        category: 'scam_spam',
        location: 'discord',
        description: `Spam hiz siniri testi numarasi ${i}.`,
      }),
    });
    assert.equal(r.status, 201);
  }
  const r6 = await fetch(`${webSrv.url}/bildir`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Cookie: guestSess.cookie,
      'X-CSRF-Token': guestSess.csrfToken,
      'X-Forwarded-For': rlIp,
    },
    body: JSON.stringify({
      _formStartedAt: validStartToken,
      category: 'scam_spam',
      location: 'discord',
      description: 'Altinci bildirim saatlik sinira takilmali.',
    }),
  });
  assert.equal(r6.status, 429, 'IP başına saatte 5 bildirim sınırı çalışmalı');
});
