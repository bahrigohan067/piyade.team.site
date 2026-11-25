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

const { ChatStore, setDefaultChatStore, makeConvId } = require('../services/chatStore');
const { chatSseHub } = require('../services/chatSseHub');
const botApiClient = require('../services/botApiClient');
const chatFileValidator = require('../utils/chatFileValidator');
const { createServerApp } = require('../server');

const USER_A = '200000000000000001';
const USER_B = '200000000000000002';
const USER_C = '200000000000000003';
const USER_D = '200000000000000004';
const USER_UNREG = '200000000000000099';

const MEMBERS = [
  { id: USER_A, displayName: 'Dosya A', discordAvatarUrl: '/img/brand/icon-192.png', hasRoblox: false },
  { id: USER_B, displayName: 'Dosya B', discordAvatarUrl: '/img/brand/icon-192.png', hasRoblox: false },
  { id: USER_C, displayName: 'Dosya C', discordAvatarUrl: '/img/brand/icon-192.png', hasRoblox: false },
  { id: USER_D, displayName: 'Dosya D', discordAvatarUrl: '/img/brand/icon-192.png', hasRoblox: false },
];

// Minimal geçerli dosya örnekleri (bayt düzeyinde)
const SAMPLE_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

function makeJpegWithExif() {
  // SOI + APP0 (JFIF) + APP1 (EXIF GPS: "GPS_SECRET_COORD") + APP13 (IPTC: "IPTC_TAG") + SOS + scan + EOI
  const soi = Buffer.from([0xff, 0xd8]);
  const app0Data = Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1');
  const app0Len = Buffer.alloc(2);
  app0Len.writeUInt16BE(app0Data.length + 2, 0);
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0]), app0Len, app0Data]);

  const app1Data = Buffer.from('Exif\0\0GPS_SECRET_COORD_41N_29E', 'latin1');
  const app1Len = Buffer.alloc(2);
  app1Len.writeUInt16BE(app1Data.length + 2, 0);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), app1Len, app1Data]);

  const app13Data = Buffer.from('Photoshop 3.0\0IPTC_CAMERA_TAG', 'latin1');
  const app13Len = Buffer.alloc(2);
  app13Len.writeUInt16BE(app13Data.length + 2, 0);
  const app13 = Buffer.concat([Buffer.from([0xff, 0xed]), app13Len, app13Data]);

  const sosHeader = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
  const scanData = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const eoi = Buffer.from([0xff, 0xd9]);

  return Buffer.concat([soi, app0, app1, app13, sosHeader, scanData, eoi]);
}

const SAMPLE_GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;', 'latin1');
const SAMPLE_WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x14, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
  Buffer.from('VP8 ', 'ascii'),
  Buffer.from([0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
]);
const SAMPLE_PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n', 'latin1');
const SAMPLE_PDF_JS = Buffer.from('%PDF-1.4\n1 0 obj << /S /JavaScript /JS (alert(1)) >> endobj\n%%EOF\n', 'latin1');
const SAMPLE_PDF_LAUNCH = Buffer.from('%PDF-1.4\n1 0 obj << /S /Launch /F (cmd.exe) >> endobj\n%%EOF\n', 'latin1');
const SAMPLE_TXT = Buffer.from('Merhaba Piyade World!\nBu guvenli bir UTF-8 metin dosyasidir.\n', 'utf8');
const SAMPLE_MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftypisom', 'ascii'),
  Buffer.from([0x00, 0x00, 0x02, 0x00]),
  Buffer.from('isomiso2', 'ascii'),
  Buffer.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'ascii'),
]);
const SAMPLE_WEBM = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]),
  Buffer.from('webm-video-stream-payload-0123456789', 'ascii'),
]);

function startFakeBotServer() {
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
        if (url.pathname === '/api/directory/lookup' && req.method === 'POST') {
          let parsed = {};
          try {
            parsed = JSON.parse(body || '{}');
          } catch (_) {}
          const ids = Array.isArray(parsed.ids) ? parsed.ids : [];
          return sendJson(200, { items: MEMBERS.filter((m) => ids.includes(m.id)) });
        }
        return sendJson(200, { status: 'ok', items: MEMBERS });
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function createSignedSession(app, userObj) {
  return new Promise((resolve, reject) => {
    const sid = `ftest_${crypto.randomBytes(12).toString('hex')}`;
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

async function uploadMultipart(baseUrl, { cookie, csrf, filename, buffer, mime = 'application/octet-stream' }) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), filename);
  const resp = await fetch(`${baseUrl}/sohbet/api/yukle`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'X-CSRF-Token': csrf,
      Accept: 'application/json',
    },
    body: form,
  });
  const text = await resp.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {}
  return { status: resp.status, json, headers: resp.headers };
}

test('Parça 3: Sohbet Dosya Yükleme, Doğrulama, EXIF ve Sunum Testleri', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piyade-chat-files-'));
  const bot = await startFakeBotServer();
  const appConfig = require('../config/app.config');
  const prevBotUrl = appConfig.BOT_API_URL;
  const prevChatEnabled = process.env.CHAT_ENABLED;

  process.env.CHAT_ENABLED = 'true';
  appConfig.BOT_API_URL = bot.url;
  botApiClient.clearDirectoryCache();

  const store = new ChatStore({ baseDir: tmpDir, silentWarning: true });
  setDefaultChatStore(store);
  chatSseHub.resetForTests();

  const app = createServerApp();
  const server = await new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  const siteUrl = `http://127.0.0.1:${server.address().port}`;

  const mkUser = (id, name, reg = true) => ({
    id,
    username: name.toLowerCase(),
    displayName: name,
    avatarUrl: '/img/brand/icon-192.png',
    roles: reg ? ['1559604702143062016'] : ['1559604540997636147'],
    level: reg ? 'registered' : 'unregistered',
    registered: reg,
    inGuild: true,
    rolesSyncedAt: Date.now(),
  });

  const sessA = await createSignedSession(app, mkUser(USER_A, 'Dosya A'));
  const sessB = await createSignedSession(app, mkUser(USER_B, 'Dosya B'));
  const sessC = await createSignedSession(app, mkUser(USER_C, 'Dosya C'));
  const sessD = await createSignedSession(app, mkUser(USER_D, 'Dosya D'));
  const sessUnreg = await createSignedSession(app, mkUser(USER_UNREG, 'Kayitsiz', false));

  for (const uid of [USER_A, USER_B, USER_C, USER_D]) {
    store.recordConsent(uid);
  }

  t.after(async () => {
    chatFileValidator.setDiskCheckOverrideForTests(null);
    chatSseHub.resetForTests();
    store.flush();
    appConfig.BOT_API_URL = prevBotUrl;
    if (prevChatEnabled === undefined) delete process.env.CHAT_ENABLED;
    else process.env.CHAT_ENABLED = prevChatEnabled;
    await new Promise((r) => server.close(r));
    await new Promise((r) => bot.server.close(r));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test('1) Birim doğrulayıcı: tüm 8 izinli tür kabul, tehlikeliler ve uyuşmazlıklar reddedilir', () => {
    const validCases = [
      ['resim.png', SAMPLE_PNG, 'png', 'image/png'],
      ['foto.jpg', makeJpegWithExif(), 'jpg', 'image/jpeg'],
      ['anim.gif', SAMPLE_GIF, 'gif', 'image/gif'],
      ['web.webp', SAMPLE_WEBP, 'webp', 'image/webp'],
      ['belge.pdf', SAMPLE_PDF, 'pdf', 'application/pdf'],
      ['not.txt', SAMPLE_TXT, 'txt', 'text/plain; charset=utf-8'],
      ['klip.mp4', SAMPLE_MP4, 'mp4', 'video/mp4'],
      ['klip.webm', SAMPLE_WEBM, 'webm', 'video/webm'],
    ];
    for (const [name, buf, expExt, expMime] of validCases) {
      const r = chatFileValidator.validateChatAttachmentBuffer(buf, name);
      assert.equal(r.ok, true, `${name} kabul edilmeliydi: ${r.error}`);
      assert.equal(r.ext, expExt);
      assert.equal(r.mimeType, expMime);
      assert.match(r.storedName, new RegExp(`^[0-9a-f]{32}\\.${expExt}$`));
    }

    // Uzantı-içerik uyuşmazlığı reddedilir
    assert.equal(chatFileValidator.validateChatAttachmentBuffer(SAMPLE_PNG, 'sahte.jpg').ok, false);
    assert.equal(chatFileValidator.validateChatAttachmentBuffer(SAMPLE_PDF, 'sahte.txt').ok, false);

    // SVG, HTML, JS, EXE, ZIP, RAR, 7z, Office reddedilir
    assert.equal(chatFileValidator.validateChatAttachmentBuffer(Buffer.from('<svg></svg>'), 'x.svg').ok, false);
    assert.equal(chatFileValidator.validateChatAttachmentBuffer(Buffer.from('<html></html>'), 'x.html').ok, false);
    assert.equal(chatFileValidator.validateChatAttachmentBuffer(Buffer.from('MZ\x90\x00'), 'x.exe').ok, false);
    assert.equal(chatFileValidator.validateChatAttachmentBuffer(Buffer.from('MZ\x90\x00'), 'x.txt').ok, false);
    assert.equal(chatFileValidator.validateChatAttachmentBuffer(Buffer.from('PK\x03\x04test'), 'x.zip').ok, false);
    assert.equal(chatFileValidator.validateChatAttachmentBuffer(Buffer.from('PK\x03\x04test'), 'x.docx').ok, false);
    assert.equal(chatFileValidator.validateChatAttachmentBuffer(Buffer.from('Rar!\x1a\x07'), 'x.rar').ok, false);

    // PDF /JavaScript ve /Launch reddedilir
    const jsPdf = chatFileValidator.validateChatAttachmentBuffer(SAMPLE_PDF_JS, 'kotu.pdf');
    assert.equal(jsPdf.ok, false);
    assert.equal(jsPdf.code, 'PDF_UNSAFE_ACTION');

    const launchPdf = chatFileValidator.validateChatAttachmentBuffer(SAMPLE_PDF_LAUNCH, 'calistir.pdf');
    assert.equal(launchPdf.ok, false);
    assert.equal(launchPdf.code, 'PDF_UNSAFE_ACTION');

    // TXT boyut sınırı (>1MB) ve NUL baytı reddedilir
    const hugeTxt = chatFileValidator.validateChatAttachmentBuffer(Buffer.alloc(1024 * 1024 + 5, 0x41), 'buyuk.txt');
    assert.equal(hugeTxt.ok, false);
    assert.equal(hugeTxt.code, 'FILE_TOO_LARGE');
    assert.equal(chatFileValidator.validateChatAttachmentBuffer(Buffer.from('abc\0def'), 'nul.txt').ok, false);

    // Dosya adı temizleme (../ ve çift uzantı hilesi)
    assert.equal(chatFileValidator.sanitizeOriginalFilename('../../saldiri.php.png', 'png'), 'saldiri_php.png');
    assert.ok(chatFileValidator.sanitizeOriginalFilename(`${'a'.repeat(120)}.pdf`, 'pdf').length <= 80);
  });

  await t.test('2) JPEG EXIF/APP1/APP13 bayt düzeyinde silinir ve bozuk JPEG reddedilir', () => {
    const withExif = makeJpegWithExif();
    assert.equal(withExif.includes('GPS_SECRET_COORD'), true);
    assert.equal(withExif.includes('IPTC_CAMERA_TAG'), true);

    const stripped = chatFileValidator.stripJpegMetadata(withExif);
    assert.equal(stripped.ok, true);
    assert.ok(stripped.strippedBytes > 20);
    assert.equal(stripped.buffer.includes('GPS_SECRET_COORD'), false);
    assert.equal(stripped.buffer.includes('IPTC_CAMERA_TAG'), false);
    // SOI, APP0 (JFIF) ve EOI korunur
    assert.equal(stripped.buffer[0], 0xff);
    assert.equal(stripped.buffer[1], 0xd8);
    assert.equal(stripped.buffer.includes('JFIF'), true);
    assert.equal(stripped.buffer[stripped.buffer.length - 2], 0xff);
    assert.equal(stripped.buffer[stripped.buffer.length - 1], 0xd9);

    // Bozuk / kesik JPEG reddedilir
    const corrupt = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x50, 0x01, 0x02]);
    const badRes = chatFileValidator.stripJpegMetadata(corrupt);
    assert.equal(badRes.ok, false);
    assert.equal(badRes.code, 'CORRUPT_JPEG');
  });

  let uploadedImgId = null;
  let uploadedPdfId = null;
  let uploadedMp4Id = null;
  let msgWithAttId = null;

  await t.test('3) Yükleme, mesaja bağlama (5 dosya OK, 6. dosya red), IDOR, başlıklar ve Range isteği', async () => {
    // JPEG (EXIF'li), PDF ve MP4 yükle
    const uJpg = await uploadMultipart(siteUrl, {
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      filename: '../../tatil.exe.jpg',
      buffer: makeJpegWithExif(),
    });
    assert.equal(uJpg.status, 201);
    assert.equal(uJpg.json.file.originalName, 'tatil_exe.jpg');
    uploadedImgId = uJpg.json.file.id;
    // Diskte EXIF gerçekten temizlenmiş olmalı
    const savedJpg = fs.readFileSync(path.join(store.filesDir, `${uploadedImgId}.jpg`));
    assert.equal(savedJpg.includes('GPS_SECRET_COORD'), false);

    const uPdf = await uploadMultipart(siteUrl, {
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      filename: 'kurallar.pdf',
      buffer: SAMPLE_PDF,
    });
    assert.equal(uPdf.status, 201);
    uploadedPdfId = uPdf.json.file.id;

    const uMp4 = await uploadMultipart(siteUrl, {
      cookie: sessA.cookie,
      csrf: sessA.csrfToken,
      filename: 'klip.mp4',
      buffer: SAMPLE_MP4,
    });
    assert.equal(uMp4.status, 201);
    uploadedMp4Id = uMp4.json.file.id;

    // 6. dosya mesaja eklenemez
    const tooMany = await fetch(`${siteUrl}/sohbet/api/sohbet/${USER_B}/mesaj`, {
      method: 'POST',
      headers: {
        Cookie: sessA.cookie,
        'X-CSRF-Token': sessA.csrfToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        text: '6 dosya testi',
        clientId: 'cid-6files',
        attachmentIds: ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32), 'd'.repeat(32), 'e'.repeat(32), 'f'.repeat(32)],
      }),
    });
    assert.equal(tooMany.status, 400);
    const tooManyJson = await tooMany.json();
    assert.equal(tooManyJson.code, 'TOO_MANY_ATTACHMENTS');

    // 3 dosyayı altyazıyla birlikte B'ye gönder
    const sendResp = await fetch(`${siteUrl}/sohbet/api/sohbet/${USER_B}/mesaj`, {
      method: 'POST',
      headers: {
        Cookie: sessA.cookie,
        'X-CSRF-Token': sessA.csrfToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        text: 'Ekli dosyalar burada',
        clientId: 'cid-att-1',
        attachmentIds: [uploadedImgId, uploadedPdfId, uploadedMp4Id],
      }),
    });
    assert.equal(sendResp.status, 201);
    const sendJson = await sendResp.json();
    msgWithAttId = sendJson.message.id;
    assert.equal(sendJson.message.attachments.length, 3);

    // IDOR: C, oturumsuz ve kayıtsız kullanıcılar 404 alır
    const cReq = await fetch(`${siteUrl}/sohbet/dosya/${uploadedImgId}`, { headers: { Cookie: sessC.cookie } });
    assert.equal(cReq.status, 404);
    const guestReq = await fetch(`${siteUrl}/sohbet/dosya/${uploadedImgId}`);
    assert.equal(guestReq.status, 404);
    const unregReq = await fetch(`${siteUrl}/sohbet/dosya/${uploadedImgId}`, { headers: { Cookie: sessUnreg.cookie } });
    assert.equal(unregReq.status, 404);

    // Katılımcı B görsele erişir -> 200, inline, nosniff, sandbox CSP
    const bImg = await fetch(`${siteUrl}/sohbet/dosya/${uploadedImgId}`, { headers: { Cookie: sessB.cookie } });
    assert.equal(bImg.status, 200);
    assert.equal(bImg.headers.get('content-type'), 'image/jpeg');
    assert.equal(bImg.headers.get('x-content-type-options'), 'nosniff');
    assert.match(bImg.headers.get('content-security-policy') || '', /sandbox/);
    assert.match(bImg.headers.get('content-disposition') || '', /^inline;/);

    // Katılımcı B PDF'e erişir -> attachment indirme zorunlu
    const bPdf = await fetch(`${siteUrl}/sohbet/dosya/${uploadedPdfId}`, { headers: { Cookie: sessB.cookie } });
    assert.equal(bPdf.status, 200);
    assert.match(bPdf.headers.get('content-disposition') || '', /^attachment;/);
    assert.equal(bPdf.headers.get('content-security-policy'), "default-src 'none'; sandbox");

    // Video Range isteği (206 Partial Content)
    const bRange = await fetch(`${siteUrl}/sohbet/dosya/${uploadedMp4Id}`, {
      headers: { Cookie: sessB.cookie, Range: 'bytes=0-15' },
    });
    assert.equal(bRange.status, 206);
    assert.match(bRange.headers.get('content-range') || '', /^bytes 0-15\//);
    const chunkBuf = Buffer.from(await bRange.arrayBuffer());
    assert.equal(chunkBuf.length, 16);
    assert.deepEqual(chunkBuf, SAMPLE_MP4.subarray(0, 16));
  });

  await t.test('4) Kota (200 MB/gün), disk dolu (%90+) ve yükleme hız sınırı (10/dk)', async () => {
    // Disk dolu senaryosu (%95)
    chatFileValidator.setDiskCheckOverrideForTests(() => ({ blocks: 1000, bavail: 50, bsize: 4096 }));
    const fullRes = await uploadMultipart(siteUrl, {
      cookie: sessC.cookie,
      csrf: sessC.csrfToken,
      filename: 'ok.png',
      buffer: SAMPLE_PNG,
    });
    assert.equal(fullRes.status, 507);
    assert.equal(fullRes.json.code, 'DISK_FULL');
    chatFileValidator.setDiskCheckOverrideForTests(null);

    // Kullanıcı C günlük kotasını 200MB'a yaklaştır -> yeni yükleme 413 QUOTA_EXCEEDED
    store.addDailyUploadBytes(USER_C, 200 * 1024 * 1024);
    const quotaRes = await uploadMultipart(siteUrl, {
      cookie: sessC.cookie,
      csrf: sessC.csrfToken,
      filename: 'kota.png',
      buffer: SAMPLE_PNG,
    });
    assert.equal(quotaRes.status, 413);
    assert.equal(quotaRes.json.code, 'QUOTA_EXCEEDED');

    // Kullanıcı D dakikada 10 yükleme yapar, 11. istek 429 RATE_LIMITED döner
    let hitRateLimit = false;
    for (let i = 1; i <= 12; i += 1) {
      const r = await uploadMultipart(siteUrl, {
        cookie: sessD.cookie,
        csrf: sessD.csrfToken,
        filename: `rl_${i}.png`,
        buffer: SAMPLE_PNG,
      });
      if (r.status === 429 && r.json && r.json.code === 'RATE_LIMITED') {
        hitRateLimit = true;
        break;
      }
      assert.equal(r.status, 201);
    }
    assert.equal(hitRateLimit, true, 'Dakikada 10 yükleme sınırı tetiklenmeli');
  });

  await t.test('5) Mesaj silme, 30 gün temizliği (preserved istisnası), sahipsiz dosya ve 1 saat tmp temizliği', async () => {
    // PDF'i Parça 4 vaka koruma işaretiyle koru; IMG korunmasın
    store.markFilePreserved(uploadedPdfId, 'case_test_1');

    // Mesaj silindiğinde korunmayan IMG ve MP4 diskten silinir, korunan PDF korunur!
    const delResp = await fetch(`${siteUrl}/sohbet/api/sohbet/${USER_B}/mesaj/${msgWithAttId}`, {
      method: 'DELETE',
      headers: { Cookie: sessA.cookie, 'X-CSRF-Token': sessA.csrfToken, Accept: 'application/json' },
    });
    assert.equal(delResp.status, 200);
    assert.equal(fs.existsSync(path.join(store.filesDir, `${uploadedImgId}.jpg`)), false);
    assert.equal(fs.existsSync(path.join(store.filesDir, `${uploadedMp4Id}.mp4`)), false);
    assert.equal(fs.existsSync(path.join(store.filesDir, `${uploadedPdfId}.pdf`)), true);

    // 30 gün dolmuş mesajın ekini silme + sahipsiz dosya + 2 saatlik yarım tmp dosyası temizliği
    const oldFid = crypto.randomBytes(16).toString('hex');
    const oldFilePath = path.join(store.filesDir, `${oldFid}.png`);
    fs.writeFileSync(oldFilePath, SAMPLE_PNG);
    const convId = makeConvId(USER_A, USER_B);
    const now = Date.now();
    const oldTs = now - 32 * 86400000;
    const oldMsg = store.appendMessage(convId, {
      from: USER_A,
      text: 'Eski ekli mesaj',
      attachments: [{ id: oldFid, originalName: 'eski.png', ext: 'png', mimeType: 'image/png', category: 'image', size: SAMPLE_PNG.length, url: `/sohbet/dosya/${oldFid}` }],
      ts: oldTs,
    });
    store.registerFileMeta({
      id: oldFid,
      storedName: `${oldFid}.png`,
      ext: 'png',
      mimeType: 'image/png',
      category: 'image',
      size: SAMPLE_PNG.length,
      originalName: 'eski.png',
      uploaderId: USER_A,
      convId,
      msgId: oldMsg.message.id,
      createdAt: oldTs,
      preserved: false,
    });

    // Sahipsiz disk dosyası (meta'da yok)
    const orphanPath = path.join(store.filesDir, 'orphan_unknown_file.png');
    fs.writeFileSync(orphanPath, SAMPLE_PNG);
    const oldMtime = new Date(now - 60000);
    fs.utimesSync(orphanPath, oldMtime, oldMtime);

    // 2 saat önce kalmış yarım tmp dosyası
    const staleTmpPath = path.join(store.tmpDir, 'aborted_upload.part');
    fs.writeFileSync(staleTmpPath, Buffer.from('partial'));
    const twoHoursAgo = new Date(now - 2 * 3600 * 1000);
    fs.utimesSync(staleTmpPath, twoHoursAgo, twoHoursAgo);

    const cleanRes = store.runRetentionCleanup({ retentionDays: 30, nowTs: now, silent: true });
    assert.equal(fs.existsSync(oldFilePath), false, '30 günü dolan ek silinmeli');
    assert.equal(fs.existsSync(orphanPath), false, 'Sahipsiz dosya temizlenmeli');
    assert.equal(fs.existsSync(staleTmpPath), false, '1 saati geçen yarım tmp dosyası silinmeli');
    assert.ok(cleanRes.removedFiles >= 1);
    assert.ok(cleanRes.removedOrphanFiles >= 1);
    assert.ok(cleanRes.removedTmpFiles >= 1);
  });

  await t.test('6) Parça 3 istemci kodu ve CSS sabit #hex renk içermez', () => {
    const attJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'chat-attachments.js'), 'utf8');
    assert.equal((attJs.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length, 0);
    const styleCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
    const sec17 = styleCss.slice(styleCss.indexOf('17. SOHBET DOSYA EKLERİ'));
    assert.equal((sec17.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length, 0);
  });
});
