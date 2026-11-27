const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const serversConfig = require('../config/servers.config');
const {
  ServerDirectory,
  setDefaultServerDirectory,
  parseDiscordInvitePayload,
} = require('../services/serverDirectory');
const carouselMod = require('../public/js/servers-carousel');
const menuConfig = require('../config/menu.config');
const { ROLES } = require('../config/roles.config');
const botApiClient = require('../services/botApiClient');
const discordAuthService = require('../services/discordAuthService');
const { MemberStore, setDefaultMemberStore } = require('../services/memberStore');
const { createServerApp } = require('../server');

function makeFakeResponse(status, body, headersMap = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headersMap || {})) {
    lower[k.toLowerCase()] = String(v);
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return lower[String(name || '').toLowerCase()] || null;
      },
    },
    async json() {
      return typeof body === 'string' ? JSON.parse(body) : body;
    },
  };
}

function makeTempDir(prefix = 'piyade-srv-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeSampleInvitePayload(opts = {}) {
  const guildId = opts.guildId !== undefined ? opts.guildId : '1410000000000000000';
  const name = opts.name !== undefined ? opts.name : 'Piyade World | Satış';
  const icon = opts.icon !== undefined ? opts.icon : 'a_abc1234567890';
  const banner = opts.banner !== undefined ? opts.banner : 'ban987654321';
  const hasMemberCount = Object.prototype.hasOwnProperty.call(opts, 'memberCount');
  const hasOnlineCount = Object.prototype.hasOwnProperty.call(opts, 'onlineCount');
  const memberCount = hasMemberCount ? opts.memberCount : 420;
  const onlineCount = hasOnlineCount ? opts.onlineCount : 87;
  const includeProfile = opts.includeProfile !== undefined ? opts.includeProfile : true;
  const expiresAt = opts.expiresAt !== undefined ? opts.expiresAt : null;
  const features = opts.features !== undefined ? opts.features : ['COMMUNITY', 'VERIFIED'];
  const traits = opts.traits !== undefined ? opts.traits : [
    { label: 'Roblox', emoji_id: '123456789012345678', emoji_name: 'rbx' },
    { label: 'Aktif Sohbet', emoji_name: '🔥' },
  ];
  const gameApplicationIds = opts.gameApplicationIds !== undefined ? opts.gameApplicationIds : ['998877665544332211'];

  const payload = {
    code: 'y2aA9U5RyR',
    expires_at: expiresAt,
    guild: {
      id: guildId,
      name,
      icon,
      banner,
      splash: null,
      features,
      description: 'Topluluk sunucusu açıklaması',
      premium_subscription_count: 14,
    },
  };
  if (memberCount !== undefined && memberCount !== null) payload.approximate_member_count = memberCount;
  if (onlineCount !== undefined && onlineCount !== null) payload.approximate_presence_count = onlineCount;
  if (includeProfile) {
    payload.profile = {
      id: guildId,
      name,
      brand_color_primary: '#7c3aed',
      tag: 'PYD',
      badge: 'community',
      traits,
      game_application_ids: gameApplicationIds,
    };
  }
  return payload;
}

// ============================================================================
// 1) DAVET AYRIŞTIRMA, SSRF VE REDIRECT: ERROR TESTLERİ
// ============================================================================

test('extractInviteCode accepts all valid Discord invite formats and rejects SSRF / invalid inputs', () => {
  assert.equal(serversConfig.extractInviteCode('y2aA9U5RyR'), 'y2aA9U5RyR');
  assert.equal(serversConfig.extractInviteCode('CnVBC6JTg'), 'CnVBC6JTg');
  assert.equal(serversConfig.extractInviteCode('discord.gg/TvuAbUbKJj'), 'TvuAbUbKJj');
  assert.equal(serversConfig.extractInviteCode('https://discord.gg/TvuAbUbKJj/'), 'TvuAbUbKJj');
  assert.equal(serversConfig.extractInviteCode('http://www.discord.gg/m4BaGwRsNu?event=123'), 'm4BaGwRsNu');
  assert.equal(serversConfig.extractInviteCode('https://discord.com/invite/GW2za6Jpdr'), 'GW2za6Jpdr');
  assert.equal(serversConfig.extractInviteCode('discordapp.com/invite/kTVBJtMtG'), 'kTVBJtMtG');
  assert.equal(serversConfig.extractInviteCode('https://www.discordapp.com/invite/abc-123'), 'abc-123');

  // Geçersiz kodlar ve SSRF denemeleri reddedilir
  assert.equal(serversConfig.extractInviteCode(''), null);
  assert.equal(serversConfig.extractInviteCode('a'), null);
  assert.equal(serversConfig.extractInviteCode('a'.repeat(33)), null);
  assert.equal(serversConfig.extractInviteCode('bad code'), null);
  assert.equal(serversConfig.extractInviteCode('https://evil.com/invite/y2aA9U5RyR'), null);
  assert.equal(serversConfig.extractInviteCode('https://discord.gg.evil.com/y2aA9U5RyR'), null);
  assert.equal(serversConfig.extractInviteCode('http://127.0.0.1/invite/y2aA9U5RyR'), null);
  assert.equal(serversConfig.extractInviteCode('http://169.254.169.254/latest/meta-data/'), null);
  assert.equal(serversConfig.extractInviteCode('https://discord.com/api/v10/users/@me'), null);
  assert.equal(serversConfig.extractInviteCode('https://discord.com/invite/../users'), null);
  assert.equal(serversConfig.extractInviteCode('javascript:alert(1)'), null);
  assert.equal(serversConfig.extractInviteCode('https://user:pass@discord.gg/y2aA9U5RyR'), null);
  assert.equal(serversConfig.extractInviteCode('https://discord.gg:8080/y2aA9U5RyR'), null);
});

test('fetchDiscordInvite enforces hardcoded discord.com origin and redirect: error rejection', async () => {
  const dir = makeTempDir();
  const seenCalls = [];
  const store = new ServerDirectory({
    baseDir: dir,
    sleepFn: async () => {},
    fetchFn: async (url, opts) => {
      seenCalls.push({ url, opts });
      assert.equal(opts.redirect, 'error');
      assert.equal(opts.headers['User-Agent'], 'PiyadeWorld-Site/1.0');
      assert.ok(url.startsWith('https://discord.com/api/v10/invites/'));
      throw new TypeError('Failed to fetch: redirect mode is set to error');
    },
  });

  try {
    const res = await store.fetchDiscordInvite('y2aA9U5RyR');
    assert.equal(res.ok, false);
    assert.equal(res.kind, 'error');
    assert.equal(seenCalls.length, 1);

    // Geçersiz kodla fetchFn hiç çağrılmaz
    const badRes = await store.fetchDiscordInvite('https://evil.com/abc');
    assert.equal(badRes.ok, false);
    assert.equal(seenCalls.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// 2) SAVUNMACI YANIT AYRIŞTIRMA, OYUN SİMGELERİ, SNOWFLAKE & CDN ADRESLERİ
// ============================================================================

test('defensive parsing handles profile present/absent, hides missing counts (never 0), and caches game apps with graceful failure', async () => {
  // 1) Profile yok & sayılar eksik -> null kalır, asla 0 olmaz
  const noProfile = parseDiscordInvitePayload(
    makeSampleInvitePayload({
      includeProfile: false,
      memberCount: undefined,
      onlineCount: undefined,
    })
  );
  assert.equal(noProfile.memberCount, null);
  assert.equal(noProfile.onlineCount, null);
  assert.deepEqual(noProfile.traits, []);
  assert.equal(noProfile.brandColor, null);

  // 2) Profile var + emoji URL + oyun simgeleri (24 saat önbellekli) + uygulama uç noktası hata verince gizlenir
  const dir = makeTempDir();
  let appFetchCalls = 0;
  let failAppsEndpoint = false;

  const store = new ServerDirectory({
    baseDir: dir,
    sleepFn: async () => {},
    fetchFn: async (url) => {
      if (url.includes('/invites/')) {
        return makeFakeResponse(200, makeSampleInvitePayload());
      }
      if (url.includes('/applications/public')) {
        appFetchCalls += 1;
        if (failAppsEndpoint) {
          return makeFakeResponse(500, { message: 'Internal Error' });
        }
        return makeFakeResponse(200, [
          { id: '998877665544332211', name: 'Roblox', icon: 'appiconhash99' },
        ]);
      }
      return makeFakeResponse(404, {});
    },
  });

  try {
    const first = await store.fetchDiscordInvite('y2aA9U5RyR');
    assert.equal(first.ok, true);
    assert.equal(first.cache.memberCount, 420);
    assert.equal(first.cache.onlineCount, 87);
    assert.equal(first.cache.badge, 'verified');
    assert.equal(first.cache.traits.length, 2);
    assert.equal(
      first.cache.traits[0].emojiUrl,
      'https://cdn.discordapp.com/emojis/123456789012345678.png?size=32'
    );
    assert.equal(first.cache.traits[1].emoji, '🔥');
    assert.equal(first.cache.gameApps.length, 1);
    assert.equal(
      first.cache.gameApps[0].iconUrl,
      'https://cdn.discordapp.com/app-icons/998877665544332211/appiconhash99.png?size=64'
    );
    assert.equal(appFetchCalls, 1);

    // İkinci sorguda uygulama simgesi 24 saatlik önbellekten gelir (yeni ağ isteği atılmaz)
    const second = await store.fetchDiscordInvite('y2aA9U5RyR');
    assert.equal(second.ok, true);
    assert.equal(second.cache.gameApps.length, 1);
    assert.equal(appFetchCalls, 1);

    // Yeni uygulama ID'si için uç nokta 500 dönerse satır sessizce gizlenir (gameApps = [])
    store._appIconCache.clear();
    failAppsEndpoint = true;
    const third = await store.fetchDiscordInvite('y2aA9U5RyR');
    assert.equal(third.ok, true);
    assert.deepEqual(third.cache.gameApps, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('snowflakeToCreatedAt uses BigInt accurately for large 64-bit guild IDs and formats TR/EN months', () => {
  // 2026-10-15T00:00:00.000Z => epochMs = 1792022400000
  const targetMs = Date.UTC(2026, 9, 15, 0, 0, 0);
  const bigId = ((BigInt(targetMs) - 1420070400000n) << 22n) | 12345n;
  const iso = serversConfig.snowflakeToCreatedAt(bigId.toString());
  assert.equal(iso, new Date(targetMs).toISOString());

  const trFmt = serversConfig.formatCreatedMonth(iso, 'tr');
  const enFmt = serversConfig.formatCreatedMonth(iso, 'en');
  assert.match(trFmt, /2026/);
  assert.match(enFmt, /Oct\s+2026/);

  // Geçersiz snowflake
  assert.equal(serversConfig.snowflakeToCreatedAt('not-a-snowflake'), null);
  assert.equal(serversConfig.snowflakeToCreatedAt('123'), null);
});

test('Discord CDN URL builders strictly emit https://cdn.discordapp.com only and handle animated a_ icons', () => {
  const anim = serversConfig.buildGuildIconUrls('1559604702143062016', 'a_deadbeef1234');
  assert.equal(anim.isAnimated, true);
  assert.equal(anim.iconUrl, 'https://cdn.discordapp.com/icons/1559604702143062016/a_deadbeef1234.png?size=256');
  assert.equal(anim.iconAnimatedUrl, 'https://cdn.discordapp.com/icons/1559604702143062016/a_deadbeef1234.gif?size=256');

  const stat = serversConfig.buildGuildIconUrls('1559604702143062016', 'deadbeef1234');
  assert.equal(stat.isAnimated, false);
  assert.equal(stat.iconUrl, 'https://cdn.discordapp.com/icons/1559604702143062016/deadbeef1234.png?size=256');
  assert.equal(stat.iconAnimatedUrl, null);

  // Path traversal veya yabancı host engellenir
  assert.equal(serversConfig.buildGuildIconUrls('1559604702143062016', '../evil').iconUrl, null);
  assert.equal(serversConfig.buildGuildBannerUrl('1559604702143062016', 'https://evil.com/x.png'), null);
  assert.equal(
    serversConfig.buildGuildBannerUrl('1559604702143062016', null, 'splashhash99'),
    'https://cdn.discordapp.com/splashes/1559604702143062016/splashhash99.png?size=600'
  );
  assert.equal(
    serversConfig.buildEmojiUrl('1559604702143062016'),
    'https://cdn.discordapp.com/emojis/1559604702143062016.png?size=32'
  );
  assert.equal(serversConfig.buildEmojiUrl('evil/123'), null);
});

// ============================================================================
// 3) TAZELEME MOTORU (SIRALI, 1.5 SN ARALIK, 429 RETRY-AFTER, STALE, 2x404 -> INVALID)
// ============================================================================

test('refreshAll runs sequentially with 1.5s spacing, honors 429 Retry-After, keeps stale cache on 500, and marks invalid after 2 consecutive 404s', async () => {
  const dir = makeTempDir();
  const sleepCalls = [];
  const fetchedCodes = [];
  let round = 1;
  let retry429Once = true;

  const store = new ServerDirectory({
    baseDir: dir,
    refreshStepDelayMs: 1500,
    sleepFn: async (ms) => {
      sleepCalls.push(ms);
    },
    fetchFn: async (url) => {
      const m = url.match(/\/invites\/([^?]+)/);
      const code = m ? decodeURIComponent(m[1]) : '';
      fetchedCodes.push({ round, code });

      // 1. kod: ilk denemede 429 Retry-After: 2, sonra 200 OK
      if (code === 'y2aA9U5RyR') {
        if (retry429Once) {
          retry429Once = false;
          return makeFakeResponse(429, { message: 'rate limited' }, { 'Retry-After': '2' });
        }
        return makeFakeResponse(200, makeSampleInvitePayload({ guildId: '1410000000000000001', name: 'Piyade World | Satış' }));
      }
      // 2. kod: 1. turda 200 OK, 2. turda 500 -> eski iyi veri korunup stale olur
      if (code === 'TvuAbUbKJj') {
        if (round === 1) {
          return makeFakeResponse(200, makeSampleInvitePayload({ guildId: '1410000000000000002', name: 'Piyade World | Ana Sunucu', memberCount: 555 }));
        }
        return makeFakeResponse(500, { error: 'boom' });
      }
      // 3. kod (9 karakter): her iki turda 404 -> 1. turda stale, 2. turda invalid
      if (code === 'CnVBC6JTg') {
        return makeFakeResponse(404, { code: 10006, message: 'Unknown Invite' });
      }
      // Diğerleri OK
      return makeFakeResponse(200, makeSampleInvitePayload({ guildId: `14100000000000000${fetchedCodes.length}`, name: `Sunucu ${code}` }));
    },
  });

  try {
    // Tur 1
    await store.refreshAll();
    // 429 için 2000ms + 6 kayıt arası 5 adet 1500ms bekleme
    assert.ok(sleepCalls.includes(2000), '429 Retry-After: 2 -> 2000ms beklenmeli');
    assert.equal(sleepCalls.filter((x) => x === 1500).length, 5, '6 kayıt arasında tam 5 kez 1500ms beklenmeli');

    const afterR1 = store.getAdminList().servers;
    const srv1 = afterR1.find((s) => s.code === 'y2aA9U5RyR');
    const srv2 = afterR1.find((s) => s.code === 'TvuAbUbKJj');
    const srv3 = afterR1.find((s) => s.code === 'CnVBC6JTg');
    assert.equal(srv1.status, 'ok');
    assert.equal(srv2.status, 'ok');
    assert.equal(srv2.cache.memberCount, 555);
    assert.equal(srv3.status, 'stale', 'Tek 404 henüz stale olmalı (ardışık 2 kez 404 gerekir)');
    assert.equal(srv3.consecutiveFailures, 1);

    // Tur 2
    round = 2;
    await store.refreshAll();
    const afterR2 = store.getAdminList().servers;
    const srv2b = afterR2.find((s) => s.code === 'TvuAbUbKJj');
    const srv3b = afterR2.find((s) => s.code === 'CnVBC6JTg');
    assert.equal(srv2b.status, 'stale');
    assert.equal(srv2b.cache.memberCount, 555, '500 hatasında son iyi veri korunmalı');
    assert.equal(srv3b.status, 'invalid', 'Ardışık 2 kez 404 -> invalid');
    assert.equal(srv3b.consecutiveFailures, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// 4) METİN GÜVENLİĞİ, OTOMATİK FİLTRE (FLAGGED) VE DEVELOPER ONAYI
// ============================================================================

test('text sanitization strips control/zero-width chars, enforces max lengths, and auto-filter flags & hides abusive guild texts until Developer approval', async () => {
  const dirty = '\u200B\u202E<script>alert(1)</script>\u0007   ' + 'A'.repeat(120);
  const clean = serversConfig.sanitizeDiscordText(dirty, 60);
  assert.ok(clean.length <= 60);
  assert.ok(!/[\u0000-\u001F\u200B\u202E]/.test(clean));

  const dir = makeTempDir();
  const store = new ServerDirectory({
    baseDir: dir,
    sleepFn: async () => {},
    fetchFn: async (url) => {
      if (url.includes('y2aA9U5RyR')) {
        return makeFakeResponse(
          200,
          makeSampleInvitePayload({
            guildId: '1410000000000000099',
            name: 'Piyade siktir sunucusu <script>x</script>',
            traits: [{ label: 'discord.gg/baska-sunucu' }],
          })
        );
      }
      return makeFakeResponse(200, makeSampleInvitePayload({ guildId: '1410000000000000088', name: 'Temiz Sunucu' }));
    },
  });

  try {
    const firstId = store.getAdminList().servers[0].id;
    await store.refreshSingle(firstId);

    const rec = store.getAdminRecordById(firstId);
    assert.equal(rec.status, 'flagged');
    assert.ok(rec.flaggedReasons.includes('profanity'));
    assert.ok(rec.flaggedReasons.includes('discord_invite'));

    // Üye listesinde flagged kayıt HİÇ görünmez
    const pubBefore = store.getPublicServerCards();
    assert.equal(pubBefore.servers.some((s) => s.id === firstId), false);

    // Developer inceleyip onaylayınca tekrar görünür olur
    const approved = store.approveFlagged(firstId, '1561777507223601353');
    assert.equal(approved.ok, true);
    assert.equal(approved.server.status, 'ok');
    const pubAfter = store.getPublicServerCards();
    assert.equal(pubAfter.servers.some((s) => s.id === firstId), true);

    // Aynı metinle tekrar tazelenince onay korunur
    await store.refreshSingle(firstId);
    assert.equal(store.getAdminRecordById(firstId).status, 'ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// 5) DEPO (ATOMİK YAZMA, .BAK KURTARMA, TOHUM SIRASI, MÜKERRER VE MAKS 24 ENGELİ)
// ============================================================================

test('storage seeds exact 6 servers with #1 featured, recovers from corrupted json via .bak, rejects duplicates and >24 limit', async () => {
  const dir = makeTempDir();
  let counter = 100;
  const fakeFetch = async (url) => {
    const m = url.match(/\/invites\/([^?]+)/);
    const code = m ? decodeURIComponent(m[1]) : 'X';
    counter += 1;
    const gid = code === 'DUPLICATEG' ? '1410000000000000001' : `1410000000000000${counter}`;
    return makeFakeResponse(200, makeSampleInvitePayload({ guildId: gid, name: `Server ${code}` }));
  };

  const store = new ServerDirectory({ baseDir: dir, fetchFn: fakeFetch, sleepFn: async () => {} });

  try {
    // Exact 6 seed order & #1 featured
    const initial = store.getAdminList().servers;
    assert.equal(initial.length, 6);
    assert.deepEqual(
      initial.map((s) => s.code),
      ['y2aA9U5RyR', 'TvuAbUbKJj', 'CnVBC6JTg', 'kTVBJtMtG', 'm4BaGwRsNu', 'GW2za6Jpdr']
    );
    assert.equal(initial[0].label, 'Piyade World | Satış');
    assert.equal(initial[0].featured, true);
    assert.equal(initial.filter((s) => s.featured).length, 1);

    // .bak kurtarma testi: önce bir yazma tetikle (.bak oluşsun), sonra ana dosyayı boz
    store.updateServer(initial[0].id, { note: 'Yedek kurtarma notu' }, 'dev1');
    const dataFile = path.join(dir, 'servers.json');
    assert.ok(fs.existsSync(`${dataFile}.bak`), '.bak dosyası oluşmuş olmalı');
    fs.writeFileSync(dataFile, '{ BOZUK JSON !!!', 'utf8');

    const recovered = new ServerDirectory({ baseDir: dir, fetchFn: fakeFetch, sleepFn: async () => {} });
    assert.equal(recovered.getAdminList().servers.length, 6);

    // Mükerrer kod reddi
    const dupCode = await recovered.addServer({ rawInput: 'y2aA9U5RyR', actorId: 'dev1' });
    assert.equal(dupCode.ok, false);
    assert.equal(dupCode.code, 'DUPLICATE_CODE');

    // Aynı guildId reddi
    recovered._state.servers[0].cache = { guildId: '1410000000000000001', name: 'Piyade Satış' };
    recovered._persist();
    const dupGuild = await recovered.addServer({ rawInput: 'DUPLICATEG', actorId: 'dev1' });
    assert.equal(dupGuild.ok, false);
    assert.equal(dupGuild.code, 'DUPLICATE_GUILD');

    // En fazla 24 sunucu sınırı
    for (let i = 7; i <= 24; i += 1) {
      const added = await recovered.addServer({ rawInput: `CodeExtra${i}`, actorId: 'dev1' });
      assert.equal(added.ok, true, `Sunucu #${i} eklenebilmeli`);
    }
    assert.equal(recovered.getAdminList().totalCount, 24);
    const overLimit = await recovered.addServer({ rawInput: 'CodeExtra25', actorId: 'dev1' });
    assert.equal(overLimit.ok, false);
    assert.equal(overLimit.code, 'MAX_SERVERS_REACHED');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// 6) CAROUSEL FİZİĞİ, YERLEŞİM (N=1,2,3,6,24), ETKİLEŞİM, ZAMANLAYICI & SES
// ============================================================================

test('3D carousel math, N=1/2/3/6/24 layouts, non-front click rule, pause/resume timers, reduced-motion, and sound switch', () => {
  // Layout modları
  assert.equal(carouselMod.computeLayoutMode(1, false), 'single');
  assert.equal(carouselMod.computeLayoutMode(2, false), 'pair');
  assert.equal(carouselMod.computeLayoutMode(3, false), 'cylinder');
  assert.equal(carouselMod.computeLayoutMode(6, false), 'cylinder');
  assert.equal(carouselMod.computeLayoutMode(24, false), 'cylinder');
  assert.equal(carouselMod.computeLayoutMode(6, true), 'grid');

  // Yarıçap hesabı: N büyüdükçe yarıçap artar, N<3 için 0
  assert.equal(carouselMod.computeRadius(1, 300), 0);
  assert.equal(carouselMod.computeRadius(2, 300), 0);
  const r3 = carouselMod.computeRadius(3, 300);
  const r6 = carouselMod.computeRadius(6, 300);
  const r24 = carouselMod.computeRadius(24, 300);
  assert.ok(r3 > 80 && r6 > r3 && r24 > r6, `r3=${r3}, r6=${r6}, r24=${r24}`);

  // Zamanlayıcılar & Etkileşim kuralı
  let fakeNow = 10000;
  let lastChangedIdx = null;
  const ctrl = carouselMod.createCarouselController({
    count: 6,
    initialIndex: 0,
    autoRotate: true,
    autoRotateStartDelayMs: 2500,
    autoRotateResumeDelayMs: 3500,
    nowFn: () => fakeNow,
    onChange: (idx) => {
      lastChangedIdx = idx;
    },
  });

  // Açılışta ilk 2.5 sn autoRotate başlamaz
  assert.equal(ctrl.canAutoRotateNow(), false);
  fakeNow += 2500;
  assert.equal(ctrl.canAutoRotateNow(), true);

  // Hover olunca durur
  ctrl.state.isHovered = true;
  assert.equal(ctrl.canAutoRotateNow(), false);
  ctrl.state.isHovered = false;

  // Sahne ekran dışındayken (IntersectionObserver) veya sekme gizliyken döngü çalışmaz
  ctrl.state.isInViewport = false;
  assert.equal(ctrl.shouldLoopRun(), false);
  ctrl.state.isInViewport = true;
  ctrl.state.isTabVisible = false;
  assert.equal(ctrl.shouldLoopRun(), false);
  ctrl.state.isTabVisible = true;

  // Ön olmayan karta tıklamak öne getirir ve linki AÇMAZ!
  const clickSide = ctrl.handleCardClick(2);
  assert.equal(clickSide.allowLinkNavigation, false);
  assert.equal(clickSide.rotatedToFront, true);
  assert.equal(ctrl.state.phase, 'spring');

  // Etkileşim sonrası 3.5 sn bekleme süresi kilitlidir
  ctrl.state.phase = 'idle';
  ctrl.state.activeIndex = 2;
  assert.equal(ctrl.canAutoRotateNow(), false);
  fakeNow += 3499;
  assert.equal(ctrl.canAutoRotateNow(), false);
  fakeNow += 2;
  assert.equal(ctrl.canAutoRotateNow(), true);

  // Ön karta tıklamak bağlantının açılmasına izin verir
  const clickFront = ctrl.handleCardClick(2);
  assert.equal(clickFront.allowLinkNavigation, true);
  assert.equal(clickFront.rotatedToFront, false);

  // Fizik adımı onChange çağırır
  ctrl.state.rot = -120;
  ctrl.stepPhysics(1 / 60);
  assert.equal(ctrl.state.activeIndex, 2);
  ctrl.state.rot = -180;
  ctrl.stepPhysics(1 / 60);
  assert.equal(lastChangedIdx, 3);

  // Ses anahtarı: hover'da / ilk etkileşim öncesi sessiz, ui-sounds=off iken sessiz
  assert.equal(carouselMod.shouldPlaySound(true, null, false), false);
  assert.equal(carouselMod.shouldPlaySound(true, 'off', true), false);
  assert.equal(carouselMod.shouldPlaySound(false, 'on', true), false);
  assert.equal(carouselMod.shouldPlaySound(true, null, true), true);
  assert.equal(carouselMod.shouldPlaySound(true, 'on', true), true);
});

// ============================================================================
// 7) HTTP ENTEGRASYON TESTİ: YETKİLER, ETag/304, COOLDOWN, IDEMPOTENCY, AUDIT, SSR
// ============================================================================

async function startTestApp({ serverDir, memberStore }) {
  setDefaultServerDirectory(serverDir);
  setDefaultMemberStore(memberStore);

  const app = createServerApp();
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    app,
    baseUrl,
    async close() {
      await new Promise((r) => server.close(r));
    },
  };
}

async function reqWithCookies(baseUrl, cookieJar, method, pathname, { headers = {}, body = null } = {}) {
  const reqHeaders = { ...headers };
  if (cookieJar.size > 0) {
    reqHeaders.Cookie = Array.from(cookieJar.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }
  const resp = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: reqHeaders,
    body,
    redirect: 'manual',
  });
  const setCookies = typeof resp.headers.getSetCookie === 'function' ? resp.headers.getSetCookie() : [];
  for (const sc of setCookies) {
    const pair = sc.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq > 0) {
      cookieJar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  const text = await resp.text();
  return { status: resp.status, headers: resp.headers, text };
}

test('full HTTP integration: permissions, fresh developer check, SSR HTML, ETag/304, 60s cooldown, verify, idempotency, audit log, robots, report prefill', async () => {
  const srvTmp = makeTempDir('piyade-srv-http-');
  const memTmp = makeTempDir('piyade-mem-http-');
  const memberStore = new MemberStore({ baseDir: memTmp });

  let fakeNow = Date.now();
  const serverDir = new ServerDirectory({
    baseDir: srvTmp,
    nowFn: () => fakeNow,
    sleepFn: async () => {},
    refreshStepDelayMs: 0,
    fetchFn: async (url) => {
      const m = url.match(/\/invites\/([^?]+)/);
      const code = m ? decodeURIComponent(m[1]) : 'UNKNOWN';
      if (code === 'DEAD404') return makeFakeResponse(404, { code: 10006 });
      if (code === 'NEWVALID99') {
        return makeFakeResponse(
          200,
          makeSampleInvitePayload({
            guildId: '1410000000000099999',
            name: 'Piyade Yeni Sunucu',
            memberCount: 150,
            onlineCount: 25,
          })
        );
      }
      return makeFakeResponse(
        200,
        makeSampleInvitePayload({
          guildId: `141000000000001${code.charCodeAt(0)}`,
          name: `Piyade ${code}`,
          memberCount: 300,
          onlineCount: 42,
        })
      );
    },
  });

  // Başlangıç verisini doldur + 1 adet gizli not ekle (üyeye sızmamalı!)
  await serverDir.refreshAll();
  const firstSrvId = serverDir.getAdminList().servers[0].id;
  serverDir.updateServer(firstSrvId, { note: 'COK_GIZLI_IC_NOT_123' }, '1561777507223601353');

  // Sahte Bot API rol eşlemesi
  const origGetMemberRoles = botApiClient.getMemberRoles;
  const origGetExchange = discordAuthService.exchangeCodeForToken;
  const origFetchDiscordUser = discordAuthService.fetchDiscordUser;

  const userProfiles = {
    '1001': {
      inGuild: true,
      registered: true,
      level: 'registered',
      roles: [ROLES.REGISTERED],
    },
    '1002': {
      inGuild: true,
      registered: true,
      level: 'yonetmenlik',
      roles: [ROLES.REGISTERED, ROLES.YONETMENLIK],
    },
    '1003': {
      inGuild: true,
      registered: true,
      level: 'registered',
      roles: [ROLES.REGISTERED, ROLES.COMMUNITY_OFFICIAL],
    },
    '1004': {
      inGuild: true,
      registered: true,
      level: 'developer',
      roles: [ROLES.REGISTERED, ROLES.DEVELOPER],
    },
  };

  let activeDiscordLoginId = '1001';
  botApiClient.getMemberRoles = async (id) => {
    const p = userProfiles[String(id)];
    if (!p) {
      const err = new Error('Not Found');
      err.response = { status: 404 };
      throw err;
    }
    return {
      discordId: String(id),
      inGuild: p.inGuild,
      registered: p.registered,
      level: p.level,
      roles: p.roles,
      highestRolePosition: p.level === 'developer' ? 100 : p.level === 'yonetmenlik' ? 60 : 10,
      displayName: `User${id}`,
    };
  };
  discordAuthService.exchangeCodeForToken = async () => ({ access_token: 'fake_tok' });
  discordAuthService.fetchDiscordUser = async () => ({
    id: activeDiscordLoginId,
    username: `user${activeDiscordLoginId}`,
    global_name: `User${activeDiscordLoginId}`,
    avatar: null,
  });

  // Aktif Google site üyesi oluştur (remember cookie ile giriş yaptırmak için)
  const createdGoogle = memberStore.createMember({
    googleSub: 'google-sub-srv-1',
    googleEmail: 'google.srv@example.com',
    googleName: 'Google Test User',
    nickname: 'GooglePiyade',
    ageGroup: '18plus',
    parentConsent: false,
    games: [],
    consents: [
      { id: 'kvkk_notice_read', version: '1.2', at: Date.now() },
      { id: 'rules_accepted', version: '1.0', at: Date.now() },
      { id: 'cross_border_transfer', version: '1.0', at: Date.now() },
      { id: 'chat_processing', version: '1.0', at: Date.now() },
    ],
  });
  assert.equal(createdGoogle.ok, true);
  const googleMember = createdGoogle.member;
  const rememberTok = memberStore.createRememberToken(googleMember.id, { userAgent: 'TestAgent' });

  const srv = await startTestApp({ serverDir, memberStore });

  async function loginAsDiscord(discordId) {
    activeDiscordLoginId = String(discordId);
    const jar = new Map();
    const start = await reqWithCookies(srv.baseUrl, jar, 'GET', '/auth/discord');
    assert.equal(start.status, 302);
    const loc = new URL(start.headers.get('location'));
    const state = loc.searchParams.get('state');
    const cb = await reqWithCookies(srv.baseUrl, jar, 'GET', `/auth/discord/callback?code=fake&state=${encodeURIComponent(state)}`);
    assert.equal(cb.status, 302);
    return jar;
  }

  try {
    // A) robots.txt & sitemap.xml & /bildir?kategori=other&not=...
    const robots = await reqWithCookies(srv.baseUrl, new Map(), 'GET', '/robots.txt');
    assert.equal(robots.status, 200);
    assert.ok(robots.text.includes('Disallow: /sunucular'));

    const sitemap = await reqWithCookies(srv.baseUrl, new Map(), 'GET', '/sitemap.xml');
    assert.equal(sitemap.status, 200);
    assert.ok(!sitemap.text.includes('/sunucular'));

    const reportPrefill = await reqWithCookies(
      srv.baseUrl,
      new Map(),
      'GET',
      '/bildir?kategori=other&not=Piyade+World+%7C+Sat%C4%B1%C5%9F'
    );
    assert.equal(reportPrefill.status, 200);
    assert.ok(reportPrefill.text.includes('Piyade World | Satış'));

    // B) Ziyaretçi (girişsiz): /sunucular yönlendirilir, /yonetim/sunucular 404
    const guestPage = await reqWithCookies(srv.baseUrl, new Map(), 'GET', '/sunucular');
    assert.equal(guestPage.status, 302);
    const guestAdmin = await reqWithCookies(srv.baseUrl, new Map(), 'GET', '/yonetim/sunucular');
    assert.equal(guestAdmin.status, 404);

    // C) Kayıtlı Discord üyesi: /sunucular 200 OK (SSR kartları, noindex, gizli iç not YOK!), /yonetim/sunucular 404
    const memberJar = await loginAsDiscord('1001');
    const memberPage = await reqWithCookies(srv.baseUrl, memberJar, 'GET', '/sunucular');
    assert.equal(memberPage.status, 200);
    assert.equal(memberPage.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.ok(memberPage.text.includes('role="region"'));
    assert.ok(memberPage.text.includes('aria-roledescription="carousel"'));
    assert.ok(memberPage.text.includes('aria-live="polite"'));
    assert.ok(memberPage.text.includes('https://discord.gg/y2aA9U5RyR'));
    assert.ok(!memberPage.text.includes('COK_GIZLI_IC_NOT_123'), 'İç not üye sayfasına ASLA sızmamalı');

    const memberAdmin = await reqWithCookies(srv.baseUrl, memberJar, 'GET', '/yonetim/sunucular');
    assert.equal(memberAdmin.status, 404);

    // D) ETag / 304 Not Modified & Gizli alan sızıntısı kontrolü
    const api1 = await reqWithCookies(srv.baseUrl, memberJar, 'GET', '/sunucular/api/liste');
    assert.equal(api1.status, 200);
    const etag = api1.headers.get('etag');
    assert.ok(etag && etag.includes('srv-'));
    const apiJson = JSON.parse(api1.text);
    assert.equal(apiJson.ok, true);
    assert.equal(apiJson.servers.length, 6);
    assert.equal('note' in apiJson.servers[0], false);
    assert.equal('addedBy' in apiJson.servers[0], false);
    assert.equal('consecutiveFailures' in apiJson.servers[0], false);

    const api304 = await reqWithCookies(srv.baseUrl, memberJar, 'GET', '/sunucular/api/liste', {
      headers: { 'If-None-Match': etag },
    });
    assert.equal(api304.status, 304);

    // E) Üye tetikli yenileme & 60 sn global bekleme süresi
    const csrfMatch = memberPage.text.match(/data-csrf="([a-f0-9]+)"/);
    assert.ok(csrfMatch, 'CSRF belirteci sayfada olmalı');
    const memberCsrf = csrfMatch[1];

    const ref1 = await reqWithCookies(srv.baseUrl, memberJar, 'POST', '/sunucular/api/yenile', {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': memberCsrf },
      body: '{}',
    });
    assert.equal(ref1.status, 200);

    const ref2 = await reqWithCookies(srv.baseUrl, memberJar, 'POST', '/sunucular/api/yenile', {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': memberCsrf },
      body: '{}',
    });
    assert.equal(ref2.status, 429);
    const ref2Json = JSON.parse(ref2.text);
    assert.equal(ref2Json.code, 'COOLDOWN_ACTIVE');
    assert.ok(ref2Json.retryAfterSec >= 1);

    // F) Google Site Üyesi: /sunucular 200 OK, /yonetim/sunucular 404; askıya alınınca /sunucular engelli
    const googleJar = new Map([['pw_remember', rememberTok.cookieValue]]);
    const googlePage = await reqWithCookies(srv.baseUrl, googleJar, 'GET', '/sunucular');
    assert.equal(googlePage.status, 200);
    assert.ok(googlePage.text.includes('https://discord.gg/y2aA9U5RyR'));
    const googleAdmin = await reqWithCookies(srv.baseUrl, googleJar, 'GET', '/yonetim/sunucular');
    assert.equal(googleAdmin.status, 404);

    // Askıdaki Google üyesi /sunucular sayfasına giremez
    memberStore.updateMember(googleMember.id, {
      status: 'suspended',
      statusReason: 'Test askı',
      statusExpiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    const suspendedGoogleRes = await reqWithCookies(srv.baseUrl, googleJar, 'GET', '/sunucular');
    assert.ok(suspendedGoogleRes.status === 403 || suspendedGoogleRes.status === 302);

    // G) Yönetmenlik & Community Official -> /yonetim/sunucular 404!
    const yonJar = await loginAsDiscord('1002');
    assert.equal((await reqWithCookies(srv.baseUrl, yonJar, 'GET', '/yonetim/sunucular')).status, 404);
    const coJar = await loginAsDiscord('1003');
    assert.equal((await reqWithCookies(srv.baseUrl, coJar, 'GET', '/yonetim/sunucular')).status, 404);

    // H) Taze doğrulanmış Discord Developer -> /yonetim/sunucular 200 OK + Doğrula + Idempotency + Audit
    const devJar = await loginAsDiscord('1004');
    const devPage = await reqWithCookies(srv.baseUrl, devJar, 'GET', '/yonetim/sunucular');
    assert.equal(devPage.status, 200);
    assert.equal(devPage.headers.get('x-robots-tag'), 'noindex, nofollow');

    const devCsrf = devPage.text.match(/data-csrf="([a-f0-9]+)"/)[1];
    const devIdem = devPage.text.match(/id="addServerIdempotencyKey"\s+value="([^"]+)"/)[1];

    // Canlı doğrulama: geçersiz 404 -> 404 "Davet geçersiz"
    const verBad = await reqWithCookies(srv.baseUrl, devJar, 'POST', '/yonetim/sunucular/api/dogrula', {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': devCsrf },
      body: JSON.stringify({ invite: 'DEAD404' }),
    });
    assert.equal(verBad.status, 404);

    // Canlı doğrulama: geçerli davet -> 200 önizleme
    const verOk = await reqWithCookies(srv.baseUrl, devJar, 'POST', '/yonetim/sunucular/api/dogrula', {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': devCsrf },
      body: JSON.stringify({ invite: 'https://discord.gg/NEWVALID99' }),
    });
    assert.equal(verOk.status, 200);
    const verOkJson = JSON.parse(verOk.text);
    assert.equal(verOkJson.ok, true);
    assert.equal(verOkJson.preview.name, 'Piyade Yeni Sunucu');

    // Ekleme (1. gönderim başarılı, aynı idempotency ile 2. gönderim 409 DUPLICATE_SUBMIT!)
    const addBody = JSON.stringify({
      invite: 'https://discord.gg/NEWVALID99',
      label: 'Yedek Ad',
      note: 'Bu iç not audit loga yazılmamalı',
      _idempotencyKey: devIdem,
    });
    const add1 = await reqWithCookies(srv.baseUrl, devJar, 'POST', '/yonetim/sunucular/ekle', {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': devCsrf },
      body: addBody,
    });
    assert.equal(add1.status, 201);

    const add2 = await reqWithCookies(srv.baseUrl, devJar, 'POST', '/yonetim/sunucular/ekle', {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': devCsrf },
      body: addBody,
    });
    assert.equal(add2.status, 409);

    // İçeriksiz denetim kaydı (audit.jsonl): yalnızca ts, actorId, action, code
    const auditPath = path.join(srvTmp, 'audit.jsonl');
    const auditRaw = fs.readFileSync(auditPath, 'utf8');
    assert.ok(!auditRaw.includes('Bu iç not audit loga yazılmamalı'), 'İç not audit.jsonl içine yazılmamalı');
    assert.ok(!auditRaw.includes('Piyade Yeni Sunucu'), 'Sunucu adı metni audit.jsonl içine yazılmamalı');
    const lastAudit = JSON.parse(auditRaw.trim().split('\n').pop());
    assert.deepEqual(Object.keys(lastAudit).sort(), ['action', 'actorId', 'code', 'ts']);
    assert.equal(lastAudit.actorId, '1004');
    assert.equal(lastAudit.action, 'add');
    assert.equal(lastAudit.code, 'NEWVALID99');

    // I) Developer rolü Bot API'den kaldırıldığında taze kontrol derhal 404 döner!
    userProfiles['1004'].roles = [ROLES.REGISTERED];
    userProfiles['1004'].level = 'registered';
    const revokedAdmin = await reqWithCookies(srv.baseUrl, devJar, 'GET', '/yonetim/sunucular');
    assert.equal(revokedAdmin.status, 404);
  } finally {
    botApiClient.getMemberRoles = origGetMemberRoles;
    discordAuthService.exchangeCodeForToken = origGetExchange;
    discordAuthService.fetchDiscordUser = origFetchDiscordUser;
    await srv.close();
    setDefaultServerDirectory(null);
    setDefaultMemberStore(null);
    fs.rmSync(srvTmp, { recursive: true, force: true });
    fs.rmSync(memTmp, { recursive: true, force: true });
  }
});

// ============================================================================
// 8) MENÜ FİLTRELERİ, SABİT RENK YASAĞI, TR/EN PARİTE VE GİZLİLİK POLİTİKASI
// ============================================================================

test('menu visibility, zero hardcoded hex colors outside theme.css, TR/EN locale parity, and Privacy Policy v1.2', () => {
  // Menü filtreleri: Discord kayıtlı & Google üye -> Sunucularımız görünür, rozet yok; Yalnızca Developer -> Yönetim/Sunucular görünür
  const discordMenus = menuConfig.getVisibleMenuItems(
    { id: '1', kind: 'discord', level: 'registered', registered: true, roles: [ROLES.REGISTERED] },
    'tr'
  );
  const srvMenu = discordMenus.find((m) => m.id === 'servers');
  assert.ok(srvMenu);
  assert.equal(srvMenu.badge, undefined);
  assert.equal(discordMenus.some((m) => m.id === 'admin-servers'), false);

  const googleMenus = menuConfig.getVisibleMenuItems(
    { id: 'g_1', kind: 'google', level: 'registered', registered: true, roles: [] },
    'en'
  );
  assert.equal(googleMenus.some((m) => m.id === 'servers'), true);
  assert.equal(googleMenus.some((m) => m.id === 'admin-servers'), false);

  const devMenus = menuConfig.getVisibleMenuItems(
    { id: '2', kind: 'discord', level: 'developer', registered: true, roles: [ROLES.REGISTERED, ROLES.DEVELOPER] },
    'tr'
  );
  const adminSrvMenu = devMenus.find((m) => m.id === 'admin-servers');
  assert.ok(adminSrvMenu);
  assert.equal(adminSrvMenu.badge, 'Developer');

  // Yeni JS/EJS/CSS dosyalarında sabit #hex renk kodu YOK
  const rootDir = path.join(__dirname, '..');
  const hexRe = /#[0-9a-fA-F]{3,8}\b/;
  const checkedFiles = [
    'public/js/servers-carousel.js',
    'public/js/admin-servers.js',
    'views/partials/server-card.ejs',
    'views/pages/servers.ejs',
    'views/pages/admin-servers.ejs',
  ];
  for (const rel of checkedFiles) {
    const content = fs.readFileSync(path.join(rootDir, rel), 'utf8');
    assert.equal(hexRe.test(content), false, `${rel} dosyasında sabit #hex renk bulunmamalı!`);
  }
  const styleCss = fs.readFileSync(path.join(rootDir, 'public/css/style.css'), 'utf8');
  const newCssBlock = styleCss.slice(styleCss.indexOf('17. SUNUCULARIMIZ'));
  assert.ok(newCssBlock.length > 500);
  assert.equal(hexRe.test(newCssBlock), false, 'style.css yeni Sunucularımız bloğunda sabit #hex bulunmamalı!');

  // TR / EN locale anahtar eşitliği
  const tr = JSON.parse(fs.readFileSync(path.join(rootDir, 'locales/tr.json'), 'utf8'));
  const en = JSON.parse(fs.readFileSync(path.join(rootDir, 'locales/en.json'), 'utf8'));
  assert.deepEqual(Object.keys(tr.servers).sort(), Object.keys(en.servers).sort());
  assert.deepEqual(Object.keys(tr.adminServers).sort(), Object.keys(en.adminServers).sort());

  // Gizlilik politikası TR & EN v1.2 güncellemesi
  const privTr = fs.readFileSync(path.join(rootDir, 'content/legal/tr/gizlilik-politikasi.md'), 'utf8');
  const privEn = fs.readFileSync(path.join(rootDir, 'content/legal/en/gizlilik-politikasi.md'), 'utf8');
  assert.ok(privTr.includes('version: 1.2'));
  assert.ok(privTr.includes('cdn.discordapp.com'));
  assert.ok(privEn.includes('version: 1.2'));
  assert.ok(privEn.includes('cdn.discordapp.com'));
});
