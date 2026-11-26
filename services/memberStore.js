const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const authConfig = require('../config/auth.config');

const MEMBER_ID_RE = /^m_[A-Za-z0-9]{6,48}$/;
const UNIFIED_GOOGLE_ID_RE = /^g_(m_[A-Za-z0-9]{6,48})$/;

let memberSeq = 0;
let memberLastTs = 0;

function generateMemberId(nowTs = Date.now()) {
  const ts = Number.isFinite(nowTs) ? Math.floor(nowTs) : Date.now();
  if (ts === memberLastTs) {
    memberSeq = (memberSeq + 1) % 1296;
  } else {
    memberLastTs = ts;
    memberSeq = 0;
  }
  const tsPart = ts.toString(36).padStart(9, '0');
  const seqPart = memberSeq.toString(36).padStart(2, '0');
  const randPart = crypto.randomBytes(5).toString('hex');
  // Yalnızca baştaki "m_" alt çizgisi bulunur; bot SITE_OWNER_REF_REGEX ve sohbet convId ile %100 uyumludur.
  return `m_${tsPart}${seqPart}${randPart}`;
}

function toUnifiedGoogleId(memberId) {
  const clean = String(memberId || '').trim();
  if (!MEMBER_ID_RE.test(clean)) return null;
  return `g_${clean}`;
}

function parseUnifiedGoogleId(unifiedId) {
  const m = String(unifiedId || '').trim().match(UNIFIED_GOOGLE_ID_RE);
  return m ? m[1] : null;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function buildDisplayName(nickname, games = []) {
  const cleanNick = String(nickname || '').trim();
  const robloxGame = Array.isArray(games)
    ? games.find((g) => g && String(g.id).toLowerCase() === 'roblox' && g.username)
    : null;
  if (robloxGame && robloxGame.username) {
    return `${cleanNick} | ${String(robloxGame.username).trim()}`;
  }
  return cleanNick;
}

function atomicWriteJson(filePath, dataObj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}`;
  const bakPath = `${filePath}.bak`;
  fs.writeFileSync(tmpPath, JSON.stringify(dataObj, null, 2), { encoding: 'utf8', mode: 0o600 });
  if (fs.existsSync(filePath)) {
    try {
      fs.copyFileSync(filePath, bakPath);
    } catch (_) {}
  }
  fs.renameSync(tmpPath, filePath);
}

function safeReadJson(filePath, fallback) {
  for (const candidate of [filePath, `${filePath}.bak`]) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const raw = fs.readFileSync(candidate, 'utf8');
      if (!raw.trim()) continue;
      return JSON.parse(raw);
    } catch (_) {}
  }
  return fallback;
}

function appendJsonlLine(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(obj)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function resolveDefaultMembersDir(envObj = process.env) {
  const vol = envObj && typeof envObj.RAILWAY_VOLUME_MOUNT_PATH === 'string'
    ? envObj.RAILWAY_VOLUME_MOUNT_PATH.trim()
    : '';
  if (vol) {
    return path.join(vol, 'members');
  }
  return path.join(process.cwd(), '.members-data');
}

function parseDeviceLabel(userAgent = '') {
  const ua = String(userAgent || '');
  let browser = 'Tarayıcı';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';

  let os = 'Cihaz';
  if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad/i.test(ua)) os = 'iOS';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  return `${browser} / ${os}`;
}

/**
 * İleride SQLite / PostgreSQL'e kolayca geçirilebilecek arayüzlü Google Üye ve Hatırlama Deposu.
 * Volume altında ${RAILWAY_VOLUME_MOUNT_PATH}/members/ (yoksa .members-data/) kullanır.
 */
class MemberStore {
  constructor(options = {}) {
    this.baseDir = options.baseDir || resolveDefaultMembersDir(options.env || process.env);
    this.membersFile = path.join(this.baseDir, 'members.json');
    this.rememberFile = path.join(this.baseDir, 'remember-tokens.json');
    this.auditFile = path.join(this.baseDir, 'members-audit.jsonl');

    fs.mkdirSync(this.baseDir, { recursive: true });

    this._state = null;
    this._rememberState = null;
  }

  _loadState() {
    if (this._state) return this._state;
    const raw = safeReadJson(this.membersFile, {
      version: 1,
      members: {},
      googleDiscordLinks: {},
      bannedSubHashes: {},
    });
    this._state = {
      version: 1,
      members: raw && typeof raw.members === 'object' && raw.members ? raw.members : {},
      googleDiscordLinks:
        raw && typeof raw.googleDiscordLinks === 'object' && raw.googleDiscordLinks
          ? raw.googleDiscordLinks
          : {},
      bannedSubHashes:
        raw && typeof raw.bannedSubHashes === 'object' && raw.bannedSubHashes
          ? raw.bannedSubHashes
          : {},
    };
    return this._state;
  }

  _saveState() {
    const st = this._loadState();
    atomicWriteJson(this.membersFile, {
      version: 1,
      updatedAt: Date.now(),
      members: st.members,
      googleDiscordLinks: st.googleDiscordLinks,
      bannedSubHashes: st.bannedSubHashes,
    });
  }

  _loadRememberState() {
    if (this._rememberState) return this._rememberState;
    const raw = safeReadJson(this.rememberFile, { version: 1, tokens: {} });
    this._rememberState = {
      version: 1,
      tokens: raw && typeof raw.tokens === 'object' && raw.tokens ? raw.tokens : {},
    };
    return this._rememberState;
  }

  _saveRememberState() {
    const st = this._loadRememberState();
    const now = Date.now();
    // Süresi dolmuşları yazarken temizle
    for (const [sel, rec] of Object.entries(st.tokens)) {
      if (!rec || rec.expiresAt <= now) {
        delete st.tokens[sel];
      }
    }
    atomicWriteJson(this.rememberFile, {
      version: 1,
      updatedAt: now,
      tokens: st.tokens,
    });
  }

  /**
   * Kimlik ve kişisel veri içermeyen sade denetim satırı yazar.
   */
  appendAudit({ action, detail = '' }) {
    const entry = {
      ts: Date.now(),
      action: String(action || ''),
      ...(detail ? { detail: String(detail).slice(0, 80) } : {}),
    };
    appendJsonlLine(this.auditFile, entry);
    return entry;
  }

  // ==========================================================================
  // 1) YASAKLI GOOGLE SUB ÖZET LİSTESİ (İlerideki yaptırım işi için hazır)
  // ==========================================================================
  isGoogleSubBanned(googleSub) {
    const hash = sha256Hex(googleSub);
    const st = this._loadState();
    return Boolean(st.bannedSubHashes[hash]);
  }

  getGoogleSubBanInfo(googleSub) {
    const hash = sha256Hex(googleSub);
    const st = this._loadState();
    return st.bannedSubHashes[hash] || null;
  }

  banGoogleSub(googleSub, reason = '') {
    const hash = sha256Hex(googleSub);
    const st = this._loadState();
    st.bannedSubHashes[hash] = {
      reason: String(reason || '').slice(0, 200),
      at: Date.now(),
    };
    this._saveState();
    this.appendAudit({ action: 'google_sub_banned' });
    return true;
  }

  unbanGoogleSub(googleSub) {
    const hash = sha256Hex(googleSub);
    const st = this._loadState();
    if (!st.bannedSubHashes[hash]) return false;
    delete st.bannedSubHashes[hash];
    this._saveState();
    this.appendAudit({ action: 'google_sub_unbanned' });
    return true;
  }

  // ==========================================================================
  // 2) GOOGLE <-> DISCORD KALICI BAĞ YÖNETİMİ
  // ==========================================================================
  findLinkedDiscordByGoogleSub(googleSub) {
    const cleanSub = String(googleSub || '').trim();
    if (!cleanSub) return null;
    const st = this._loadState();
    const link = st.googleDiscordLinks[cleanSub];
    if (link && link.discordId) return String(link.discordId);
    // Ayrıca üye kaydındaki linkedDiscordId alanına da bak
    const member = this.findByGoogleSub(cleanSub);
    if (member && member.linkedDiscordId) return String(member.linkedDiscordId);
    return null;
  }

  findGoogleSubByLinkedDiscord(discordId) {
    const cleanDiscord = String(discordId || '').trim();
    if (!cleanDiscord) return null;
    const st = this._loadState();
    for (const [sub, rec] of Object.entries(st.googleDiscordLinks)) {
      if (rec && String(rec.discordId) === cleanDiscord) {
        return sub;
      }
    }
    for (const m of Object.values(st.members)) {
      if (m && m.linkedDiscordId && String(m.linkedDiscordId) === cleanDiscord) {
        return m.googleSub;
      }
    }
    return null;
  }

  linkGoogleToDiscord(googleSub, discordId) {
    const cleanSub = String(googleSub || '').trim();
    const cleanDiscord = String(discordId || '').trim();
    if (!cleanSub || !cleanDiscord) {
      return { ok: false, code: 'INVALID_INPUT' };
    }
    const st = this._loadState();
    const existingSubForDiscord = this.findGoogleSubByLinkedDiscord(cleanDiscord);
    if (existingSubForDiscord && existingSubForDiscord !== cleanSub) {
      return { ok: false, code: 'DISCORD_ALREADY_LINKED' };
    }
    const existingLink = st.googleDiscordLinks[cleanSub];
    if (existingLink && String(existingLink.discordId) !== cleanDiscord) {
      return { ok: false, code: 'GOOGLE_ALREADY_LINKED' };
    }

    st.googleDiscordLinks[cleanSub] = {
      googleSub: cleanSub,
      discordId: cleanDiscord,
      linkedAt: Date.now(),
    };
    this._saveState();
    this.appendAudit({ action: 'google_discord_linked' });
    return { ok: true, discordId: cleanDiscord };
  }

  // ==========================================================================
  // 3) GOOGLE ÜYE CRUD VE BENZERSİZLİK İNDEKSLERİ (googleSub, robloxId)
  // ==========================================================================
  _cloneMember(rec) {
    if (!rec) return null;
    return JSON.parse(JSON.stringify(rec));
  }

  findById(memberId) {
    const clean = String(memberId || '').trim();
    const st = this._loadState();
    return this._cloneMember(st.members[clean] || null);
  }

  findByUnifiedId(unifiedId) {
    const memberId = parseUnifiedGoogleId(unifiedId);
    if (!memberId) return null;
    return this.findById(memberId);
  }

  findByGoogleSub(googleSub) {
    const cleanSub = String(googleSub || '').trim();
    if (!cleanSub) return null;
    const st = this._loadState();
    for (const rec of Object.values(st.members)) {
      if (rec && rec.googleSub === cleanSub) {
        return this._cloneMember(rec);
      }
    }
    return null;
  }

  findByRobloxId(robloxId, { excludeMemberId = null } = {}) {
    const cleanRb = String(robloxId || '').trim();
    if (!cleanRb) return null;
    const st = this._loadState();
    for (const rec of Object.values(st.members)) {
      if (!rec || (excludeMemberId && rec.id === excludeMemberId)) continue;
      const games = Array.isArray(rec.games) ? rec.games : [];
      if (games.some((g) => g && g.id === 'roblox' && String(g.robloxId || '') === cleanRb)) {
        return this._cloneMember(rec);
      }
    }
    return null;
  }

  listActiveMembers() {
    const st = this._loadState();
    return Object.values(st.members)
      .filter((m) => m && m.status === 'active')
      .map((m) => this._cloneMember(m));
  }

  listAllMembers() {
    const st = this._loadState();
    return Object.values(st.members)
      .filter(Boolean)
      .map((m) => this._cloneMember(m));
  }

  /**
   * Yeni Google üyesi oluşturur.
   * GÜVENLİK: Profil resmi (picture) ASLA kabul edilmez/saklanmaz. googleSub ve robloxId benzersizdir.
   */
  createMember({
    id = null,
    googleSub,
    email,
    emailVerified = true,
    googleName = '',
    nickname,
    games = [],
    ageGroup,
    consents = [],
    privacy = { showGamesInChat: true },
    status = 'active',
    linkedDiscordId = null,
    nowMs = Date.now(),
  }) {
    const cleanSub = String(googleSub || '').trim();
    if (!cleanSub) {
      return { ok: false, code: 'MISSING_GOOGLE_SUB' };
    }
    if (!emailVerified) {
      return { ok: false, code: 'EMAIL_NOT_VERIFIED' };
    }
    if (this.isGoogleSubBanned(cleanSub)) {
      return { ok: false, code: 'GOOGLE_SUB_BANNED' };
    }
    if (this.findByGoogleSub(cleanSub)) {
      return { ok: false, code: 'GOOGLE_SUB_EXISTS' };
    }

    const cleanGames = (Array.isArray(games) ? games : [])
      .filter((g) => g && g.id && g.username)
      .map((g) => {
        const entry = {
          id: String(g.id).trim().toLowerCase(),
          username: String(g.username).trim().slice(0, 100),
        };
        if (g.robloxId) entry.robloxId = String(g.robloxId).trim();
        if (g.robloxAvatarUrl) entry.robloxAvatarUrl = String(g.robloxAvatarUrl).trim();
        if (g.robloxProfileUrl) entry.robloxProfileUrl = String(g.robloxProfileUrl).trim();
        return entry;
      });

    const rbGame = cleanGames.find((g) => g.id === 'roblox');
    if (rbGame && rbGame.robloxId && this.findByRobloxId(rbGame.robloxId)) {
      return { ok: false, code: 'ROBLOX_ALREADY_REGISTERED' };
    }

    const memberId = id && MEMBER_ID_RE.test(String(id)) ? String(id) : generateMemberId(nowMs);
    const cleanNick = String(nickname || '').trim().slice(0, 32);
    const displayName = buildDisplayName(cleanNick, cleanGames);
    const createdAt = Number(nowMs) || Date.now();

    const record = {
      id: memberId,
      googleSub: cleanSub,
      email: String(email || '').trim().toLowerCase().slice(0, 160),
      emailVerified: true,
      googleName: String(googleName || '').trim().slice(0, 120),
      nickname: cleanNick,
      displayName,
      games: cleanGames,
      ageGroup: ['13_17', '18_plus'].includes(ageGroup) ? ageGroup : '18_plus',
      consents: (Array.isArray(consents) ? consents : []).map((c) => ({
        id: String(c.id || '').trim(),
        version: String(c.version || '1.0').trim(),
        at: Number(c.at) || createdAt,
      })),
      privacy: {
        showGamesInChat: privacy && typeof privacy.showGamesInChat === 'boolean' ? privacy.showGamesInChat : true,
      },
      status: ['active', 'suspended', 'banned'].includes(status) ? status : 'active',
      createdAt,
      lastLoginAt: createdAt,
      ...(linkedDiscordId ? { linkedDiscordId: String(linkedDiscordId) } : {}),
    };

    const st = this._loadState();
    st.members[memberId] = record;
    this._saveState();
    this.appendAudit({ action: 'google_member_created' });

    return { ok: true, member: this._cloneMember(record) };
  }

  updateMember(memberId, patch = {}) {
    const cleanId = String(memberId || '').trim();
    const st = this._loadState();
    const rec = st.members[cleanId];
    if (!rec) return { ok: false, code: 'NOT_FOUND' };

    if (Array.isArray(patch.games)) {
      const cleanGames = patch.games
        .filter((g) => g && g.id && g.username)
        .map((g) => {
          const entry = {
            id: String(g.id).trim().toLowerCase(),
            username: String(g.username).trim().slice(0, 100),
          };
          if (g.robloxId) entry.robloxId = String(g.robloxId).trim();
          if (g.robloxAvatarUrl) entry.robloxAvatarUrl = String(g.robloxAvatarUrl).trim();
          if (g.robloxProfileUrl) entry.robloxProfileUrl = String(g.robloxProfileUrl).trim();
          return entry;
        });
      const rbGame = cleanGames.find((g) => g.id === 'roblox');
      if (rbGame && rbGame.robloxId && this.findByRobloxId(rbGame.robloxId, { excludeMemberId: cleanId })) {
        return { ok: false, code: 'ROBLOX_ALREADY_REGISTERED' };
      }
      rec.games = cleanGames;
    }

    if (typeof patch.nickname === 'string' && patch.nickname.trim()) {
      rec.nickname = patch.nickname.trim().slice(0, 32);
    }

    rec.displayName = buildDisplayName(rec.nickname, rec.games);

    if (patch.privacy && typeof patch.privacy === 'object') {
      if (typeof patch.privacy.showGamesInChat === 'boolean') {
        rec.privacy = { ...(rec.privacy || {}), showGamesInChat: patch.privacy.showGamesInChat };
      }
    }

    if (Array.isArray(patch.consents)) {
      rec.consents = patch.consents.map((c) => ({
        id: String(c.id || '').trim(),
        version: String(c.version || '1.0').trim(),
        at: Number(c.at) || Date.now(),
      }));
    }

    if (typeof patch.lastLoginAt === 'number' && Number.isFinite(patch.lastLoginAt)) {
      rec.lastLoginAt = patch.lastLoginAt;
    }

    if (patch.status && ['active', 'suspended', 'banned'].includes(patch.status)) {
      rec.status = patch.status;
    }

    if (typeof patch.statusReason === 'string') {
      rec.statusReason = patch.statusReason.slice(0, 300);
    }

    if (patch.statusExpiresAt === null) {
      rec.statusExpiresAt = null;
    } else if (typeof patch.statusExpiresAt === 'number' && Number.isFinite(patch.statusExpiresAt)) {
      rec.statusExpiresAt = patch.statusExpiresAt;
    }

    this._saveState();
    return { ok: true, member: this._cloneMember(rec) };
  }

  withdrawConsent(memberId, consentId) {
    const cleanId = String(memberId || '').trim();
    const cleanConsent = String(consentId || '').trim();
    const st = this._loadState();
    const rec = st.members[cleanId];
    if (!rec) return { ok: false, code: 'NOT_FOUND' };

    rec.consents = (Array.isArray(rec.consents) ? rec.consents : []).filter((c) => c.id !== cleanConsent);
    if (cleanConsent === 'chat_profile_game_usernames') {
      rec.privacy = { ...(rec.privacy || {}), showGamesInChat: false };
    }
    this._saveState();
    this.appendAudit({ action: 'consent_withdrawn', detail: cleanConsent });
    return { ok: true, member: this._cloneMember(rec) };
  }

  grantConsent(memberId, consentId, version = '1.0') {
    const cleanId = String(memberId || '').trim();
    const cleanConsent = String(consentId || '').trim();
    const st = this._loadState();
    const rec = st.members[cleanId];
    if (!rec) return { ok: false, code: 'NOT_FOUND' };

    const list = (Array.isArray(rec.consents) ? rec.consents : []).filter((c) => c.id !== cleanConsent);
    list.push({ id: cleanConsent, version: String(version || '1.0'), at: Date.now() });
    rec.consents = list;
    if (cleanConsent === 'chat_profile_game_usernames') {
      rec.privacy = { ...(rec.privacy || {}), showGamesInChat: true };
    }
    this._saveState();
    return { ok: true, member: this._cloneMember(rec) };
  }

  hasConsent(member, consentId) {
    if (!member || !Array.isArray(member.consents)) return false;
    return member.consents.some((c) => c && c.id === consentId);
  }

  /**
   * Üye kaydını ve ilişkili hatırlama kayıtlarını tamamen siler; geriye yalnızca kimliksiz denetim satırı kalır.
   */
  deleteMember(memberId) {
    const cleanId = String(memberId || '').trim();
    const st = this._loadState();
    const rec = st.members[cleanId];
    if (!rec) return { ok: false, code: 'NOT_FOUND' };

    const robloxGame = Array.isArray(rec.games) ? rec.games.find((g) => g && g.id === 'roblox') : null;
    const robloxId = robloxGame && robloxGame.robloxId ? String(robloxGame.robloxId) : null;

    if (rec.googleSub && st.googleDiscordLinks[rec.googleSub]) {
      delete st.googleDiscordLinks[rec.googleSub];
    }
    delete st.members[cleanId];
    this._saveState();

    this.revokeAllRememberTokensForMember(cleanId);
    // KİMLİKSİZ denetim satırı: ad, e-posta, sub, takma ad, memberId ASLA yazılmaz
    this.appendAudit({ action: 'account_deleted' });

    return { ok: true, deletedMemberId: cleanId, robloxId };
  }

  /**
   * Aktif Google üyelerinin Roblox avatar URL'lerini (bot POST /api/roblox/avatars yanıtından)
   * toplu günceller ve 6 saatlik yenileme zaman damgasını kaydeder.
   */
  updateRobloxAvatarsByRobloxId(avatarMap = {}, nowMs = Date.now()) {
    if (!avatarMap || typeof avatarMap !== 'object') return 0;
    const st = this._loadState();
    let updatedCount = 0;
    for (const rec of Object.values(st.members)) {
      if (!rec || rec.status !== 'active' || !Array.isArray(rec.games)) continue;
      const rbGame = rec.games.find((g) => g && g.id === 'roblox' && g.robloxId);
      if (!rbGame) continue;
      const rid = String(rbGame.robloxId).trim();
      if (!Object.prototype.hasOwnProperty.call(avatarMap, rid)) continue;
      const nextUrl = typeof avatarMap[rid] === 'string' && avatarMap[rid].trim() ? avatarMap[rid].trim() : null;
      if (nextUrl && rbGame.robloxAvatarUrl !== nextUrl) {
        rbGame.robloxAvatarUrl = nextUrl;
      }
      rec.robloxAvatarRefreshedAt = Number(nowMs) || Date.now();
      updatedCount += 1;
    }
    if (updatedCount > 0) {
      this._saveState();
    }
    return updatedCount;
  }

  /**
   * Sohbet rehberi ve halka/kart gösterimi için güvenli genel görünüm üretir.
   * E-posta ve googleName ASLA bu nesnede yer almaz!
   */
  toPublicChatDirectoryItem(member) {
    if (!member || member.status !== 'active') return null;
    const unifiedId = toUnifiedGoogleId(member.id);
    if (!unifiedId) return null;
    const games = Array.isArray(member.games) ? member.games : [];
    const rbGame = games.find((g) => g && g.id === 'roblox') || null;
    const showGames = Boolean(
      member.privacy &&
      member.privacy.showGamesInChat !== false &&
      this.hasConsent(member, 'chat_profile_game_usernames')
    );

    return {
      id: unifiedId,
      kind: 'google',
      displayName: member.displayName || member.nickname,
      discordAvatarUrl: null,
      robloxId: rbGame && rbGame.robloxId ? String(rbGame.robloxId) : null,
      robloxUsername: rbGame && rbGame.username ? String(rbGame.username) : null,
      robloxAvatarUrl: rbGame && rbGame.robloxAvatarUrl ? String(rbGame.robloxAvatarUrl) : null,
      robloxProfileUrl: rbGame && rbGame.robloxProfileUrl ? String(rbGame.robloxProfileUrl) : null,
      robloxAvatarRefreshedAt: Number(member.robloxAvatarRefreshedAt) || Number(member.createdAt) || 0,
      hasRoblox: Boolean(rbGame && (rbGame.robloxId || rbGame.username)),
      showGamesInChat: showGames,
      ...(showGames
        ? {
            games: games.map((g) => ({
              id: g.id,
              username: g.username,
              ...(g.robloxId ? { robloxId: String(g.robloxId) } : {}),
              ...(g.robloxProfileUrl ? { profileUrl: String(g.robloxProfileUrl) } : {}),
            })),
          }
        : { games: [] }),
    };
  }

  // ==========================================================================
  // 4) "BENİ HATIRLA" (pw_remember) — selector.validator, 5 cihaz, döndürme & çalınma tespiti
  // ==========================================================================
  createRememberToken(memberId, { userAgent = '', nowMs = Date.now() } = {}) {
    const cleanId = String(memberId || '').trim();
    const rSt = this._loadRememberState();
    const now = Number(nowMs) || Date.now();

    // Kullanıcı başına en çok REMEMBER_MAX_DEVICES (5) cihaz: fazlasında en eskisini sil
    const existingForMember = Object.values(rSt.tokens)
      .filter((t) => t && t.memberId === cleanId && t.expiresAt > now)
      .sort((a, b) => (a.lastUsedAt || a.createdAt) - (b.lastUsedAt || b.createdAt));

    while (existingForMember.length >= authConfig.REMEMBER_MAX_DEVICES) {
      const oldest = existingForMember.shift();
      if (oldest && oldest.selector) {
        delete rSt.tokens[oldest.selector];
      }
    }

    const selector = crypto.randomBytes(12).toString('hex'); // 24 hex
    const validator = crypto.randomBytes(32).toString('hex'); // 64 hex
    const validatorHash = sha256Hex(validator);

    rSt.tokens[selector] = {
      selector,
      validatorHash,
      memberId: cleanId,
      deviceLabel: parseDeviceLabel(userAgent),
      createdAt: now,
      lastUsedAt: now,
      expiresAt: now + authConfig.REMEMBER_TTL_MS,
    };
    this._saveRememberState();

    return {
      cookieValue: `${selector}.${validator}`,
      selector,
      expiresAt: rSt.tokens[selector].expiresAt,
    };
  }

  /**
   * Hatırlama çerezini doğrular ve başarılıysa döndürür (rotate).
   * ÇALINMA TESPİTİ: selector kayıtlı ancak validator özeti uyuşmuyorsa o üyenin TÜM cihazları iptal edilir!
   */
  consumeAndRotateRememberToken(rawCookieValue, { userAgent = '', nowMs = Date.now() } = {}) {
    if (typeof rawCookieValue !== 'string' || !rawCookieValue.includes('.')) {
      return { ok: false, reason: 'INVALID_FORMAT' };
    }
    const [selector, validator] = rawCookieValue.trim().split('.');
    if (!/^[a-f0-9]{16,40}$/i.test(selector || '') || !/^[a-f0-9]{32,128}$/i.test(validator || '')) {
      return { ok: false, reason: 'INVALID_FORMAT' };
    }

    const rSt = this._loadRememberState();
    const record = rSt.tokens[selector];
    const now = Number(nowMs) || Date.now();
    if (!record) {
      return { ok: false, reason: 'NOT_FOUND' };
    }
    if (record.expiresAt <= now) {
      delete rSt.tokens[selector];
      this._saveRememberState();
      return { ok: false, reason: 'EXPIRED' };
    }

    const providedHash = sha256Hex(validator);
    const a = Buffer.from(record.validatorHash, 'utf8');
    const b = Buffer.from(providedHash, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      // ÇALINMA TESPİTİ! O üyenin TÜM cihazlarını derhal iptal et!
      const affectedMemberId = record.memberId;
      this.revokeAllRememberTokensForMember(affectedMemberId);
      this.appendAudit({ action: 'remember_theft_detected' });
      return { ok: false, reason: 'THEFT_DETECTED', revokedAll: true };
    }

    const member = this.findById(record.memberId);
    if (!member || member.status !== 'active') {
      delete rSt.tokens[selector];
      this._saveRememberState();
      return { ok: false, reason: member ? 'MEMBER_INACTIVE' : 'MEMBER_DELETED', memberStatus: member ? member.status : null };
    }

    // Kullanımda döndür (eski selector silinir, yeni selector + validator + 90 gün taze süre üretilir)
    const oldCreatedAt = record.createdAt;
    delete rSt.tokens[selector];

    const nextSelector = crypto.randomBytes(12).toString('hex');
    const nextValidator = crypto.randomBytes(32).toString('hex');
    rSt.tokens[nextSelector] = {
      selector: nextSelector,
      validatorHash: sha256Hex(nextValidator),
      memberId: member.id,
      deviceLabel: userAgent ? parseDeviceLabel(userAgent) : record.deviceLabel,
      createdAt: oldCreatedAt,
      lastUsedAt: now,
      expiresAt: now + authConfig.REMEMBER_TTL_MS,
    };
    this._saveRememberState();

    this.updateMember(member.id, { lastLoginAt: now });

    return {
      ok: true,
      member: this.findById(member.id),
      rotatedCookieValue: `${nextSelector}.${nextValidator}`,
      selector: nextSelector,
      expiresAt: rSt.tokens[nextSelector].expiresAt,
    };
  }

  revokeRememberTokenByCookieValue(rawCookieValue) {
    if (typeof rawCookieValue !== 'string' || !rawCookieValue.includes('.')) return false;
    const selector = rawCookieValue.trim().split('.')[0];
    return this.revokeRememberSelector(selector);
  }

  revokeRememberSelector(selector, { expectedMemberId = null } = {}) {
    const cleanSel = String(selector || '').trim();
    if (!cleanSel) return false;
    const rSt = this._loadRememberState();
    const rec = rSt.tokens[cleanSel];
    if (!rec) return false;
    if (expectedMemberId && rec.memberId !== expectedMemberId) return false;
    delete rSt.tokens[cleanSel];
    this._saveRememberState();
    return true;
  }

  revokeAllRememberTokensForMember(memberId) {
    const cleanId = String(memberId || '').trim();
    const rSt = this._loadRememberState();
    let count = 0;
    for (const [sel, rec] of Object.entries(rSt.tokens)) {
      if (rec && rec.memberId === cleanId) {
        delete rSt.tokens[sel];
        count += 1;
      }
    }
    if (count > 0) this._saveRememberState();
    return count;
  }

  listRememberSessions(memberId, { currentSelector = '' } = {}) {
    const cleanId = String(memberId || '').trim();
    const rSt = this._loadRememberState();
    const now = Date.now();
    return Object.values(rSt.tokens)
      .filter((t) => t && t.memberId === cleanId && t.expiresAt > now)
      .sort((a, b) => (b.lastUsedAt || b.createdAt) - (a.lastUsedAt || a.createdAt))
      .map((t) => ({
        selector: t.selector,
        deviceLabel: t.deviceLabel || 'Tarayıcı',
        createdAt: t.createdAt,
        lastUsedAt: t.lastUsedAt,
        expiresAt: t.expiresAt,
        isCurrent: Boolean(currentSelector && t.selector === currentSelector),
      }));
  }

  flush() {
    if (this._state) this._saveState();
    if (this._rememberState) this._saveRememberState();
  }
}

let singletonMemberStore = null;

function getMemberStore(options) {
  if (options && options.baseDir) {
    return new MemberStore(options);
  }
  if (!singletonMemberStore) {
    singletonMemberStore = new MemberStore();
  }
  return singletonMemberStore;
}

function setDefaultMemberStore(instance) {
  singletonMemberStore = instance || null;
}

function resetMemberStoreForTests() {
  singletonMemberStore = null;
}

module.exports = {
  MEMBER_ID_RE,
  UNIFIED_GOOGLE_ID_RE,
  MemberStore,
  generateMemberId,
  toUnifiedGoogleId,
  parseUnifiedGoogleId,
  buildDisplayName,
  resolveDefaultMembersDir,
  getMemberStore,
  setDefaultMemberStore,
  resetMemberStoreForTests,
};
