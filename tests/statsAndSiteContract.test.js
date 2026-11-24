/**
 * Site İstatistik Katmanı, Bot-Site Sözleşmesi, Geriye Uyumluluk ve Güvenlik Testleri
 * Kapsam: T6, G5 (site tarafı), C2–C7
 * Yalnızca Node.js yerleşik modüllerini ve mevcut proje dosyalarını kullanır (ek paket yok).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempVolDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piyade-site-stats-test-'));
const TEST_SESSION_SECRET = 'test_site_session_secret_minimum_32_chars_long';
const TEST_API_SECRET = 'test_bot_api_shared_secret_12345';

// Sahte Bot HTTP sunucusu (test boyunca davranışını değiştirebiliriz)
let mockBotServer = null;
let mockBotPort = 0;
let botHandler = () => ({ status: 200, body: {} });
const recordedBotRequests = [];

function signSessionCookie(sid, secret) {
  const sig = crypto
    .createHmac('sha256', secret)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '');
  return `piyade.sid=${encodeURIComponent(`s:${sid}.${sig}`)}`;
}

async function startMockBotServer() {
  return new Promise((resolve) => {
    mockBotServer = http.createServer((req, res) => {
      recordedBotRequests.push({
        method: req.method,
        url: req.url,
        auth: req.headers.authorization || '',
      });
      const result = botHandler(req);
      const status = result?.status ?? 200;
      const contentType = result?.contentType || 'application/json; charset=utf-8';
      res.writeHead(status, { 'Content-Type': contentType });
      if (typeof result?.rawBody === 'string') {
        res.end(result.rawBody);
      } else {
        res.end(JSON.stringify(result?.body ?? {}));
      }
    });
    mockBotServer.listen(0, '127.0.0.1', () => {
      mockBotPort = mockBotServer.address().port;
      resolve();
    });
  });
}

let siteApp = null;
let siteServer = null;
let siteBaseUrl = '';
let botApiClient = null;
let siteConfig = null;
let formatDurationUtils = null;

test.before(async () => {
  await startMockBotServer();

  process.env.NODE_ENV = 'test';
  process.env.PORT = '0';
  process.env.BASE_URL = 'http://127.0.0.1:3001';
  process.env.BOT_API_URL = `http://127.0.0.1:${mockBotPort}`;
  process.env.API_SECRET = TEST_API_SECRET;
  process.env.SESSION_SECRET = TEST_SESSION_SECRET;
  process.env.DISCORD_CLIENT_ID = '123456789012345678';
  process.env.DISCORD_CLIENT_SECRET = 'fake_discord_secret';
  process.env.RAILWAY_VOLUME_MOUNT_PATH = tempVolDir;

  formatDurationUtils = require('../utils/formatDuration');
  siteConfig = require('../config/site.config');
  botApiClient = require('../services/botApiClient');
  const { createServerApp } = require('../server');

  siteApp = createServerApp();
  await new Promise((resolve) => {
    siteServer = siteApp.listen(0, '127.0.0.1', () => {
      siteBaseUrl = `http://127.0.0.1:${siteServer.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (siteServer) {
    siteServer.closeAllConnections?.();
    await new Promise((resolve) => siteServer.close(resolve));
  }
  if (mockBotServer) {
    mockBotServer.closeAllConnections?.();
    await new Promise((resolve) => mockBotServer.close(resolve));
  }
  try {
    fs.rmSync(tempVolDir, { recursive: true, force: true });
  } catch (_) {}
});

function clearAllCaches() {
  botApiClient.clearSummaryCache();
  botApiClient.clearTopGamesCache();
  recordedBotRequests.length = 0;
}

async function seedSession(sid, userObj) {
  await new Promise((resolve, reject) => {
    siteApp.locals.sessionStore.set(
      sid,
      {
        cookie: {
          originalMaxAge: 86400000,
          expires: new Date(Date.now() + 86400000).toISOString(),
          httpOnly: true,
          path: '/',
        },
        user: {
          ...userObj,
          rolesSyncedAt: Date.now(), // 60 sn içinde tekrar /roles sormasın
        },
      },
      (err) => (err ? reject(err) : resolve())
    );
  });
  return signSessionCookie(sid, TEST_SESSION_SECRET);
}

// ============================================================================
// T6) HERO VE ÜST ŞERİT AYNI VERİ KAYNAĞINDAN BESLENİR (AYRI HESAP YOK)
// ============================================================================

test('T6) Hero ve üst şerit birebir aynı activeThisMonth ve playingNow değerlerini gösterir (TR & EN)', async () => {
  clearAllCaches();
  const computedAtIso = new Date(Date.now() - 2 * 60_000).toISOString();

  botHandler = (req) => {
    if (req.url.startsWith('/api/stats/summary')) {
      return {
        status: 200,
        body: {
          activeThisMonth: 11,
          playingNow: 3,
          uncertainCount: 1,
          computedAt: computedAtIso,
          activeRegisteredCount: 11,
          totalMemberCount: 45,
          onlineCount: 14,
          playingCount: 3,
          updatedAt: Date.now(),
          families: [],
        },
      };
    }
    if (req.url.startsWith('/api/stats/top-games')) {
      return {
        status: 200,
        body: {
          scope: 'month',
          group: 'family',
          month: '2026-11',
          updatedAt: Date.now(),
          computedAt: computedAtIso,
          totalSeconds: 18000,
          families: [
            {
              key: 'roblox',
              label: 'Roblox',
              emoji: '🧱',
              totalSeconds: 14400,
              uniquePlayers: 4,
              rank: 1,
              percent: 80,
              hours: 4,
              formattedDuration: '4 sa',
            },
            {
              key: 'minecraft',
              label: 'Minecraft',
              emoji: '⛏️',
              totalSeconds: 3600,
              uniquePlayers: 2,
              rank: 2,
              percent: 20,
              hours: 1,
              formattedDuration: '1 sa',
            },
          ],
          games: [
            {
              id: 'roblox',
              name: 'Roblox',
              emoji: '🧱',
              family: 'roblox',
              seconds: 14400,
              hours: 4,
              percent: 80,
              players: 4,
            },
          ],
        },
      };
    }
    return { status: 200, body: { ok: true } };
  };

  const resTr = await fetch(`${siteBaseUrl}/`);
  assert.equal(resTr.status, 200);
  const htmlTr = await resTr.text();

  const heroActiveMatch = htmlTr.match(/data-stat="hero-active-month"\s+data-stat-value="(\d+)"/);
  const topActiveMatch = htmlTr.match(/data-stat="top-active-month"\s+data-stat-value="(\d+)"/);
  const heroPlayingMatch = htmlTr.match(/data-stat="hero-playing-now"\s+data-stat-value="(\d+)"/);
  const topPlayingMatch = htmlTr.match(/data-stat="top-playing-now"\s+data-stat-value="(\d+)"/);

  assert.ok(heroActiveMatch && topActiveMatch, 'Hero ve üst şerit activeThisMonth veri öznitelikleri olmalı');
  assert.ok(heroPlayingMatch && topPlayingMatch, 'Hero ve üst şerit playingNow veri öznitelikleri olmalı');
  assert.equal(heroActiveMatch[1], '11');
  assert.equal(topActiveMatch[1], '11');
  assert.equal(heroPlayingMatch[1], '3');
  assert.equal(topPlayingMatch[1], '3');
  assert.ok(htmlTr.includes('11 Aktif') || htmlTr.includes('<span>Aktif</span>'));
  assert.ok(!htmlTr.includes('Bu ay aktif'), '"Bu ay aktif" yerine yalnızca "Aktif" görünmeli');
  assert.ok(htmlTr.includes('Şu an oyunda'));
  assert.ok(htmlTr.includes('Son güncelleme:'));

  // EN kontrolü
  const resEn = await fetch(`${siteBaseUrl}/en`);
  assert.equal(resEn.status, 200);
  const htmlEn = await resEn.text();
  assert.ok(htmlEn.includes('11 Active') || htmlEn.includes('<span>Active</span>'));
  assert.ok(!htmlEn.includes('Active this month'), '"Active this month" yerine yalnızca "Active" görünmeli');
  assert.ok(htmlEn.includes('Playing now'));
  assert.ok(htmlEn.includes('Last updated:'));
});

// ============================================================================
// G5 (SİTE TARAFI): ROBLOX TEK SATIR + İSTEĞE BAĞLI BREAKDOWN + ETKİNLİĞİM
// ============================================================================

test('G5) Site anasayfa sıralaması ve Etkinliğim (/api/me/activity) botun grupladığı tek "Roblox" satırını ve opsiyonel breakdown\'ı gösterir', async () => {
  clearAllCaches();

  botHandler = (req) => {
    if (req.url.startsWith('/api/stats/summary')) {
      return {
        status: 200,
        body: {
          activeThisMonth: 5,
          playingNow: 1,
          uncertainCount: 0,
          computedAt: new Date().toISOString(),
          activeRegisteredCount: 5,
          playingCount: 1,
          updatedAt: Date.now(),
          families: [],
        },
      };
    }
    if (req.url.startsWith('/api/stats/top-games')) {
      return {
        status: 200,
        body: {
          scope: 'month',
          group: 'family',
          month: '2026-11',
          updatedAt: Date.now(),
          computedAt: new Date().toISOString(),
          totalSeconds: 150420,
          families: [
            {
              key: 'roblox',
              label: 'Roblox',
              emoji: '🧱',
              totalSeconds: 150420,
              uniquePlayers: 5,
              rank: 1,
              percent: 100,
              hours: 41.8,
              formattedDuration: '41 sa 47 dk',
              breakdown: {
                items: [{ id: 'tsb', name: 'The Strongest Battlegrounds', seconds: 7200, formattedDuration: '2 sa' }],
                overflowCount: 2,
                formattedLine: 'içinde: The Strongest Battlegrounds 2 sa, +2 diğer',
              },
            },
          ],
          games: [],
        },
      };
    }
    if (req.url.startsWith('/api/member/777000111222333444/activity')) {
      return {
        status: 200,
        body: {
          userId: '777000111222333444',
          month: '2026-11',
          tracking: true,
          totalSeconds: 4200,
          families: [
            {
              key: 'roblox',
              label: 'Roblox',
              emoji: '🧱',
              totalSeconds: 4200,
              uniquePlayers: 1,
              rank: 1,
              percent: 100,
              formattedDuration: '1 sa 10 dk',
            },
          ],
          games: [
            {
              id: 'roblox',
              name: 'Roblox',
              emoji: '🧱',
              family: 'roblox',
              seconds: 4200,
              percent: 100,
              formattedDuration: '1 sa 10 dk',
            },
          ],
          live: null,
          nextResetAt: Date.now() + 86400000,
        },
      };
    }
    return { status: 200, body: { ok: true } };
  };

  // Anasayfa sıralaması
  const homeRes = await fetch(`${siteBaseUrl}/`);
  assert.equal(homeRes.status, 200);
  const homeHtml = await homeRes.text();
  assert.ok(homeHtml.includes('Roblox'));
  assert.ok(homeHtml.includes('41 sa 47 dk'));
  assert.ok(homeHtml.includes('topgames-breakdown'));
  assert.ok(homeHtml.includes('+2 diğer'));
  assert.ok(!homeHtml.includes('Roblox (diğer)'));

  // Etkinliğim API
  const cookie = await seedSession('sess-g5', {
    id: '777000111222333444',
    username: 'piyade_member',
    displayName: 'Piyade Member',
    roles: [{ id: '1559604702143062016', name: 'Cengaver' }],
    level: 'registered',
    registered: true,
  });

  const meRes = await fetch(`${siteBaseUrl}/api/me/activity`, { headers: { Cookie: cookie } });
  assert.equal(meRes.status, 200);
  const meBody = await meRes.json();
  assert.equal(meBody.ok, true);
  assert.equal(meBody.families.length, 1);
  assert.equal(meBody.families[0].key, 'roblox');
  assert.equal(meBody.families[0].label, 'Roblox');
  assert.equal(meBody.families[0].formattedDuration, '1 sa 10 dk');
  assert.equal(meBody.games[0].id, 'roblox');
});

// ============================================================================
// C2 & C3) GERİYE DÖNÜK UYUMLULUK (YENİ SİTE + ESKİ BOT / ESKİ SİTE + YENİ BOT)
// ============================================================================

test('C2) Yeni site + ESKİ bot (activeThisMonth/playingNow/families YOK): çökmez, sessizce eski gösterime düşer', async () => {
  clearAllCaches();

  botHandler = (req) => {
    if (req.url.startsWith('/api/stats/summary')) {
      return {
        status: 200,
        body: {
          // Sadece eski bot alanları
          activeRegisteredCount: 9,
          totalMemberCount: 30,
          onlineCount: 10,
          playingCount: 2,
          updatedAt: Date.now() - 15_000,
        },
      };
    }
    if (req.url.startsWith('/api/stats/top-games')) {
      return {
        status: 200,
        body: {
          // Sadece eski games dizisi (families ve computedAt yok)
          scope: 'month',
          month: '2026-11',
          updatedAt: Date.now() - 15_000,
          totalSeconds: 7200,
          games: [
            { id: 'minecraft', name: 'Minecraft', emoji: '⛏️', seconds: 7200, hours: 2, percent: 100, players: 3 },
          ],
        },
      };
    }
    return { status: 200, body: { ok: true } };
  };

  const res = await fetch(`${siteBaseUrl}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('data-stat="hero-active-month" data-stat-value="9"'));
  assert.ok(html.includes('data-stat="top-active-month" data-stat-value="9"'));
  assert.ok(html.includes('Minecraft'));
  assert.ok(html.includes('2 sa'));
  assert.ok(!/\b(NaN|Infinity|undefined)\b/.test(html));
});

test('C3) Eski site sözleşmesi + YENİ bot: proxy yanıtında hem yeni families hem eski games alanları mevcuttur', async () => {
  clearAllCaches();

  botHandler = (req) => {
    if (req.url.startsWith('/api/stats/top-games')) {
      return {
        status: 200,
        body: {
          scope: 'month',
          group: 'family',
          month: '2026-11',
          updatedAt: Date.now(),
          computedAt: new Date().toISOString(),
          totalSeconds: 3600,
          families: [
            {
              key: 'cs2',
              label: 'Counter-Strike 2',
              emoji: '🎯',
              totalSeconds: 3600,
              uniquePlayers: 2,
              rank: 1,
              percent: 100,
              hours: 1,
              formattedDuration: '1 sa',
            },
          ],
          games: [
            {
              id: 'cs2',
              name: 'Counter-Strike 2',
              emoji: '🎯',
              family: 'cs2',
              seconds: 3600,
              hours: 1,
              percent: 100,
              players: 2,
            },
          ],
        },
      };
    }
    return { status: 200, body: { ok: true } };
  };

  const res = await fetch(`${siteBaseUrl}/api/stats/top-games?scope=month&lang=tr`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.families[0].key, 'cs2');
  assert.equal(body.games[0].id, 'cs2');
  assert.equal(body.games[0].seconds, 3600);
  assert.ok(botApiClient.TOP_GAMES_CACHE_TTL_MS <= 60 * 1000, 'Site önbellek süresi 60 sn\'yi geçmemeli');
  assert.ok(botApiClient.SUMMARY_CACHE_TTL_MS <= 60 * 1000, 'Özet önbellek süresi 60 sn\'yi geçmemeli');
});

// ============================================================================
// C4) BOT ERİŞİLEMEZ / BOZUK YANIT: SON İYİ VERİ + SESSİZ UYARI, ÇÖKME YOK
// ============================================================================

test('C4) Bot erişilemez veya bozuk HTML döndürürse site son iyi veriyi korur, "veri güncellenemedi" gösterir ve çökmez', async () => {
  clearAllCaches();

  // 1. Adım: Bot sağlıklı iken iyi veriyi bellek önbelleğine al
  botHandler = (req) => {
    if (req.url.startsWith('/api/stats/summary')) {
      return {
        status: 200,
        body: {
          activeThisMonth: 7,
          playingNow: 2,
          uncertainCount: 0,
          computedAt: new Date().toISOString(),
          activeRegisteredCount: 7,
          playingCount: 2,
          updatedAt: Date.now(),
          families: [],
        },
      };
    }
    if (req.url.startsWith('/api/stats/top-games')) {
      return {
        status: 200,
        body: {
          scope: 'month',
          group: 'family',
          month: '2026-11',
          updatedAt: Date.now(),
          computedAt: new Date().toISOString(),
          totalSeconds: 10800,
          families: [
            {
              key: 'roblox',
              label: 'Roblox',
              emoji: '🧱',
              totalSeconds: 10800,
              uniquePlayers: 3,
              rank: 1,
              percent: 100,
              hours: 3,
              formattedDuration: '3 sa',
            },
          ],
          games: [],
        },
      };
    }
    return { status: 200, body: { ok: true } };
  };

  const goodSummary = await botApiClient.getServerStatsSummary({ forceRefresh: true, lang: 'tr' });
  const goodTop = await botApiClient.getTopGames({ forceRefresh: true, scope: 'month', group: 'family', lang: 'tr' });
  assert.equal(goodSummary.activeThisMonth, 7);
  assert.equal(goodTop.families[0].label, 'Roblox');

  // 2. Adım: Bot artık 503 / bozuk HTML döndürüyor
  botHandler = () => ({
    status: 503,
    contentType: 'text/html',
    rawBody: '<html><body>503 Bad Gateway</body></html>',
  });

  const staleSummary = await botApiClient.getServerStatsSummary({ forceRefresh: true, lang: 'tr', timeoutMs: 1000 });
  const staleTop = await botApiClient.getTopGames({ forceRefresh: true, scope: 'month', group: 'family', lang: 'tr', timeoutMs: 1000 });

  assert.equal(staleSummary.activeThisMonth, 7, 'Son iyi aktif oyuncu sayısı korunmalı');
  assert.equal(staleSummary.playingNow, 2, 'Son iyi şu an oyunda sayısı korunmalı');
  assert.equal(staleSummary.stale, true);
  assert.equal(staleSummary.refreshFailed, true);

  assert.equal(staleTop.families[0].label, 'Roblox', 'Son iyi oyun sıralaması korunmalı');
  assert.equal(staleTop.stale, true);
  assert.equal(staleTop.refreshFailed, true);

  // lastKnownActiveStats da silinmeden korunmuş ve bayat işaretli olmalı
  const lastKnown = botApiClient.getLastKnownActiveStats();
  assert.equal(lastKnown.activeThisMonth, 7);
  assert.equal(lastKnown.stale, true);

  // Sayfa çökmeden 200 dönmeli ve sessizce "veri güncellenemedi" ibaresini göstermeli
  const res = await fetch(`${siteBaseUrl}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('7'));
  assert.ok(html.includes('Roblox'));
});

// ============================================================================
// C5) NaN / undefined / Infinity HİÇBİR YERDE GÖRÜNMEZ
// ============================================================================

test('C5) NaN / undefined / Infinity değerleri formatDuration, anasayfa ve API çıktılarında ASLA görünmez', async () => {
  const { formatDuration, formatRelativeUpdated } = formatDurationUtils;

  // Sınır durumları (TR & EN)
  assert.equal(formatDuration(0, 'tr'), '0 dk');
  assert.equal(formatDuration(0, 'en'), '0 min');
  assert.equal(formatDuration(59, 'tr'), "1 dk'dan az");
  assert.equal(formatDuration(59, 'en'), '<1 min');
  assert.equal(formatDuration(3600, 'tr'), '1 sa');
  assert.equal(formatDuration(3600, 'en'), '1 hr');
  assert.equal(formatDuration(119.6 * 60, 'tr'), '1 sa 59 dk');
  assert.equal(formatDuration(119.6 * 60, 'en'), '1 hr 59 min');
  assert.equal(formatDuration(41 * 3600 + 47 * 60, 'tr'), '41 sa 47 dk');

  for (const bad of [NaN, Infinity, -Infinity, -100, null, undefined, 'bad']) {
    assert.equal(formatDuration(bad, 'tr'), '0 dk');
    assert.equal(formatDuration(bad, 'en'), '0 min');
    assert.equal(formatRelativeUpdated(bad, 'tr'), '');
  }

  // Bozuk alanlı bot yanıtı geldiğinde bile sayfada NaN / Infinity / undefined çıkmamalı
  clearAllCaches();
  botHandler = (req) => {
    if (req.url.startsWith('/api/stats/summary')) {
      return {
        status: 200,
        body: {
          activeThisMonth: 0,
          playingNow: 0,
          uncertainCount: null,
          computedAt: 'not-a-date',
          activeRegisteredCount: 0,
          playingCount: null,
          updatedAt: null,
          families: [],
        },
      };
    }
    if (req.url.startsWith('/api/stats/top-games')) {
      return {
        status: 200,
        body: {
          scope: 'month',
          group: 'family',
          month: '2026-11',
          updatedAt: null,
          computedAt: 'invalid',
          totalSeconds: null,
          families: [
            {
              key: 'roblox',
              label: 'Roblox',
              emoji: '🧱',
              totalSeconds: 120,
              uniquePlayers: null,
              rank: null,
              formattedDuration: 'NaN sa Infinity dk',
            },
            {
              key: 'broken',
              label: 'Broken',
              totalSeconds: 'Infinity',
            },
          ],
          games: [],
        },
      };
    }
    return { status: 200, body: { ok: true } };
  };

  const res = await fetch(`${siteBaseUrl}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(!/\bNaN\b/.test(html), 'HTML içinde NaN görünmemeli');
  assert.ok(!/\bInfinity\b/.test(html), 'HTML içinde Infinity görünmemeli');
  assert.ok(!/\bundefined\b/.test(html), 'HTML içinde undefined görünmemeli');
  assert.ok(html.includes('2 dk'), 'Bozuk formattedDuration yok sayılıp güvenli 2 dk hesaplanmalı');
});

// ============================================================================
// C6) ASSET_VERSION OTOMATİK SÜRÜMLEME
// ============================================================================

test('C6) ASSET_VERSION 2.2.0-<hash> üretir, CSS/JS değişince yeni hash verir ve sayfa linklerinde yer alır', async () => {
  assert.match(siteConfig.ASSET_VERSION, /^2\.2\.0-[0-9a-f]{8}$/);

  // Geçici dizinde aynı statik dosyalarla hash değişikliği testi
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piyade-asset-ver-'));
  try {
    const cssDir = path.join(tempRoot, 'public', 'css');
    const jsDir = path.join(tempRoot, 'public', 'js');
    fs.mkdirSync(cssDir, { recursive: true });
    fs.mkdirSync(jsDir, { recursive: true });
    fs.writeFileSync(path.join(cssDir, 'style.css'), 'body { color: #fff; }');
    fs.writeFileSync(path.join(jsDir, 'top-games.js'), 'console.log(1);');

    const publicDir = path.join(tempRoot, 'public');
    const v1 = siteConfig.computeAssetVersion('2.2.0', publicDir);
    assert.match(v1, /^2\.2\.0-[0-9a-f]{8}$/);

    fs.writeFileSync(path.join(cssDir, 'style.css'), 'body { color: #000; }');
    const v2 = siteConfig.computeAssetVersion('2.2.0', publicDir);
    assert.match(v2, /^2\.2\.0-[0-9a-f]{8}$/);
    assert.notEqual(v1, v2, 'CSS değişince ASSET_VERSION yeni hash üretmeli');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  // Anasayfa HTML içinde ?v=<ASSET_VERSION> parametreleri bozulmamış olmalı
  const res = await fetch(`${siteBaseUrl}/`);
  const html = await res.text();
  assert.ok(html.includes(`/css/style.css?v=${siteConfig.ASSET_VERSION}`));
  assert.ok(html.includes(`/js/top-games.js?v=${siteConfig.ASSET_VERSION}`) || html.includes(`/js/top-games.js?v=`));
});

// ============================================================================
// C7) ETKİNLİĞİM YALNIZCA KİŞİNİN KENDİ VERİSİNİ GÖSTERİR
// ============================================================================

test('C7) /api/me/activity giriş/kayıt zorunlu kılar ve dışarıdan ID verilse bile yalnızca oturum sahibinin verisini çeker', async () => {
  clearAllCaches();
  const selfId = '111222333444555666';
  const otherId = '999888777666555444';

  botHandler = (req) => {
    if (req.url.startsWith(`/api/member/${selfId}/activity`)) {
      return {
        status: 200,
        body: {
          userId: selfId,
          month: '2026-11',
          tracking: true,
          totalSeconds: 600,
          families: [{ key: 'roblox', label: 'Roblox', emoji: '🧱', totalSeconds: 600, uniquePlayers: 1, rank: 1 }],
          games: [],
          live: null,
        },
      };
    }
    return { status: 404, body: { error: 'Not Found' } };
  };

  // 1) Giriş yapmamış ziyaretçi -> 401
  const unauthRes = await fetch(`${siteBaseUrl}/api/me/activity`);
  assert.equal(unauthRes.status, 401);

  // 2) Giriş yapmış ama kayıtsız üye -> 403
  const unregCookie = await seedSession('sess-unreg', {
    id: '555666777888999000',
    username: 'guest_user',
    displayName: 'Guest',
    roles: [],
    level: 'unregistered',
    registered: false,
  });
  const unregRes = await fetch(`${siteBaseUrl}/api/me/activity`, { headers: { Cookie: unregCookie } });
  assert.equal(unregRes.status, 403);

  // 3) Kayıtlı üye başka kullanıcı ID'si enjekte etmeye çalışsa bile yalnızca KENDİ ID'si çekilir
  const regCookie = await seedSession('sess-self', {
    id: selfId,
    username: 'self_user',
    displayName: 'Self User',
    roles: [{ id: '1559604702143062016', name: 'Cengaver' }],
    level: 'registered',
    registered: true,
  });
  recordedBotRequests.length = 0;

  const selfRes = await fetch(
    `${siteBaseUrl}/api/me/activity?userId=${otherId}&id=${otherId}&discordId=${otherId}`,
    { headers: { Cookie: regCookie } }
  );
  assert.equal(selfRes.status, 200);
  const selfBody = await selfRes.json();
  assert.equal(selfBody.userId, selfId);

  const memberCalls = recordedBotRequests.filter((r) => r.url.includes('/api/member/'));
  assert.equal(memberCalls.length, 1);
  assert.ok(memberCalls[0].url.startsWith(`/api/member/${selfId}/activity`));
  assert.ok(!memberCalls[0].url.includes(otherId), 'Başka kullanıcının ID\'si bot API\'ye ASLA iletilmemeli');
});
